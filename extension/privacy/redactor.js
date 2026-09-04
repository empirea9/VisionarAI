/**
 * Redactor — ES module (imported by service-worker)
 * Takes a PageState + PrivacyMap and produces a sanitized copy
 * where all detected PII is replaced with safe placeholders.
 */

import { scanPageState, isSensitiveField, detectTextPII } from './pii-detector.js';

const REDACT_LABELS = {
  EMAIL:           '[REDACTED_EMAIL]',
  PHONE:           '[REDACTED_PHONE]',
  CREDIT_CARD:     '[REDACTED_CC]',
  SSN:             '[REDACTED_SSN]',
  AADHAAR:         '[REDACTED_AADHAAR]',
  PAN:             '[REDACTED_PAN]',
  IP_ADDRESS:      '[REDACTED_IP]',
  SENSITIVE_FIELD: '[REDACTED]'
};

/**
 * Deep-clone and redact a PageState.
 * Returns { sanitizedState, privacyMeta }.
 */
export function redactPageState(pageState) {
  // Deep clone so we don't mutate the original
  var clone = JSON.parse(JSON.stringify(pageState));

  // Run detection
  var privacyMap = scanPageState(clone);

  // Redact element text and values
  (clone.elements || []).forEach(function (el) {
    if (isSensitiveField(el)) {
      el.value = REDACT_LABELS.SENSITIVE_FIELD;
      el.text  = el.text ? redactString(el.text) : '';
    } else {
      el.text  = redactString(el.text || '');
      el.value = redactString(el.value || '');
    }
    // Also redact placeholder if it contains PII
    el.placeholder = redactString(el.placeholder || '');
  });

  // Redact text blocks
  (clone.relevantText || []).forEach(function (block) {
    block.text = redactString(block.text || '');
  });

  return {
    sanitizedState: clone,
    privacyMeta:    privacyMap
  };
}

/**
 * Replace all PII matches in a string with placeholders.
 */
function redactString(str) {
  if (!str) return str;

  var hits = detectTextPII(str);
  if (hits.length === 0) return str;

  // Sort by index descending so replacements don't shift positions
  hits.sort(function (a, b) { return b.index - a.index; });

  hits.forEach(function (hit) {
    var label = REDACT_LABELS[hit.type] || '[REDACTED]';
    str = str.substring(0, hit.index) + label + str.substring(hit.index + hit.match.length);
  });

  return str;
}

/**
 * Redact regions in an image using Canvas API.
 * Takes a base64 data URL and a list of bbox regions to blur.
 * Returns a new base64 data URL.
 * NOTE: This must run in an offscreen document (needs Canvas).
 */
export function redactImageRegions(dataUrl, regions) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () {
      var canvas = new OffscreenCanvas(img.width, img.height);
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // Apply blur/black box to each region
      regions.forEach(function (region) {
        var x = region.bbox[0];
        var y = region.bbox[1];
        var w = region.bbox[2];
        var h = region.bbox[3];

        // Black out the region
        ctx.fillStyle = 'black';
        ctx.fillRect(x, y, w, h);

        // Draw redaction label
        ctx.fillStyle = '#ff4444';
        ctx.font = '14px monospace';
        ctx.fillText(region.type || 'REDACTED', x + 4, y + 18);
      });

      canvas.convertToBlob({ type: 'image/png' }).then(function (blob) {
        var reader = new FileReader();
        reader.onloadend = function () { resolve(reader.result); };
        reader.readAsDataURL(blob);
      }).catch(reject);
    };
    img.onerror = function () { reject(new Error('Failed to load image for redaction')); };
    img.src = dataUrl;
  });
}
