/**
 * Background Service Worker — ES module
 * Central orchestrator for the Private Browser Agent.
 *
 * Flow:
 * 1. User enters task in popup
 * 2. Service worker gets PageState from content script
 * 3. Perception Router decides what processing is needed
 * 4. If visual processing needed → screenshot → offscreen full privacy pipeline
 * 5. Privacy Engine sanitizes text in PageState
 * 6. Sends AgentRequest to FastAPI server
 * 7. Receives AgentResponse with answer + actions
 * 8. Forwards actions to content script for execution
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

// Keywords that suggest visual analysis is needed
const VISION_KEYWORDS  = /chart|graph|plot|diagram|image|picture|photo|screenshot|visual|show|display|what.*look|who.*screen|what.*screen|video|player|face|person|people|ui|layout|interface|describe|look at/i;
const OCR_KEYWORDS     = /read|text|says?|written|content of|extract|pdf|document|scan|ocr/i;
const CLICK_KEYWORDS   = /click|press|tap|hit|select|choose|open|close|toggle|submit|button/i;
const TYPE_KEYWORDS    = /type|enter|fill|write|input|search for|put/i;
const SCROLL_KEYWORDS  = /scroll|down|up|bottom|top|next page/i;

function getPerceptionPlan(task, pageState) {
  var plan = {
    needsDOM:        true,
    needsScreenshot: true,  // Default to true for spatial awareness
    needsOCR:        false,
    needsVision:     true,  // Default to true so it can see UI layout
    cropRegion:      null,
    reasoning:       'Defaulting to visual context to understand spatial relationships and layout.'
  };

  if (!task) return plan;

  var hasCanvas = (pageState.media || []).some(function (m) { return m.isCanvas; });
  var hasImages = (pageState.media || []).some(function (m) { return m.tag === 'img'; });

  // Extremely strict fast path (only for pure scrolling)
  if (/^scroll (down|up|bottom|top)$/i.test(task.trim())) {
    plan.needsScreenshot = false;
    plan.needsVision = false;
    plan.reasoning = 'Trivial scroll task — DOM only, visual processing skipped for speed.';
    return plan;
  }

  // OCR path
  if (OCR_KEYWORDS.test(task) && (hasImages || hasCanvas)) {
    plan.needsOCR = true;
    var imgTarget = (pageState.media || []).find(function (m) {
      return m.tag === 'img' || m.isCanvas;
    });
    if (imgTarget) plan.cropRegion = imgTarget.bbox;
    plan.reasoning = 'Task asks to read content and page has images/canvas — using OCR + Vision.';
    return plan;
  }

  // Target specific visual elements if explicitly asked
  if (VISION_KEYWORDS.test(task) && !/screen|ui|layout|interface/i.test(task)) {
    var target = (pageState.media || []).find(function (m) {
      return m.tag === 'video' || m.isCanvas || m.isSVG || m.tag === 'img';
    });
    if (target) plan.cropRegion = target.bbox;
    plan.reasoning = 'Task asks about specific visual content — cropped screenshot for Vision AI.';
    return plan;
  }

  return plan;
}

// ── Configuration ──────────────────────────────────────────────

const DEFAULT_SERVER = 'http://localhost:8000';
let serverUrl = DEFAULT_SERVER;

chrome.storage.sync.get(['serverUrl'], function (data) {
  if (data.serverUrl) serverUrl = data.serverUrl;
});

// ── Offscreen document management ──────────────────────────────

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
    if (!err.message.includes('already exists')) {
      console.error('[SW] Offscreen creation failed:', err);
    }
    offscreenCreated = true;
  }
}

// ── Message handler ────────────────────────────────────────────

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
      return true;

    case 'SET_SERVER_URL':
      serverUrl = msg.url || DEFAULT_SERVER;
      chrome.storage.sync.set({ serverUrl: serverUrl });
      sendResponse({ success: true, serverUrl: serverUrl });
      return true;

    case 'GET_STATUS':
      sendResponse({ serverUrl: serverUrl, offscreen: offscreenCreated });
      return true;

    case 'CHECK_SERVER':
      sendResponse({ success: true, online: true });
      return true;

    case 'PRELOAD_MODELS':
      ensureOffscreen()
        .then(function () { sendResponse({ success: true }); })
        .catch(function (err) { sendResponse({ success: false, error: err.message }); });
      return true;
  }
});

// ── Core task handler ──────────────────────────────────────────

async function handleTask(task, tabId) {
  var steps = [];

  function log(msg) {
    steps.push(msg);
    chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', steps: steps }).catch(function () {});
  }

  try {
    // 1 — Get active tab
    if (!tabId) {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || !tabs.length) throw new Error('No active tab found');
      tabId = tabs[0].id;
    }

    // 1.5 - Get API Key
    var d = await chrome.storage.local.get('geminiApiKey');
    if (!d.geminiApiKey) {
      throw new Error('API Key is missing. Please set it in the extension settings.');
    }
    var geminiApiKey = d.geminiApiKey;

    log('Reading page DOM...');

    // 2 — Get page state from content script
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
    log('Found ' + (pageState.elements || []).length + ' elements');

    // 3 — Perception routing
    var plan = getPerceptionPlan(task, pageState);
    log(plan.reasoning);

    var visualContext   = null;
    var ocrText         = '';
    var visualPrivacy   = null;

    // 4 — Visual processing pipeline (if needed)
    if (plan.needsScreenshot) {
      await ensureOffscreen();

      log('Capturing screenshot...');
      var screenshot = await captureScreenshot();

      // Run the FULL privacy pipeline in offscreen document:
      // Detection (YOLOS ViT) + OCR (Tesseract) + Redaction (Canvas)
      log('Running local ViT + OCR models...');

      var privacyResult;
      if (typeof window !== 'undefined' && window.handleFullPrivacyPipeline) {
        // Firefox fallback: scripts share the same background page context
        try {
          privacyResult = await window.handleFullPrivacyPipeline(screenshot);
        } catch(e) {
          privacyResult = { success: false, error: e.message };
        }
      } else {
        privacyResult = await chrome.runtime.sendMessage({
          type:  'OFFSCREEN_FULL_PRIVACY',
          image: screenshot
        }).catch(err => ({ success: false, error: err.message }));
      }

      if (privacyResult && privacyResult.success) {
        visualContext = privacyResult.sanitizedImage;
        ocrText       = privacyResult.ocrText || '';
        visualPrivacy = {
          regions:      privacyResult.privacyRegions || [],
          redactedCount: privacyResult.redactedCount || 0
        };

        if (privacyResult.redactedCount > 0) {
          log('Redacted ' + privacyResult.redactedCount + ' sensitive regions in image');
        }
        log('Visual processing complete');
      } else {
        log('Warning: Visual processing failed: ' + (privacyResult ? privacyResult.error : 'unknown'));
      }
    }

    // 5 — Text privacy: sanitize DOM-extracted PageState
    log('Sanitizing text data...');
    var redacted      = redactPageState(pageState);
    var sanitizedState = redacted.sanitizedState;
    var textPrivacy    = redacted.privacyMeta;

    if (textPrivacy.redactedCount > 0) {
      log('Redacted ' + textPrivacy.redactedCount + ' PII items in text');
    }

    // Append OCR text to relevant text
    if (ocrText) {
      sanitizedState.relevantText = sanitizedState.relevantText || [];
      sanitizedState.relevantText.push({ tag: 'ocr', text: ocrText, role: 'ocr-result' });
    }

    // Merge privacy metadata
    var combinedPrivacy = {
      processed:    true,
      redactedCount: textPrivacy.redactedCount + (visualPrivacy ? visualPrivacy.redactedCount : 0),
      regions:       textPrivacy.regions.concat(visualPrivacy ? visualPrivacy.regions : [])
    };

    // 6 — Build initial request
    log('Sending context to server...');
    var request = buildAgentRequest(task, sanitizedState, visualContext, combinedPrivacy);

    // ── Agentic Loop ──────────────────────────────────────────
    // After each action batch, re-read the DOM and call the server again
    // until it returns no more actions (task complete) or max iterations reached.
    // Give the agent essentially unlimited steps. 
    // The loop detector will break it if it gets stuck.
    var MAX_ITERATIONS = 50;
    var iteration = 0;
    var actionHistory = [];
    var finalAnswer = null;
    var lastFailedActions = []; // track failures for retry context

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      // Re-read & re-sanitize page on subsequent loops
      if (iteration > 1) {
        log('Re-reading page after actions (step ' + iteration + ')...');
        var newStateResp = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_STATE' });
        if (!newStateResp || !newStateResp.success) break;

        var newRedacted = redactPageState(newStateResp.pageState);
        request = buildAgentRequest(
          task,
          newRedacted.sanitizedState,
          null,
          { processed: true, redactedCount: newRedacted.privacyMeta.redactedCount, regions: [] }
        );
        request.action_history = actionHistory;

        // Tell the server exactly what failed so it can try a different approach
        if (lastFailedActions.length > 0) {
          request.retry_reason = 'The following actions FAILED and were NOT executed: ' +
            lastFailedActions.map(function(a) {
              return a.type + (a.elementId ? ' #' + a.elementId : '') + (a.error ? ' (' + a.error + ')' : '');
            }).join(', ') + '. Please try a different approach (e.g. click the element first to activate it, then type).';
          lastFailedActions = [];
        }
      }

      var response;
      try {
        response = await runAgent(geminiApiKey, task, request.page_state, request.visual_context, request.action_history, request.retry_reason);
      } catch (e) {
        log('Agent Error: ' + e.message);
        break; // Stop loop if API fails
      }

      if (response.answer) finalAnswer = response.answer;

      // No more actions? Done.
      if (!response.actions || response.actions.length === 0) {
        log('Task complete — no further actions needed.');
        break;
      }

      // Execute this batch of actions
      log('Executing ' + response.actions.length + ' action(s) (step ' + iteration + ')...');

      var anyFailed = false;

      // Prevent infinite loops where the LLM just repeats the exact same action
      var currentActionsStr = JSON.stringify(response.actions);
      if (iteration > 1 && currentActionsStr === lastActionsStr && !lastAnyFailed) {
        log('Agent returned exact same actions as previous step. Forcing retry with different approach...');
        lastFailedActions = response.actions.map(function(a) {
          return { ...a, error: 'You just executed this exact action and it did not change the page state enough. DO NOT repeat it. Try a different approach (e.g. hover instead of click).' };
        });
        lastActionsStr = ""; // reset to prevent double-trigger
        lastAnyFailed = true;
        // Small wait, then let the loop continue to re-read DOM and send the retry reason
        await new Promise(function (r) { setTimeout(r, 400); });
        continue;
      }

      for (var action of response.actions) {
        var result = await chrome.tabs.sendMessage(tabId, {
          type: 'EXECUTE_ACTION', action: action
        });

        var ok    = result && result.success;
        var icon  = ok ? 'Done:' : 'Fail:';
        var desc  = action.type +
          (action.elementId ? ' #' + action.elementId : '') +
          (action.text ? ' "' + String(action.text).substring(0, 40) + '"' : '');

        if (!ok) {
          anyFailed = true;
          var errMsg = (result && result.error) ? result.error : 'unknown error';
          log(icon + ' ' + desc + ' — ' + errMsg);
          lastFailedActions.push({ ...action, error: errMsg });
        } else {
          log(icon + ' ' + desc);
        }

        actionHistory.push({ ...action, success: ok, error: (result && result.error) || null });
      }

      var lastActionsStr = currentActionsStr;
      var lastAnyFailed = anyFailed;

      // If all actions failed, don't count this as progress — keep retrying
      if (anyFailed) {
        log('Some actions failed — will retry with corrected approach...');
        // Small extra wait before retry
        await new Promise(function (r) { setTimeout(r, 400); });
      }

      // Wait for DOM mutations to settle
      await new Promise(function (r) { setTimeout(r, 800); });
    }

    var hitMaxSteps = iteration >= MAX_ITERATIONS;
    if (hitMaxSteps) {
      log('Reached max steps (' + MAX_ITERATIONS + ') — stopping.');
    }

    // Check if any actions actually succeeded
    var successCount = actionHistory.filter(function(a) { return a.success; }).length;
    var totalActions = actionHistory.length;

    if (totalActions > 0 && successCount === 0) {
      log('Warning: All ' + totalActions + ' action(s) failed to execute.');
      return { 
        success: false, 
        error: "Task failed to complete. All attempted actions resulted in errors.", 
        steps: steps 
      };
    } 

    if (hitMaxSteps && !finalAnswer) {
      finalAnswer = "❌ I was unable to fully complete the task. I hit the maximum number of allowed steps before I could finish. (" + successCount + "/" + totalActions + " actions succeeded).";
    }

    log('Completed agent loop (' + successCount + '/' + totalActions + ' actions succeeded)');

    return {
      success:  true,
      answer:   finalAnswer || null,
      actions:  actionHistory,
      privacy:  combinedPrivacy,
      steps:    steps
    };

  } catch (err) {
    log('Error: ' + err.message);
    return { success: false, error: err.message, steps: steps };
  }
}

// (Server communication removed — now strictly local via agent.js)

console.log('[SW] Private Browser Agent loaded');
