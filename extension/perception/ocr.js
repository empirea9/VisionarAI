/**
 * OCR — ES module
 * Messaging interface for Tesseract.js OCR running in the offscreen document.
 * The actual inference happens in offscreen/offscreen.js.
 */

/**
 * Run OCR on an image.
 * @param {string} imageDataUrl - base64 image
 * @returns {Promise<{ text: string, regions: Array }>}
 */
export async function runOCR(imageDataUrl) {
  try {
    var response = await chrome.runtime.sendMessage({
      type:  'OFFSCREEN_OCR',
      image: imageDataUrl
    });

    if (response && response.success) {
      return {
        text:    response.text || '',
        regions: response.regions || []
      };
    }

    console.warn('[OCR] Failed:', response?.error);
    return { text: '', regions: [] };
  } catch (err) {
    console.warn('[OCR] Not available:', err.message);
    return { text: '', regions: [] };
  }
}
