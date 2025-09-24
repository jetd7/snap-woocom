/**
 * Payment Method Detector Utility
 * 
 * Single responsibility: Determine what payment method is currently selected.
 * Used by both Classic and Blocks checkouts.
 */

(function() {
    'use strict';

    // Internal state held in closure (safe with Object.freeze)
    let _currentMethod = null;
    let _listeners = [];
    let _initialized = false;
    let _lastChangeTs = null;
    let _unsubscribeWp = null;
    let _radioListenerBound = false;

    const PaymentMethodDetector = {

        /**
         * Check if Snap Finance payment method is currently selected
         * @returns {boolean} True if Snap Finance is the active payment method
         */
        isSnapFinanceSelected() {
            try {
                // Method 1: WooCommerce Blocks data store (Blocks checkout)
                if (window.wp?.data?.select) {
                    const currentMethod = wp.data.select('wc/store/payment')?.getActivePaymentMethod?.();
                    if (currentMethod === 'snapfinance_refined') {
                        return true;
                    }
                }
                
                // Method 2: Classic checkout radio button
                const snapRadio = document.querySelector('input[name="payment_method"][value="snapfinance_refined"]');
                if (snapRadio && snapRadio.checked) {
                    return true;
                }
                
                // Method 3: Blocks checkout payment method selection (UI fallback)
                const blocksSnapMethod = document.querySelector('.wc-block-components-payment-method--snapfinance_refined .wc-block-components-payment-method__radio-input:checked');
                if (blocksSnapMethod) {
                    return true;
                }
                
                return false;
            } catch (e) {
                console.warn('⚠️ Error checking Snap Finance selection:', e);
                return false;
            }
        },

        /**
         * Get the currently selected payment method ID
         * @returns {string|null} Payment method ID or null if none selected
         */
        getSelectedPaymentMethod() {
            try {
                // Method 1: WooCommerce Blocks data store (Blocks checkout)
                if (window.wp?.data?.select) {
                    const currentMethod = wp.data.select('wc/store/payment')?.getActivePaymentMethod?.();
                    if (currentMethod) {
                        return currentMethod;
                    }
                }
                
                // Method 2: Classic checkout radio button
                const selectedRadio = document.querySelector('input[name="payment_method"]:checked');
                if (selectedRadio) {
                    return selectedRadio.value;
                }
                
                // Method 3: Blocks checkout payment method selection (UI fallback)
                const blocksSelectedMethod = document.querySelector('.wc-block-components-payment-method .wc-block-components-payment-method__radio-input:checked');
                if (blocksSelectedMethod) {
                    // Extract method ID from the parent element's class
                    const parentElement = blocksSelectedMethod.closest('.wc-block-components-payment-method');
                    if (parentElement) {
                        const classList = parentElement.className;
                        const methodMatch = classList.match(/--([a-zA-Z0-9_]+)/);
                        if (methodMatch) {
                            return methodMatch[1];
                        }
                    }
                }
                
                return null;
            } catch (e) {
                console.warn('⚠️ Error getting selected payment method:', e);
                return null;
            }
        },

        /**
         * Initialize selection change monitoring (idempotent)
         */
        init() {
            if (_initialized) return;
            _initialized = true;

            // Seed current method
            _currentMethod = this.getSelectedPaymentMethod();
            _lastChangeTs = Date.now();

            // Subscribe to Woo Blocks payment store if available
            try {
                if (window.wp?.data?.subscribe) {
                    const select = () => window.wp.data.select('wc/store/payment');
                    let last = _currentMethod;
                    const unsubscribe = window.wp.data.subscribe(() => {
                        try {
                            const now = select()?.getActivePaymentMethod?.() || null;
                            if (now !== last) {
                                last = now;
                                this._handleSelectionChange(now);
                            }
                        } catch (_) {
                            // ignore
                        }
                    });
                    _unsubscribeWp = unsubscribe;
                }
            } catch (_) {}

            // Classic checkout radio fallback
            try {
                if (!_radioListenerBound) {
                    document.addEventListener('change', (ev) => {
                        const t = ev.target;
                        if (t && t.name === 'payment_method') {
                            const now = this.getSelectedPaymentMethod();
                            this._handleSelectionChange(now);
                        }
                    }, true);
                    _radioListenerBound = true;
                }
            } catch (_) {}
        },

        /**
         * Internal handler to fan-out selection changes
         * @param {string|null} methodId
         */
        _handleSelectionChange(methodId) {
            _currentMethod = methodId;
            _lastChangeTs = Date.now();

            const isSnap = methodId === 'snapfinance_refined';
            const detail = { methodId, isSnap, timestamp: _lastChangeTs };

            try { window.dispatchEvent(new CustomEvent('snapfinance:method-change', { detail })); } catch(_) {}
            try { window.dispatchEvent(new CustomEvent(isSnap ? 'snapfinance:selected' : 'snapfinance:deselected', { detail })); } catch(_) {}

            // Notify subscribers
            try {
                _listeners.forEach((fn) => {
                    try { fn(detail); } catch(_) {}
                });
            } catch(_) {}
        },

        /**
         * Subscribe to selection changes
         * @param {(detail:{methodId:string|null,isSnap:boolean,timestamp:number})=>void} handler
         * @returns {() => void} Unsubscribe function
         */
        subscribe(handler) {
            if (typeof handler !== 'function') return () => {};
            _listeners.push(handler);
            return () => {
                _listeners = _listeners.filter((h) => h !== handler);
            };
        },

        /**
         * Convenience: fire when Snap becomes active
         * @param {Function} handler
         * @returns {() => void}
         */
        onSelected(handler) {
            return this.subscribe((d) => { if (d.isSnap) handler(d); });
        },

        /**
         * Convenience: fire when Snap becomes inactive
         * @param {Function} handler
         * @returns {() => void}
         */
        onDeselected(handler) {
            return this.subscribe((d) => { if (!d.isSnap) handler(d); });
        },

        /**
         * Check if a specific payment method is selected
         * @param {string} methodId - Payment method ID to check
         * @returns {boolean} True if the specified method is selected
         */
        isPaymentMethodSelected(methodId) {
            const selectedMethod = this.getSelectedPaymentMethod();
            return selectedMethod === methodId;
        },

        /**
         * Log the current payment method status (for debugging)
         */
        logPaymentMethodStatus() {
            const selectedMethod = this.getSelectedPaymentMethod();
            const isSnapSelected = this.isSnapFinanceSelected();
            
            console.log('🔍 Payment Method Status:', {
                selectedMethod: selectedMethod || 'none',
                isSnapFinanceSelected: isSnapSelected,
                timestamp: new Date().toISOString()
            });
            
            return {
                selectedMethod,
                isSnapFinanceSelected: isSnapSelected
            };
        },

        /**
         * Log idle status when Snap Finance is not selected
         */
        logIdleStatus() {
            console.log('💤 Snap Finance not selected - staying idle');
        },

        /**
         * Log active status when Snap Finance is selected
         */
        logActiveStatus() {
            console.log('🔍 Snap Finance selected - proceeding with validation');
        }
    };

    // Expose to global scope
    window.PaymentMethodDetector = Object.freeze(PaymentMethodDetector);
    // Initialize immediately
    try { PaymentMethodDetector.init(); } catch(_) {}
    
    console.log('✅ PaymentMethodDetector loaded and ready');
})();
