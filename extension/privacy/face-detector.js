/**
 * Face Detector — ES module
 * Stub for local face detection using Transformers.js / ONNX Runtime.
 * Actual inference runs in the offscreen document; this module provides
 * the messaging interface used by the service worker.
 */

/**
 * Request face detection from the offscreen document.
 * @param {string} imageDataUrl - base64 image to analyze
 * @returns {Promise<Array>} Array of { bbox, confidence }
 */
export async function detectFaces(imageDataUrl) {
  try {
    var response = await chrome.runtime.sendMessage({
      type:   'OFFSCREEN_FACE_DETECT',
      image:  imageDataUrl
    });

    if (response && response.success) {
      return response.faces || [];
    }
    console.warn('[FaceDetector] Detection failed:', response?.error);
    return [];
  } catch (err) {
    console.warn('[FaceDetector] Not available:', err.message);
    return [];
  }
}

/**
 * Convert face detection results to PrivacyMap regions.
 */
export function facesToPrivacyRegions(faces) {
  return faces.map(function (face) {
    return {
      type: 'FACE',
      bbox: face.bbox,
      confidence: face.confidence
    };
  });
}
