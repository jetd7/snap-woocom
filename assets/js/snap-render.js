/**
 * Snap Finance Shared Renderer
 * 
 * Single source of truth for Snap SDK button rendering.
 * Used by both Classic and Blocks checkouts.
 */

// Constants
const CONTAINER_ID = 'snap-uk-checkout';

// Helper functions
const log = (...args) => console.log(...args);
const warn = (...args) => console.warn(...args);
const err = (...args) => console.error(...args);
// Diagnostics-only logger (enabled when snap_params.debug_diag === true)
const diag = (...args) => {
  try {
    if (window.snap_params && window.snap_params.debug_diag === true) {
      console.log(...args);
    }
  } catch(_) {}
};

// Stable transaction hash function (ignores volatile fields)
function stableTxHash(tx) {
    if (!tx) return 'no-tx';
    const products = (tx.products || []).map(p => ({ id: p.productId, price: p.price, qty: p.quantity }));
    return JSON.stringify({
        shippingCost: tx.shippingCost ?? 0,
        products
    });
}

// Lightweight diagnostics helper (collapsed console groups)
if (!window.SnapDiag) {
  (function(){
    const SNAP_GROUP_TITLE = '[Snap] Checkout Diagnostics';
    const state = { printedInitial: false, buildId: 0 };

    function getTotalIncVAT() {
      try {
        const sel = window.wp?.data?.select('wc/store/cart');
        const totals = sel?.getCartTotals?.();
        let total = totals?.total_price ?? totals?.totalPrice ?? totals?.total;
        if (typeof total === 'string') total = parseFloat(total);
        if (!isFinite(total) || total === 0) total = window.snap_params?.cart_total ?? 0;
        return isFinite(total) ? Number(total) : 0;
      } catch(_) { return window.snap_params?.cart_total ?? 0; }
    }

    function isEligible(total) {
      const min = Number(window.snap_params?.min_amount ?? 0);
      const max = Number(window.snap_params?.max_amount ?? Number.MAX_SAFE_INTEGER);
      return Number(total) >= min && Number(total) <= max;
    }

    function mask(str) {
      if (!str) return '';
      const s = String(str);
      if (s.length <= 7) return '•••';
      return s.slice(0,4) + '…' + s.slice(-3);
    }

    function computeMerchantRequired() {
      const defaults = ['billing_first_name','billing_last_name','billing_email','billing_postcode','billing_address_1','billing_city'];
      const cfg = Array.isArray(window.snap_params?.merchant_required_fields) ? window.snap_params.merchant_required_fields : defaults;
      return new Set(cfg);
    }

    function fieldRow(name, value, snapRequiredSet, merchantSet, validationMessages) {
      const snapReq = snapRequiredSet.has(name);
      const merchReq = merchantSet.has(name);
      const requiredBy = snapReq && merchReq ? 'Both' : (snapReq ? 'Snap' : (merchReq ? 'Merchant' : 'Optional'));
      const msgHit = (validationMessages||[]).find(m => (m||'').toLowerCase().includes(name.replace('billing_','').replace('_',' ')));
      const valid = !msgHit && (requiredBy === 'Optional' || (String(value||'').trim().length > 0));
      const notes = msgHit ? msgHit : '';
      return { field: name, value: value ?? '', required_by: requiredBy, valid, notes, lastUpdated: new Date().toISOString(), buildId: state.buildId };
    }

    window.SnapDiag = {
      printInitial() {
        if (!window.snap_params || window.snap_params.debug_diag !== true) return;
        if (state.printedInitial) return;
        try {
          const plugin = window.__snapDiagMeta?.plugin || window.snap_params?.plugin_version || 'dev';
          const php = window.__snapDiagMeta?.php || window.snap_params?.php_version || 'unknown';
          const isBlocks = !!(window.__snapDiagMeta?.isBlocks ?? window.snap_params?.is_blocks);
          const total = getTotalIncVAT();
          const eligible = isEligible(total);
          console.groupCollapsed('%c' + SNAP_GROUP_TITLE, 'color:#0a0; font-weight:bold;');
          console.table([{ plugin, checkout: (isBlocks ? 'Blocks' : 'Classic'), php, total_inc_vat: Number(total).toFixed(2), eligible }]);
          state.printedInitial = true;
        } catch(_) {}
      },
      printSnapshot(source) {
        if (!window.snap_params || window.snap_params.debug_diag !== true) return;
        try {
          state.buildId += 1;
          const tx = window.SnapTransaction?.build?.(window.snap_params) || null;
          const msgs = (window.SnapTransaction?.validate?.(tx, window.snap_params) || []);
          const pf = (window.Validation && window.Validation.preflight) ? window.Validation.preflight(window.snap_params) : { ok: true, messages: [], wooState: { ok: true, reasons: [] } };
          const snapRequired = new Set(['billing_first_name','billing_last_name','billing_email','billing_postcode']); // proxy for SDK-required fields
          const merchantSet = computeMerchantRequired();
          const rows = [];
          const f = (n) => window.snap_params?.[n] ?? '';
          const fieldNames = ['billing_first_name','billing_last_name','billing_email','billing_phone','billing_address_1','billing_address_2','billing_city','billing_postcode'];
          fieldNames.forEach(n => rows.push(fieldRow(n, f(n), snapRequired, merchantSet, msgs)));
          rows.push(fieldRow('invoiceNumber', tx?.invoiceNumber, new Set(), new Set(), []));
          const total = getTotalIncVAT();
          rows.push(fieldRow('total_inc_vat', Number(total).toFixed(2), new Set(['total_inc_vat']), new Set(['total_inc_vat']), []));
          rows.push(fieldRow('deliveryDate', tx?.deliveryDate, new Set(), new Set(), []));
          console.groupCollapsed('[Snap] Transaction snapshot #' + state.buildId + ' (' + (source||'init') + ')');
          console.table(rows);
          const snapOk = msgs.length === 0;
          const merchantFailures = rows.filter(r => r.required_by !== 'Optional' && (r.required_by === 'Merchant' || r.required_by === 'Both') && !r.valid).map(r=>r.field);
          // Prefer centralized preflight for merchant/woo state
          const merchantOk = !!(pf && pf.wooState ? pf.wooState.ok : (merchantFailures.length === 0));
          const reasons = (pf && Array.isArray(pf.messages) && pf.messages.length > 0) ? pf.messages : merchantFailures;
          console.table([{ snap_required_ok: snapOk, merchant_required_ok: merchantOk, overall_blocked: !(snapOk && merchantOk), reasons }]);
          // Application session (if present)
          try {
            const app = (window.SnapStorage?.get?.('application')) || null;
            if (app && (app.id || app.applicationId)) {
              console.groupCollapsed('[Snap] Application session');
              console.table([{ applicationId: app.id || app.applicationId, token_masked: mask(app.token), status: app.status || '', submitted: !!app.submitted, lastUpdatedAt: app.lastUpdatedAt || app.lastSubmittedAt || '' }]);
              console.groupEnd();
            }
          } catch(_) {}
          console.groupEnd();
        } catch(_) {}
      }
    };
  })();
}

window.SnapRender = {
    // Module-level flag to ensure SDK is initialized only once per page
    _sdkInitialized: false,
    _renderAttempts: 0,
    _maxRenderAttempts: 5,
    _isRendering: false, // Add rendering flag to prevent concurrent renders
    _sdkButtonMounted: false, // Track if SDK button is already mounted
    _lastTransactionHash: '', // Track last transaction/validation hash to prevent unnecessary re-renders
    _lastReplaceTime: 0, // Track last time a container was replaced to prevent rapid re-renders
    _idle: false,
    _forceFullRenderNext: false, // One-shot: force host replacement on next render
    _autoClickNext: false, // One-shot: auto-click new Snap button after render
    _cancelRequested: false,
    _timeouts: new Set(),
    _sdkLoggerInstalled: false,
    _domObserver: null,
    _observerCooldownUntil: 0,
    _guardedRenderActive: false,
    _heartbeatCooldownUntil: 0,
    _hbMisses: 0,

    _trackTimeout(fn, delay) {
        const id = setTimeout(() => {
            if (this._idle || this._cancelRequested) return;
            try { fn(); } catch (e) { console.error(e); }
            this._timeouts.delete(id);
        }, delay);
        this._timeouts.add(id);
        return id;
    },

    _clearTrackedTimeouts() {
        this._timeouts.forEach((id) => clearTimeout(id));
        this._timeouts.clear();
    },

    goIdle() {
        this._idle = true;
        this._cancelRequested = true;
        this._clearTrackedTimeouts();
        this._isRendering = false;
        try {
            const c = document.getElementById(CONTAINER_ID);
            if (c) {
                this.removeValidationOverlay(c);
                this.clearValidationMessage(c);
            }
        } catch(_) {}
        console.log('💤 SnapRender: idle (Snap not selected)');
    },

    resumeActive() {
        this._idle = false;
        this._cancelRequested = false;
        console.log('✅ SnapRender: active (Snap selected)');
    },

    // Helper: determine if the container's stored transaction object matches current form data
    _isLabelFresh(containerEl) {
        try {
            const storedRaw = containerEl?.dataset?.transactionData;
            if (!storedRaw) return false;
            const stored = JSON.parse(storedRaw);
            const snapParams = window.snap_params;
            if (!snapParams || !window.SnapTransaction) return false;
            const current = window.SnapTransaction.build(snapParams);
            const storedHash = stableTxHash(stored);
            const currentHash = stableTxHash(current);
            return storedHash === currentHash;
        } catch (_) {
            return false;
        }
    },

    // Helper: extract previous validation status from container dataset if present
    _getPreviousStatus(containerEl) {
        try {
            const raw = containerEl?.dataset?.transactionData;
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed?._validationStatus || null;
        } catch (_) {
            return null;
        }
    },

    /**
     * Render the Snap Finance button (auto-detects container and params)
     */
    render() {
        // Idle/active gate based on selected payment method
        try {
            const isActive = window.PaymentMethodDetector?.isSnapFinanceSelected?.() || false;
            if (!isActive) {
                console.log('💤 Snap not selected - render() skipped');
                this.goIdle();
                return;
            }
            this.resumeActive();
        } catch(_) {}
        // Check if already rendering to prevent concurrent renders
        if (this._isRendering) {
            console.log('↺ Render in progress - skipping');
            return;
        }

        // Guarded single-render gate: if we already have an initial render and validation is not OK, avoid re-render
        // IMPORTANT: Do NOT suppress if the container is missing; we must re-render to restore it
        try {
            const pre = (window.Validation && window.Validation.preflight) ? window.Validation.preflight(window.snap_params) : { ok: true };
            const containerPresent = !!document.getElementById(CONTAINER_ID);
            if (this._guardedRenderActive && pre && pre.ok === false && containerPresent) {
                const container = document.getElementById(CONTAINER_ID);
                if (container) {
                    // Update overlay/messages only; keep current SDK render
                    try {
                        const tx = window.SnapTransaction?.build?.(window.snap_params) || null;
                        const msgs = window.SnapTransaction?.validate?.(tx, window.snap_params) || [];
                        this.updateValidationMessagesOnly(container, msgs, tx);
                        console.log('[Guard] Guarded single-render active → overlay/messages updated; re-render suppressed');
                    } catch(_) {}
                }
                return;
            }
        } catch(_) {}
        
        this._isRendering = true;
        this._renderAttempts++;
        console.log('🎯 STEP 1: Starting Snap Finance render process (attempt #' + this._renderAttempts + ')');
        console.log('🎯 STEP 1: Render timestamp:', new Date().toISOString());
        
        try {
            // Reset application status only if not already success
            try {
                const current = window.SnapApplication?.getApplicationStatus?.();
                const status = (current && current.status) || 'none';
                if (status !== 'success' && window.SnapApplication?.resetApplicationStatus) {
                    window.SnapApplication.resetApplicationStatus();
                }
            } catch(_) {}
            
            let containerEl = document.getElementById(CONTAINER_ID);
            if (!containerEl) { 
                warn(`⚠️ STEP 1 FAILED: Missing #${CONTAINER_ID}`); 
                console.log('🔍 Available containers with "snap" in ID:', 
                    Array.from(document.querySelectorAll('[id*="snap"]')).map(el => el.id));
                return; 
            }
            console.log('✅ STEP 1: Container found:', containerEl);
            
            // Add CSS class for smooth transitions
            containerEl.classList.add('snap-container');
            // Add CSS for fade transitions
            containerEl.style.transition = 'opacity 0.2s ease';

            // Install DOM observer to recover from Classic/Blocks DOM swaps (e.g., updated_checkout)
            try { this._installDomObserver(containerEl); } catch(_) {}
            
            // Defer host preparation until we know a full SDK render is required

            const snapParams = window.snap_params;
            if (!snapParams || !snapParams.client_id || !snapParams.merchant_id) {
                console.error('❌ STEP 1 FAILED: Missing required Snap Finance parameters');
                console.log('🔍 snapParams available:', !!snapParams);
                console.log('🔍 snapParams keys:', snapParams ? Object.keys(snapParams) : 'undefined');
                console.log('🔍 client_id:', snapParams?.client_id);
                console.log('🔍 merchant_id:', snapParams?.merchant_id);
                this.showError(containerEl, 'Snap Finance is not properly configured. Please contact support.');
                return;
            }
            console.log('✅ STEP 1: Parameters validated');

            // Limits enforcement is handled server-side (Classic is_available, Blocks is_active)

            // Clear any existing overlays/messages just in case
            try { this.removeValidationOverlay(containerEl); } catch(_) {}
            try { this.clearValidationMessage(containerEl); } catch(_) {}

            // Initialize SDK and render button
            this.initializeSDKAndRender(containerEl, snapParams);
        } catch (error) {
            console.error('❌ Error during render:', error);
        } finally {
            // Reset rendering flag after a longer delay to prevent rapid re-renders
            this._trackTimeout(() => {
                this._isRendering = false;
            }, 1000);
        }
    },

    /**
     * Initialize SDK and render the button
     * @param {HTMLElement} containerEl - Container element
     * @param {Object} snapParams - Snap Finance parameters
     */
    initializeSDKAndRender(containerEl, snapParams) {
        console.log('🎯 STEP 2: Waiting for SDK to be available...');
        console.log('🎯 STEP 2: SDK check timestamp:', new Date().toISOString());
        
        // Wait for SDK to be available
        this.waitForSDK(() => {
            try {
                console.log('🎯 STEP 3: Initializing Snap SDK...');
                console.log('🎯 STEP 3: SDK init timestamp:', new Date().toISOString());
                
                // Initialize SDK (idempotent)
                if (!this._sdkInitialized && typeof snapuk !== 'undefined' && snapuk.init) {
                    snapuk.init(snapParams.client_id);
                    this._sdkInitialized = true;
                    console.log('✅ STEP 3: Snap SDK initialized with client_id:', snapParams.client_id);
                    
                    // Brief delay for init to settle
                    this._trackTimeout(() => {
                        console.log('🎯 STEP 4: Creating transaction data...');
                        // Use modular transaction builder
                        const transaction = window.SnapTransaction.build(snapParams);
                        const messages = window.SnapTransaction.validate(transaction, snapParams);
                        // Update status on transaction
                        const prevStatus = this._getPreviousStatus(containerEl);
                        window.SnapTransaction.updateValidationStatus(transaction, messages, messages.length === 0);
                        console.log('✅ STEP 4: Built UK API transaction');
                        
                        // Log transaction validation status
                        const validationSummary = window.SnapTransaction.getValidationSummary(transaction);
                        console.log('📋 Transaction data for Snap SDK:', {
                            invoiceNumber: transaction.invoiceNumber,
                            validationStatus: validationSummary?.status || 'unknown',
                            hasValidData: validationSummary?.hasValidData || false,
                            messageCount: messages.length,
                            customerData: transaction.customer
                        });
                        
                        // Check if transaction has changed using stable hash (ignores volatile fields)
                        const newHash = stableTxHash(transaction);
                        const unchanged = this._lastTransactionHash === newHash;
                        const forceFullRender = this._forceFullRenderNext || (prevStatus === 'invalid' && validationSummary?.status === 'valid');
                        
                        if (unchanged && this._sdkButtonMounted && !forceFullRender) {
                            console.log('↺ Stable transaction unchanged - updating validation messages only');
                            // No full re-render; just update overlay/messages if needed
                            this.updateValidationMessagesOnly(containerEl, messages, transaction);
                            this._isRendering = false;
                            return;
                        }
                        this._lastTransactionHash = newHash;

                        // Prepare/replace host ONLY when we need a full SDK render
                        try {
                            if (containerEl.shadowRoot) {
                                console.log('🧹 Replacing host element to avoid duplicate shadow root');
                                const parent = containerEl.parentNode;
                                if (parent) {
                                    const newContainer = document.createElement('div');
                                    newContainer.id = CONTAINER_ID;
                                    newContainer.style.minHeight = containerEl.style.minHeight || '45px';
                                    newContainer.style.minWidth = containerEl.style.minWidth || '320px';
                                    newContainer.style.height = containerEl.style.height || '45px';
                                    newContainer.style.width = containerEl.style.width || '320px';
                                    newContainer.style.boxSizing = 'border-box';
                                    newContainer.style.margin = containerEl.style.margin || '15px 0';
                                    newContainer.style.display = containerEl.style.display || 'block';
                                    newContainer.style.transition = containerEl.style.transition || 'opacity 0.2s';
                                    newContainer.className = containerEl.className || '';
                                    try {
                                        parent.replaceChild(newContainer, containerEl);
                                        containerEl = newContainer;
                                    } catch (e) {
                                        console.warn('⚠️ Host replacement failed—falling back to clear:', e);
                                        containerEl.innerHTML = '';
                                    }
                                    // Reset flags on host replacement
                                    this._sdkButtonMounted = false;
                                    containerEl.dataset.snapRendered = '0';
                                    containerEl.dataset.snapPostVerified = '0';
                                }
                            } else {
                                containerEl.innerHTML = '';
                            }
                            console.log('🧹 Cleared container for fresh render');
                        } catch (e) {
                            console.warn('⚠️ Failed to prepare container host:', e);
                        }
                        
                        console.log('🎯 STEP 5: Rendering Snap button...');
                        this.renderButton(containerEl, snapParams, transaction, messages);
                    }, 50);
                } else {
                    console.log('✅ STEP 3: SDK already initialized, proceeding...');
                    
                    console.log('🎯 STEP 4: Creating transaction data...');
                    // Use modular transaction builder
                    const transaction = window.SnapTransaction.build(snapParams);
                    const messages = window.SnapTransaction.validate(transaction, snapParams);
                    // Update status on transaction
                    const prevStatus = this._getPreviousStatus(containerEl);
                    window.SnapTransaction.updateValidationStatus(transaction, messages, messages.length === 0);
                    console.log('✅ STEP 4: Built UK API transaction');
                    
                    // Log transaction validation status
                    const validationSummary = window.SnapTransaction.getValidationSummary(transaction);
                    console.log('📋 Transaction data for Snap SDK:', {
                        invoiceNumber: transaction.invoiceNumber,
                        validationStatus: validationSummary?.status || 'unknown',
                        hasValidData: validationSummary?.hasValidData || false,
                        messageCount: messages.length,
                        customerData: transaction.customer
                    });
                    
                    // Check if transaction has changed using stable hash (ignores volatile fields)
                    const newHash = stableTxHash(transaction);
                    const unchanged = this._lastTransactionHash === newHash;
                    const forceFullRender = this._forceFullRenderNext || (prevStatus === 'invalid' && validationSummary?.status === 'valid');
                    
                    if (unchanged && this._sdkButtonMounted && !forceFullRender) {
                        console.log('↺ Stable transaction unchanged - updating validation messages only');
                        // No full re-render; just update overlay/messages if needed
                        this.updateValidationMessagesOnly(containerEl, messages, transaction);
                        this._isRendering = false;
                        return;
                    }
                    this._lastTransactionHash = newHash;

                    // Prepare/replace host ONLY when we need a full SDK render
                    try {
                        if (containerEl.shadowRoot) {
                            console.log('🧹 Replacing host element to avoid duplicate shadow root');
                            const parent = containerEl.parentNode;
                            if (parent) {
                                const newContainer = document.createElement('div');
                                newContainer.id = CONTAINER_ID;
                                newContainer.style.minHeight = containerEl.style.minHeight || '45px';
                                newContainer.style.minWidth = containerEl.style.minWidth || '320px';
                                newContainer.style.height = containerEl.style.height || '45px';
                                newContainer.style.width = containerEl.style.width || '320px';
                                newContainer.style.boxSizing = 'border-box';
                                newContainer.style.margin = containerEl.style.margin || '15px 0';
                                newContainer.style.display = containerEl.style.display || 'block';
                                newContainer.style.transition = containerEl.style.transition || 'opacity 0.2s';
                                newContainer.className = containerEl.className || '';
                                try {
                                    parent.replaceChild(newContainer, containerEl);
                                    containerEl = newContainer;
                                } catch (e) {
                                    console.warn('⚠️ Host replacement failed—falling back to clear:', e);
                                    containerEl.innerHTML = '';
                                }
                                // Reset flags on host replacement
                                this._sdkButtonMounted = false;
                                containerEl.dataset.snapRendered = '0';
                                containerEl.dataset.snapPostVerified = '0';
                            }
                        } else {
                            containerEl.innerHTML = '';
                        }
                        console.log('🧹 Cleared container for fresh render');
                    } catch (e) {
                        console.warn('⚠️ Failed to prepare container host:', e);
                    }
                    
                    console.log('🎯 STEP 5: Rendering Snap button...');
                    this.renderButton(containerEl, snapParams, transaction, messages);
                }

                // Note: snapRendered flag is set only after SDK success in renderButton()

            } catch (error) {
                console.error('❌ Error rendering Snap Finance button:', error);
                this.showError(containerEl, 'Unable to load Snap Finance. Please try again.');
            }
        });
    },

    /**
     * Observe container/payment box for DOM swaps and automatically re-render when host disappears
     */
    _installDomObserver(containerEl) {
        try {
            if (this._domObserver) { try { this._domObserver.disconnect(); } catch(_) {} }
            const paymentBox = containerEl.closest('.payment_box') || containerEl.parentElement || containerEl;
            const observer = new MutationObserver((mutations) => {
                try {
                    const now = Date.now();
                    // If the container was removed from DOM entirely, we must re-render once
                    const containerPresent = !!document.getElementById(CONTAINER_ID);
                    if (!containerPresent) {
                        if (now < this._observerCooldownUntil) return;
                        this._observerCooldownUntil = now + 500; // 500ms cooldown
                        diag('🧭 Container missing → schedule one re-render');
                        this._trackTimeout(() => {
                            if (!this._idle && !this._cancelRequested) {
                                this.render();
                            }
                        }, 50);
                        return;
                    }
                    // If we are already rendering or within cooldown, do nothing
                    if (this._isRendering || now < this._observerCooldownUntil) return;
                    // Ignore brief inner-host loss; keep single render and overlay
                    const hostPresent = !!containerEl.querySelector('.snapuk-host');
                    if (!hostPresent) {
                        // Soft check for actual button presence in shadow; avoid churn
                        try {
                            const sr = containerEl.shadowRoot || null;
                            const snapBtn = sr && (sr.getElementById('snapuk-checkout-btn') || sr.querySelector('button'));
                            if (snapBtn) return;
                        } catch(_) {}
                        // As a safety, only update overlay/messages rather than re-render
                        this._observerCooldownUntil = now + 500;
                        try {
                            const tx = window.SnapTransaction?.build?.(window.snap_params) || null;
                            const msgs = window.SnapTransaction?.validate?.(tx, window.snap_params) || [];
                            this.updateValidationMessagesOnly(containerEl, msgs, tx);
                            diag('[Guard] Host briefly missing → updated overlay only (no re-render)');
                        } catch(_) {}
                    }
                } catch(_) {}
            });
            observer.observe(paymentBox, { childList: true, subtree: true });
            this._domObserver = observer;
        } catch(_) {}
    },

    /**
     * Wait for SDK to be fully available with improved logging
     * @param {Function} callback - Callback to execute when SDK is ready
     */
    waitForSDK(callback) {
        console.log('🔍 STEP 2: Checking SDK availability...');
        console.log('🔍 STEP 2: SDK check timestamp:', new Date().toISOString());
        const snapukDefined = typeof snapuk !== 'undefined';
        console.log('🔍 STEP 2: snapuk defined?', snapukDefined);
        console.log('🔍 STEP 2: snapuk object:', snapukDefined ? snapuk : null);
        console.log('🔍 STEP 2: snapuk.checkout =', snapukDefined ? typeof snapuk.checkout : 'n/a');
        console.log('🔍 STEP 2: snapuk.checkout.button =', snapukDefined && snapuk.checkout ? typeof snapuk.checkout.button : 'n/a');
        
        if (typeof snapuk !== 'undefined' && snapuk.checkout && typeof snapuk.checkout.button === 'function') {
            console.log('✅ STEP 2: SDK fully available immediately (snapuk.checkout.button ready)');
            console.log('✅ STEP 2: SDK ready timestamp:', new Date().toISOString());
            try { this.installSdkCallbackLoggerIfEnabled?.(); } catch(_) {}
            callback();
            return;
        }
        console.log('⌛ STEP 2: SDK not ready yet - starting wait interval');
        let attempts = 0;
        const maxAttempts = 40;  // 4s max wait
        const interval = setInterval(() => {
            if (this._idle || this._cancelRequested) {
                clearInterval(interval);
                return;
            }
            attempts++;
            console.log('🔍 STEP 2: SDK check attempt #' + attempts + ' at ' + new Date().toISOString());
            const snapukDefined = typeof snapuk !== 'undefined';
            console.log('🔍 STEP 2: snapuk defined:', snapukDefined);
            console.log('🔍 STEP 2: snapuk.checkout.button type:', snapukDefined && snapuk.checkout ? typeof snapuk.checkout.button : 'n/a');
            
            if (typeof snapuk !== 'undefined' && snapuk.checkout && typeof snapuk.checkout.button === 'function') {
                clearInterval(interval);
                console.log(`✅ STEP 2: SDK became available after ${attempts * 100}ms (snapuk.checkout.button ready)`);
                console.log('✅ STEP 2: SDK ready timestamp:', new Date().toISOString());
                try { this.installSdkCallbackLoggerIfEnabled?.(); } catch(_) {}
                callback();
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                const snapukDefined = typeof snapuk !== 'undefined';
                console.error('❌ STEP 2 FAILED: SDK wait timeout after 4s - snapuk defined? ' + snapukDefined + ', checkout.button type? ' + (snapukDefined && snapuk.checkout ? typeof snapuk.checkout.button : 'n/a'));
                console.error('❌ STEP 2 FAILED: Final SDK state at timeout:', {
                    snapukDefined: snapukDefined,
                    snapukObject: snapukDefined ? snapuk : null,
                    checkoutExists: snapukDefined ? !!snapuk.checkout : false,
                    buttonType: snapukDefined && snapuk.checkout ? typeof snapuk.checkout.button : 'n/a'
                });
                // Do NOT callback() - prevent downstream errors
            }
        }, 100); // Check every 100ms
    },

    // Install a developer-only SDK callback logger when enabled via flag
    installSdkCallbackLoggerIfEnabled() {
        try {
            const enabled = !!(window.snap_params && window.snap_params.debug_callbacks);
            if (!enabled || this._sdkLoggerInstalled) return;
            if (!window.snapuk || !snapuk.checkout || typeof snapuk.checkout.button !== 'function') return;
            const orig = snapuk.checkout.button;
            snapuk.checkout.button = function(config) {
                const cfg = Object.assign({}, config);
                const keys = ['onApplicationId','onClose','onApproved','onApprovedWithConditions','onSuccess','onError','onDenied','onUnverifiedAccount','onPaymentFailure','onWithdrawn'];
                keys.forEach((k) => {
                    if (typeof cfg[k] === 'function') {
                        const fn = cfg[k];
                        cfg[k] = function() {
                            try { console.log(`💜🧩 SDK callback: ${k}`, { ts: new Date().toISOString(), args: Array.from(arguments) }); } catch(_) {}
                            return fn.apply(this, arguments);
                        };
                    }
                });
                try { console.info('✅ Snap SDK callback logger installed'); } catch(_) {}
                return orig(cfg);
            };
            this._sdkLoggerInstalled = true;
        } catch(_) {}
    },

    // prepareContainer() removed as unused; forceExplicitContainerSizing + host replacement are used instead

    /**
     * Prepare container for Snap button rendering
     * @param {HTMLElement} containerEl - Container element
     */
    // (removed duplicate prepareContainer)

    /**
     * CONTAINER READINESS CHECK - prevents SVG "height: undefined" error
     * @param {HTMLElement} el - Container element
     * @returns {boolean} True if container is ready for SDK
     */
    containerIsReady(el) {
        if (!el || !el.isConnected) {
            console.log('🔍 Container not ready: not connected to DOM');
            return false;
        }
        
        // CRITICAL: Ensure container has explicit dimensions before SDK renders
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none') {
            console.log('🔍 Container not ready: display:none');
            return false;
        }
        
        // Force explicit dimensions to prevent SDK SVG height errors
        if (!el.style.height || el.style.height === '') {
            el.style.height = '70px';
            console.log('🔧 Forced container height to 70px');
        }
        if (!el.style.minHeight || el.style.minHeight === '') {
            el.style.minHeight = '70px';
            console.log('🔧 Forced container min-height to 70px');
        }
        if (!el.style.width || el.style.width === '') {
            el.style.width = '300px';
            console.log('🔧 Forced container width to 300px');
        }
        if (!el.style.minWidth || el.style.minWidth === '') {
            el.style.minWidth = '300px';
            console.log('🔧 Forced container min-width to 300px');
        }
        
        console.log('✅ Container ready with explicit dimensions:', {
            height: el.style.height,
            width: el.style.width,
            computed: {
                height: cs.height,
                width: cs.width
            }
        });
        return true;
    },



    /**
     * Render the Snap button using the SDK
     * @param {HTMLElement} containerEl - Container element
     * @param {Object} snapParams - Snap Finance parameters
     * @param {Object} transaction - Transaction data
     * @param {Array} validationMessages - Validation error messages
     * @param {number} attempts - Retry attempts
     */
    renderButton(containerEl, snapParams, transaction, validationMessages = [], attempts = 0) {
        if (attempts > 8) {  // Max 8 retries
            console.error('❌ Max retries (8) reached for renderButton - giving up');
            this.showError(containerEl, 'Failed to render Snap button after multiple attempts.');
            return;
        }
        if (typeof snapuk === 'undefined' || !snapuk.checkout || typeof snapuk.checkout.button !== 'function') {
            console.log('⚠️ SDK not ready for snapuk.checkout.button - retrying in 120ms (attempt ' + (attempts + 1) + '/8)');
            this._trackTimeout(() => this.renderButton(containerEl, snapParams, transaction, validationMessages, attempts + 1), 120);
            return;
        }

        // Allow SDK to control sizing; do not force explicit container size

        // CONTAINER READINESS CHECK - prevents SVG "height: undefined" error
        // Relaxed readiness: proceed without forcing pre-size; SDK will size the control
        
        console.log('✅ Container is ready - proceeding with SDK call');
        console.log('🔍 Container final dimensions before SDK call:', {
            width: containerEl.style.width,
            height: containerEl.style.height,
            computed: {
                width: window.getComputedStyle(containerEl).width,
                height: window.getComputedStyle(containerEl).height
            },
            bounds: containerEl.getBoundingClientRect()
        });

        console.log('🔍 Transaction object:', transaction);
        console.log('🔍 Validation messages:', validationMessages);

        // Rehydrate session on first render attempt
        try { console.log('🔄 Rehydrate: attempting session refresh from saved app/token'); window.SnapApplication?.rehydrateSnapSession?.(); } catch(_) {}
        try { console.log('🔒 Keep blocked: ensuring block if only approved'); window.SnapApplication?.ensureBlockingFromStorage?.(); } catch(_) {}
        try { /* autoSubmit logs happen inside function */ window.SnapApplication?.autoSubmitIfApproved?.(); } catch(_) {}

        const buttonConfig = {
            merchantId: snapParams.merchant_id,
            theme: this.getSnapTheme(snapParams),
            transaction: transaction,

            onApplicationId: (applicationId, token) => {
                console.log('💜 onApplicationId', applicationId);
                console.log('📨 Application Status: Application Created');
                
                // Clear invoice cache after successful application start
                try { 
                    window.SnapTransaction?.resetInvoice?.(); 
                    console.log('🔄 Invoice cache cleared after application start');
                } catch(e) {
                    console.warn('⚠️ Failed to clear invoice cache:', e);
                }
                
                try {
                    const p = window.SnapApplication?.saveSnapApp?.(applicationId, token);
                    p?.catch?.((err) => {
                        const status = err && (err.response?.status || err.status) || 'unknown';
                        console.warn('[Snap] save_snap_application non-blocking error; continuing checkout', { status });
                    })?.finally?.(() => window.SnapApplication?.forceChosenSnap?.());
                } catch(_) {}
                window.SnapApplication.onApplicationId(applicationId, token, snapParams, transaction.invoiceNumber);
            },
            onClose: (applicationId, token) => {
                console.log('💜 onClose', applicationId || '(none)');
            },
            onApproved: (applicationId, token) => {
                console.log('💜 onApproved', applicationId);
                try {
                    const p = window.SnapApplication?.saveSnapApp?.(applicationId, token);
                    p?.catch?.((err) => {
                        const status = err && (err.response?.status || err.status) || 'unknown';
                        console.warn('[Snap] save_snap_application non-blocking error; continuing checkout', { status });
                    })?.finally?.(() => window.SnapApplication?.forceChosenSnap?.());
                } catch(_) {}
                window.SnapApplication.onApproved(
                    applicationId, token,
                    () => { document.querySelector('form.checkout')?.submit(); },
                    () => { try { wp.data.dispatch('wc/store/checkout').submitOrder(); } catch(e) {} }
                );
            },
            onApprovedWithConditions: (applicationId, token) => {
                console.log('💜 onApprovedWithConditions', applicationId);
                try {
                    const p = window.SnapApplication?.saveSnapApp?.(applicationId, token);
                    p?.catch?.((err) => {
                        const status = err && (err.response?.status || err.status) || 'unknown';
                        console.warn('[Snap] save_snap_application non-blocking error; continuing checkout', { status });
                    })?.finally?.(() => window.SnapApplication?.forceChosenSnap?.());
                } catch(_) {}
                window.SnapApplication.onApproved(
                    applicationId, token,
                    () => { document.querySelector('form.checkout')?.submit(); },
                    () => { try { wp.data.dispatch('wc/store/checkout').submitOrder(); } catch(e) {} }
                );
            },
            onSuccess: (applicationId, token) => {
                console.log('💜 onSuccess', applicationId);
                console.log('💜 Application Status: Application Approved & Completed');
                try {
                    const p = window.SnapApplication?.saveSnapApp?.(applicationId, token);
                    p?.catch?.((err) => {
                        const status = err && (err.response?.status || err.status) || 'unknown';
                        console.warn('[Snap] save_snap_application non-blocking error; continuing checkout', { status });
                    })?.finally?.(() => window.SnapApplication?.forceChosenSnap?.());
                } catch(_) {}
                window.SnapApplication.onSuccess(applicationId, token);
            },
            onError: (applicationId, token, message) => {
                console.error('💜 onError', { application_id: applicationId, message });
                console.error('💜 Application Status: Error occurred');
                window.SnapApplication.onError(applicationId, token, message);
                this.showError(containerEl, message);
            },
            onDenied: (applicationId, token) => {
                console.log('💜 onDenied', applicationId);
                window.SnapApplication.onDenied(applicationId, token);
                this.showError(containerEl, 'Your Snap Finance application was not approved. Please try another payment method.');
            },
            onUnverifiedAccount: (applicationId, token) => {
                console.log('💜 onUnverifiedAccount', applicationId);
                window.SnapApplication.onUnverifiedAccount(applicationId, token);
            },
            onPaymentFailure: (applicationId, token) => {
                console.log('💜 onPaymentFailure', applicationId);
                window.SnapApplication.onPaymentFailure(applicationId, token);
            },
            onWithdrawn: (applicationId, token) => {
                console.log('💜 onWithdrawn', applicationId);
                window.SnapApplication.onWithdrawn(applicationId, token);
            }
        };

        try {
            // Store validation state for click handling (apply latest transaction)
            containerEl.dataset.validationMessages = JSON.stringify(validationMessages);
            containerEl.dataset.transactionData = JSON.stringify(transaction);
            console.log('🏷️ Transaction attached to container:', {
                invoiceNumber: transaction?.invoiceNumber,
                status: transaction?._validationStatus,
                hash: stableTxHash(transaction)
            });

            // PATCH: defer SDK call to post-paint + final recheck
            const callSdk = () => {
                if (!this.containerIsReady(containerEl)) {
                    console.log('🔁 Container changed before SDK call; retrying shortly…');
                    return requestAnimationFrame(() =>
                        this.renderButton(containerEl, snapParams, transaction, validationMessages, attempts + 1)
                    );
                }
                if (typeof snapuk === 'undefined' || !snapuk.checkout || typeof snapuk.checkout.button !== 'function') {
                    console.log('🔁 SDK changed before call; retrying shortly…');
                    return requestAnimationFrame(() =>
                        this.renderButton(containerEl, snapParams, transaction, validationMessages, attempts + 1)
                    );
                }
        try {
            console.log('🎯 STEP 5: Calling snapuk.checkout.button with config:', buttonConfig);
                    // Do not force width/height on host container; let SDK styles apply
            console.log('🎯 STEP 5: Using theme:', this.getSnapTheme(snapParams));
            console.log('🚀 SNAP SDK BUTTON CALL - Transaction data being passed to Snap:', {
                invoiceNumber: transaction.invoiceNumber,
                validationStatus: transaction._validationStatus || 'unknown',
                hasValidData: window.SnapTransaction?.isTransactionValid?.(transaction) || false,
                customerData: transaction.customer,
                timestamp: new Date().toISOString()
            });
                    requestAnimationFrame(() => {
                        // Proceed without gating on host rect; SDK will size its own content
                        // Create or find a host for the SDK
                        let host = containerEl.querySelector('.snapuk-host');
                        if (!host) {
                            host = document.createElement('div');
                            host.className = 'snapuk-host';
                            // CRITICAL: Ensure host has explicit dimensions
                            host.style.width = '100%';
                            host.style.height = '70px';
                            host.style.minHeight = '70px';
                            host.style.minWidth = '300px';
                            host.style.display = 'block';
                            host.style.position = 'relative';
                            containerEl.appendChild(host);
                            console.log('🔧 Created host element with explicit dimensions');
                        }

                        // Do not manipulate host opacity/visibility; allow SDK to paint immediately

                        try {
                            // Rebuild transaction just before calling SDK to ensure freshness
                            try {
                                const rebuilt = window.SnapTransaction?.build?.(window.snap_params || {});
                                if (rebuilt) {
                                    buttonConfig.transaction = rebuilt;
                                    containerEl.dataset.transactionData = JSON.stringify(rebuilt);
                                }
                            } catch(_) {}
                            const configWithTarget = Object.assign({}, buttonConfig, { target: host });
                            console.log('🎯 Calling SDK with target host:', host);
                            snapuk.checkout.button(configWithTarget);
                            try { this._earlyPinSvg(containerEl); } catch(_) {}
                        } catch (e) {
                            console.warn('⚠️ SDK call with target failed, trying without target:', e);
                            try { 
                                snapuk.checkout.button(buttonConfig);
                                try { this._earlyPinSvg(containerEl); } catch(_) {}
                            } catch (e2) {
                                console.error('❌ SDK call completely failed:', e2);
                            }
                        }
                        console.log('✅ STEP 5: Snap Finance button rendered successfully');
                        try { this.ensureShadowHostVisible(containerEl); } catch(_) {}
                        containerEl.dataset.snapRendered = '1';
                        // Activate guarded single-render mode after the first mount
                        if (!this._guardedRenderActive) {
                            this._guardedRenderActive = true;
                            diag('[Guard] Guarded render active');
                        }
                        // Start watchdog heartbeat to restore button if shadow/button disappears
                        try { this._startHeartbeat(); } catch(_) {}
                        // PATCH: post-render verification (once)
                        this._trackTimeout(() => {
                            try {
                                if (containerEl.dataset.snapPostVerified === '1') return;
                                const hostEl = containerEl.querySelector('.snapuk-host') || containerEl;
                                const shadow = hostEl?.shadowRoot || containerEl.shadowRoot || null;
                                const btn = shadow?.getElementById('snapuk-checkout-btn') ||
                                            shadow?.querySelector('#snapuk-checkout-btn') ||
                                            shadow?.querySelector('.snap-checkout-btn') ||
                                            shadow?.querySelector('button');
                                if (btn) {
                                    containerEl.dataset.snapPostVerified = '1';
                                    // Reveal container now that button exists
                                    containerEl.style.visibility = 'visible';
                                    containerEl.style.opacity = '1';
                                    btn.style.minHeight = '40px';
                                    console.log('✅ Post-render verification: shadow/button present');
                                } else {
                                    console.warn('⚠️ Post-render: Snap button not found yet; harmless if SDK still mounting.');
                                }
                            } catch (e) {
                                console.warn('⚠️ Post-render verification error (ignored):', e);
                            }
                        }, 0);
                    });
                } catch (e) {
                    console.error('❌ STEP 5 FAILED: SDK button call threw:', e);
                }
            };
            // Two-frame defer to let React/Blocks commit and styles settle
            requestAnimationFrame(() => requestAnimationFrame(callSdk));
            
            // Mark SDK button as mounted (optimistic; will verify below)
            this._sdkButtonMounted = true;
            
            // Post-render verification: observe only; do not re-call SDK on same host to avoid attachShadow errors
            this._trackTimeout(() => {
                const hasShadow = !!containerEl.shadowRoot;
                const snapBtn = (containerEl.shadowRoot && containerEl.shadowRoot.querySelector('#snapuk-checkout-btn')) || null;
                if (!hasShadow || !snapBtn) {
                    console.warn('⚠️ Post-render verification: shadow/button not observable yet (no retry to avoid duplicate attachShadow)');
                } else {
                    console.log('✅ Post-render verification: shadow/button present');
                    try { this.ensureShadowHostVisible(containerEl); } catch(_) {}
                    try {
                        // Pin SVG size if missing
                        const svg = containerEl.shadowRoot?.querySelector('svg');
                        if (svg) {
                            if (!svg.getAttribute('width')) svg.setAttribute('width', '320');
                            if (!svg.getAttribute('height')) svg.setAttribute('height', '45');
                        }
                    } catch (_) {}
                }
                // Auto-click if requested
                if (this._autoClickNext) {
                    this._autoClickNext = false;
                    this._scheduleAutoClick(containerEl);
                }
            }, 400);
            
            // Add validation overlay if validation fails
            if (validationMessages && validationMessages.length > 0) {
                console.log('❌ VALIDATION FAILED: Adding transparent overlay to Snap button');
                console.log('❌ Validation errors:', validationMessages);
                
                // Show validation message
                this.showValidationMessage(containerEl, validationMessages, transaction);
                
                // Add transparent overlay after Snap button renders
                // Classic: small initial delay (~150ms) to avoid early retries before shadow is ready
                const isBlocks = !!(window.snap_params && window.snap_params.is_blocks);
                const firstDelay = isBlocks ? 700 : 850; // 700 + 150ms for Classic
                this._trackTimeout(() => {
                    if (containerEl.shadowRoot) {
                        this.addValidationOverlay(containerEl, validationMessages, transaction);
                    } else {
                        // Try a bit later if shadow root isn't ready yet
                        this._trackTimeout(() => this.addValidationOverlay(containerEl, validationMessages, transaction), 700);
                    }
                }, firstDelay); // Wait for Snap button to render
            } else {
                console.log('✅ VALIDATION PASSED: No overlay needed - Snap button ready to use');
                
                // Clear any existing validation messages but keep guard overlay present
                this.clearValidationMessage(containerEl);
                window.SnapTransaction?.clearFieldHighlighting?.();

                // Ensure guard overlay exists in valid state; clicking will revalidate and auto-launch
                this._trackTimeout(() => {
                    this.addValidationOverlay(containerEl, [], transaction);
                    // Also wire click validation handler on the underlying button for robustness
                    this.addClickValidationHandler(containerEl, snapParams);
                }, 700);
            }
            
            // Do not fade host; avoid modifying opacity—SDK controls presentation
            
            // Debug: Check what was actually rendered with multiple checks
            this._trackTimeout(() => {
                console.log('🔍 Button debug - Container HTML:', containerEl.innerHTML);
                console.log('🔍 Button debug - Container dimensions:', containerEl.getBoundingClientRect());
                
                const button = containerEl.querySelector('button');
                if (button) {
                    console.log('🔍 Button debug - Button found:', button);
                    console.log('🔍 Button debug - Button classes:', button.className);
                } else {
                    console.log('🔍 Button debug - No button found in container');
                    console.log('🔍 Button debug - All elements in container:', containerEl.children);
                    
                    // Try alternative selectors
                    const snapButton = containerEl.querySelector('#snapuk-checkout-btn') ||
                                      containerEl.querySelector('.snapuk-btn') ||
                                      containerEl.querySelector('.snap-checkout-btn') ||
                                      containerEl.querySelector('[data-snap-button]') ||
                                      containerEl.querySelector('div[role="button"]');
                    
                    if (snapButton) {
                        console.log('🔍 Button debug - Found Snap button with alternative selector:', snapButton);
                    } else {
                        console.log('🔍 Button debug - No Snap button found with any selector');
                    }
                }
            }, 100);
        } catch (error) {
            console.error('❌ STEP 5 FAILED: Error during SDK snapuk.checkout.button:', error);
            this.showError(containerEl, 'Failed to render Snap button. Please try again.');
        }
    },



    // Limits warning removed: hidden at source by gateway limits

    // (removed duplicate updateValidationMessagesOnly(messages))

    /**
     * Show validation message without affecting the Snap button
     * @param {HTMLElement} containerEl - Container element
     * @param {Array} messages - Validation error messages
     * @param {Object} transaction - Transaction data for debugging
     */
    showValidationMessage(containerEl, messages, transaction) {
        // Allow shipping errors to show even without prior user interaction (higher severity)
        const hasInteracted = window.FormMonitorUtil?.hasUserInteracted?.() || false;
        const hasShippingError = (messages || []).some(m => /shipping/i.test(String(m)));
        if (!hasInteracted && (messages?.length || 0) > 0 && !hasShippingError) {
            diag('⏱️ Skipping validation message - no user interaction yet (non-shipping)');
            return;
        }

        // Progressive filtering: only show messages for fields that were interacted with (always allow shipping)
        let msgs = Array.isArray(messages) ? messages.slice() : [];
        try {
          const interacted = (window.FormMonitorUtil && typeof window.FormMonitorUtil.getInteractedFields === 'function') ? window.FormMonitorUtil.getInteractedFields() : null;
          if (interacted && interacted.size) {
            msgs = msgs.filter(m => {
              const s = String(m || '').toLowerCase();
              if (s.includes('shipping')) return true; // Always surface shipping issues
              if (s.includes('terms')) return true; // Always surface terms & conditions
              if (s.includes('first name')) return interacted.has('billing_first_name');
              if (s.includes('last name')) return interacted.has('billing_last_name');
              if (s.includes('email')) return interacted.has('billing_email');
              if (s.includes('mobile')) return interacted.has('billing_phone');
              if (s.includes('postcode')) return interacted.has('billing_postcode');
              if (s.includes('address') && !s.includes('shipping')) return interacted.has('billing_address_1');
              if (s.includes('city') && !s.includes('shipping')) return interacted.has('billing_city');
              if (s.includes('terms')) return interacted.has('terms');
              return true; // fallback
            });
          }
        } catch(_) {}

        // Do not render a header-only box when there are no concrete messages
        if (!msgs || msgs.length === 0) {
            try { this.clearValidationMessage(containerEl); } catch(_) {}
            diag('ℹ️ No specific validation messages to show; skipping banner');
            return;
        }

        // Build content once
        const messageList = (msgs || []).map(msg => `<li>${msg}</li>`).join('');
        const inner = `
            <div style="color: #d63638; background: #fcf0f1; border: 1px solid #d63638; padding: 1px 10px 10px; border-radius: 4px; margin: 14px 0 5px; font-size: 14px; width: 100%; box-sizing: border-box;">
                <strong>⚠️ Please complete required fields:</strong>
                <ul style="margin: 5px 0; padding-left: 20px; font-size: 13px;">
                    ${messageList}
                </ul>
            </div>`;

        // Update existing singleton message if present to avoid flicker
        const parent = containerEl.parentNode || document.body;
        let validationDiv = parent.querySelector('#snap-validation-message');
        if (validationDiv) {
            if (validationDiv.innerHTML !== inner) validationDiv.innerHTML = inner;
        } else {
            validationDiv = document.createElement('div');
            validationDiv.id = 'snap-validation-message';
            validationDiv.innerHTML = inner;
            parent.insertBefore(validationDiv, containerEl);
        }

        diag('🔍 Validation message shown/updated');
    },

    /**
     * Clear validation message when validation passes
     * @param {HTMLElement} containerEl - Container element
     */
    clearValidationMessage(containerEl) {
        // Clear ALL validation messages (not just the first one)
        const validationMessages = document.querySelectorAll('#snap-validation-message, [id^="snap-validation-message-"]');
        validationMessages.forEach(msg => {
            msg.remove();
            console.log('✅ Validation message cleared:', msg.id);
        });
        
        // Also clear any validation messages without IDs that might be around the container
        const containerParent = containerEl.parentNode;
        if (containerParent) {
            const nearbyMessages = containerParent.querySelectorAll('div[style*="color: #d63638"][style*="background: #fcf0f1"]');
            nearbyMessages.forEach(msg => {
                if (msg.textContent.includes('Please complete required fields')) {
                    msg.remove();
                    console.log('✅ Additional validation message cleared');
                }
            });
        }
    },

    /**
     * Clear all errors (validation messages + field highlighting)
     * @param {HTMLElement} containerEl - Container element
     */
    clearAllErrors(containerEl) {
      this.clearValidationMessage(containerEl);
      window.SnapTransaction?.clearFieldHighlighting?.();
      console.log('✅ All errors cleared');
    },

    /**
     * Add click validation handler to Snap button
     * @param {HTMLElement} containerEl - Container element
     * @param {Object} snapParams - Snap parameters
     */
    addClickValidationHandler(containerEl, snapParams) {
        // Wait for the Snap button to be rendered and try multiple selectors
        this._trackTimeout(() => {
            // Check for Shadow DOM first (Snap SDK uses shadow DOM)
            const hostEl = containerEl.querySelector('.snapuk-host');
            const shadowRoot = hostEl?.shadowRoot || containerEl.shadowRoot || null;
            let snapButton = null;
            
            if (shadowRoot) {
                console.log('🔍 Found Shadow DOM - searching inside shadow root');
                snapButton = shadowRoot.querySelector('#snapuk-checkout-btn') ||
                            shadowRoot.querySelector('.snapuk-btn') ||
                            shadowRoot.querySelector('.snap-checkout-btn') ||
                            shadowRoot.querySelector('button');
            }
            
            // Fallback to regular DOM if no shadow root or button not found
            if (!snapButton) {
                console.log('🔍 No Shadow DOM or button not found in shadow - trying regular DOM');
                snapButton = containerEl.querySelector('#snapuk-checkout-btn') ||
                            containerEl.querySelector('.snapuk-btn') ||
                            containerEl.querySelector('.snap-checkout-btn') ||
                            containerEl.querySelector('button');
            }
            
            const validationHandler = (event) => {
                    console.log('🖱️ Snap button clicked - re-validating current form state...');
                    
                    // Force interaction state on button click (so warnings can show)
                    if (window.FormMonitorUtil?.forceInteraction) {
                        window.FormMonitorUtil.forceInteraction();
                    }
                    // Universal preflight guard using centralized Validation
                    try {
                        const pre = (window.Validation && window.Validation.preflight) ? window.Validation.preflight(window.snap_params) : { ok: true };
                        if (!pre.ok) {
                            this.showGenericWarning(containerEl, pre && pre.message ? pre.message : 'Please complete all required fields to continue.');
                            event.preventDefault();
                            event.stopPropagation();
                            return false;
                        } else {
                            this.clearGenericWarning(containerEl);
                        }
                    } catch(_) {}
                    
                    // Always rebuild transaction and validate on each click
                    const snapParamsLocal = window.snap_params;
                    let messages = [];
                    let tx = null;
                    try {
                        tx = window.SnapTransaction.build(snapParamsLocal);
                        messages = window.SnapTransaction.validate(tx, snapParamsLocal) || [];
                    } catch (e) {
                        console.error('❌ Error building/validating transaction on click:', e);
                    }

                    // Do not manually override postcode messages here; leave it to SnapTransaction.validate()
                    // This keeps dynamic behavior consistent across fields.

                    if (messages.length > 0) {
                        console.log('❌ Current form invalid at click - blocking and showing messages');
                        event.preventDefault();
                        event.stopPropagation();
                        try {
                            // Update dataset and show overlay/messages
                            containerEl.dataset.validationMessages = JSON.stringify(messages);
                            if (tx) containerEl.dataset.transactionData = JSON.stringify(tx);
                            this.showValidationMessage(containerEl, messages, tx || {});
                            this.addValidationOverlay(containerEl, messages, tx || {});
                            if (window.SnapTransaction?.highlightMissingFields) {
                                window.SnapTransaction.clearFieldHighlighting?.();
                                window.SnapTransaction.highlightMissingFields(messages);
                            }
                        } catch (e) {
                            console.error('❌ Error updating validation overlay/messages on click:', e);
                        }
                        return false;
                    }

                    // If valid, ensure the stored transaction is still fresh; otherwise re-render and block
                    const labelFresh = this._isLabelFresh(containerEl);
                    if (!labelFresh) {
                        console.log('🏷️ Stored transaction stale - refreshing before allowing application');
                        try { this.render(); } catch (_) {}
                        event.preventDefault();
                        event.stopPropagation();
                        return false;
                    }
                    
                    console.log('✅ Validation up-to-date and label fresh - allowing Snap application to proceed');
            };

            if (snapButton) {
                console.log('🔍 Adding click validation handler to Snap button:', snapButton);
                console.log('🔍 Button classes:', snapButton.className);
                console.log('🔍 Button ID:', snapButton.id);
                snapButton.addEventListener('click', validationHandler, true); // Use capture to intercept before Snap's handler
            } else {
                console.log('⚠️ Snap button not found for click handler - trying retry approach');
                
                // Retry approach with multiple attempts
                const findButtonWithRetry = (attempts = 3) => {
                    this._trackTimeout(() => {
                        const snapButton = containerEl.querySelector('#snapuk-checkout-btn') ||
                                         containerEl.querySelector('.snapuk-btn') ||
                                         containerEl.querySelector('.snap-checkout-btn') ||
                                         containerEl.querySelector('button');
                        
                        if (snapButton) {
                            snapButton.addEventListener('click', validationHandler, true);
                            console.log('✅ Validation handler added to button on retry');
                        } else if (attempts > 0) {
                            findButtonWithRetry(attempts - 1);
                        } else {
                            console.error('❌ Failed to find Snap button after retries');
                        }
                    }, 500); // Half-second intervals
                };
                findButtonWithRetry();
            }
        }, 1000); // Wait longer for Snap SDK to render the button
    },

    /**
     * Add transparent overlay on top of Snap button when validation fails
     * @param {HTMLElement} containerEl - Container element
     * @param {Array} validationMessages - Validation error messages
     * @param {Object} transaction - Transaction data
     */
    addValidationOverlay(containerEl, validationMessages, transaction) {
        diag('🔍 Adding validation overlay to Snap button...');
        
        // Always clear any existing overlay before adding a new one
        try { this.removeValidationOverlay(containerEl); } catch(_) {}
        
        // Find the Snap button within the container (including Shadow DOM)
        let snapButton = null;
        
        // First try regular DOM
        snapButton = containerEl.querySelector('#snapuk-checkout-btn') ||
                    containerEl.querySelector('.snapuk-btn') ||
                    containerEl.querySelector('.snap-checkout-btn') ||
                    containerEl.querySelector('button') ||
                    containerEl.querySelector('[role="button"]');
        
        // If not found, try Shadow DOM (prefer inner host)
        if (!snapButton) {
            const hostEl = containerEl.querySelector('.snapuk-host');
            const shadowRoot = hostEl?.shadowRoot || containerEl.shadowRoot || null;
            if (shadowRoot) {
                diag('🔍 Searching Shadow DOM for Snap button...');
                snapButton = shadowRoot.querySelector('#snapuk-checkout-btn') ||
                            shadowRoot.querySelector('.snapuk-btn') ||
                            shadowRoot.querySelector('.snap-checkout-btn') ||
                            shadowRoot.querySelector('button') ||
                            shadowRoot.querySelector('[role="button"]') ||
                            shadowRoot.querySelector('svg') ||
                            shadowRoot.querySelector('div[role="button"]');
                
                if (snapButton) {
                    diag('✅ Found Snap button in Shadow DOM:', snapButton);
                }
            }
        }
        
        if (!snapButton) {
            diag('⚠️ Snap button not found for overlay - will retry with multiple approaches');
            
            // Try multiple retry strategies
            const maxRetries = 5; // escalate sooner
            let retryCount = 0;
            
            const retryWithDelay = () => {
                retryCount++;
                diag(`🔄 Retry attempt ${retryCount}/${maxRetries} for finding Snap button`);
                
                // Try to find button again
                let foundButton = containerEl.querySelector('#snapuk-checkout-btn') ||
                                containerEl.querySelector('.snapuk-btn') ||
                                containerEl.querySelector('.snap-checkout-btn') ||
                                containerEl.querySelector('button') ||
                                containerEl.querySelector('[role="button"]');
                
                // Try Shadow DOM
                if (!foundButton) {
                    const shadowRoot = containerEl.shadowRoot;
                    if (shadowRoot) {
                        foundButton = shadowRoot.querySelector('#snapuk-checkout-btn') ||
                                    shadowRoot.querySelector('.snapuk-btn') ||
                                    shadowRoot.querySelector('.snap-checkout-btn') ||
                                    shadowRoot.querySelector('button') ||
                                    shadowRoot.querySelector('[role="button"]') ||
                                    shadowRoot.querySelector('svg') ||
                                    shadowRoot.querySelector('div[role="button"]');
                    }
                }
                
                if (foundButton) {
                    diag('✅ Found Snap button on retry:', foundButton);
                    // Recursively call this function with the found button
                    this.addValidationOverlay(containerEl, validationMessages, transaction);
                } else if (retryCount < maxRetries) {
                    // Exponential backoff: 500ms, 1000ms, 1500ms, etc.
                    const delay = 500 + (retryCount * 500);
                    this._trackTimeout(retryWithDelay, delay);
                } else {
                    // Only escalate when overall preflight is OK; otherwise use container-level overlay
                    try {
                        const pre = (window.Validation && window.Validation.preflight) ? window.Validation.preflight(window.snap_params) : { ok: false };
                        if (pre && pre.ok) {
                            console.error('❌ Failed to find Snap button after retries — escalating to guarded re-render');
                            this._guardedRenderActive = false;
                            this._forceFullRenderNext = true;
                            this._sdkButtonMounted = false;
                            this.render();
                        } else {
                            diag('⚠️ Button not found and preflight invalid — adding fallback overlay to container');
                            this.addOverlayToContainer(containerEl, validationMessages, transaction);
                        }
                    } catch(_) {
                        this.addOverlayToContainer(containerEl, validationMessages, transaction);
                    }
                }
            };
            
            this._trackTimeout(retryWithDelay, 500);
            return;
        }
        
        diag('✅ Found Snap button for overlay:', snapButton);
        
        // Create transparent overlay
        const overlay = document.createElement('div');
        overlay.id = 'snap-validation-overlay';
        overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: transparent;
            cursor: pointer;
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: inherit;
            pointer-events: auto;
        `;
        
        // Add click handler to overlay
        overlay.addEventListener('click', (event) => {
            console.log('🖱️ Validation overlay clicked - re-validating...');
            
            // Mark this as user interaction so warnings can be shown
            if (window.FormMonitorUtil && window.FormMonitorUtil.forceInteraction) {
                window.FormMonitorUtil.forceInteraction();
                console.log('✅ Interaction forced (overlay click) - enabling warnings');
            }

            // Universal preflight guard using centralized Validation
            try {
                const pre = (window.Validation && window.Validation.preflight) ? window.Validation.preflight(window.snap_params) : { ok: true };
                if (!pre.ok) {
                    this.showGenericWarning(containerEl, pre && pre.message ? pre.message : 'Please complete all required fields to continue.');
                    event.preventDefault();
                    event.stopPropagation();
                    return false;
                } else {
                    this.clearGenericWarning(containerEl);
                    // Clear Woo error banners if now valid (prevents stale blocks)
                    try {
                        const groups = document.querySelectorAll('.woocommerce-NoticeGroup-checkout, .woocommerce-error, .woocommerce-notice--error');
                        groups.forEach(g => g.remove());
                    } catch(_) {}
                }
            } catch(_) {}
            
            // Re-validate with current form data (fresh params)
            const freshSnapParams = { ...(window.snap_params || {}) };
            try { freshSnapParams.billing_postcode = document.querySelector('[name="billing_postcode"]')?.value?.trim() || ''; } catch(_) {}
            const snapParams = freshSnapParams;
            if (!snapParams) {
                console.error('❌ No snap_params available for re-validation');
                return;
            }
            
            const newTransaction = window.SnapTransaction.build(snapParams);
            const newValidationMessages = window.SnapTransaction.validate(newTransaction, snapParams);
            
            console.log('🔍 Re-validating with current form data:', { newValidationMessages, newTransaction });
            
            if (newValidationMessages && newValidationMessages.length > 0) {
                console.log('❌ VALIDATION STILL FAILED: Updating validation message');
                
                // Small delay to ensure interaction flag is set before showing message
                this._trackTimeout(() => {
                    // Update validation message
                    this.clearValidationMessage(containerEl);
                    this.showValidationMessage(containerEl, newValidationMessages, newTransaction);
                }, 10);
                
                // Highlight missing fields
                if (window.SnapTransaction && window.SnapTransaction.highlightMissingFields) {
                        window.SnapTransaction.clearFieldHighlighting();
                    window.SnapTransaction.highlightMissingFields(newValidationMessages);
                }
            } else {
                console.log('✅ VALIDATION NOW PASSED: Forcing fresh render and auto-launch (on user click)');
                // Keep overlay guarding; clear messages/highlighting
                this.clearValidationMessage(containerEl);
                if (window.SnapTransaction && window.SnapTransaction.clearFieldHighlighting) {
                    window.SnapTransaction.clearFieldHighlighting();
                }
                // One-shot flags: force host replacement, then auto-click after re-render
                this._forceFullRenderNext = true;
                this._autoClickNext = true;
                this._guardedRenderActive = false; // allow a single fresh render now
                // Trigger render shortly to allow DOM to settle
                this._trackTimeout(() => {
                    try { this.render(); } catch (e) { console.error('❌ Error triggering forced render:', e); }
                }, 100);
            }
            
                        event.preventDefault();
                        event.stopPropagation();
        });
        
        // Add overlay to the appropriate location (Shadow DOM or regular DOM)
        const shadowRoot = containerEl.shadowRoot;
        if (shadowRoot && snapButton && shadowRoot.contains(snapButton)) {
            // Button is in Shadow DOM, add overlay to Shadow DOM
            diag('✅ Adding overlay to Shadow DOM');
            
            // Ensure Shadow DOM container has relative positioning
            const shadowContainer = shadowRoot.querySelector('div') || shadowRoot.firstElementChild;
            if (shadowContainer && getComputedStyle(shadowContainer).position === 'static') {
                shadowContainer.style.position = 'relative';
            }
            
            shadowRoot.appendChild(overlay);
                    } else {
            // Button is in regular DOM, add overlay to regular container
            diag('✅ Adding overlay to regular DOM');
            
            // Ensure container has relative positioning for absolute overlay
            if (getComputedStyle(containerEl).position === 'static') {
                containerEl.style.position = 'relative';
            }
            
            containerEl.appendChild(overlay);
        }
        
        diag('✅ Validation overlay added successfully');
    },

    /**
     * Add overlay to container as fallback when button can't be found
     * @param {HTMLElement} containerEl - Container element
     * @param {Array} validationMessages - Validation error messages
     * @param {Object} transaction - Transaction data
     */
    addOverlayToContainer(containerEl, validationMessages, transaction) {
        diag('🔧 Adding targeted fallback overlay to button area');
        // Always clear any existing overlay before adding a new one
        try { this.removeValidationOverlay(containerEl); } catch(_) {}
        
        // Try to find a more specific button container within the Snap container
        let buttonContainer = null;
        
        // Look for common Snap button container patterns
        const possibleSelectors = [
            '[data-snap-button]',
            '.snap-button-container',
            '.snap-checkout-button',
            'div[style*="height"]', // Snap often uses styled divs
            'div[style*="width"]',
            'div[style*="display: flex"]',
            'div[style*="justify-content"]',
            'div[style*="align-items"]',
            'div[style*="cursor: pointer"]',
            'div[role="button"]',
            'div[tabindex]', // Interactive elements
            'div[onclick]',
            'div[class*="button"]',
            'div[class*="checkout"]',
            'div[class*="snap"]'
        ];
        
        for (const selector of possibleSelectors) {
            buttonContainer = containerEl.querySelector(selector);
            if (buttonContainer) {
                diag('✅ Found button container with selector:', selector);
                break;
            }
        }
        
        // Create overlay based on whether we found a specific button container
        let overlay;
        
        if (buttonContainer) {
            // Overlay the specific button container
            diag('✅ Creating overlay for specific button container');
            overlay = document.createElement('div');
            overlay.id = 'snap-validation-overlay';
            overlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: transparent;
                cursor: pointer;
                z-index: 1000;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: inherit;
                pointer-events: auto;
            `;
            } else {
            // Create a targeted overlay that covers just the button area
            diag('🔧 Creating targeted button area overlay');
            overlay = document.createElement('div');
            overlay.id = 'snap-validation-overlay';
            overlay.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 300px;
                height: 70px;
                background: transparent;
                cursor: pointer;
                z-index: 1000;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                pointer-events: auto;
            `;
        }
        
        // Add click handler to overlay
        overlay.addEventListener('click', (event) => {
            console.log('🖱️ Fallback overlay clicked - re-validating...');
            
            // Universal preflight guard using centralized Validation
            try {
                const pre = (window.Validation && window.Validation.preflight) ? window.Validation.preflight(window.snap_params) : { ok: true };
                if (!pre.ok) {
                    this.showGenericWarning(containerEl, pre && pre.message ? pre.message : 'Please complete all required fields to continue.');
                    event.preventDefault();
                    event.stopPropagation();
                    return false;
                } else {
                    this.clearGenericWarning(containerEl);
                }
            } catch(_) {}

            // Re-validate with current form data (fresh params)
            const freshSnapParams = { ...(window.snap_params || {}) };
            try { freshSnapParams.billing_postcode = document.querySelector('[name="billing_postcode"]')?.value?.trim() || ''; } catch(_) {}
            const snapParams = freshSnapParams;
            if (!snapParams) {
                console.error('❌ No snap_params available for re-validation');
                return;
            }
            
            const newTransaction = window.SnapTransaction.build(snapParams);
            const newValidationMessages = window.SnapTransaction.validate(newTransaction, snapParams);
            
            console.log('🔍 Re-validating with current form data:', { newValidationMessages, newTransaction });
            
            if (newValidationMessages && newValidationMessages.length > 0) {
                console.log('❌ VALIDATION STILL FAILED: Updating validation message');
                
                // Update validation message
                        this.clearValidationMessage(containerEl);
                this.showValidationMessage(containerEl, newValidationMessages, newTransaction);
                
                // Highlight missing fields
                if (window.SnapTransaction && window.SnapTransaction.highlightMissingFields) {
                        window.SnapTransaction.clearFieldHighlighting();
                    window.SnapTransaction.highlightMissingFields(newValidationMessages);
                }
            } else {
                console.log('✅ VALIDATION NOW PASSED (fallback): Forcing fresh render and auto-launch');
                // Clear messages/highlighting
                this.clearValidationMessage(containerEl);
                if (window.SnapTransaction && window.SnapTransaction.clearFieldHighlighting) {
                    window.SnapTransaction.clearFieldHighlighting();
                }
                this._forceFullRenderNext = true;
                this._autoClickNext = true;
                this._guardedRenderActive = false;
                this._trackTimeout(() => {
                    try { this.render(); } catch (e) { console.error('❌ Error triggering forced render (fallback):', e); }
                }, 100);
            }
            
                        event.preventDefault();
                        event.stopPropagation();
        });
        
        // Add overlay to the appropriate location
        if (buttonContainer) {
            // Add overlay to the specific button container
            if (getComputedStyle(buttonContainer).position === 'static') {
                buttonContainer.style.position = 'relative';
            }
            buttonContainer.appendChild(overlay);
            diag('✅ Fallback overlay added to specific button container');
                    } else {
            // Add overlay to the main container
            if (getComputedStyle(containerEl).position === 'static') {
                containerEl.style.position = 'relative';
            }
            containerEl.appendChild(overlay);
            diag('✅ Fallback overlay added to main container (targeted area)');
        }
    },

    /**
     * Remove validation overlay when validation passes
     * @param {HTMLElement} containerEl - Container element
     */
    removeValidationOverlay(containerEl) {
        // Try to find overlay in regular DOM
        let overlay = containerEl.querySelector('#snap-validation-overlay');
        
        // If not found in regular DOM, try Shadow DOM
        if (!overlay) {
            const shadowRoot = containerEl.shadowRoot;
            if (shadowRoot) {
                overlay = shadowRoot.querySelector('#snap-validation-overlay');
            }
        }
        
        if (overlay) {
            overlay.remove();
            diag('✅ Validation overlay removed');
        } else {
            diag('⚠️ No validation overlay found to remove');
        }
    },

    /**
     * Update validation overlay with new messages (for dynamic field improvements)
     * @param {HTMLElement} containerEl - Container element
     * @param {Array} validationMessages - Updated validation messages
     * @param {Object} transaction - Transaction data
     */
    updateValidationOverlay(containerEl, validationMessages, transaction) {
        // Try to find overlay in regular DOM
        let overlay = containerEl.querySelector('#snap-validation-overlay');
        
        // If not found in regular DOM, try Shadow DOM
        if (!overlay) {
            const shadowRoot = containerEl.shadowRoot;
            if (shadowRoot) {
                overlay = shadowRoot.querySelector('#snap-validation-overlay');
            }
        }
        
        if (overlay) {
            // Update the overlay content with new messages
            const messageHtml = validationMessages.map(msg => 
                `<div style="color: #d63638; margin: 5px 0;">• ${msg}</div>`
            ).join('');
            
            overlay.innerHTML = `
                <div style="
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(255, 255, 255, 0.9);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                    cursor: pointer;
                    border-radius: 4px;
                ">
                    <div style="
                        background: #fcf0f1;
                        border: 1px solid #d63638;
                        padding: 15px;
                        border-radius: 4px;
                        max-width: 300px;
                        text-align: center;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    ">
                        <div style="color: #d63638; font-weight: bold; margin-bottom: 10px;">
                            Please complete the following:
                        </div>
                        ${messageHtml}
                        <div style="color: #666; font-size: 12px; margin-top: 10px;">
                            Click to update validation
                        </div>
                    </div>
                </div>
            `;
            
            diag('✅ Validation overlay updated with new messages:', validationMessages);
        } else {
            diag('⚠️ No validation overlay found to update');
        }
    },

    /**
     * Clear warnings for specific fields that have improved
     * @param {HTMLElement} containerEl - Container element
     * @param {Array} improvedFields - Array of field names that improved
     */
    clearFieldWarnings(containerEl, improvedFields) {
        diag('🎯 Clearing warnings for improved fields:', improvedFields);
        
        // Clear field highlighting for improved fields
        if (window.SnapTransaction && window.SnapTransaction.clearFieldHighlighting) {
            window.SnapTransaction.clearFieldHighlighting(improvedFields);
        }
        
        // Note: The validation message box is updated separately via updateValidationOverlay
        // This method focuses on field-specific visual feedback
        diag('✅ Field warnings cleared for:', improvedFields);
    },

    /**
     * Update validation messages only (no re-render)
     * @param {HTMLElement} containerEl - Container element
     * @param {Array} validationMessages - Validation messages
     * @param {Object} transaction - Transaction data
     */
    updateValidationMessagesOnly(containerEl, validationMessages, transaction) {
        diag('🔄 Updating validation messages only (no re-render):', validationMessages);
        
        if (validationMessages && validationMessages.length > 0) {
            // Show validation message and add overlay
            this.showValidationMessage(containerEl, validationMessages, transaction);
            this.addValidationOverlay(containerEl, validationMessages, transaction);
        } else {
            // Clear field/messages but KEEP guard overlay to always intercept clicks
            this.clearAllErrors(containerEl);
            // Ensure a guard overlay exists even when valid; clicking it will revalidate and auto-launch
            try { this.addValidationOverlay(containerEl, [], transaction); } catch (_) {}
        }
    },

    /**
     * Handle clicks on validation placeholder button (legacy - now using overlay approach)
     * @param {HTMLElement} buttonEl - The placeholder button element
     */
    handleValidationClick(buttonEl) {
        console.log('🖱️ Legacy validation button clicked - this should not happen with overlay approach');
        
        // This function is kept for backward compatibility but should not be used
        // The overlay approach handles validation clicks directly
        const containerEl = buttonEl.closest('[id^="snap-uk-checkout"]');
        if (containerEl) {
            // Trigger overlay click handler if overlay exists
            const overlay = containerEl.querySelector('#snap-validation-overlay');
            if (overlay) {
                overlay.click();
            }
        }
    },

    /**
     * Show error message
     * @param {HTMLElement} containerEl - Container element
     * @param {string} message - Error message
     */
    showError(containerEl, message) {
        containerEl.innerHTML = `
            <div style="color: #d63638; background: #fcf0f1; border: 1px solid #d63638; padding: 10px; border-radius: 4px; margin: 10px 0;">
                <strong>Error</strong><br>
                ${message}
            </div>
        `;
    },

    // Removed forced container sizing; SDK governs layout

    // Ensure the SDK shadow host is visible even if SDK stylesheet briefly hides it
    ensureShadowHostVisible(containerEl) {
        try {
            const sr = containerEl.shadowRoot;
            if (!sr) return;
            if (sr.getElementById('snap-force-visible')) return;
            const s = document.createElement('style');
            s.id = 'snap-force-visible';
            s.textContent = `
                :host { visibility: visible !important; opacity: 1 !important; }
                #snapuk-checkout-btn, .snap-checkout-btn, button { visibility: visible !important; }
            `;
            sr.appendChild(s);
        } catch (_) {}
    },

    // Early SVG size pin to avoid initial flash when SDK hasn't set attributes yet
    _earlyPinSvg(containerEl) {
        try {
            const tryPin = () => {
                try {
                    const host = containerEl.querySelector('.snapuk-host') || containerEl;
                    const sr = (host && (host.shadowRoot || null)) || containerEl.shadowRoot || null;
                    if (!sr) return false;
                    const svg = sr.querySelector('svg');
                    if (!svg) return false;
                    if (!svg.getAttribute('width')) svg.setAttribute('width', '320');
                    if (!svg.getAttribute('height')) svg.setAttribute('height', '45');
                    diag('🔧 Early SVG pin applied');
                    return true;
                } catch (_) { return false; }
            };
            if (tryPin()) return;
            let attempts = 25; // ~500ms total with 20ms steps
            const tick = () => {
                if (this._idle || this._cancelRequested) return;
                if (tryPin()) return;
                if (--attempts > 0) {
                    this._trackTimeout(tick, 20);
                }
            };
            this._trackTimeout(tick, 0);
        } catch (_) {}
    },

    // Heartbeat: periodically ensure button/shadow exists; restore if missing
    _startHeartbeat() {
        const loop = () => {
            if (this._idle || this._cancelRequested) return; // paused when not selected
            try {
                const isActive = window.PaymentMethodDetector?.isSnapFinanceSelected?.() || false;
                if (!isActive) { this._trackTimeout(loop, 3000); return; }
                const container = document.getElementById(CONTAINER_ID);
                if (!container) {
                    // Container missing → re-render once (respect cooldown)
                    const now = Date.now();
                    if (now >= this._heartbeatCooldownUntil && !this._isRendering) {
                        this._heartbeatCooldownUntil = now + 1500;
                        this._guardedRenderActive = false;
                        this._forceFullRenderNext = true;
                        diag('[Heartbeat] Container missing → re-render');
                        try { this.render(); } catch(_) {}
                    }
                    this._trackTimeout(loop, 2000);
                    return;
                }
                // Check shadow/button presence
                const host = container.querySelector('.snapuk-host') || container;
                const sr = (host && (host.shadowRoot || null)) || container.shadowRoot || null;
                const btn = sr && (sr.getElementById('snapuk-checkout-btn') || sr.querySelector('button'));
                if (!sr || !btn) {
                    // require two consecutive misses OR an overall valid preflight before re-render
                    this._hbMisses = (this._hbMisses || 0) + 1;
                    const now = Date.now();
                    let pre = null;
                    try { pre = (window.Validation && window.Validation.preflight) ? window.Validation.preflight(window.snap_params) : { ok: false }; } catch(_) { pre = { ok: false }; }
                    if ((this._hbMisses >= 2 || (pre && pre.ok)) && now >= this._heartbeatCooldownUntil && !this._isRendering) {
                        this._heartbeatCooldownUntil = now + 1500;
                        this._sdkButtonMounted = false;
                        this._guardedRenderActive = false; // allow a refresh
                        this._forceFullRenderNext = true;
                        diag('[Heartbeat] Shadow/button missing (sustained or valid preflight) → re-render');
                        try { this.render(); } catch(_) {}
                    }
                } else {
                    // healthy
                    this._hbMisses = 0;
                }
            } catch(_) {}
            this._trackTimeout(loop, 2000);
        };
        // Kick off or continue
        this._trackTimeout(loop, 2000);
    },


    /**
     * Schedule auto-click of the Snap button after it mounts
     * @param {HTMLElement} containerEl
     * @param {number} attempts
     * @param {number} delayMs
     */
    _scheduleAutoClick(containerEl, attempts = 15, delayMs = 150) {
        const tryClick = () => {
            const shadow = containerEl.shadowRoot;
            const btn = (shadow && (shadow.querySelector('#snapuk-checkout-btn') || shadow.querySelector('.snapuk-btn') || shadow.querySelector('button')))
                    || containerEl.querySelector('#snapuk-checkout-btn')
                    || containerEl.querySelector('.snapuk-btn')
                    || containerEl.querySelector('button');
            if (btn) {
                try {
                    btn.click();
                    console.log('🟢 Auto-clicked Snap button');
                } catch (e) {
                    console.error('❌ Failed to auto-click Snap button:', e);
                }
                return;
            }
            if (attempts > 0) {
                this._trackTimeout(() => this._scheduleAutoClick(containerEl, attempts - 1, delayMs * 1.2), delayMs);
            } else {
                console.error('❌ Max auto-click retries reached');
            }
        };
        this._trackTimeout(tryClick, delayMs);
    },



    /**
     * Get Snap Finance button theme
     * @param {Object} snapParams - Snap Finance parameters
     * @returns {string} Theme ('DARK' or 'LIGHT')
     */
    getSnapTheme(snapParams) {
        const raw = (snapParams && snapParams.button_theme ? String(snapParams.button_theme) : 'DARK')
            .trim()
            .toUpperCase();
        return raw === 'LIGHT' ? 'LIGHT' : 'DARK';
    },


    

    showGenericWarning(containerEl, msg) {
        try {
            const message = msg || 'Please complete all required fields to continue.';
            this.showValidationMessage(containerEl, [message], {});
        } catch(_) {}
    },

    clearGenericWarning(containerEl) {
        try { this.clearValidationMessage(containerEl); } catch(_) {}
    }
};