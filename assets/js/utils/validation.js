/**
 * Centralized Validation Module for Snap Finance
 * - Collects WooCommerce state (errors, terms, shipping)
 * - Aggregates merchant field validation via SnapTransaction
 * - Provides a single preflight() gate for Classic & Blocks
 */
(function(){
  'use strict';

  function readWooErrors() {
    try {
      const selectors = [
        '.woocommerce-NoticeGroup-checkout .woocommerce-error li',
        '.woocommerce-error',
        '.woocommerce-notice--error'
      ];
      const msgs = [];
      selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(n => {
          if (n && n.textContent && n.offsetParent !== null) {
            const txt = String(n.textContent).trim();
            // Skip Woo terms error if the terms are currently checked (stale banner)
            try {
              const termsChecked = !!document.querySelector('#terms')?.checked;
              if (termsChecked && /terms/i.test(txt)) {
                return; // ignore stale terms error
              }
            } catch(_) {}
            msgs.push(txt);
          }
        });
      });
      // Revert: return all Woo errors so preflight remains conservative
      return msgs;
    } catch(_) { return []; }
  }

  function readTermsState() {
    try {
      const terms = document.querySelector('input#terms');
      if (terms && !terms.checked) {
        return { ok: false, reason: 'terms_unchecked', message: 'Please accept the terms and conditions to continue.' };
      }
      return { ok: true };
    } catch(_) { return { ok: true }; }
  }

  function readShippingState() {
    try {
      // Find shipping area in Classic/Blocks review table
      const containers = [
        '.woocommerce-checkout-review-order-table .woocommerce-shipping-totals',
        '.woocommerce-shipping-methods',
        '#shipping_method',
        '.woocommerce-checkout #order_review .shipping'
      ];
      let host = null;
      for (const sel of containers) { const el = document.querySelector(sel); if (el) { host = el; break; } }
      if (!host) return { ok: true };

      const text = (host.textContent || '').toLowerCase();
      const unavailable = (
        text.includes('no shipping method') ||
        text.includes('no shipping methods') ||
        text.includes("don't deliver") ||
        text.includes('do not deliver') ||
        text.includes('we do not deliver') ||
        text.includes("we don't deliver") ||
        text.includes('deliver to your area')
      );
      if (unavailable) {
        return { ok: false, reason: 'shipping_unavailable', message: 'Shipping is unavailable for the entered address.' };
      }

      // WooCommerce renders hidden inputs when only one method exists (auto-selected)
      const hiddenInputs = Array.from(document.querySelectorAll('input[type="hidden"][name^="shipping_method"]'));
      if (hiddenInputs.length > 0) {
        return { ok: true }; // single method implicitly selected
      }

      // Consider only visible radio inputs for multiple methods
      const visibleRadios = Array.from(document.querySelectorAll('input[type="radio"][name^="shipping_method"]'))
        .filter(el => el && el.offsetParent !== null);
      const selectedRadio = document.querySelector('input[type="radio"][name^="shipping_method"]:checked');
      if (visibleRadios.length > 0 && !selectedRadio) {
        return { ok: false, reason: 'shipping_unselected', message: 'Please select a shipping method to continue.' };
      }

      // Dropdown select fallback (rare)
      const selects = Array.from(document.querySelectorAll('select[name^="shipping_method"]'));
      if (selects.length > 0) {
        const anySelected = selects.some(s => s && s.value && String(s.value).trim().length > 0);
        if (!anySelected) {
          return { ok: false, reason: 'shipping_unselected', message: 'Please select a shipping method to continue.' };
        }
      }
      return { ok: true };
    } catch(_) { return { ok: true }; }
  }

  function inferMerchantRequiredSet() {
    try {
      // Blocks: attempt to read validation keys if available
      const required = new Set();
      try {
        const checkout = window.wp?.data?.select('wc/store/checkout');
        const errs = checkout?.getValidationErrors?.() || {};
        Object.keys(errs || {}).forEach(k => required.add(String(k)));
      } catch(_) {}

      // Classic: infer from markup
      const classicSel = ['.validate-required [name]', '[aria-required="true"]'];
      classicSel.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          const nm = el.getAttribute('name') || '';
          if (nm) required.add(nm);
        });
      });
      return required;
    } catch(_) { return new Set(); }
  }

  function validateMerchantFields(snapParams) {
    try {
      const tx = window.SnapTransaction?.build?.(snapParams) || null;
      const messages = window.SnapTransaction?.validate?.(tx, snapParams) || [];
      return { tx, messages };
    } catch(e) {
      return { tx: null, messages: [] };
    }
  }

  function collectWooState() {
    const terms = readTermsState();
    const ship  = readShippingState();
    const errs  = readWooErrors();
    const wooOk = terms.ok && ship.ok && errs.length === 0;
    const reasons = [];
    if (!terms.ok) reasons.push(terms.message);
    if (!ship.ok)  reasons.push(ship.message);
    if (errs.length) reasons.push(...errs);
    return { ok: wooOk, reasons, errors: errs, terms, ship };
  }

  function preflight(snapParams) {
    const woo = collectWooState();
    const { tx, messages } = validateMerchantFields(snapParams || window.snap_params || {});
    const snapOk = (messages || []).length === 0;
    const ok = !!(woo.ok && snapOk);
    const reasons = [];
    if (!woo.ok) reasons.push(...woo.reasons);
    if (!snapOk) reasons.push(...messages);
    const message = ok ? '' : (reasons[0] || 'Please complete required fields to continue.');
    return { ok, message, messages: reasons, snapMessages: messages, wooState: woo, tx };
  }

  window.Validation = {
    collectWooState,
    validateMerchantFields,
    preflight,
    inferMerchantRequiredSet
  };
})();


