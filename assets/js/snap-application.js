(function () {
  'use strict';
console.log('🔧 SnapApplication Loaded:', (window.snap_params && window.snap_params.plugin_version) || 'unknown');

  // Application status tracking
  let applicationStatus = 'none'; // 'none', 'pending', 'approved', 'denied', 'error'
  let applicationId = null;
  let applicationToken = null;
  let __limitsInvalid = false;
  let __limitsInfo = { min: null, max: null, total: null };

  // Lightweight helpers for watchdog
  const __snapNow = () => Date.now();
  const __snapSleep = (ms) => new Promise(r => setTimeout(r, ms));
  async function __snapWaitForSuccessOrTimeout(maxMs = 90000) {
    const start = __snapNow();
    while (__snapNow() - start < maxMs) {
      try {
        const app = (typeof SnapStorage !== 'undefined' && SnapStorage.get) ? (SnapStorage.get('application') || {}) : {};
        if (app && (app.status === 'success' || app.status === 'funded')) return 'success';
      } catch(_) {}
      await __snapSleep(1000);
    }
    return 'timeout';
  }
  function __snapNotify(msg) {
    try {
      console.warn('[Snap NOTICE]', msg);
      const el = document.createElement('div');
      el.textContent = msg;
      el.style.cssText = 'position:fixed;bottom:16px;left:16px;padding:10px 12px;background:#111;color:#fff;font:14px/1.2 system-ui;border-radius:8px;z-index:99999;opacity:.95';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 6000);
    } catch(_) {}
  }

  // URL-based fallback watcher (sandbox-friendly)
  let __snapUrlPollId = null;
  let __snapUrlPopstateHandler = null;
  let __snapUrlLastPath = null;
  function __stopUrlCompletionWatcher() {
    try {
      if (__snapUrlPopstateHandler) {
        window.removeEventListener('popstate', __snapUrlPopstateHandler);
        __snapUrlPopstateHandler = null;
      }
      if (__snapUrlPollId) {
        clearInterval(__snapUrlPollId);
        __snapUrlPollId = null;
      }
      __snapUrlLastPath = null;
      console.log('🧹 URL watcher: cleaned up');
    } catch(_) {}
  }
  function __startUrlCompletionWatcher(appId, token, triggerSuccessFn) {
    try {
      __stopUrlCompletionWatcher();
      console.log('🔭 URL watcher: starting (sandbox fallback)');
      __snapUrlLastPath = window.location.pathname + window.location.hash;
      const postJourney = (stage) => {
        try {
          const nonce = window.snap_params?.rest_nonce || window.snap_params?.restNonce || window.wpApiSettings?.nonce || '';
          fetch('/wp-json/snap/v1/journey', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
            credentials: 'same-origin',
            body: JSON.stringify({ stage, application_id: appId })
          }).then(r=>r.json()).then(j=>{
            if (!j?.ok) console.warn('🗒️ Journey note failed', j); else console.log('🗒️ Journey noted:', j.label, j.binary);
          }).catch(()=>{});
        } catch(_) {}
      };
      const checkUrl = () => {
        try {
          const currentPath = window.location.pathname + window.location.hash;
          if (currentPath !== __snapUrlLastPath) {
            console.log('🌐 URL changed:', { from: __snapUrlLastPath, to: currentPath });
            __snapUrlLastPath = currentPath;
            // Map hash to friendly stage slugs and POST once (server enforces idempotency)
            const h = (window.location.hash || '').replace(/^#\//,'');
            const known = [
              'otp/verify','about-you','address-details','income','denied',
              'build-your-loans/approved','build-your-loans/bnpl-deposit',
              'pay-and-sign/direct-debit','pay-and-sign/deposit-payment','pay-and-sign/deposit-payment/payment-success',
              'pay-and-sign/bnpl-signing','you-have-done-it'
            ];
            if (h && known.some(k => h.startsWith(k))) {
              const stage = known.find(k => h.startsWith(k));
              postJourney(stage);
              // NEW: when reaching 'build-your-loans/approved', poll server status once to capture 6 (approved)
              if (stage === 'build-your-loans/approved' && !window.__snapUrlApprovedPolled) {
                window.__snapUrlApprovedPolled = true;
                try { window.SnapApplication?.logServerStatus?.(appId, token, 'url:approved'); } catch(_) {}
              }
              if (stage === 'denied') {
                try { window.SnapApplication?.onDenied?.(appId, token); } catch(_) {}
              }
              // Success hint from portal: proactively trigger onSuccess once (only final stage)
              if (!window.__snapUrlSuccessFired && stage === 'you-have-done-it') {
                window.__snapUrlSuccessFired = true;
                try {
                  console.log('💡 URL success hint detected → triggering onSuccess flow');
                  if (typeof triggerSuccessFn === 'function') {
                    triggerSuccessFn(appId, token);
                  } else if (window.SnapApplication && typeof window.SnapApplication.onSuccess === 'function') {
                    window.SnapApplication.onSuccess(appId, token);
                  }
                } catch (e) { console.warn('URL success trigger failed (non-fatal)', e); }
              }
            }
          }
        } catch(e) { console.warn('URL watcher error (ignored)', e); }
      };
      __snapUrlPopstateHandler = checkUrl;
      window.addEventListener('popstate', __snapUrlPopstateHandler);
      __snapUrlPollId = setInterval(checkUrl, 1000);
      window.addEventListener('unload', __stopUrlCompletionWatcher);
    } catch(e) {
      console.warn('URL watcher start failed (non-fatal)', e);
    }
  }

  const SnapApplication = {
    /**
     * Attach current application to server-side draft order
     */
    async attachApplication(appId, status, invoice = '') {
      try {
        // Build a lightweight billing snapshot to hydrate draft order details
        let billing = {};
        let shipping = {};
        let totalSnapshot = null;
        try {
          if (window.SnapTransaction && typeof window.SnapTransaction.getCustomer === 'function') {
            const c = window.SnapTransaction.getCustomer(window.snap_params || {});
            billing = {
              billing_first_name: c.firstName || '',
              billing_last_name:  c.lastName  || '',
              billing_email:      c.email     || '',
              billing_phone:      c.mobileNumber || '',
              billing_address_1:  c.streetAddress || '',
              billing_address_2:  c.unit || '',
              billing_city:       c.city || '',
              billing_postcode:   c.postcode || ''
            };
          }
          // Capture a total snapshot for draft creation fallback
          try {
            if (window.SnapTransaction && typeof window.SnapTransaction.getTotalMajor === 'function') {
              totalSnapshot = window.SnapTransaction.getTotalMajor(window.snap_params || {});
            } else if (window.snap_params && window.snap_params.cart_total) {
              totalSnapshot = String(window.snap_params.cart_total);
            }
          } catch(_) {}
          // Read Classic DOM for shipping if present (Blocks may not expose separate shipping fields)
          const get = (sel) => { try { const el = document.querySelector(sel); return el ? String(el.value || '').trim() : ''; } catch(_) { return ''; } };
          const shipDifferent = (() => { try { const cb = document.querySelector('#ship-to-different-address-checkbox'); return !!(cb && cb.checked); } catch(_) { return false; } })();
          if (shipDifferent) {
            shipping = {
              shipping_first_name: get('#shipping_first_name'),
              shipping_last_name:  get('#shipping_last_name'),
              shipping_address_1:  get('#shipping_address_1'),
              shipping_address_2:  get('#shipping_address_2'),
              shipping_city:       get('#shipping_city'),
              shipping_postcode:   get('#shipping_postcode')
            };
          }

          // Shipping method (Classic): capture selected rate id and label
          try {
            const sm = document.querySelector('input[name^="shipping_method"]:checked');
            if (sm) {
              const methodId = String(sm.value || '').trim();
              let methodTitle = '';
              try { const lbl = document.querySelector(`label[for="${sm.id}"]`); methodTitle = lbl ? String(lbl.textContent || '').trim() : ''; } catch(_) {}
              if (methodId) {
                shipping.shipping_method_id = methodId;
                if (methodTitle) shipping.shipping_method_title = methodTitle;
              }
            }
          } catch(_) {}

          // Customer order note (Classic)
          try {
            const note = get('#order_comments');
            if (note) { billing.order_note = note; }
          } catch(_) {}
        } catch(_) {}
        const res = await fetch('/wp-json/snap/v1/attach', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-WP-Nonce': window.snap_params?.rest_nonce || window.snap_params?.restNonce || window.wpApiSettings?.nonce || ''
          },
          credentials: 'same-origin',
          body: JSON.stringify(Object.assign({ application_id: appId, progress_status: status, invoice_number: invoice, order_total_snapshot: totalSnapshot }, billing, shipping))
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.order_id) {
          console.log('[Snap] ❌ attach failed:', {
            reason: json?.code || json?.reason || 'unknown',
            response: json,
            note: 'Expected in Classic until draft exists'
          });
          return false;
        }
        console.log('[Snap] ✅ attach success:', { order_id: json.order_id, status });
        return true;
      } catch (e) {
        console.log('[Snap] ❌ attach error:', { error: e?.message });
        return false;
      }
    },
    /**
     * Detect order confirmation page and perform client cleanup.
     * Clears local Snap app state to avoid reusing a funded app on a later order.
     */
    detectAndCleanupOnThankYou() {
      try {
        const path = String(window.location.pathname || '');
        const isThankYou = /(?:\/checkout\/order-received\/|[?&]key=wc_order_)/.test(window.location.href) ||
                           /order-received/.test(path) ||
                           /order\-received/.test(path);
        if (!isThankYou) return;
        console.log('🧹 [Snap] Thank-you detected → clearing client state');
        // Mark submitted and clear storage
        try {
          const latest = this.getApp() || {};
          if (latest && latest.id) {
            this.setApp(Object.assign({}, latest, { submitted: true, lastSubmittedAt: Date.now() }));
          }
        } catch(_) {}
        try { this.clearApp(); } catch(_) {}
        try {
          localStorage.removeItem('snap_application_id');
          localStorage.removeItem('snap_token');
          localStorage.removeItem('snap_application_status');
          localStorage.removeItem('snap_finance_approved');
        } catch(_) {}
      } catch(_) {}
    },
    async logServerStatus(appId, token, context = 'poll') {
      try {
        const params = new URLSearchParams({ application_id: appId });
        if (token) params.set('bearer', token);
        // Include lightweight context for server log method column
        if (context) params.set('method', context);
        const url = '/wp-json/snap/v1/status?' + params.toString();
        const res = await fetch(url, { method: 'GET', headers: { 'X-WP-Nonce': window.snap_params?.rest_nonce || window.snap_params?.restNonce || window.wpApiSettings?.nonce || '' }, credentials: 'same-origin' });
        const data = await res.json().catch(() => null);
        if (data?.ok) {
          console.log(`🛰️ [${context}] Server status`, { application_id: data.application_id, progress_status: data.progress_status, payload: data.payload });
          return data;
        }
        console.warn(`🛰️ [${context}] Server status failed`, data);
      } catch (e) {
        console.warn(`🛰️ [${context}] Server status exception`, e);
      }
      return null;
    },
    async finalizeSnapOrderInBackground({ applicationId, token, invoice_number = null, progress_status = null }) {
      try {
        if (window.__snapFinalized) {
          console.log('[Snap] finalize skipped: already finalized');
          return true;
        }
        // Always get a fresh server status just before finalize for authoritative mapping
        try {
          await this.logServerStatus(applicationId, token, 'preFinalize');
        } catch(_) {}
        // Optional: token freshness pre-check (lightweight)
        try {
          const app = this.getApp() || {};
          if (app && typeof app.lastUpdatedAt === 'number' && Date.now() - app.lastUpdatedAt > 5 * 60 * 1000) {
            await this.logServerStatus(applicationId, token, 'preFinalizeRefresh');
          }
        } catch(_) {}
        const url = (window.snap_params?.rest_url) || '/wp-json/snap/v1/funded';
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-WP-Nonce': window.snap_params?.rest_nonce || window.snap_params?.restNonce || window.wpApiSettings?.nonce || ''
          },
          credentials: 'same-origin',
          body: JSON.stringify({ application_id: applicationId, bearer: token, invoice_number, progress_status })
        });
        let data = null;
        try { data = await res.json(); } catch(_) {}
        if (data?.success && data.order_received_url) {
          console.log('🚀 Finalized via REST; redirecting to thank-you', data.order_received_url);
          try {
            const latest = this.getApp() || {};
            this.setApp(Object.assign({}, latest, { submitted: true, lastSubmittedAt: Date.now() }));
          } catch(_) {}
          window.__snapFinalized = true;
          try { window.wp?.data?.dispatch?.('wc/store/checkout')?.setIsProcessing?.(false); } catch(_) {}
          window.location.assign(data.order_received_url);
          return true;
        }
        console.warn('[Snap] finalize order not ready; keeping checkout blocked', data);
        try { this.blockCheckoutSubmission(); } catch(_) {}
        try { this.showInlineMessage('Snap is unavailable until you finish your application. If you believe you have completed your application, please check your emails or contact us for further support', 'warning'); } catch(_) {}
        return false;
      } catch (e) {
        console.error('[Snap] finalize order exception', e);
        return false;
      }
    },
    /**
     * Set or clear the hard limits guard (min/max basket limits)
     * @param {boolean} isInvalid - true if total is outside limits
     * @param {number} minAmount
     * @param {number} maxAmount
     * @param {number} cartTotal
     */
    setLimitsGuard(isInvalid, minAmount, maxAmount, cartTotal) {
      try {
        __limitsInvalid = !!isInvalid;
        __limitsInfo = { min: minAmount, max: maxAmount, total: cartTotal };
        if (__limitsInvalid) {
          console.warn(`🚫 Limits guard active: total £${cartTotal} outside £${minAmount}-£${maxAmount}`);
          // Enforce blocking on both Classic and Blocks
          this.blockCheckoutSubmission();
        } else {
          console.log('✅ Limits ok for Snap guard');
        }
      } catch(_) {}
    },
    // Storage bridge (unified)
    setApp(obj) { try { window.SnapStorage?.set?.('application', obj); } catch(_) {} },
    getApp() { try { return window.SnapStorage?.get?.('application'); } catch(_) { return null; } },
    clearApp() { try { window.SnapStorage?.remove?.('application'); } catch(_) {} },
    // === Snap session persistence util (minimal) ===
    async saveSnapApp(applicationId, token, opts = {}) {
      const quiet = !!opts.quiet;
      try {
        localStorage.setItem('snap_application_id', applicationId);
        localStorage.setItem('snap_token', token);

        // Use WooCommerce AJAX (works logged-in/out; avoids nonce/caching issues)
        const ajaxurl = '/?wc-ajax=snap_save_application';
        const params = new URLSearchParams();
        params.set('application_id', applicationId);
        params.set('token', token);
        try { params.set('nonce', window.snap_params?.nonce || ''); } catch(_) {}

        const res = await fetch(ajaxurl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: params.toString()
        });
        const text = await res.text();
        if (!res.ok) {
          // Quietly ignore expected invalid/expired token during rehydrate
          if (quiet) {
            try {
              const j = JSON.parse(text);
              const code = (j && j.data && j.data.code) || res.status;
              if (code === 401 || (j && j.data && /invalid token/i.test(JSON.stringify(j.data)))) {
                return { ok: false, status: code };
              }
            } catch(_) {}
          }
          throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
        }
        let json = {};
        try { json = JSON.parse(text); } catch (_) {}
        if (!json.success) throw new Error(`Server unsuccessful: ${text}`);
        console.debug('[Snap] save_snap_application OK');
        return json;
      } catch (e) {
        if (quiet) {
          // Downgrade noise for expected rehydrate failures
          try { console.debug('[Snap] save_snap_application (quiet) failed'); } catch(_) {}
          return { ok: false };
        } else {
          console.error('[Snap] save_snap_application failed:', e);
          throw e;
        }
      }
    },

    forceChosenSnap() {
      try {
        // Classic radio (best-effort)
        const radio = document.querySelector('input[name="payment_method"][value="snapfinance_refined"]');
        if (radio && !radio.checked) radio.checked = true;

        const ajaxurl = (window.snap_params && window.snap_params.ajax_url) ||
                        window.ajaxurl || '/wp-admin/admin-ajax.php';
        fetch(ajaxurl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: new URLSearchParams({ action: 'snap_set_chosen', method: 'snapfinance_refined' })
        }).catch(()=>{});
      } catch(_) {}
    },

    rehydrateSnapSession() {
      try {
        const id = localStorage.getItem('snap_application_id');
        const tk = localStorage.getItem('snap_token');
        if (id && tk) this.saveSnapApp(id, tk, { quiet: true }).catch(()=>{});
      } catch(_) {}
    },
    onApplicationId(appId, token, snapParams, invoiceNumber) {
      try {
        console.log('📝 [SDK ▶] onApplicationId → attach+persist', { appId });
        applicationStatus = 'pending';
        applicationId = appId;
        applicationToken = token;
        
        // Store in localStorage for persistence (standardized snake_case keys)
        localStorage.setItem('snap_application_id', applicationId);
        localStorage.setItem('snap_token', token);
        localStorage.setItem('snap_application_status', 'pending');
        
        // Block checkout submission
        this.blockCheckoutSubmission();
        
        // Persist session immediately (then poll server status so token is available)
        this.saveSnapApp(appId, token).then(() => {
          // Now the server has the token in session; poll status for visibility
          this.logServerStatus(appId, token, 'onApplicationId');
        }).catch((err) => {
          const status = err && (err.response?.status || err.status) || 'unknown';
          console.warn('[Snap] save_snap_application non-blocking error; continuing checkout', { status });
        }).finally(() => {
          try { this.forceChosenSnap(); } catch(_) {}
        });

        // Attach CREATED (2)
        try { this.attachApplication(appId, 2, window.snap_params?.transaction?.invoiceNumber || ''); } catch(_) {}

        // Start URL watcher so we can detect both success and denied routes
        try { __startUrlCompletionWatcher(appId, token, (id, tk) => this.onSuccess(id, tk)); } catch(_) {}

        // (status poll moved to after saveSnapApp resolves)
      } catch (e) {
        console.error('[Snap] onApplicationId error:', e);
      }
    },

    

    // Approved (pre-sign): persist only; keep checkout blocked
    onApproved(appId, token, submitClassicCb, submitBlocksCb) {
      try {
        console.log('🟡 [SDK ▶] onApproved → keep blocked, await signing', { appId });
        // Persist state only; DO NOT allow submission yet
        this.setApp({ id: appId, token: token, status: 'approved' });
        // ensure blocking is active
        this.blockCheckoutSubmission();
      // Attach APPROVED (6)
      try { this.attachApplication(appId, 6, window.snap_params?.transaction?.invoiceNumber || ''); } catch(_) {}
      // Poll server status immediately to capture progress 6 (approved) in logs
      try { this.logServerStatus(appId, token, 'callback:onApproved'); } catch(_) {}
      // Optional brief re-poll to catch fast transitions 6→26
      setTimeout(() => { try { this.logServerStatus(appId, token, 'callback:onApproved+1s'); } catch(_) {} }, 1000);
        // Start URL-based sandbox fallback watcher immediately
        __startUrlCompletionWatcher(appId, token, (id, tk) => this.onSuccess(id, tk));
      } catch (e) { console.error(e); }
      // Watchdog: surface notice if success/funded does not arrive in time
      // Watchdog removed per cart-decoupled flow; rely on URL watcher + funded callbacks
    },

    // Success/Funded (post-sign): unlock and submit once (await Blocks submit)
    async onSuccess(appId, token) {
      try {
        const __cid = `${appId}-${Math.random().toString(36).slice(2,8)}`;
        console.info(`🏁 [SDK ▶] onSuccess funded; cid=${__cid}`);
        console.log('✅ [Path] post-sign → verify → finalize');
        if (window.__snapFinalized) { console.log('[Snap] onSuccess: already finalized, ignoring'); return; }
        // Mark status as success at module-level for any pending guards
        applicationStatus = 'success';
        // Stop URL watcher on success
        try { __stopUrlCompletionWatcher(); } catch(_) {}

        // Refresh server session to reflect funded status and store total snapshot
        try {
          if (typeof this.saveSnapApp === 'function') {
            const total = (window.SnapTransaction && typeof window.SnapTransaction.getTotalMajor === 'function') ? window.SnapTransaction.getTotalMajor(window.snap_params || {}) : null;
            if (window.SnapStorage && window.SnapStorage.set) {
              try { window.SnapStorage.set('application', Object.assign({}, (this.getApp()||{}), { total: total ? Number(total) : undefined })); } catch(_) {}
            }
            this.saveSnapApp(appId, token).catch((err) => {
              const status = err && (err.response?.status || err.status) || 'unknown';
              console.warn('[Snap] save_snap_application non-blocking error; continuing checkout', { status });
            });
          }
        } catch (e) {
          console.error('[Snap] saveSnapApp after onSuccess failed', e);
        }

        // Update local storage/application state to success, do NOT mark submitted yet
        const prior = this.getApp() || {};
        this.setApp({ id: appId, token: token, status: 'success', submitted: false, lastUpdatedAt: Date.now() });

        // Also show the latest server status in logs before finalize
        await this.logServerStatus(appId, token, 'beforeFinalize');

        // Attach SIGNED (26) before finalize
        try { await this.attachApplication(appId, 26, (window.snap_params?.transaction?.invoiceNumber || '')); } catch(_) {}
        // Finalize via REST first; only on failure consider UI submit
        const current = this.getApp();
        if (!current?.submitted) {
          const snapParams = window.snap_params || {};
          const invoiceNum = (window.SnapTransaction && typeof window.SnapTransaction.getLastInvoiceNumber === 'function' ? window.SnapTransaction.getLastInvoiceNumber() : null) || (snapParams && snapParams.transaction ? snapParams.transaction.invoiceNumber : null) || null;
          const ok = await this.finalizeSnapOrderInBackground({ applicationId: appId, token, invoice_number: invoiceNum, progress_status: 0 });
          if (!ok) {
            console.warn('Finalize not ready; keeping checkout blocked');
            try { this.blockCheckoutSubmission(); } catch(_) {}
            try { this.showInlineMessage('Snap is unavailable until you finish your application. If you believe you have completed your application, please check your emails or contact us for further support', 'warning'); } catch(_) {}
          }
        }
      } catch (e) { console.error(e); }
    },

    onDenied(appId, token) {
      console.warn('⛔ [SDK ▶] onDenied → set failed, block UI', { appId });
      applicationStatus = 'denied';
      applicationId = appId;
      applicationToken = token;
      
      // Update localStorage
      this.updateStorage('denied');
      
      // Keep checkout submission blocked while Snap is selected
      this.blockCheckoutSubmission();

      // Attach DECLINED (14)
      try { this.attachApplication(appId, 14, window.snap_params?.transaction?.invoiceNumber || ''); } catch(_) {}
      // Notify server so the attached order is marked failed (no redirect)
      try {
        const nonce = window.snap_params?.rest_nonce || window.snap_params?.restNonce || window.wpApiSettings?.nonce || '';
        const snapParams = window.snap_params || {};
        const invoiceNum = (window.SnapTransaction && typeof window.SnapTransaction.getLastInvoiceNumber === 'function' ? window.SnapTransaction.getLastInvoiceNumber() : null) || (snapParams && snapParams.transaction ? snapParams.transaction.invoiceNumber : null) || null;
        fetch('/wp-json/snap/v1/funded', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
          credentials: 'same-origin',
          body: JSON.stringify({ application_id: appId, bearer: token, invoice_number: invoiceNum, progress_status: 14 })
        }).then(r => r.json()).then(j => {
          console.log('🛰️ [denied] Server update result', j);
        }).catch(e => console.warn('🛰️ [denied] Server update failed', e));
      } catch(_) {}

      // Provide UI affordance to start a new application: clear server session then allow button
      try {
        const clearUrl = (window.snap_params && window.snap_params.ajax_url) ? window.snap_params.ajax_url : '/?wc-ajax=snap_clear_application';
        const isAdminAjax = /admin-ajax\.php/.test(clearUrl);
        if (isAdminAjax) {
          // admin-ajax style
          fetch(clearUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: new URLSearchParams({ action: 'snap_clear_application' }).toString()
          }).then(()=>{
            // Clear client storage so SDK can start a fresh application id
            try { this.resetApplicationStatus(); } catch(_) {}
            // Keep blocked until a new app actually starts
            try { this.blockCheckoutSubmission(); } catch(_) {}
            // Inform the customer
            this.showInlineMessage('Your previous Snap application was declined. You can start a new one using Check eligibility.', 'info');
          }).catch(()=>{});
        } else {
          // direct wc-ajax endpoint
          fetch('/?wc-ajax=snap_clear_application', { method: 'POST', credentials: 'same-origin' }).then(()=>{
            try { this.resetApplicationStatus(); } catch(_) {}
            try { this.blockCheckoutSubmission(); } catch(_) {}
            this.showInlineMessage('Your previous Snap application was declined. You can start a new one using Check eligibility.', 'info');
          }).catch(()=>{});
        }
      } catch(_) {}
    },

    onError(appId, token, message) {
      console.error('❌ [SDK ▶] onError', { appId, message });
      applicationStatus = 'error';
      applicationId = appId;
      applicationToken = token;
      
      // Update localStorage
      this.updateStorage('error');
      
      // Keep blocked and show technical delay guidance
      this.blockCheckoutSubmission();
      try { this.showInlineMessage('Technical delay — Snap will email you the decision. You can resume from the link in your email.', 'info'); } catch(_) {}
    },

    onUnverifiedAccount(appId, token) {
      console.warn('🔎 [SDK ▶] onUnverifiedAccount', { appId });
    },

    onPaymentFailure(appId, token) {
      console.warn('💥 [SDK ▶] onPaymentFailure', { appId });
    },

    onWithdrawn(appId, token) {
      console.warn('🚫 [SDK ▶] onWithdrawn', { appId });
      applicationStatus = 'withdrawn';
      applicationId = appId;
      applicationToken = token;
      // Keep checkout submission blocked while Snap is selected
      this.blockCheckoutSubmission();
      // Customer message (two-line)
      try { this.showInlineMessage('Withdrawn — Your Snap application was cancelled before completion.\nPlease contact Snap Finance for the specific reason; you may be able to correct issues and try again.', 'warning'); } catch(_) {}
    },

    isBlocks() {
      return !!(window.wp && wp.data && wp.data.select);
    },

    /**
     * Block checkout submission until Snap application is complete
     */
    blockCheckoutSubmission() {
      console.log('🚫 Blocked: checkout submission blocked');
      
      // For Classic checkout
      if (!this.isBlocks()) {
        const form = document.querySelector('form.checkout');
        if (form && !form.dataset.snapListener) {
          form.addEventListener('submit', this.preventSubmission, true);
          form.dataset.snapListener = 'true'; // Prevent duplicates
        }
      }
      
      // For Blocks checkout
      if (this.isBlocks() && window.wp?.data?.dispatch) {
        // Store original submit function on a stable global (dispatch() objects may differ per call)
        try {
          const d = window.wp.data.dispatch('wc/store/checkout');
          if (!window.__snapOriginalBlocksSubmitOrder && d && typeof d.submitOrder === 'function') {
            window.__snapOriginalBlocksSubmitOrder = d.submitOrder.bind(d);
            d.submitOrder = function() {
              try {
                const active = window.wp?.data?.select?.('wc/store/payment')?.getActivePaymentMethod?.();
                if (active !== 'snapfinance_refined') {
                  // Pass-through for other payment methods
                  return window.__snapOriginalBlocksSubmitOrder ? window.__snapOriginalBlocksSubmitOrder.apply(d, arguments) : undefined;
                }
              } catch(_) {}
              console.log('🚫 Blocks checkout submission blocked - Snap application pending/denied');
              return false;
            };
          }
        } catch(_) {}
      }
    },

    /**
     * Allow checkout submission after Snap application is complete
     */
    allowCheckoutSubmission() {
      // Do not unblock if limits invalid or if Snap is denied and Snap is selected
      if (__limitsInvalid) {
        console.log('🔒 Keep blocked: limits guard active (outside min/max)');
        return; // Do not restore submit while limits invalid
      }
      try {
        const snapSelectedClassic = (() => { try { const r = document.querySelector('input[name="payment_method"][value="snapfinance_refined"]'); return !!(r && r.checked); } catch(_) { return false; } })();
        const activeBlocks = window.wp?.data?.select?.('wc/store/payment')?.getActivePaymentMethod?.();
        const snapSelectedBlocks = activeBlocks === 'snapfinance_refined';
        if (applicationStatus === 'denied' && (snapSelectedClassic || snapSelectedBlocks)) {
          console.log('🔒 Keep blocked: Snap denied and Snap selected');
          return;
        }
      } catch(_) {}
      console.log('🔓 Unblock: allowing checkout submission');
      
      // For Classic checkout
      if (!this.isBlocks()) {
        const form = document.querySelector('form.checkout');
        if (form && form.dataset.snapListener) {
          form.removeEventListener('submit', this.preventSubmission, true);
          delete form.dataset.snapListener;
        }
      }
      
      // For Blocks checkout
      if (this.isBlocks() && window.wp?.data?.dispatch) {
        // Restore original submit function from stable global
        try {
          const d = window.wp.data.dispatch('wc/store/checkout');
          if (window.__snapOriginalBlocksSubmitOrder && d) {
            d.submitOrder = window.__snapOriginalBlocksSubmitOrder;
            window.__snapOriginalBlocksSubmitOrder = null;
          }
        } catch(_) {}
      }
    },

    /**
     * Auto-submit checkout if stored application is approved/success on return-to-checkout
     * - field-agnostic: relies on Woo validation guard already present
     * - double-submit protected per invoice via one-time clear
     */
    async autoSubmitIfApproved() {
      try {
        if (window.__snapFinalized) {
          console.log('[Snap] autoSubmitIfApproved: already finalized, skipping UI submit');
          return;
        }
        const app = window.SnapStorage?.get?.('application');
        if (!app || !app.status) return;
        if (app.status !== 'success') return; // submit only after signing complete
        if (app.submitted) return; // already submitted
        console.log('🤖 Auto-submit: success detected in storage', app);

        this.allowCheckoutSubmission();

        // Finalize via REST first; on failure fallback to UI submission
        try {
          const snapParams = window.snap_params || {};
          const invoiceNum = (window.SnapTransaction && typeof window.SnapTransaction.getLastInvoiceNumber === 'function' ? window.SnapTransaction.getLastInvoiceNumber() : null) || (snapParams && snapParams.transaction ? snapParams.transaction.invoiceNumber : null) || null;
          const ok = await this.finalizeSnapOrderInBackground({ applicationId: app?.id || app?.applicationId, token: app?.token, invoice_number: invoiceNum, progress_status: 0 });
          if (!ok) {
            console.warn('Finalize not ready (return journey); keeping checkout blocked');
            try { this.blockCheckoutSubmission(); } catch(_) {}
            try { this.showInlineMessage('Snap is unavailable until you finish your application. If you believe you have completed your application, please check your emails or contact us for further support'); } catch(_) {}
          }
        } catch(_) {}
      } catch(_) {}
    },

    /**
     * Prevent form submission (Classic checkout)
     */
    preventSubmission(event) {
      const snapSelectedClassic = (() => { try { const r = document.querySelector('input[name="payment_method"][value="snapfinance_refined"]'); return !!(r && r.checked); } catch(_) { return false; } })();
      if (((applicationStatus === 'pending' || applicationStatus === 'denied') && snapSelectedClassic) || (__limitsInvalid && snapSelectedClassic)) {
        console.log('🚫 Preventing checkout submission - reason:', applicationStatus === 'pending' ? 'pending' : 'limits');
        event.preventDefault();
        event.stopPropagation();
        
        // Show user-friendly message inline instead of modal
        try {
          if (applicationStatus === 'pending') {
            window.SnapApplication?.showInlineMessage('Please complete your Snap Finance application before proceeding.');
          } else if (applicationStatus === 'denied') {
            window.SnapApplication?.showInlineMessage('Snap is unavailable due to a declined application. You can try again by selecting Check eligibility.');
          } else if (__limitsInvalid) {
            const m = __limitsInfo.min, x = __limitsInfo.max, t = __limitsInfo.total;
            window.SnapApplication?.showInlineMessage(`Snap is unavailable for this basket (£${Number(t).toFixed(2)}). Available between £${Number(m).toFixed(2)} and £${Number(x).toFixed(2)}.`);
          }
        } catch(_) {}
        
        return false;
      }
    },

    /**
     * Show inline message instead of modal
     * @param {string} message - Message to display
     * @param {string} type - Message type ('error', 'warning', 'info', 'success')
     */
    showInlineMessage(message, type = 'warning') {
      // Try to find Snap Finance container
      const snapContainer = document.querySelector('#snap-uk-checkout') || 
                           document.querySelector('.snap-container') ||
                           document.querySelector('[data-gateway="snapfinance_refined"]');
      
      if (snapContainer) {
        // Define styles based on message type
        const styles = {
          error: 'color: #d63638; background: #fcf0f1; border: 1px solid #d63638;',
          warning: 'color: #d63638; background: #fcf0f1; border: 1px solid #d63638;',
          info: 'color: #0073aa; background: #f0f6fc; border: 1px solid #0073aa;',
          success: 'color: #00a32a; background: #f0f6fc; border: 1px solid #00a32a;'
        };
        
        const icons = {
          error: '❌',
          warning: '⚠️',
          info: 'ℹ️',
          success: '✅'
        };

        // Use a singleton container to prevent duplicate messages
        const parent = snapContainer.parentNode || document.body;
        let messageDiv = parent.querySelector('#snap-inline-message');
        const markup = `
          <div style="${styles[type]} padding: 10px; border-radius: 4px; margin: 10px 0; font-size: 14px;">
            <strong>${icons[type]} ${type.charAt(0).toUpperCase() + type.slice(1)}</strong><br>
            ${message}
          </div>
        `;

        if (messageDiv) {
          // Replace content if different; keep single instance
          if (messageDiv.innerHTML !== markup) {
            messageDiv.innerHTML = markup;
          }
        } else {
          messageDiv = document.createElement('div');
          messageDiv.id = 'snap-inline-message';
          messageDiv.innerHTML = markup;
          // Insert before the Snap container
          parent.insertBefore(messageDiv, snapContainer);
        }

        // Auto-remove after appropriate time based on type
        const autoRemoveTime = type === 'success' ? 3000 : 5000;
        try { clearTimeout(window.__snapInlineMsgTimer); } catch(_) {}
        window.__snapInlineMsgTimer = setTimeout(() => {
          const el = parent.querySelector('#snap-inline-message');
          if (el && el.parentNode) el.remove();
        }, autoRemoveTime);

        console.log(`✅ Inline ${type} message shown (singleton):`, message);
      } else {
        // Fallback to console only (no modal)
        console.warn(`⚠️ Could not find Snap container for inline ${type} message:`, message);
      }
    },

    /**
     * Show guidance with action links (Resume / Start new)
     */
    showInlineGuidance(message, options = {}) {
      try {
        const snapContainer = document.querySelector('#snap-uk-checkout') || 
                             document.querySelector('.snap-container') ||
                             document.querySelector('[data-gateway="snapfinance_refined"]');
        if (!snapContainer) return this.showInlineMessage(message, 'info');
        const wrapper = document.createElement('div');
        wrapper.id = `snap-inline-guidance-${Date.now()}`;
        wrapper.innerHTML = `
          <div style="background:#f8f9fb;border:1px solid #cbd5e1;border-radius:6px;padding:12px;margin:10px 0;font-size:14px;">
            <div style="margin-bottom:8px;">ℹ️ ${message}</div>
            <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
              <button type="button" id="snap-resume-btn" style="background:#111;color:#fff;border:0;border-radius:4px;padding:8px 10px;cursor:pointer;">Resume Snap application</button>
              <a href="#" id="snap-new-app-link" style="font-size:13px;color:#0a66c2;text-decoration:underline;">Start a new application</a>
            </div>
          </div>
        `;
        snapContainer.parentNode.insertBefore(wrapper, snapContainer);
        const resume = wrapper.querySelector('#snap-resume-btn');
        const anew  = wrapper.querySelector('#snap-new-app-link');
        if (resume) resume.addEventListener('click', () => {
          try {
            // Best-effort: click the existing Snap button to resume
            const btn = document.querySelector('#snap-uk-checkout button, [data-snap-check-eligibility], .snap-container button');
            if (btn) { btn.click(); }
            else { this.showInlineMessage('Open the email from Snap to continue signing.', 'info'); }
          } catch(_) { this.showInlineMessage('Open the email from Snap to continue signing.', 'info'); }
        });
        if (anew) anew.addEventListener('click', (e) => {
          e.preventDefault();
          if (!confirm('This will abandon the current Snap application and start a new one. Continue?')) return;
          try { this.resetApplicationStatus(); } catch(_) {}
          try { this.allowCheckoutSubmission(); } catch(_) {}
          this.showInlineMessage('You can now start a new Snap application using Check eligibility.', 'success');
        });
      } catch(_) {}
    },

    /**
     * Clear all inline messages
     */
    clearInlineMessages() {
      // Remove both legacy timestamped messages and the singleton
      const messages = document.querySelectorAll('[id^="snap-inline-message"]');
      messages.forEach(msg => {
        msg.remove();
        console.log('✅ Inline message cleared:', msg.id);
      });
    },

    /**
     * Centralized storage update function
     * @param {string} status - Application status
     */
    updateStorage(status) {
      localStorage.setItem('snap_application_status', status);
      if (applicationId) localStorage.setItem('snap_application_id', applicationId);
      if (applicationToken) localStorage.setItem('snap_token', applicationToken);
      if (status === 'approved') localStorage.setItem('snap_finance_approved', 'true');
    },

    /**
     * Get current application status
     */
    getApplicationStatus() {
      return {
        status: applicationStatus,
        applicationId: applicationId,
        applicationToken: applicationToken
      };
    },

    /**
     * Reset application status (for new applications)
     */
    resetApplicationStatus() {
      // Only reset if status is not already 'none'
      if (applicationStatus !== 'none') {
        applicationStatus = 'none';
        applicationId = null;
        applicationToken = null;
        
        // Clear localStorage (standardized keys)
        localStorage.removeItem('snap_application_id');
        localStorage.removeItem('snap_token');
        localStorage.removeItem('snap_application_status');
        localStorage.removeItem('snap_finance_approved');
        
        // Clear any inline messages
        this.clearInlineMessages();
        try {
          // Also reset chosen payment method in Woo to avoid accidental drafts on return
          const ajaxurl = (window.snap_params && window.snap_params.ajax_url) || window.ajaxurl || '/wp-admin/admin-ajax.php';
          fetch(ajaxurl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: new URLSearchParams({ action: 'woocommerce_set_payment_method', payment_method: '' }).toString()
          }).catch(()=>{});
        } catch(_) {}
        
        console.log('🔄 Application status reset');
      }
    }
  };

  window.SnapApplication = Object.freeze(SnapApplication);

  // Optional: Light error subscription for Blocks checkout to keep retries possible
  try {
    if (window?.wp?.data?.subscribe && window?.wp?.data?.select) {
      window.wp.data.subscribe(() => {
        try {
          const checkout = window.wp.data.select('wc/store/checkout');
          if (checkout && typeof checkout.hasError === 'function' && checkout.hasError()) {
            let msg = undefined;
            try { msg = (typeof checkout.getErrorMessage === 'function') ? checkout.getErrorMessage() : undefined; } catch(_) {}
            if (!window.__snapLoggedCheckoutError) {
              if (msg) { console.error('[Snap][Blocks] Checkout error observed:', msg); }
              else { console.warn('[Snap][Blocks] Checkout error observed'); }
              try {
                window.__snapLoggedCheckoutError = true;
                setTimeout(function(){ try { delete window.__snapLoggedCheckoutError; } catch(_) {} }, 3000);
              } catch(_) {}
            }
            // Ensure we can retry submissions
            try {
              const prev = window.SnapStorage?.get?.('application') || {};
              if (prev.submitted === true) {
                window.SnapStorage?.set?.('application', Object.assign({}, prev, { submitted: false }));
              }
            } catch(_) {}
          }
        } catch(_) {}
      });
    }
  } catch(_) {}

  // Thank-you cleanup: run at load in case user lands here directly
  try { window.SnapApplication?.detectAndCleanupOnThankYou?.(); } catch(_) {}

  // On checkout load: if a Snap app exists and is not signed, poll status and show guidance
  try {
    const app = window.SnapStorage?.get?.('application');
    if (app && app.id && app.status !== 'success' && app.submitted !== true) {
      window.SnapApplication?.logServerStatus?.(app.id, app.token, 'returnCheck').then((data) => {
        if (!data || !data.ok) return;
        const p = Number(data.progress_status);
        if (p === 6) {
          window.SnapApplication?.showInlineGuidance?.('Approved — please finish signing in the Snap popup, or check your email for your agreement.');
        } else if (p === 10) {
          window.SnapApplication?.showInlineGuidance?.('Approved with conditions — additional steps/signing may be required in the Snap popup, or check your email for the link to continue.');
        } else if (p === 22) {
          window.SnapApplication?.showInlineGuidance?.('Documents required — please upload the requested documents in the Snap popup, or check your email for the link to continue.');
        } else if (p === 14) {
          window.SnapApplication?.showInlineMessage?.('Snap is unavailable due to a declined application. You can try again with Check eligibility.', 'warning');
        } else if (p === 18) {
          window.SnapApplication?.showInlineMessage?.('Application withdrawn — you can start a new application or choose another payment method.', 'info');
        }
      }).catch(()=>{});
    }
  } catch(_) {}
})();
