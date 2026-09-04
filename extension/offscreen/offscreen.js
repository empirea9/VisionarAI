/**
 * Offscreen Document — ML Inference Runtime
 *
 * This runs in an offscreen document (has DOM + Canvas access).
 * It handles all heavy ML tasks that the service worker can't do:
 *   - OCR (Tesseract.js)
 *   - Face detection (Transformers.js)
 *   - Vision analysis
 *   - Image cropping
 *
 * Communication: chrome.runtime.onMessage ↔ service-worker
 *
 * NOTE: For the prototype, OCR uses a lightweight approach.
 * Tesseract.js / ONNX models will be loaded on first use and cached.
 */

// ── State ──────────────────────────────────────────────────────

let tesseractWorker = null;
let faceDetector    = null;
let modelsLoading   = false;

// ── Message handler ────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  switch (msg.type) {

    case 'OFFSCREEN_OCR':
      handleOCR(msg.image)
        .then(sendResponse)
        .catch(function (err) {
          sendResponse({ success: false, error: err.message });
        });
      return true;

    case 'OFFSCREEN_FACE_DETECT':
      handleFaceDetection(msg.image)
        .then(sendResponse)
        .catch(function (err) {
          sendResponse({ success: false, error: err.message });
        });
      return true;

    case 'OFFSCREEN_VISION':
      handleVision(msg.image, msg.query)
        .then(sendResponse)
        .catch(function (err) {
          sendResponse({ success: false, error: err.message });
        });
      return true;

    case 'OFFSCREEN_CROP':
      handleCrop(msg.image, msg.bbox)
        .then(sendResponse)
        .catch(function (err) {
          sendResponse({ success: false, error: err.message });
        });
      return true;
  }
});

// ── OCR Handler ────────────────────────────────────────────────

async function handleOCR(imageDataUrl) {
  // For the prototype, we use the Canvas API to extract basic info.
  // In production, swap this with Tesseract.js:
  //   import Tesseract from 'tesseract.js';
  //   const worker = await Tesseract.createWorker('eng');
  //   const { data: { text } } = await worker.recognize(imageDataUrl);

  try {
    // Try to load Tesseract.js if available
    if (typeof Tesseract !== 'undefined') {
      if (!tesseractWorker) {
        tesseractWorker = await Tesseract.createWorker('eng');
      }
      var result = await tesseractWorker.recognize(imageDataUrl);
      return {
        success: true,
        text:    result.data.text,
        regions: result.data.words.map(function (w) {
          return {
            text: w.text,
            bbox: [w.bbox.x0, w.bbox.y0,
                   w.bbox.x1 - w.bbox.x0,
                   w.bbox.y1 - w.bbox.y0],
            confidence: w.confidence
          };
        })
      };
    }

    // Fallback: return empty (OCR library not loaded yet)
    console.warn('[Offscreen] Tesseract.js not loaded — OCR unavailable');
    return {
      success: true,
      text:    '[OCR not available — Tesseract.js not loaded]',
      regions: []
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Face Detection Handler ─────────────────────────────────────

async function handleFaceDetection(imageDataUrl) {
  // For the prototype, this is a stub.
  // In production, use Transformers.js:
  //   import { pipeline } from '@huggingface/transformers';
  //   const detector = await pipeline('object-detection', 'Xenova/detr-resnet-50');

  try {
    if (typeof pipeline !== 'undefined' && !faceDetector) {
      faceDetector = await pipeline('object-detection',
        'Xenova/detr-resnet-50', { device: 'webgpu' });
    }

    if (faceDetector) {
      var results = await faceDetector(imageDataUrl);
      var faces = results
        .filter(function (r) { return r.label === 'person' || r.label === 'face'; })
        .map(function (r) {
          return {
            bbox: [r.box.xmin, r.box.ymin,
                   r.box.xmax - r.box.xmin,
                   r.box.ymax - r.box.ymin],
            confidence: r.score
          };
        });
      return { success: true, faces: faces };
    }

    // Stub: no faces detected (model not loaded)
    return { success: true, faces: [] };
  } catch (err) {
    return { success: false, error: err.message, faces: [] };
  }
}

// ── Vision Handler ─────────────────────────────────────────────

async function handleVision(imageDataUrl, query) {
  // Stub for prototype.
  // In production, use a visual Q&A or image classification model.
  return {
    success:     true,
    description: '[Vision model not loaded — stub response]',
    objects:     []
  };
}

// ── Image Cropping ─────────────────────────────────────────────

async function handleCrop(imageDataUrl, bbox) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () {
      var canvas = document.getElementById('workCanvas') || document.createElement('canvas');
      var x = bbox[0], y = bbox[1], w = bbox[2], h = bbox[3];

      canvas.width  = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

      resolve({
        success:      true,
        croppedImage: canvas.toDataURL('image/png')
      });
    };
    img.onerror = function () {
      reject(new Error('Failed to load image for cropping'));
    };
    img.src = imageDataUrl;
  });
}

console.log('[Offscreen] ML runtime loaded');
