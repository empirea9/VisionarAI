/**
 * Action Executor — Content Script
 * Executes structured actions (click, type, scroll, select, navigate)
 * on DOM elements identified by the agent.
 *
 * Handles both standard inputs AND contenteditable divs (WhatsApp, Gmail, etc.)
 */
(function () {
  'use strict';

  const BA = window.__BrowserAgent = window.__BrowserAgent || {};

  // ── Helpers ──────────────────────────────────────────────────

  function getElement(id) {
    var el = BA.elementMap && BA.elementMap.get(id);
    if (!el) throw new Error('Element not found: id=' + id);
    return el;
  }

  /**
   * Type text into any element:
   * - Standard input/textarea: sets .value and fires input + change events
   * - contenteditable (WhatsApp, Gmail, etc.): uses document.execCommand
   *   with proper focus/selection events so React/Vue pick it up
   */
  function typeIntoElement(el, text) {
    el.focus();

    var isContentEditable = el.isContentEditable ||
      el.getAttribute('contenteditable') === 'true' ||
      el.getAttribute('contenteditable') === '';

    if (isContentEditable) {
      // For contenteditable (WhatsApp, Notion, etc.)
      // Clear existing content
      el.textContent = '';

      // Move cursor to end
      var range = document.createRange();
      var sel   = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);

      // Insert text via execCommand so undo history works
      // and React synthetic events fire correctly
      document.execCommand('insertText', false, text);

      // Dispatch additional events for frameworks that need them
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

      // Simulate key events for apps that listen for Enter/keyup
      text.split('').forEach(function (ch) {
        el.dispatchEvent(new KeyboardEvent('keydown',  { bubbles: true, cancelable: true, key: ch }));
        el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: ch }));
        el.dispatchEvent(new KeyboardEvent('keyup',    { bubbles: true, cancelable: true, key: ch }));
      });

    } else {
      // Standard input/textarea
      var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      ) || Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      );

      if (nativeInputValueSetter && nativeInputValueSetter.set) {
        // Use native setter so React's onChange fires
        nativeInputValueSetter.set.call(el, text);
      } else {
        el.value = text;
      }

      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /**
   * Press Enter on a contenteditable or input element.
   * Used to submit messages (WhatsApp, ChatGPT, etc.)
   */
  function pressEnter(el) {
    var keyProps = {
      key: 'Enter', code: 'Enter', keyCode: 13,
      which: 13, bubbles: true, cancelable: true
    };
    el.dispatchEvent(new KeyboardEvent('keydown',  keyProps));
    el.dispatchEvent(new KeyboardEvent('keypress', keyProps));
    el.dispatchEvent(new KeyboardEvent('keyup',    keyProps));
  }

  // ── Main dispatcher ──────────────────────────────────────────

  function executeAction(action) {
    var type      = action.type;
    var elementId = action.elementId;
    var text      = action.text;
    var value     = action.value;
    var url       = action.url;
    var deltaX    = action.deltaX || 0;
    var deltaY    = action.deltaY || 0;

    try {
      switch (type) {

        // ── Click ────────────────────────────────────────────
        case 'click': {
          var el = getElement(elementId);
          el.focus();
          if (typeof el.click === 'function') {
            el.click();
          }
          // Also dispatch a full mouse event sequence for sites using mousedown
          // This also acts as a fallback if el.click() doesn't exist (e.g. some SVGs)
          ['mousedown', 'mouseup', 'click'].forEach(function (evType) {
            el.dispatchEvent(new MouseEvent(evType, {
              bubbles: true, cancelable: true, view: window
            }));
          });
          return { success: true, action: type };
        }

        // ── Type ─────────────────────────────────────────────
        case 'type': {
          if (text === undefined || text === null) {
            return { success: false, error: 'No text provided for type action' };
          }
          var el = getElement(elementId);
          typeIntoElement(el, String(text));
          return { success: true, action: type, typed: text };
        }

        // ── Type + Submit (press Enter after typing) ──────────
        // The agent can use type:"typeAndSubmit" to do both in one step
        case 'typeAndSubmit': {
          if (text === undefined || text === null) {
            return { success: false, error: 'No text provided for typeAndSubmit action' };
          }
          var el = getElement(elementId);
          typeIntoElement(el, String(text));
          setTimeout(function () { pressEnter(el); }, 100);
          return { success: true, action: type, typed: text };
        }

        // ── Scroll ───────────────────────────────────────────
        case 'scroll': {
          var target = window;
          
          if (elementId) {
            var el = getElement(elementId);
            // If the element itself is scrollable, use it
            if (el.scrollHeight > el.clientHeight) {
              target = el;
            } else {
              // Otherwise, just scroll the element into view
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              return { success: true, action: type, scrolledTo: true };
            }
          } else {
            // If no element specified, find the largest scrollable container (crucial for SPAs like WhatsApp)
            var divs = document.querySelectorAll('div, main, section, ul');
            var maxArea = 0;
            for (var i = 0; i < divs.length; i++) {
              var container = divs[i];
              var style = window.getComputedStyle(container);
              if (container.scrollHeight > container.clientHeight && style.overflowY !== 'hidden' && style.overflowY !== 'visible') {
                var rect = container.getBoundingClientRect();
                var area = rect.width * rect.height;
                if (area > maxArea) {
                  maxArea = area;
                  target = container;
                }
              }
            }
          }

          if (target === window) {
            window.scrollBy({ top: deltaY, left: deltaX, behavior: 'smooth' });
          } else {
            target.scrollBy({ top: deltaY, left: deltaX, behavior: 'smooth' });
          }
          return { success: true, action: type };
        }

        // ── Select (dropdown) ────────────────────────────────
        case 'select': {
          var el = getElement(elementId);
          el.value = value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, action: type, selected: value };
        }

        // ── Navigate ─────────────────────────────────────────
        case 'navigate': {
          if (!url) return { success: false, error: 'No URL provided for navigate action' };
          window.location.href = url;
          return { success: true, action: type, url: url };
        }

        // ── Press Key ────────────────────────────────────────
        case 'pressKey': {
          var el = elementId ? getElement(elementId) : document.activeElement;
          var key = text || 'Enter';
          var keyCode = key === 'Enter' ? 13 : key.charCodeAt(0);
          var keyProps = {
            key: key, code: key, keyCode: keyCode,
            which: keyCode, bubbles: true, cancelable: true
          };
          el.dispatchEvent(new KeyboardEvent('keydown',  keyProps));
          el.dispatchEvent(new KeyboardEvent('keyup',    keyProps));
          return { success: true, action: type, key: key };
        }

        // ── Hover ────────────────────────────────────────────
        case 'hover': {
          var el = getElement(elementId);
          el.focus();
          ['mouseenter', 'mouseover', 'mousemove'].forEach(function(evType) {
            el.dispatchEvent(new MouseEvent(evType, {
              bubbles: true, cancelable: true, view: window
            }));
          });
          return { success: true, action: type };
        }

        default:
          return { success: false, error: 'Unknown action type: ' + type };
      }

    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  BA.executeAction = executeAction;

})();
