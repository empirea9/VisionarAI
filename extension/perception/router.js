/**
 * Perception Router — ES module (imported by service-worker)
 * Analyzes the user's task + PageState to decide which perception
 * modules are needed. This avoids running expensive OCR/Vision when
 * a simple DOM read suffices.
 *
 *               Task + DOM
 *                   │
 *            ┌──────┼──────┐
 *            ▼      ▼      ▼
 *          DOM    OCR    Vision
 *        (always) (if   (if canvas/
 *                 img)   chart)
 */

// Keywords that suggest visual analysis is needed
const VISION_KEYWORDS  = /chart|graph|plot|diagram|image|picture|photo|screenshot|visual|show|display|what.*look|who.*screen|what.*screen|video|player|face|person|people|ui|layout|interface|describe|look at/i;
const OCR_KEYWORDS     = /read|text|says?|written|content of|extract|pdf|document|scan|ocr/i;
const CLICK_KEYWORDS   = /click|press|tap|hit|select|choose|open|close|toggle|submit|button/i;
const TYPE_KEYWORDS    = /type|enter|fill|write|input|search for|put/i;
const SCROLL_KEYWORDS  = /scroll|down|up|bottom|top|next page/i;

/**
 * Determine what perception capabilities are needed.
 * @returns {{ needsDOM: boolean, needsScreenshot: boolean, needsOCR: boolean,
 *             needsVision: boolean, cropRegion: number[]|null, reasoning: string }}
 */
export function getPerceptionPlan(task, pageState) {
  var plan = {
    needsDOM:        true,       // always
    needsScreenshot: false,
    needsOCR:        false,
    needsVision:     false,
    cropRegion:      null,
    reasoning:       ''
  };

  if (!task) return plan;

  var hasCanvas = (pageState.media || []).some(function (m) { return m.isCanvas; });
  var hasSVG    = (pageState.media || []).some(function (m) { return m.isSVG; });
  var hasImages = (pageState.media || []).some(function (m) { return m.tag === 'img'; });
  var hasVideo  = (pageState.media || []).some(function (m) { return m.tag === 'video' || m.tag === 'iframe'; });

  // ── Fast path: simple click / type / scroll ──────────────────
  if ((CLICK_KEYWORDS.test(task) || TYPE_KEYWORDS.test(task) || SCROLL_KEYWORDS.test(task)) && !VISION_KEYWORDS.test(task)) {
    plan.reasoning = 'Simple interaction task — DOM only, no visual processing needed.';
    return plan;
  }

  // ── Vision path: Screen, Videos, UI, Charts ──────────────────
  if (VISION_KEYWORDS.test(task)) {
    plan.needsScreenshot = true;
    plan.needsVision     = true;

    // If it's a specific video/canvas query, try to crop to it. 
    // Otherwise, for general "screen" queries, keep cropRegion null to send full screenshot.
    if (!/screen|ui|layout|interface/i.test(task)) {
      var target = (pageState.media || []).find(function (m) {
        return m.tag === 'video' || m.isCanvas || m.isSVG || m.tag === 'img';
      });
      if (target) plan.cropRegion = target.bbox;
    }

    plan.reasoning = 'Task asks about visual content (video/screen/faces) — capturing screenshot for Vision AI.';
    return plan;
  }

  // ── OCR path: reading text from images / PDFs ────────────────
  if (OCR_KEYWORDS.test(task) && (hasImages || hasCanvas)) {
    plan.needsScreenshot = true;
    plan.needsOCR        = true;

    var imgTarget = (pageState.media || []).find(function (m) {
      return m.tag === 'img' || m.isCanvas;
    });
    if (imgTarget) plan.cropRegion = imgTarget.bbox;

    plan.reasoning = 'Task asks to read content and page has images/canvas — need screenshot + OCR.';
    return plan;
  }

  // ── Vision for images without explicit keywords ──────────────
  if (VISION_KEYWORDS.test(task) && hasImages) {
    plan.needsScreenshot = true;
    plan.needsVision     = true;
    plan.reasoning = 'Task references visual content with images present.';
    return plan;
  }

  // ── Default: DOM only ────────────────────────────────────────
  plan.reasoning = 'No visual processing triggers matched — using DOM context only.';
  return plan;
}
