// Pica — generic reusable modal shell (M15 manual-time).
//
// createModal({ titleKey, className }) → { root, body, titleEl, open, close, onClose }
//
// Uses native <dialog> with showModal() / close() so the browser provides:
//   • focus trap (Tab stays inside the dialog)
//   • focus restoration on close (returns to the element that opened the dialog)
//   • Escape key dismissal (fires the 'cancel' event before 'close')
//
// Backdrop click: detected by checking event.target === dialog. When
// showModal() is used, the dialog element fills the entire viewport behind
// the panel via the ::backdrop pseudo-element; clicks that land on the
// backdrop land on the <dialog> itself rather than any child.
//
// The factory is lazy: the first call to open() builds the DOM once and
// appends it to document.body. Subsequent calls to open/close reuse it.
//
// NO inline styles, NO innerHTML with dynamic content.
// Conforms to the CSP constraints enforced by test-security-headers.mjs.

import { t } from '/i18n.js';

// Counter for unique aria-labelledby IDs (valid even if multiple modals coexist).
let _modalCounter = 0;

/**
 * @param {object} [opts]
 * @param {string} [opts.titleKey]  i18n key for the modal title (optional).
 * @param {string} [opts.className] Extra class added to the <dialog> (optional).
 * @returns {{ root: HTMLDialogElement, body: HTMLElement, titleEl: HTMLElement,
 *             open: () => void, close: () => void, onClose: (cb: () => void) => void }}
 */
export function createModal({ titleKey, className } = {}) {
  const titleId = `modal-title-${++_modalCounter}`;
  let built = false;
  let dialog, panelEl, headEl, titleEl, closeBtn, bodyEl;
  let useNative = false;   // set in build(); stable after first open()
  const closeCallbacks = [];

  function build() {
    if (built) return;
    built = true;

    // <dialog class="modal [className]" aria-labelledby="modal-title-N">
    dialog = document.createElement('dialog');
    dialog.className = className ? `modal ${className}` : 'modal';
    dialog.setAttribute('aria-labelledby', titleId);

    // <div class="modal__panel">
    panelEl = document.createElement('div');
    panelEl.className = 'modal__panel';

    // <header class="modal__head">
    headEl = document.createElement('header');
    headEl.className = 'modal__head';

    // <h2 class="modal__title" id="modal-title-N">
    titleEl = document.createElement('h2');
    titleEl.className = 'modal__title';
    titleEl.id = titleId;
    if (titleKey) titleEl.textContent = t(titleKey);

    // <button type="button" class="modal__close" aria-label="Close">×</button>
    // margin-top:0 is handled in modal.css to beat the global button rule.
    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal__close';
    closeBtn.setAttribute('aria-label', t('modal.close'));
    closeBtn.textContent = '×';

    // <div class="modal__body"> — caller appends content here
    bodyEl = document.createElement('div');
    bodyEl.className = 'modal__body';

    // Assemble
    headEl.appendChild(titleEl);
    headEl.appendChild(closeBtn);
    panelEl.appendChild(headEl);
    panelEl.appendChild(bodyEl);
    dialog.appendChild(panelEl);
    document.body.appendChild(dialog);

    // Capture native <dialog> support once so open() and close() use the
    // same sentinel.  Mixing dialog.showModal (method check) with
    // dialog.close (always-truthy property) led to the hidden-attribute
    // fallback's _fireCallbacks() being unreachable (Fix 1).
    useNative = typeof dialog.showModal === 'function';

    // ---- Event wiring -------------------------------------------------------

    // Close button click
    closeBtn.addEventListener('click', () => close());

    // Backdrop click: event.target is the dialog element when the click lands
    // on the ::backdrop area (outside the panel). Clicks inside the panel
    // bubble up to panelEl first, not the dialog, so this is safe.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) close();
    });

    // native <dialog> fires 'cancel' when Escape is pressed (before 'close').
    // We call our close() to run cleanup (callbacks, hidden fallback) rather
    // than letting the browser close the dialog silently.
    dialog.addEventListener('cancel', (e) => {
      // Prevent the browser from automatically closing the dialog so we can
      // run our close() which handles the hidden-attribute fallback path too.
      e.preventDefault();
      close();
    });

    // PRIMARY callback path for native dialogs: 'close' fires after the
    // dialog element is closed (from our own dialog.close() call above — the
    // 'cancel' intercept ensures no other source reaches here on the native
    // path). The hidden-attribute fallback fires callbacks directly in close()
    // below because this event does not fire on non-native elements.
    if (useNative) {
      dialog.addEventListener('close', () => {
        _fireCallbacks();
      });
    }
  }

  function _fireCallbacks() {
    for (const cb of closeCallbacks) {
      try { cb(); } catch (_) { /* best-effort */ }
    }
  }

  function open() {
    build();
    // Guard against open()-while-open: showModal() throws InvalidStateError
    // if the dialog is already open (dialog.open is true). The hidden-
    // attribute path has no such guard of its own, so we check here for both
    // (Fix 2).
    if (dialog.open) return;
    if (useNative) {
      dialog.showModal();
    } else {
      dialog.hidden = false;
    }
  }

  function close() {
    if (!built) return;
    if (useNative) {
      // On the native path the 'close' event fires _fireCallbacks() (see
      // the listener registered in build()).  Do NOT call _fireCallbacks()
      // here — it would double-fire.
      dialog.close();
    } else {
      dialog.hidden = true;
      // On the hidden-attribute fallback the 'close' event never fires,
      // so we fire callbacks directly here.  Mutually exclusive with the
      // native path above so callbacks fire exactly once per close.
      _fireCallbacks();
    }
  }

  /**
   * Register a callback to be invoked whenever the modal closes (any trigger:
   * close button, backdrop click, Escape, programmatic close()). Callbacks are
   * best-effort; errors are swallowed so one bad callback cannot block others.
   *
   * Callbacks are ADDITIVE — each call pushes another entry onto the list.
   * Register once at construction time, NOT inside a per-open code path;
   * registering on every open() call would accumulate duplicate callbacks
   * across reopens (Fix 3).
   *
   * @param {() => void} cb
   */
  function onClose(cb) {
    closeCallbacks.push(cb);
  }

  return {
    /** The native <dialog> element (root). */
    get root() { build(); return dialog; },
    /** The .modal__body element — append your form/content here. */
    get body() { build(); return bodyEl; },
    /** The .modal__title element — set textContent to change the title after build. */
    get titleEl() { build(); return titleEl; },
    open,
    close,
    onClose,
  };
}
