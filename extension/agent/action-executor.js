/**
 * Action Executor — Content Script
 * Validates and executes actions returned by the LLM on the live DOM.
 * Uses the elementMap built by dom-collector.js.
 */
(function () {
  'use strict';

  const BA = window.__BrowserAgent = window.__BrowserAgent || {};

  function executeAction(action) {
    try {
      switch (action.type) {
        case 'click':    return doClick(action);
        case 'type':     return doType(action);
        case 'scroll':   return doScroll(action);
        case 'select':   return doSelect(action);
        case 'navigate': return doNavigate(action);
        case 'wait':     return { success: true, action: 'wait' };
        default:
          return { success: false, error: 'Unknown action: ' + action.type };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Click ────────────────────────────────────────────────────

  function doClick(action) {
    var el = BA.elementMap.get(action.elementId);
    if (!el)                    return fail(action.elementId, 'not found');
    if (!document.contains(el)) return fail(action.elementId, 'removed from DOM');

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    var r = el.getBoundingClientRect();
    var cx = r.x + r.width / 2;
    var cy = r.y + r.height / 2;

    el.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true, clientX: cx, clientY: cy }));
    el.dispatchEvent(new MouseEvent('mousedown',  { bubbles: true, clientX: cx, clientY: cy }));
    el.dispatchEvent(new MouseEvent('mouseup',    { bubbles: true, clientX: cx, clientY: cy }));
    el.click();

    return { success: true, action: 'click', elementId: action.elementId };
  }

  // ── Type ─────────────────────────────────────────────────────

  function doType(action) {
    var el = BA.elementMap.get(action.elementId);
    if (!el) return fail(action.elementId, 'not found');

    el.focus();
    if (action.clear !== false) el.value = '';

    el.value = action.text || '';
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return { success: true, action: 'type', elementId: action.elementId };
  }

  // ── Scroll ───────────────────────────────────────────────────

  function doScroll(action) {
    window.scrollBy({
      left:     action.deltaX || 0,
      top:      action.deltaY || 500,
      behavior: 'smooth'
    });
    return { success: true, action: 'scroll' };
  }

  // ── Select (dropdown) ────────────────────────────────────────

  function doSelect(action) {
    var el = BA.elementMap.get(action.elementId);
    if (!el) return fail(action.elementId, 'not found');

    el.value = action.value || '';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, action: 'select', elementId: action.elementId };
  }

  // ── Navigate ─────────────────────────────────────────────────

  function doNavigate(action) {
    if (!action.url) return { success: false, error: 'No URL provided' };
    window.location.href = action.url;
    return { success: true, action: 'navigate', url: action.url };
  }

  // ── Helper ───────────────────────────────────────────────────

  function fail(id, reason) {
    return { success: false, error: 'Element ' + id + ' ' + reason };
  }

  BA.executeAction = executeAction;
})();
