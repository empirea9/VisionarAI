/**
 * PII Detector — ES module (imported by service-worker)
 * Detects personally-identifiable information in text and DOM metadata.
 * Runs entirely locally — no data leaves the browser.
 */

// ── Regex patterns for common PII ──────────────────────────────

const PATTERNS = {
  EMAIL:        /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  PHONE:        /(?:\+\d{1,3}[\s\-]?)?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4}\b/g,
  CREDIT_CARD:  /\b(?:\d[ \-]*?){13,19}\b/g,
  SSN:          /\b\d{3}[\s\-]?\d{2}[\s\-]?\d{4}\b/g,
  AADHAAR:      /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g,
  PAN:          /\b[A-Z]{5}\d{4}[A-Z]\b/g,
  IP_ADDRESS:   /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g
};

// DOM attributes that often contain sensitive data
const SENSITIVE_FIELD_TYPES = [
  'password', 'email', 'tel', 'cc-number', 'cc-exp',
  'cc-csc', 'credit-card'
];

const SENSITIVE_NAMES = /passw|secret|token|api.?key|ssn|aadhaar|pan.?card|cvv|cvc/i;

/**
 * Scan a text string for PII. Returns an array of { type, match, index }.
 */
export function detectTextPII(text) {
  if (!text) return [];

  var hits = [];
  for (var type in PATTERNS) {
    var regex = new RegExp(PATTERNS[type].source, PATTERNS[type].flags);
    var m;
    while ((m = regex.exec(text)) !== null) {
      hits.push({ type: type, match: m[0], index: m.index });
    }
  }
  return hits;
}

/**
 * Check whether a DOM element description represents a sensitive field.
 */
export function isSensitiveField(element) {
  if (!element) return false;

  // Check input type
  if (SENSITIVE_FIELD_TYPES.indexOf(element.inputType) !== -1) return true;
  if (SENSITIVE_FIELD_TYPES.indexOf(element.type) !== -1)      return true;

  // Check name / placeholder / ariaLabel
  var fields = [element.name, element.placeholder, element.ariaLabel].join(' ');
  if (SENSITIVE_NAMES.test(fields)) return true;

  return false;
}

/**
 * Scan an entire PageState and return a PrivacyMap.
 */
export function scanPageState(pageState) {
  var regions = [];
  var redactedCount = 0;

  // Scan elements
  (pageState.elements || []).forEach(function (el) {
    // Check if field itself is sensitive
    if (isSensitiveField(el)) {
      regions.push({
        type:      'SENSITIVE_FIELD',
        elementId: el.id,
        fieldType: el.inputType || el.type
      });
      redactedCount++;
    }

    // Check element text / value for PII
    var textHits = detectTextPII(el.text + ' ' + el.value);
    textHits.forEach(function (hit) {
      regions.push({
        type:      hit.type,
        elementId: el.id,
        match:     hit.match
      });
      redactedCount++;
    });
  });

  // Scan relevant text blocks
  (pageState.relevantText || []).forEach(function (block, i) {
    var hits = detectTextPII(block.text);
    hits.forEach(function (hit) {
      regions.push({
        type:       hit.type,
        textBlock:  i,
        match:      hit.match
      });
      redactedCount++;
    });
  });

  return {
    processed:     true,
    redactedCount: redactedCount,
    regions:       regions
  };
}
