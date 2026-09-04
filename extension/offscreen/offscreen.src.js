/**
 * Offscreen ML Runtime — Source (gets bundled by webpack)
 *
 * Runs real ML models locally in the browser:
 *   - YOLOS-tiny (ViT-based object detection) — detects people/objects
 *   - Tesseract.js — OCR text extraction from images
 *   - Canvas API — image cropping and PII redaction (blur/mask)
 *
 * Models are downloaded from HuggingFace on first use and cached in browser.
 */

import { pipeline, env } from '@huggingface/transformers';

// ── Configure Transformers.js ──────────────────────────────────
env.allowLocalModels = false;   // Download from HuggingFace Hub
env.useBrowserCache  = true;    // Cache models in browser storage

// ── Model singletons (lazy loaded) ────────────────────────────
let objectDetector = null;
let ocrWorker      = null;

const STATUS = {
  objectDetection: 'idle',  // idle | loading | ready | error
  ocr:             'idle',
};

// ── Lazy model loaders ─────────────────────────────────────────

async function getObjectDetector() {
  if (objectDetector) return objectDetector;

  STATUS.objectDetection = 'loading';
  broadcast('MODEL_STATUS', { model: 'objectDetection', status: 'loading' });

  try {
    objectDetector = await pipeline('object-detection', 'Xenova/yolos-tiny', {
      dtype: 'fp32',
    });
    STATUS.objectDetection = 'ready';
    broadcast('MODEL_STATUS', { model: 'objectDetection', status: 'ready' });
    console.log('[Offscreen] YOLOS-tiny loaded');
    return objectDetector;
  } catch (err) {
    STATUS.objectDetection = 'error';
    broadcast('MODEL_STATUS', { model: 'objectDetection', status: 'error', error: err.message });
    throw err;
  }
}

async function getOCRWorker() {
  if (ocrWorker) return ocrWorker;

  STATUS.ocr = 'loading';
  broadcast('MODEL_STATUS', { model: 'ocr', status: 'loading' });

  try {
    // Dynamic import for Tesseract — it may fail if not bundled properly,
    // in which case we gracefully degrade
    var Tesseract = await import('tesseract.js');
    ocrWorker = await Tesseract.createWorker('eng');
    STATUS.ocr = 'ready';
    broadcast('MODEL_STATUS', { model: 'ocr', status: 'ready' });
    console.log('[Offscreen] Tesseract.js loaded');
    return ocrWorker;
  } catch (err) {
    STATUS.ocr = 'error';
    console.warn('[Offscreen] Tesseract.js failed to load:', err.message);
    broadcast('MODEL_STATUS', { model: 'ocr', status: 'error', error: err.message });
    return null;
  }
}

// ── Message handler ────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  var handler = null;

  switch (msg.type) {
    case 'OFFSCREEN_OCR':          handler = handleOCR(msg.image); break;
    case 'OFFSCREEN_FACE_DETECT':  handler = handleFaceDetection(msg.image); break;
    case 'OFFSCREEN_VISION':       handler = handleVision(msg.image, msg.query); break;
    case 'OFFSCREEN_CROP':         handler = handleCrop(msg.image, msg.bbox); break;
    case 'OFFSCREEN_FULL_PRIVACY': handler = handleFullPrivacyPipeline(msg.image); break;
    case 'OFFSCREEN_GET_STATUS':   sendResponse({ success: true, status: STATUS }); return;
    default: return;
  }

  handler
    .then(sendResponse)
    .catch(function (err) { sendResponse({ success: false, error: err.message }); });
  return true;
});

// ── OCR Handler ────────────────────────────────────────────────

async function handleOCR(imageDataUrl) {
  var worker = await getOCRWorker();
  if (!worker) {
    return { success: true, text: '', regions: [], note: 'OCR not available' };
  }

  var result = await worker.recognize(imageDataUrl);
  return {
    success: true,
    text:    result.data.text,
    regions: result.data.words.map(function (w) {
      return {
        text:       w.text,
        bbox:       [w.bbox.x0, w.bbox.y0, w.bbox.x1 - w.bbox.x0, w.bbox.y1 - w.bbox.y0],
        confidence: w.confidence,
      };
    }),
  };
}

// ── Face / Person Detection ────────────────────────────────────

async function handleFaceDetection(imageDataUrl) {
  var detector = await getObjectDetector();
  var results  = await detector(imageDataUrl, { threshold: 0.5 });

  var faces = results.filter(function (r) {
    return r.label === 'person';
  });

  return {
    success: true,
    faces: faces.map(function (r) {
      return {
        bbox:       [r.box.xmin, r.box.ymin, r.box.xmax - r.box.xmin, r.box.ymax - r.box.ymin],
        confidence: r.score,
        label:      r.label,
      };
    }),
  };
}

// ── Vision Handler (Object Detection for screen understanding) ─

async function handleVision(imageDataUrl, query) {
  var detector = await getObjectDetector();
  var results  = await detector(imageDataUrl, { threshold: 0.3 });

  var description = results.length > 0
    ? 'Objects detected: ' + results.map(function (r) {
        return r.label + ' (' + (r.score * 100).toFixed(1) + '%)';
      }).join(', ')
    : 'No objects detected in the image region.';

  return {
    success:     true,
    description: description,
    objects: results.map(function (r) {
      return {
        label:      r.label,
        confidence: r.score,
        bbox:       [r.box.xmin, r.box.ymin, r.box.xmax - r.box.xmin, r.box.ymax - r.box.ymin],
      };
    }),
  };
}

// ── Full Privacy Pipeline ──────────────────────────────────────
//    Screenshot → detect faces + OCR PII → redact → return sanitized

async function handleFullPrivacyPipeline(imageDataUrl) {
  var privacyRegions = [];

  // 1. Face/Person blurring is DISABLED by default. 
  // It interferes with tasks like identifying actors in videos, 
  // and for sensitive local forms, Vision AI isn't triggered anyway (DOM is used).

  // 2. Run OCR and scan for PII
  var ocrText = '';
  try {
    var worker = await getOCRWorker();
    if (worker) {
      var ocrResult = await worker.recognize(imageDataUrl);
      ocrText = ocrResult.data.text;

      // Scan OCR words for PII patterns
      ocrResult.data.words.forEach(function (w) {
        var piiType = detectPIIInText(w.text);
        if (piiType) {
          privacyRegions.push({
            type: piiType,
            bbox: [w.bbox.x0, w.bbox.y0, w.bbox.x1 - w.bbox.x0, w.bbox.y1 - w.bbox.y0],
            text: w.text,
          });
        }
      });

      // Also scan multi-word sequences (emails, phone numbers span multiple words)
      var lines = ocrResult.data.lines || [];
      lines.forEach(function (line) {
        var lineText = line.text || '';
        var lineType = detectPIIInText(lineText);
        if (lineType) {
          privacyRegions.push({
            type: lineType,
            bbox: [line.bbox.x0, line.bbox.y0, line.bbox.x1 - line.bbox.x0, line.bbox.y1 - line.bbox.y0],
            text: lineText,
          });
        }
      });
    }
  } catch (err) {
    console.warn('[Offscreen] OCR failed:', err.message);
  }

  // 3. Redact the image
  var sanitizedImage = imageDataUrl;
  if (privacyRegions.length > 0) {
    sanitizedImage = await redactImage(imageDataUrl, privacyRegions);
  }

  return {
    success:        true,
    sanitizedImage: sanitizedImage,
    ocrText:        ocrText,
    privacyRegions: privacyRegions,
    redactedCount:  privacyRegions.length,
  };
}

// Expose to window so service-worker.js can call it directly in Firefox
if (typeof window !== 'undefined') {
  window.handleFullPrivacyPipeline = handleFullPrivacyPipeline;
}

// ── PII Pattern Matching ───────────────────────────────────────

var PII_PATTERNS = [
  { type: 'EMAIL',       regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/ },
  { type: 'PHONE',       regex: /(?:\+?\d{1,3}[\s\-]?)?\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4}/ },
  { type: 'CREDIT_CARD', regex: /\b(?:\d[ \-]*?){13,19}\b/ },
  { type: 'AADHAAR',     regex: /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/ },
  { type: 'PAN',         regex: /\b[A-Z]{5}\d{4}[A-Z]\b/ },
  { type: 'SSN',         regex: /\b\d{3}[\s\-]?\d{2}[\s\-]?\d{4}\b/ },
];

function detectPIIInText(text) {
  if (!text || text.length < 4) return null;
  for (var i = 0; i < PII_PATTERNS.length; i++) {
    if (PII_PATTERNS[i].regex.test(text)) return PII_PATTERNS[i].type;
  }
  return null;
}

// ── Image Redaction via Canvas ─────────────────────────────────

function redactImage(dataUrl, regions) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () {
      var canvas = document.createElement('canvas');
      canvas.width  = img.width;
      canvas.height = img.height;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      regions.forEach(function (region) {
        var x = region.bbox[0], y = region.bbox[1];
        var w = region.bbox[2], h = region.bbox[3];

        if (region.type === 'PERSON') {
          // Blur people/faces by pixelating
          pixelateRegion(ctx, x, y, w, h, 12);
        } else {
          // Black out text PII
          ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
          ctx.fillRect(x, y, w, h);
          // Label
          ctx.fillStyle = '#ff4444';
          ctx.font = 'bold 10px monospace';
          ctx.fillText('[' + region.type + ']', x + 2, y + h - 3);
        }
      });

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = function () { reject(new Error('Failed to load image')); };
    img.src = dataUrl;
  });
}

function pixelateRegion(ctx, x, y, w, h, blockSize) {
  // Read the region
  var imageData = ctx.getImageData(x, y, w, h);
  var data = imageData.data;

  // Pixelate
  for (var py = 0; py < h; py += blockSize) {
    for (var px = 0; px < w; px += blockSize) {
      var idx = (py * w + px) * 4;
      var r = data[idx], g = data[idx + 1], b = data[idx + 2];

      for (var by = 0; by < blockSize && py + by < h; by++) {
        for (var bx = 0; bx < blockSize && px + bx < w; bx++) {
          var i = ((py + by) * w + (px + bx)) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b;
        }
      }
    }
  }

  ctx.putImageData(imageData, x, y);

  // Add semi-transparent overlay
  ctx.fillStyle = 'rgba(255, 0, 0, 0.15)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#ff4444';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#ff4444';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('[PERSON]', x + 3, y + 14);
}

// ── Image Cropping ─────────────────────────────────────────────

function handleCrop(imageDataUrl, bbox) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () {
      var canvas = document.createElement('canvas');
      var x = bbox[0], y = bbox[1], w = bbox[2], h = bbox[3];
      canvas.width  = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      resolve({ success: true, croppedImage: canvas.toDataURL('image/png') });
    };
    img.onerror = function () { reject(new Error('Crop failed')); };
    img.src = imageDataUrl;
  });
}

// ── Broadcast helper ───────────────────────────────────────────

function broadcast(type, data) {
  chrome.runtime.sendMessage(Object.assign({ type: type }, data)).catch(function () {});
}

console.log('[Offscreen] ML runtime loaded — models will be downloaded on first use');
