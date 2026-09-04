/**
 * DOM Collector — Content Script
 * Runs inside every webpage. Collects interactive + media elements
 * and builds a compact representation for the agent.
 * 
 * Uses a shared namespace: window.__BrowserAgent
 */
(function () {
  'use strict';

  const BA = window.__BrowserAgent = window.__BrowserAgent || {};

  // ── Element ID tracking ──────────────────────────────────────
  BA.elementMap = new Map();   // id → HTMLElement (for action execution)
  let nextId = 1;

  // ── Selectors ────────────────────────────────────────────────
  const INTERACTIVE = [
    'button', 'a', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="textbox"]',
    '[role="checkbox"]', '[role="radio"]', '[role="tab"]',
    '[role="menuitem"]', '[role="option"]', '[role="switch"]',
    '[onclick]', '[tabindex]:not([tabindex="-1"])',
    'label', 'summary', 'details'
  ].join(', ');

  const MEDIA = 'img, video, canvas, svg, iframe, object, embed';

  function isVisibleAndInViewport(el, rect) {
    // 1. Basic visibility check
    if (rect.width === 0 && rect.height === 0) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;

    // 2. Viewport intersection check
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;

    // Must be at least partially visible within the viewport
    return (
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= windowHeight &&
      rect.left <= windowWidth
    );
  }

  function getText(el) {
    // Prefer aria-label, then innerText (trimmed, capped)
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.substring(0, 200);
    const txt = (el.innerText || el.textContent || '').trim();
    return txt.substring(0, 200);
  }

  function getType(el) {
    const role = el.getAttribute('role');
    if (role) return role;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') return el.type || 'text';
    if (tag === 'a') return 'link';
    return tag;
  }

  // ── Main collection function ─────────────────────────────────

  function collectElements() {
    BA.elementMap.clear();
    nextId = 1;

    const combined = document.querySelectorAll(INTERACTIVE + ', ' + MEDIA);
    const elements = [];

    combined.forEach(function (el) {
      const rect = el.getBoundingClientRect();
      
      // Strict filter: skip if hidden or outside current viewport
      if (!isVisibleAndInViewport(el, rect)) return;

      const id = nextId++;
      BA.elementMap.set(id, el);

      elements.push({
        id:          id,
        tag:         el.tagName.toLowerCase(),
        type:        getType(el),
        text:        getText(el),
        ariaLabel:   el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        bbox:        [Math.round(rect.x), Math.round(rect.y),
                      Math.round(rect.width), Math.round(rect.height)],
        visible:     true, // We already filtered out invisible ones
        value:       el.value || '',
        href:        el.href || '',
        src:         el.src || '',
        name:        el.name || '',
        inputType:   el.type || '',
        checked:     !!el.checked,
        disabled:    !!el.disabled
      });
    });

    // Sort strictly by vertical position (Y coordinate) so top elements are prioritized
    elements.sort(function(a, b) {
      return a.bbox[1] - b.bbox[1];
    });

    // Hard-cap the payload to 150 elements to prevent server crashes and LLM context overload
    if (elements.length > 150) {
      elements.length = 150;
    }

    return elements;
  }

  // ── Exports ──────────────────────────────────────────────────
  BA.collectElements   = collectElements;
  BA.INTERACTIVE_SEL   = INTERACTIVE;
  BA.MEDIA_SEL         = MEDIA;
})();
