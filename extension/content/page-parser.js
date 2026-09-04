/**
 * Page Parser — Content Script
 * Extracts media elements and relevant text blocks from the page.
 * Complements dom-collector.js by providing richer context.
 */
(function () {
  'use strict';

  const BA = window.__BrowserAgent = window.__BrowserAgent || {};

  // ── Media extraction ─────────────────────────────────────────

  function extractMedia() {
    const results = [];
    const els = document.querySelectorAll(BA.MEDIA_SEL || 'img,video,canvas,svg,iframe');

    els.forEach(function (el, i) {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;        // skip tiny / hidden

      const tag = el.tagName.toLowerCase();
      results.push({
        index:    i,
        tag:      tag,
        src:      el.src || el.getAttribute('data-src') || '',
        alt:      el.alt || '',
        bbox:     [Math.round(r.x), Math.round(r.y),
                   Math.round(r.width), Math.round(r.height)],
        isCanvas: tag === 'canvas',
        isSVG:    tag === 'svg',
        width:    Math.round(r.width),
        height:   Math.round(r.height)
      });
    });

    return results;
  }

  // ── Relevant text extraction ─────────────────────────────────

  function extractText() {
    const blocks = [];
    const seen = new Set();
    const els = document.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,p,li,td,th,blockquote,figcaption,[role="heading"]'
    );

    els.forEach(function (el) {
      const txt = (el.innerText || '').trim();
      if (!txt || txt.length < 3 || txt.length > 500) return;
      if (seen.has(txt)) return;                           // dedupe
      seen.add(txt);

      blocks.push({
        tag:  el.tagName.toLowerCase(),
        text: txt.substring(0, 300),
        role: el.getAttribute('role') || ''
      });
    });

    return blocks.slice(0, 100);                           // cap at 100
  }

  // ── Exports ──────────────────────────────────────────────────
  BA.extractMedia = extractMedia;
  BA.extractText  = extractText;
})();
