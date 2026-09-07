/**
 * Background Service Worker - ES module
 * Central orchestrator for the Private Browser Agent.
 */

import { redactPageState }    from '../privacy/redactor.js';
import { buildAgentRequest }  from '../agent/context-builder.js';
import { captureScreenshot }  from '../perception/screenshot.js';
import { runAgent }           from '../agent/agent.js';

// Initialize Chrome Side Panel (global behavior)
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
}

// Global state for cancellation
let activeAbortController = null;

const VISION_KEYWORDS  = /chart|graph|plot|diagram|image|picture|photo|screenshot|visual|show|display|what.*look|who.*screen|what.*screen|video|player|face|person|people|ui|layout|interface|describe|look at/i;
const OCR_KEYWORDS     = /read|text|says?|written|content of|extract|pdf|document|scan|ocr/i;

let offscreenCreated = false;

async function ensureOffscreen() {
  if (offscreenCreated) return;
  try {
    if (chrome.offscreen) {
      await chrome.offscreen.createDocument({
        url:           'offscreen/offscreen.html',
        reasons:       ['DOM_PARSER', 'WORKERS'],
        justification: 'ML inference (ViT object detection, OCR, image redaction) requires DOM/Canvas'
      });
    }
    offscreenCreated = true;
  } catch (err) {
    offscreenCreated = true;
  }
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  switch (msg.type) {
    case 'RUN_TASK':
      handleTask(msg.task, msg.tabId)
        .then(sendResponse)
        .catch(function (err) { 
          if (err.name === 'AbortError') {
            sendResponse({ success: false, error: 'Cancelled by user' });
          } else {
            sendResponse({ success: false, error: err.message });
          }
        });
      return true;

    case 'CANCEL_TASK':
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
      sendResponse({ success: true });
      return;

    case 'PRELOAD_MODELS':
      Promise.resolve().then(() => sendResponse({ success: true })).catch(err => sendResponse({ success: false, error: err.message }));
      return true;
  }
});

async function handleTask(task, tabId) {
  var steps = [];
  function log(msg) {
    steps.push(msg);
    chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', steps: steps }).catch(function () {});
  }

  try {
    if (!tabId) {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || !tabs.length) throw new Error('No active tab found');
      tabId = tabs[0].id;
    }

    log('Reading page DOM...');
    var stateResp;
    try {
      stateResp = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_STATE' });
    } catch (e) {
      if (e.message.includes('Receiving end does not exist')) {
        throw new Error('Cannot run on this page. Please navigate to a standard website (not a chrome:// settings page or blank tab).');
      }
      throw e;
    }
    
    if (!stateResp || !stateResp.success) {
      throw new Error('Failed to read page: ' + (stateResp ? stateResp.error : 'no response'));
    }
    var pageState = stateResp.pageState;

    if (pageState.elements) {
      log('Found ' + pageState.elements.length + ' elements');
    }

    var plan = { needsScreenshot: true };
    log('Defaulting to visual context to understand spatial relationships and layout.');

    var visualContext   = null;
    var ocrText         = '';
    var visualPrivacy   = null;

    if (plan.needsScreenshot) {
      // offscreen bypassed
      log('Capturing screenshot...');
      var screenshot = await captureScreenshot();

      log('Running local PII redaction pipeline (SW native)...');
      var textPrivacyMeta = redactPageState(pageState).privacyMeta;
      var piiBoxes = [];
      (textPrivacyMeta.regions || []).forEach(function(r) {
          var el = pageState.elements.find(e => e.id === r.elementId);
          if (el && el.bbox) piiBoxes.push({ type: r.type, bbox: el.bbox });
      });

      // Inject a script into the page to find exact bounding boxes of all text PII
      var domPiiBoxes = [];
      try {
        var execRes = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function() {
            var boxes = [];
            
            // Approach 1: Try window.find() with regex matches from innerText
            var text = document.body.innerText || "";
            var emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
            var matches = text.match(emailRegex) || [];
            
            // Deduplicate matches
            matches = [...new Set(matches)];
            
            matches.forEach(function(m) {
              window.getSelection().removeAllRanges();
              // window.find searches the visual page, piercing span boundaries
              if (window.find(m, false, false, true, false, false, false)) {
                var range = window.getSelection().getRangeAt(0);
                var rect = range.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  boxes.push({ type: 'EMAIL', bbox: [rect.x, rect.y, rect.width, rect.height] });
                }
              }
            });
            window.getSelection().removeAllRanges(); // cleanup

            // Approach 2: If innerText didn't have it (Shadow DOM), we recursively extract text
            if (boxes.length === 0) {
                function extractShadowText(root) {
                    var t = root.innerText || root.textContent || "";
                    var els = root.querySelectorAll ? root.querySelectorAll('*') : [];
                    for(var i=0; i<els.length; i++) {
                        if (els[i].shadowRoot) t += " " + extractShadowText(els[i].shadowRoot);
                    }
                    return t;
                }
                var shadowMatches = extractShadowText(document.body).match(emailRegex) || [];
                shadowMatches = [...new Set(shadowMatches)];
                shadowMatches.forEach(function(m) {
                  window.getSelection().removeAllRanges();
                  if (window.find(m, false, false, true, false, false, false)) {
                    var range = window.getSelection().getRangeAt(0);
                    var rect = range.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                      boxes.push({ type: 'EMAIL', bbox: [rect.x, rect.y, rect.width, rect.height] });
                    }
                  }
                });
                window.getSelection().removeAllRanges();
            }

            return boxes;
          }
        });
        if (execRes && execRes[0] && execRes[0].result) {
            domPiiBoxes = execRes[0].result;
            piiBoxes = piiBoxes.concat(domPiiBoxes);
        }
      } catch (err) { log('Failed to scan DOM for PII: ' + err.message); }

      var sanitizedDataUrl = screenshot;
      if (piiBoxes.length > 0) {
          try {
              var res = await fetch(screenshot);
              var blob = await res.blob();
              var img = await createImageBitmap(blob);
              var canvas = new OffscreenCanvas(img.width, img.height);
              var ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);

              // Calculate DPI scaling factor
              var scaleX = img.width / (pageState.viewport[0] || img.width);
              var scaleY = img.height / (pageState.viewport[1] || img.height);

              ctx.font = 'bold ' + Math.round(16 * scaleY) + 'px monospace';
              piiBoxes.forEach(function(b) {
                  var x = b.bbox[0] * scaleX;
                  var y = b.bbox[1] * scaleY;
                  var w = b.bbox[2] * scaleX;
                  var h = b.bbox[3] * scaleY;
                  
                  ctx.fillStyle = 'black';
                  // Add a tiny bit of padding to ensure it covers
                  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
                  ctx.fillStyle = '#ff4444';
                  ctx.fillText(b.type, x + 4, y + (16 * scaleY));
              });

              var redactedBlob = await canvas.convertToBlob({ type: 'image/png' });
              sanitizedDataUrl = await new Promise((resolve) => {
                  var reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result);
                  reader.readAsDataURL(redactedBlob);
              });
              log('Redacted ' + piiBoxes.length + ' PII regions from image context');
          } catch(e) {
              log('Canvas redaction failed: ' + e.message);
          }
      } else {
        log('No PII detected on screen');
      }

      visualContext = sanitizedDataUrl;
      ocrText = '';
      visualPrivacy = {
          regions: piiBoxes,
          redactedCount: piiBoxes.length
      };
      log('Visual processing complete');
    }

    log('Sanitizing text data...');
    var redacted      = redactPageState(pageState);
    var sanitizedState = redacted.sanitizedState;
    var textPrivacy    = redacted.privacyMeta;

    log('Sending context to server...');
    var geminiApiKey = null;
    try {
      var storage = await chrome.storage.local.get(['geminiApiKey']);
      geminiApiKey = storage.geminiApiKey;
    } catch (e) {}

    var request = buildAgentRequest(
      task,
      sanitizedState,
      visualContext ? { image: visualContext, ocr: ocrText, privacy: visualPrivacy } : null
    );

    var finalAnswer = null;
    var successCount = 0;

    for (var i = 0; i < 3; i++) {
      var response;
      try {
        response = await runAgent(geminiApiKey, task, request.page_state, request.visual_context ? request.visual_context.image : null, request.action_history, request.retry_reason);
      } catch (e) {
        log('Agent Error: ' + e.message);
        break; 
      }

      if (response.answer) finalAnswer = response.answer;

      if (!response.actions || response.actions.length === 0) {
        log('Task complete - no further actions needed.');
        break;
      }

      log('Executing ' + response.actions.length + ' actions...');
      var execResult = await chrome.tabs.sendMessage(tabId, {
        type: 'EXECUTE_ACTIONS',
        actions: response.actions
      });

      if (!execResult || !execResult.success) {
        log('Action execution failed: ' + (execResult ? execResult.error : 'timeout'));
        request.retry_reason = 'Action failed: ' + (execResult ? execResult.error : 'timeout');
      } else {
        successCount += execResult.results.filter(function (r) { return r.success; }).length;
        request.action_history = request.action_history || [];
                  // Merge the original action intent with the execution result so the LLM sees the full context (type, elementId, text)
          var mergedResults = response.actions.map(function(act, idx) {
            var res = execResult.results[idx] || {};
            return Object.assign({}, act, { success: res.success !== false, error: res.error });
          });
          request.action_history.push(...mergedResults);

        var newStateResp = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_STATE' });
        if (!newStateResp || !newStateResp.success) break;

        var newRedacted = redactPageState(newStateResp.pageState);
        request = buildAgentRequest(
          task,
          newRedacted.sanitizedState,
          visualContext ? { image: visualContext, ocr: ocrText, privacy: visualPrivacy } : null
        );
      }
    }

    log('Completed agent loop (' + successCount + '/' + (request.action_history ? request.action_history.length : 0) + ' actions succeeded)');

    return {
      success:  true,
      answer:   finalAnswer,
      steps:    steps
    };

  } catch (err) {
    log('Error: ' + err.message);
    return { success: false, error: err.message, steps: steps };
  }
}
console.log('[SW] Private Browser Agent loaded');












