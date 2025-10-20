/**
 * Snap Finance Blocks Checkout Handler
 * 
 * Blocks checkout-specific functionality for Snap Finance integration.
 * ROBUST MOUNT TIMING FIX for default payment method issue.
 */

console.groupCollapsed('[Snap] Blocks Init');
console.log('🔧 Snap Finance Blocks:', (window.snap_params && window.snap_params.plugin_version) || 'unknown', 'Starting registration...');

const registerPaymentMethod = window.wc?.wcBlocksRegistry?.registerPaymentMethod;

// Get settings from WooCommerce Blocks registry (proper method)
const settings = window.wc?.wcSettings?.getSetting?.('snapfinance_refined_data', {}) || {};
console.log('🔧 Snap Finance Blocks: Settings from registry:', settings);

// Get icon from settings or snap_params, with fallback
const icon = settings.icon || settings.icons?.[0]?.src || window.snap_params?.icon || plugin_dir_url + 'assets/images/snap-logo.svg?v=' + ((window.snap_params && window.snap_params.plugin_version) || '1.0.0');
console.log('🔧 Resolved icon URL:', icon);

console.log('🔧 Snap Finance Blocks: Settings loaded:', settings);
console.log('🔧 Snap Finance Blocks: Icon URL:', icon);

// Inject responsive icon CSS once
(function injectResponsiveIconCSSOnce(){
    try {
        if (!document.getElementById('snap-responsive-icons-css')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'snap-responsive-icons-css';
            styleEl.textContent = `
                .snap-desc-icon--mobile { display: none; }
                @media (max-width: 600px) {
                    .snap-desc-icon--desktop { display: none !important; }
                    .snap-desc-icon--mobile { display: block !important; }
                }
                @media (min-width: 601px) {
                    .snap-desc-icon--desktop { display: block !important; }
                    .snap-desc-icon--mobile { display: none !important; }
                }
            `;
            document.head.appendChild(styleEl);
        }
    } catch (e) {}
})();

// Use settings from PHP Blocks integration, with fallbacks to localized gateway settings
const decode = (window.wp && wp.htmlEntities && typeof wp.htmlEntities.decodeEntities === 'function') ? wp.htmlEntities.decodeEntities : (s) => s;
const label = decode(
    settings.title || window.snap_params?.gateway_title || 'Snap Finance'
);
const description = settings.description 
    || window.snap_params?.gateway_description 
    || 'Flexible payments from 4 to 48 months, 18+. T&Cs apply. Credit subject to status. Check your eligibility without impacting your credit score.';

console.log('🔧 Snap Finance Blocks: Description:', description);
console.log('🔧 Snap Finance Blocks: Settings description:', settings.description);

const Content = () => {
    console.log('🔧 Snap Finance Blocks: Content component rendering with description:', description);

    const descRowStyle = {
        margin: '0 0 15px 0',
        fontSize: '16px',
        color: '#000000',
        fontWeight: '400',
        lineHeight: '1.4',
        display: 'flex',
        alignItems: 'center'
    };

    const iconStyle = {
        boxSizing: 'border-box',
        display: 'block',
        flexGrow: 0,
        flexShrink: 0,
        width: '44px',
        height: '44px',
        marginRight: '11px',
        overflow: 'hidden',
        verticalAlign: 'middle',
        fill: 'rgb(17, 17, 17)',
        transition: 'fill 0.1s ease 0s'
    };

    // This div will be mounted by Blocks when the payment method is selected
    return wp.element.createElement('div', null,
        wp.element.createElement('div', { style: descRowStyle },
            // Inline SVG icon (desktop)
            wp.element.createElement('svg', {
                className: 'snap-desc-icon snap-desc-icon--desktop p-Icon p-Icon--redirectDesktop Icon p-Icon--xl',
                fill: 'rgb(17, 17, 17)',
                xmlns: 'http://www.w3.org/2000/svg',
                viewBox: '0 0 48 40',
                role: 'presentation',
                style: iconStyle
            },
                wp.element.createElement('path', {
                    opacity: '.6',
                    fillRule: 'evenodd',
                    clipRule: 'evenodd',
                    d: 'M0 8a4 4 0 014-4h30a4 4 0 014 4v8a1 1 0 11-2 0v-4a2 2 0 00-2-2H4a2 2 0 00-2 2v20a2 2 0 002 2h30a2 2 0 002-2v-6a1 1 0 112 0v6a4 4 0 01-4 4H4a4 4 0 01-4-4V8zm4 0a1 1 0 100-2 1 1 0 000 2zm3 0a1 1 0 100-2 1 1 0 000 2zm4-1a1 1 0 11-2 0 1 1 0 012 0zm29.992 9.409L44.583 20H29a1 1 0 100 2h15.583l-3.591 3.591a1 1 0 101.415 1.416l5.3-5.3a1 1 0 000-1.414l-5.3-5.3a1 1 0 10-1.415 1.416z'
                })
            ),
            // Inline SVG icon (mobile)
            wp.element.createElement('svg', {
                className: 'snap-desc-icon snap-desc-icon--mobile p-Icon p-Icon--redirectMobile Icon p-Icon--xl',
                fill: 'rgb(17, 17, 17)',
                xmlns: 'http://www.w3.org/2000/svg',
                viewBox: '0 0 48 40',
                role: 'presentation',
                style: iconStyle
            },
                wp.element.createElement('path', {
                    opacity: '.6',
                    fillRule: 'evenodd',
                    clipRule: 'evenodd',
                    d: 'M9 1a4 4 0 00-4 4v30a4 4 0 004 4h18a4 4 0 004-4v-9a1 1 0 10-2 0v9a2 2 0 01-2 2H9a2 2 0 01-2-2V14a2 2 0 012-2h18a2 2 0 012 2v2a1 1 0 102 0V5a4 4 0 00-4-4H9zm26.992 15.409L39.583 20H24a1 1 0 100 2h15.583l-3.591 3.591a1 1 0 101.415 1.416l5.3-5.3a1 1 0 000-1.414l-5.3-5.3a1 1 0 10-1.415 1.416zM7 8.5A1.5 1.5 0 018.5 7h19a1.5 1.5 0 010 3h-19A1.5 1.5 0 017 8.5zM23 3a1 1 0 100 2 1 1 0 000-2zm-8 1a1 1 0 011-1h4a1 1 0 110 2h-4a1 1 0 01-1-1zm0 30a1 1 0 100 2h6a1 1 0 100-2h-6z'
                })
            ),
            wp.element.createElement('span', null, wp.htmlEntities.decodeEntities(description))
        ),
        wp.element.createElement('div', { 
            id: 'snap-uk-checkout',
            style: { 
                margin: '15px 0',
                transition: 'opacity 0.2s'
            } 
        })
    );
};

const SnapFinance = {
    name: 'snapfinance_refined',
    label: wp.element.createElement('div', { className: 'payment-method-label' },
        wp.element.createElement('span', { className: 'payment-method-label__label' }, label),
        icon ? wp.element.createElement('img', { 
            className: 'payment-methods--logos',
            src: icon,
            alt: 'Snap Finance',
            style: { maxHeight: '24px', width: 'auto' }
        }) : null
    ),
    content: Object(wp.element.createElement)(Content, null),
    edit: Object(wp.element.createElement)(Content, null),
    canMakePayment: () => true,
    ariaLabel: label,
    supports: {
        features: settings.supports || ['products'],
    },
    // Both icon formats for maximum compatibility
    icon: icon,  // String for simple
    icons: icon ? [{ id: 'snap-finance', src: icon, alt: 'Snap Finance' }] : [],  // Array for robustness
};

console.log('🔧 Snap Finance Blocks: Payment method ready for registration');

// ROBUST BLOCKS MOUNT TIMING FIX
(function() {
    'use strict';
  
console.log('🔧 Snap Finance Blocks Checkout Handler Loaded:', (window.snap_params && window.snap_params.plugin_version) || 'unknown');
    
    // Get Snap parameters from PHP
    const snapParams = window.snap_params || {};
    const clientId = snapParams.client_id;
    const merchantId = snapParams.merchant_id;
    
    console.log('🔧 Snap params loaded:', { clientId: !!clientId, merchantId: !!merchantId });
    
    // Blocks-specific environment detection
    function isBlocksEnvironment() {
        return !!(window.wp && wp.data && wp.data.select);
    }
    
    // Simple debounce helper
    function debounce(fn, wait) {
        let t;
        return function(...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    // IDEMPOTENT RENDERER - uses shared SnapRender
    let _blocksIsRendering = false;
    let _containerPollActive = false;
    let _containerPollScheduled = false;
    let _lastMissingLogTs = 0;
    function renderSnapButton() {
        const el = ensureBlocksContainer();
        if (!el) {
            const now = Date.now();
            if (now - _lastMissingLogTs > 1000) {
                _lastMissingLogTs = now;
                console.log('🔍 Container not found yet');
            }
            return false;
        }
        
        if (el.dataset.snapRendered === '1') {
            console.log('✅ Button already rendered');
            return true; // avoid duplicates
        }
        
        if (!clientId || !merchantId) {
            console.error('❌ Missing required parameters');
            return false;
        }

        // Avoid concurrent renders with a short lock
        if (_blocksIsRendering) {
            console.log('↺ Render in progress - skipping');
            return false;
        }
        _blocksIsRendering = true;

        // Use the shared renderer - it handles all rendering logic
        if (window.SnapRender && window.SnapRender.render) {
            console.log('🎯 Using shared SnapRender');
            try {
                window.SnapRender.render();
                setTimeout(() => { _blocksIsRendering = false; }, 1000); // 1s lock
                return true;
            } catch (e) {
                console.error('❌ Error with SnapRender:', e);
                _blocksIsRendering = false;
                return false;
            }
        }

        console.log('⚠️ SnapRender not available');
        _blocksIsRendering = false;
        return false;
    }

    // Blocks-specific container management
    let containerNotFoundCount = 0;
    function ensureBlocksContainer() {
        const el = document.getElementById('snap-uk-checkout');
        if (!el) {
            containerNotFoundCount++;
            if (containerNotFoundCount === 1) {
                console.log('🔍 Snap container not found - waiting for Blocks to render...');
            } else if (containerNotFoundCount % 50 === 0) {
                console.log(`🔍 Snap container not found - waiting... (${containerNotFoundCount} attempts)`);
            }
            return null;
        }
        return el;
    }

    // TRY UNTIL RENDERED - only if Snap is selected
    function tryUntilRendered() {
        // Only attempt rendering if Snap Finance is the active payment method
        const isActive = window.PaymentMethodDetector?.isSnapFinanceSelected?.() || 
                        wp.data.select('wc/store/payment')?.getActivePaymentMethod?.() === 'snapfinance_refined';
        if (!isActive) {
            window.PaymentMethodDetector?.logIdleStatus?.();
            return;
        }

        // Ensure container exists and is dimension-ready before rendering
        const el = document.getElementById('snap-uk-checkout');
        if (!el) {
            const now = Date.now();
            if (now - _lastMissingLogTs > 1000) {
                _lastMissingLogTs = now;
                console.log('🔍 Container not found yet');
            }
            setTimeout(tryUntilRendered, 200);
            return;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width < 200 || rect.height < 45) {
            console.log('🔍 Container dimensions not ready:', rect);
            setTimeout(tryUntilRendered, 200);
            return;
        }
        
        if (!renderSnapButton()) {
            // Slightly slower retry — Blocks may still be mounting/replacing nodes
            setTimeout(tryUntilRendered, 200);
        }
    }

    // Add timeout to prevent infinite loops
    let renderAttempts = 0;
    const maxRenderAttempts = 60; // ~12 seconds at 200ms intervals
    let lastRenderTime = 0;
    const renderCooldown = 1000; // 1 second cooldown between renders
    
    function tryUntilRenderedWithTimeout() {
        renderAttempts++;
        
        // Check cooldown to prevent rapid re-renders
        const now = Date.now();
        if (now - lastRenderTime < renderCooldown) {
            console.log('⏳ Render cooldown active - skipping attempt');
            return;
        }
        
        if (renderAttempts > maxRenderAttempts) {
            console.error('❌ Snap Finance: Max render attempts reached - container may not be available');
            return;
        }
        
        const isActive = window.PaymentMethodDetector?.isSnapFinanceSelected?.() || 
                        wp.data.select('wc/store/payment')?.getActivePaymentMethod?.() === 'snapfinance_refined';
        if (!isActive) {
            return;
        }
        
        if (!renderSnapButton()) {
            setTimeout(tryUntilRenderedWithTimeout, 200);
        } else {
            // Success - reset attempts and update last render time
            renderAttempts = 0;
            lastRenderTime = now;
        }
    }

    // Scheduler to avoid overlapping pollers
    function scheduleTryUntilRendered() {
        if (_containerPollScheduled) return;
        _containerPollScheduled = true;
        setTimeout(() => {
            _containerPollScheduled = false;
            tryUntilRenderedWithTimeout();
        }, 250);
    }

    // Blocks-specific error handling
    function handleBlocksError(containerEl, error) {
        console.error('❌ Snap Finance Blocks error:', error);
        if (containerEl) {
            containerEl.innerHTML = `
                <div style="color: #d63638; background: #fcf0f1; border: 1px solid #d63638; padding: 10px; border-radius: 4px; margin: 10px 0;">
                    <strong>Error</strong><br>
                    ${error}
                </div>
            `;
        }
    }

    // MUTATION OBSERVER - watches for Blocks re-renders (only when Snap is selected)
    const mo = new MutationObserver(() => {
        // Only process mutations if Snap Finance is the active payment method
        const isActive = window.PaymentMethodDetector?.isSnapFinanceSelected?.() || 
                        wp.data.select('wc/store/payment')?.getActivePaymentMethod?.() === 'snapfinance_refined';
        if (!isActive) {
            return;
        }
        
        const el = document.getElementById('snap-uk-checkout');
        // Re-render when: not yet rendered OR rendered flag exists but shadow root is missing (stale)
        if (el && (el.dataset.snapRendered !== '1' || !el.shadowRoot)) {
            console.log('🔄 DOM changed - attempting to render Snap button');
            renderSnapButton();
        }
    });
    
    // WP.DATA SUBSCRIPTION - monitor payment method changes
    if (window.wp && wp.data && wp.data.subscribe) {
        let lastMethod = null;
        wp.data.subscribe(() => {
            try {
                const currentMethod = wp.data.select('wc/store/payment')?.getActivePaymentMethod?.();
                if (currentMethod !== lastMethod) {
                    lastMethod = currentMethod;
                    if (currentMethod === 'snapfinance_refined') {
                        window.PaymentMethodDetector?.logActiveStatus?.();
                        // Clear any stale rendered state on the (possibly re-used) container
                        try {
                            const c = document.getElementById('snap-uk-checkout');
                            if (c) { c.dataset.snapRendered = ''; c.innerHTML = ''; }
                        } catch(_) {}
                        // Use container-aware retry loop after a short delay for React commit
                        scheduleTryUntilRendered();
                    } else {
                        // Snap deselected: ensure renderer idles and cleans up overlays/messages
                        try { window.SnapRender?.goIdle?.(); } catch(_) {}
                        try {
                            const c = document.getElementById('snap-uk-checkout');
                            if (c) {
                                window.SnapRender?.removeValidationOverlay?.(c);
                                window.SnapRender?.clearValidationMessage?.(c);
                                // Reset render flags and stale state so reselection mounts cleanly
                                c.dataset.snapRendered = '';
                                c.innerHTML = '';
                            }
                            if (window.SnapRender) {
                                window.SnapRender._sdkButtonMounted = false;
                                window.SnapRender._renderAttempts = 0;
                            }
                            console.log('🔄 Snap deselected - render state reset');
                        } catch(_) {}
                    }
                }
            } catch (e) {
                // Silent fail - wp.data might not be fully ready
            }
        });
    }

    // Use shared form monitoring utility for Blocks
    if (window.FormMonitorUtil) {
        window.FormMonitorUtil.initBlocksMonitoring(() => {
            console.log('🔄 Form change detected - re-validating Snap Finance');
            
            // Get the container
            const container = document.getElementById('snap-uk-checkout');
            if (!container) {
                console.warn('⚠️ Snap container not found');
                return;
            }
            
            // Rebuild transaction with current form data
            if (window.SnapTransaction && window.snap_params) {
                const transaction = window.SnapTransaction.build(window.snap_params);
                const validationMessages = window.SnapTransaction.validate(transaction, window.snap_params);
                
                console.log('🔍 Validation result:', {
                    messages: validationMessages,
                    count: validationMessages.length,
                    isValid: validationMessages.length === 0
                });
                
                // Update transaction validation status
                window.SnapTransaction.updateValidationStatus(transaction, validationMessages, validationMessages.length === 0);
                
                // Update the container's data attributes
                container.dataset.validationMessages = JSON.stringify(validationMessages);
                container.dataset.transactionData = JSON.stringify(transaction);
                
                // If validation passed, clear the rendered state to force re-render
                if (validationMessages.length === 0) {
                    console.log('✅ Validation passed - clearing rendered state for re-render');
                    container.dataset.snapRendered = '';
                    
                    // Force re-render with fresh data
                    setTimeout(() => {
                        if (window.SnapRender && window.SnapRender.render) {
                            window.SnapRender.render();
                        }
                    }, 100);
                } else {
                    console.log('❌ Validation failed - letting SnapRender manage messaging');
                    // Avoid duplicate validation messages; SnapRender manages overlay/messages internally
                }
            }
        });
    } else {
        console.warn('⚠️ FormMonitorUtil not available - falling back to inline monitoring');
        
        // Fallback to original monitoring if utility not available
        if (window.wp?.data?.subscribe) {
            let last = '';
            let renderTimeout = null;
            let isRendering = false; // Add rendering flag to prevent concurrent renders
            
            // Store subscription for billing/totals changes with improved change detection
            let lastSnapshot = '';
            
            wp.data.subscribe(() => {
                try {
                    const isActive = window.PaymentMethodDetector?.isSnapFinanceSelected?.() || 
                                   wp.data.select('wc/store/payment')?.getActivePaymentMethod?.() === 'snapfinance_refined';
                    if (!isActive || isRendering) {
                        return; // Early exit if not active or already rendering
                    }

                    // Use Cart Store for billing data (more reliable than checkout store)
                    const cartStore = wp.data.select('wc/store/cart');
                    const customerData = cartStore?.getCustomerData?.();
                    const billingAddress = customerData?.billingAddress || customerData?.billing;
                    const tot = cartStore?.getCartTotals?.();
                    
                    if (!billingAddress && !tot) {
                        return;
                    }
                    
                    const newSnapshot = JSON.stringify({
                        first_name: billingAddress?.first_name || '',
                        last_name: billingAddress?.last_name || '',
                        email: billingAddress?.email || '',
                        postcode: billingAddress?.postcode || '',
                        total: tot?.total_price ?? tot?.totalPrice ?? tot?.total
                    });

                    // Only re-render if snapshot differs AND at least one required field changed
                    if (newSnapshot !== lastSnapshot && hasRequiredFieldChange(lastSnapshot, newSnapshot)) {
                        lastSnapshot = newSnapshot;
                        console.log('🔄 Significant billing/totals change - re-rendering Snap button');
                        
                        isRendering = true;
                        
                        setTimeout(() => {
                            const el = document.getElementById('snap-uk-checkout');
                            if (el) {
                                el.dataset.snapRendered = '';
                                el.innerHTML = '';
                                window.SnapRender.render();
                            }
                            isRendering = false;
                        }, 800); // 800ms debounce as recommended by Grok Heavy
                    }
                } catch (e) {
                    console.error('❌ Error in billing/totals subscription:', e);
                    isRendering = false;
                }
            });
            
            // Helper function to check if required fields actually changed
            function hasRequiredFieldChange(oldSnap, newSnap) {
                if (!oldSnap) return true; // First render
                
                const old = JSON.parse(oldSnap || '{}');
                const nw = JSON.parse(newSnap);
                
                return (
                    old.first_name !== nw.first_name ||
                    old.last_name !== nw.last_name ||
                    old.email !== nw.email ||
                    old.postcode !== nw.postcode
                );
            }
        }
    }
    
    // Start observing and attempting
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            mo.observe(document.body, { childList: true, subtree: true });
            scheduleTryUntilRendered();
            // Bind to selection events: use container-aware retry loop (never call render() directly)
            window.addEventListener('snapfinance:deselected', () => { try { window.SnapRender?.goIdle?.(); } catch(_) {} });
            window.addEventListener('snapfinance:selected', () => { try { window.SnapRender?.resumeActive?.(); scheduleTryUntilRendered(); } catch(_) {} });
        });
    } else {
        mo.observe(document.body, { childList: true, subtree: true });
        scheduleTryUntilRendered();
        window.addEventListener('snapfinance:deselected', () => { try { window.SnapRender?.goIdle?.(); } catch(_) {} });
        window.addEventListener('snapfinance:selected', () => { try { window.SnapRender?.resumeActive?.(); scheduleTryUntilRendered(); } catch(_) {} });
    }

    // Register payment method
    registerPaymentMethod(SnapFinance);
    console.groupEnd();
    console.log('✅ Snap Finance Blocks payment method registered');

    // Debug function
    window.testSnapRender = function() {
        console.log('🧪 Manual Snap render test');
        renderSnapButton();
    };

    // Debug function to test data stores
    window.testDataStores = function() {
        console.log('🧪 Testing WooCommerce data stores...');
        
        if (window.wp?.data?.select) {
            console.log('✅ wp.data.select available');
            
            try {
                const cartStore = window.wp.data.select('wc/store/cart');
                console.log('🔍 Cart Store:', cartStore);
                console.log('🔍 Cart Store methods:', cartStore ? Object.keys(cartStore) : 'null');
                
                if (cartStore?.getBillingAddress) {
                    const billingAddress = cartStore.getBillingAddress();
                    console.log('🔍 Billing Address:', billingAddress);
                } else {
                    console.log('❌ getBillingAddress method not available');
                }
                
                if (cartStore?.getCartTotals) {
                    const totals = cartStore.getCartTotals();
                    console.log('🔍 Cart Totals:', totals);
                } else {
                    console.log('❌ getCartTotals method not available');
                }
                
            } catch (e) {
                console.error('❌ Error testing data stores:', e);
            }
        } else {
            console.log('❌ wp.data.select not available');
        }
    };

})();