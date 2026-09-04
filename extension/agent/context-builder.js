/**
 * Context Builder — ES module (imported by service-worker)
 * Constructs the AgentRequest payload that gets sent to the server.
 * Applies a token budget so the payload doesn't blow up the LLM context.
 */

const MAX_ELEMENTS    = 150;
const MAX_TEXT_BLOCKS = 60;
const MAX_MEDIA       = 30;

/**
 * Build the request body for POST /agent
 */
export function buildAgentRequest(task, pageState, visualContext, privacyMeta) {
  // Compact the page state to fit within reasonable limits
  var compacted = compactPageState(pageState);

  return {
    task:            task,
    page_state:      compacted,
    visual_context:  visualContext || null,
    privacy: {
      processed:   !!(privacyMeta && privacyMeta.processed),
      redacted:    (privacyMeta && privacyMeta.redactedCount) || 0,
      regions:     (privacyMeta && privacyMeta.regions) || []
    }
  };
}

/**
 * Strip the PageState down to essentials so the LLM prompt stays small.
 */
function compactPageState(ps) {
  if (!ps) return {};

  // Only keep visible elements
  var visibleEls = (ps.elements || []).filter(function (e) { return e.visible; });

  // Trim to budget
  var els = visibleEls.slice(0, MAX_ELEMENTS).map(function (e) {
    return {
      id:          e.id,
      type:        e.type,
      tag:         e.tag,
      text:        (e.text || '').substring(0, 80),
      ariaLabel:   e.ariaLabel || undefined,
      placeholder: e.placeholder || undefined,
      href:        e.href || undefined,
      value:       e.value || undefined,
      checked:     e.checked || undefined,
      disabled:    e.disabled || undefined,
      bbox:        e.bbox
    };
  });

  return {
    url:          ps.url,
    title:        ps.title,
    viewport:     ps.viewport,
    elements:     els,
    media:        (ps.media || []).slice(0, MAX_MEDIA),
    relevantText: (ps.relevantText || []).slice(0, MAX_TEXT_BLOCKS)
  };
}
