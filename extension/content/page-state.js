/**
 * Page State — Content Script
 * Assembles the full PageState object and listens for messages
 * from the background service-worker.
 */
(function () {
  'use strict';

  const BA = window.__BrowserAgent = window.__BrowserAgent || {};

  // ── Build the complete page state ────────────────────────────

  function buildPageState() {
    return {
      url:            window.location.href,
      title:          document.title,
      viewport:       [window.innerWidth, window.innerHeight],
      scrollPosition: [Math.round(window.scrollX), Math.round(window.scrollY)],
      elements:       BA.collectElements(),
      media:          BA.extractMedia(),
      relevantText:   BA.extractText(),
      timestamp:      Date.now()
    };
  }

  BA.buildPageState = buildPageState;

  // ── Message listener ─────────────────────────────────────────

  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    switch (msg.type) {

      case 'GET_PAGE_STATE':
        try {
          sendResponse({ success: true, pageState: buildPageState() });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        return true;                                       // keep channel open

      case 'EXECUTE_ACTION':
        try {
          var result = BA.executeAction(msg.action);
          sendResponse(result);
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        return true;

      case 'EXECUTE_ACTIONS':
        // Execute a batch of actions sequentially
        (async function () {
          var results = [];
          for (var action of (msg.actions || [])) {
            // Small delay between actions for DOM to update
            await new Promise(function (r) { setTimeout(r, 300); });
            results.push(BA.executeAction(action));
          }
          sendResponse({ success: true, results: results });
        })();
        return true;
    }
  });

  console.log('[BrowserAgent] Content scripts loaded:', window.location.href);
})();
