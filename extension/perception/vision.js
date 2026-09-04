/**
 * Vision — ES module
 * Messaging interface for local vision model running in the offscreen doc.
 * Used for chart/graph understanding, object detection in canvas regions.
 */

/**
 * Run vision analysis on an image.
 * @param {string} imageDataUrl - base64 image
 * @param {string} query        - what to look for
 * @returns {Promise<{ description: string, objects: Array }>}
 */
export async function runVision(imageDataUrl, query) {
  try {
    var response = await chrome.runtime.sendMessage({
      type:  'OFFSCREEN_VISION',
      image: imageDataUrl,
      query: query || ''
    });

    if (response && response.success) {
      return {
        description: response.description || '',
        objects:     response.objects || []
      };
    }

    console.warn('[Vision] Failed:', response?.error);
    return { description: '', objects: [] };
  } catch (err) {
    console.warn('[Vision] Not available:', err.message);
    return { description: '', objects: [] };
  }
}
