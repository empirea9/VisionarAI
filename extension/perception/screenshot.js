/**
 * Screenshot — ES module (imported by service-worker)
 * Captures the visible tab and optionally crops to a bounding box.
 */

/**
 * Capture the currently visible tab as a PNG data URL.
 * Must be called from the background service worker.
 */
export async function captureScreenshot() {
  var dataUrl = await chrome.tabs.captureVisibleTab(null, {
    format:  'png',
    quality: 90
  });
  return dataUrl;
}

/**
 * Crop a screenshot data URL to a specific bounding box.
 * Since the service worker has no Canvas, this delegates to the offscreen doc.
 * @param {string} dataUrl - full screenshot
 * @param {number[]} bbox  - [x, y, width, height]
 * @returns {Promise<string>} cropped data URL
 */
export async function cropToRegion(dataUrl, bbox) {
  try {
    var response = await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_CROP',
      image: dataUrl,
      bbox:  bbox
    });
    if (response && response.success) return response.croppedImage;
    return dataUrl;  // fallback: return uncropped
  } catch (err) {
    console.warn('[Screenshot] Crop failed, using full screenshot:', err.message);
    return dataUrl;
  }
}
