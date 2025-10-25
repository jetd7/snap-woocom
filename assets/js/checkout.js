/**
 * Snap Finance Classic Checkout Handler
 * 
 * Classic checkout-specific functionality for Snap Finance integration.
 * Uses the shared SnapRender.render() function for button rendering.
 */

jQuery(document).ready(function($) {
    'use strict';
    console.groupCollapsed('[Snap] Classic Init');
    console.log('🔧 Snap Finance Classic Checkout Handler Loaded');
    console.log('🔧 Page load time:', new Date().toISOString());
    
    // Debug: Check initial payment method selection
    const initialPaymentMethod = $('input[name="payment_method"]:checked').val();
    console.log('🔧 Initial payment method:', initialPaymentMethod);
    console.log('🔧 Snap Finance radio button exists:', $('input[name="payment_method"][value="snapfinance_refined"]').length > 0);
    console.log('🔧 Snap Finance radio button checked:', $('input[name="payment_method"][value="snapfinance_refined"]').is(':checked'));
    
    // Enhanced initialization tracking
    let initializationAttempts = 0;
    const maxInitAttempts = 10;
    
    // Tiny hook to call renderer when Snap is selected
    function go() { 
        console.log('🔧 go() called - attempt #' + (initializationAttempts + 1));
        initializationAttempts++;
        
        if (window.SnapRender && document.getElementById('snap-uk-checkout')) {
            console.log('[Snap] checkout.js init - SnapRender available');
            window.SnapRender.render(); 
        } else {
            console.log('🔧 SnapRender or container not ready yet');
            console.log('🔧 SnapRender available:', !!window.SnapRender);
            console.log('🔧 Container exists:', !!document.getElementById('snap-uk-checkout'));
            
            // Retry logic for timing issues
            if (initializationAttempts < maxInitAttempts) {
                console.log('🔧 Retrying in 500ms...');
                setTimeout(go, 500);
            } else {
                console.error('🔧 Max initialization attempts reached');
            }
        }
    }
    
    // Enhanced check for Snap being selected on page load
    function checkInitialSelection() {
        console.log('🔧 Checking initial payment method selection...');
        
        // Use PaymentMethodDetector (no jQuery fallback needed)
        const isSnapSelected = window.PaymentMethodDetector?.isSnapFinanceSelected?.();
        
        console.log('🔧 Snap Finance selected:', isSnapSelected);
        
        if (isSnapSelected) {
            window.PaymentMethodDetector?.logActiveStatus?.();
            console.log('🔧 Snap Finance is pre-selected - initializing...');
            
            // CRITICAL FIX: Trigger the same flow as if the radio button was clicked
            // This ensures the payment box is shown and the button is rendered
            $('.payment_box').hide();
            $('.payment_box.payment_method_snapfinance_refined').show();
            
            // Add a small delay to ensure DOM is fully ready
            setTimeout(go, 100);
        } else {
            window.PaymentMethodDetector?.logIdleStatus?.();
            console.log('🔧 Snap Finance not pre-selected');
        }
    }
    
    // Check if Snap is already selected on page load
    checkInitialSelection();
    
    // Listen for payment method changes
    $(document).on('change', 'input[name="payment_method"]', function() {
        console.log('🔧 Payment method changed to:', this.value);
        if (this.value === 'snapfinance_refined') {
            console.log('🔧 Snap Finance selected via radio button change');
            go();
        }
    });
    
    // Get Snap parameters
    const snapParams = window.snap_params || {};
    console.log('🔧 Snap params available:', !!snapParams);
    console.log('🔧 Snap params keys:', Object.keys(snapParams));
    
    // Debounce function to prevent excessive calls
    function debounce(func, wait) {
        let timeout;
        return function() {
            clearTimeout(timeout);
            timeout = setTimeout(func, wait);
        };
    }
    
    /**
     * Ensure Snap Finance div is properly injected in Classic checkout
     */
    function ensureSnapContainer() {
        console.log('🔧 Ensuring Snap container exists...');
        
        // Check if container already exists
        if ($('#snap-uk-checkout').length) {
            console.log('🔧 Snap container already exists');
            return $('#snap-uk-checkout')[0];
        }
        
        // Find the Snap Finance payment method
        const snapPaymentMethod = $('.payment_method_snapfinance_refined');
        if (!snapPaymentMethod.length) {
            console.log('🔍 Snap Finance payment method not found in Classic checkout');
            return null;
        }
        
        // Look for payment box or create one
        let paymentBox = snapPaymentMethod.find('.payment_box');
        if (!paymentBox.length) {
            // Create payment box if it doesn't exist
            paymentBox = $('<div class="payment_box payment_method_snapfinance_refined"></div>');
            snapPaymentMethod.append(paymentBox);
            console.log('🔧 Created payment box for Snap Finance');
        }
        
        // Add Snap container if not present (no forced sizing; SDK controls layout)
        if (!paymentBox.find('#snap-uk-checkout').length) {
            const snapContainer = $('<div id="snap-uk-checkout"></div>');
            paymentBox.append(snapContainer);
            console.log('✅ Snap Finance container added to Classic checkout');
        }
        
        return $('#snap-uk-checkout')[0];
    }
    
    /**
     * Render Snap Finance button using shared renderer
     */
    const debouncedRender = debounce(function() {
        console.log('🔧 Debounced render called');
        const containerEl = ensureSnapContainer();
        if (!containerEl) {
            console.log('❌ Could not create Snap Finance container');
            return;
        }
        
        // Use shared renderer
        if (window.SnapRender && window.SnapRender.render) {
            console.log('[Snap] checkout.js init via debounced render');
            window.SnapRender.render();
        } else {
            console.error('❌ SnapRender not available in debounced render');
        }
    }, 250);
    
    /**
     * Handle payment method selection in Classic checkout
     */
    function handlePaymentMethodSelection() {
        $(document).on('change', 'input[name="payment_method"]', function() {
            const selectedMethod = $(this).val();
            console.log('🔧 Payment method selection handler - method:', selectedMethod);
            
            if (selectedMethod === 'snapfinance_refined') {
                console.log('💰 Snap Finance selected in Classic checkout');
                
                // Show the payment box
                $('.payment_box').hide();
                $('.payment_box.payment_method_snapfinance_refined').show();
                
                // One-time takeover bump: clear stale awaiting payment and set chosen method to Snap
                try {
                    const ajaxurl = (window.snap_params && window.snap_params.ajax_url) || window.ajaxurl || '/wp-admin/admin-ajax.php';
                    fetch(ajaxurl, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                        body: new URLSearchParams({ action: 'snap_takeover' }).toString()
                    }).catch(()=>{});
                } catch(_) {}

                // Render Snap button
                debouncedRender();
            } else {
                // Hide Snap Finance payment box when other method selected
                $('.payment_box.payment_method_snapfinance_refined').hide();
                // Optional polish: immediately restore normal submission and clear Snap messages
                try { window.SnapApplication?.allowCheckoutSubmission?.(); } catch(_) {}
                try { window.SnapApplication?.clearInlineMessages?.(); } catch(_) {}
            }
        });
    }
    
    /**
     * Handle WooCommerce fragment updates
     */
    function handleFragmentUpdates() {
        // Listen for WooCommerce fragment refresh events
        $(document.body).on('wc_fragment_refresh updated_wc_div', debounce(function() {
            console.log('🔄 WooCommerce fragment updated - checking Snap Finance');
            
            // Check if Snap Finance is still selected
            const selectedMethod = $('input[name="payment_method"]:checked').val();
            console.log('🔧 Fragment update - selected method:', selectedMethod);
            if (selectedMethod === 'snapfinance_refined') {
                debouncedRender();
            }
        }, 250));
        
        // Listen for WooCommerce checkout updates (CRITICAL for shipping toggle, cart updates, etc.)
        $(document.body).on('updated_checkout', function() {
            console.log('🔄 WooCommerce checkout updated - re-checking Snap Finance');

            const selectedMethod = $('input[name="payment_method"]:checked').val();
            console.log('🔧 Checkout update - selected method:', selectedMethod);

            if (selectedMethod === 'snapfinance_refined') {
                // Always re-show Snap payment box; Woo often hides/rebuilds it
                $('.payment_box').hide();
                $('.payment_box.payment_method_snapfinance_refined').show();

                // Ensure container exists (it might have been removed during AJAX update)
                const container = ensureSnapContainer();
                if (container) {
                    console.log('✅ Container ensured after checkout update');
                    // Immediate render (no debounce) to recover quickly after shipping toggle
                    if (window.SnapRender && window.SnapRender.render) {
                        window.SnapRender.render();
                    } else {
                        console.warn('⚠️ SnapRender not available during updated_checkout');
                    }
                } else {
                    console.warn('⚠️ Failed to ensure container after checkout update');
                }
            }
        });
    }
    
    /**
     * Handle form validation events
     */
    function handleFormValidation() {
        // Listen for checkout errors
        $(document.body).on('checkout_error', function() {
            console.log('🔄 Checkout error detected - ensuring Snap Finance container');
            debouncedRender();
        });
        
        // Listen for successful validation
        $(document.body).on('checkout_place_order_success', function() {
            console.log('✅ Checkout validation successful');
        });
        
        // Use shared form monitoring utility
        if (window.FormMonitorUtil) {
            window.FormMonitorUtil.initClassicMonitoring(() => {
                console.log('🔄 Form change detected (Classic) - re-validating Snap Finance');
                
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
                    
                    console.log('🔍 Validation result (Classic):', {
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
                        console.log('✅ Validation passed (Classic) - clearing rendered state for re-render');
                        container.dataset.snapRendered = '';
                        
                        // Force re-render with fresh data
                        setTimeout(() => {
                            if (window.SnapRender && window.SnapRender.render) {
                                window.SnapRender.render();
                            }
                        }, 100);
                    } else {
                        console.log('❌ Validation failed (Classic) - updating validation message');
                        // Update validation message if SnapRender has the function
                        if (window.SnapRender && window.SnapRender.showValidationMessage) {
                            window.SnapRender.showValidationMessage(container, validationMessages, transaction);
                        }
                    }
                }
            });
        } else {
            console.warn('⚠️ FormMonitorUtil not available - falling back to inline monitoring');
            
            // Fallback to original monitoring if utility not available
                    const formFields = [
            'billing_first_name', 'billing_last_name', 'billing_email',
            // 'billing_phone' removed - WooCommerce doesn't require it
            'billing_postcode', 'billing_address_1',
            'billing_city', 'shipping_first_name', 'shipping_last_name',
            'shipping_postcode'
        ];
            
            formFields.forEach(fieldName => {
                $(document).on('change keyup blur', `[name="${fieldName}"]`, debounce(function() {
                    const selectedMethod = $('input[name="payment_method"]:checked').val();
                    if (selectedMethod === 'snapfinance_refined') {
                        const fieldValue = $(this).val();
                        console.log(`🔄 Form field changed: ${fieldName} = "${fieldValue}" - re-validating Snap Finance`);
                        
                        // Clear the rendered state to force re-validation
                        const container = document.getElementById('snap-uk-checkout');
                        if (container) {
                            container.dataset.snapRendered = '';
                            container.innerHTML = '';
                        }
                        
                        // Re-render with updated validation
                        setTimeout(() => {
                            if (window.SnapRender) {
                                window.SnapRender.render();
                            }
                        }, 100);
                    }
                }, 300));
            });
        }
    }
    
    /**
     * Handle returning approved customer flow
     */
    function handleReturningCustomer() {
        // Check if customer has a previously approved application
        const approvedApplicationId = localStorage.getItem('snap_application_id');
        const isApproved = localStorage.getItem('snap_finance_approved');
        
        if (approvedApplicationId && isApproved === 'true') {
            console.log('👤 Returning approved customer detected');
            
            // Still render the button to ensure callbacks are bound
            const selectedMethod = $('input[name="payment_method"]:checked').val();
            if (selectedMethod === 'snapfinance_refined') {
                debouncedRender();
            }
        }
    }
    
    /**
     * Enhanced initialization with better timing
     */
    function init() {
        console.log('🚀 Initializing Snap Finance Classic checkout');
        console.log('🚀 Document ready state:', document.readyState);
        console.log('🚀 jQuery ready state:', $.isReady);
        
        // Set up event handlers
        handlePaymentMethodSelection();
        handleFragmentUpdates();
        handleFormValidation();
        
        // Handle returning customer
        handleReturningCustomer();
        
        // Enhanced initial render logic for pre-selected Snap Finance
        const selectedMethod = $('input[name="payment_method"]:checked').val();
        console.log('🚀 Initialization - selected method:', selectedMethod);
        
        if (selectedMethod === 'snapfinance_refined') {
            console.log('💰 Snap Finance pre-selected - setting up enhanced initialization');
            
            // Multiple attempts with increasing delays to handle timing issues
            setTimeout(() => {
                console.log('🔧 Initial render attempt 1 (100ms delay)');
                go();
            }, 100);
            
            setTimeout(() => {
                console.log('🔧 Initial render attempt 2 (500ms delay)');
                go();
            }, 500);
            
            setTimeout(() => {
                console.log('🔧 Initial render attempt 3 (1000ms delay)');
                go();
            }, 1000);
        }
        
        console.log('✅ Snap Finance Classic checkout initialized');
    }
    
    // Initialize when document is ready
    init();

    // Block place order submission when Snap is selected; guide to use Snap button
    (function blockClassicPlaceOrder(){
        try {
            const form = document.querySelector('form.checkout');
            if (!form) return;
            form.addEventListener('submit', function(ev){
                const selected = document.querySelector('input[name="payment_method"]:checked');
                if (selected && selected.value === 'snapfinance_refined') {
                    console.log('🚫 Blocking Classic place order submit (Snap selected)');
                    ev.preventDefault();
                    ev.stopPropagation();
                    try { window.SnapApplication?.showInlineMessage?.('Use Check eligibility to continue with Snap Finance. We will place the order for you when signing is complete.', 'info'); } catch(_) {}
                    // Ensure button is rendered
                    setTimeout(() => { if (window.SnapRender?.render) window.SnapRender.render(); }, 100);
                    return false;
                }
            }, true);
        } catch(_) {}
    })();
    
    // Classic-only: observe the payment box for DOM swaps and recover the host/container
    (function setupClassicObserver(){
        try {
            const paymentBox = document.querySelector('.payment_box.payment_method_snapfinance_refined') || document.querySelector('.payment_method_snapfinance_refined');
            if (!paymentBox) return;
            const observer = new MutationObserver((mutations) => {
                // If our container is missing while Snap is selected, recreate and re-render
                const isSnapSelected = window.PaymentMethodDetector?.isSnapFinanceSelected?.() || ($('input[name="payment_method"]').filter(':checked').val() === 'snapfinance_refined');
                const container = document.getElementById('snap-uk-checkout');
                if (isSnapSelected && (!container || !container.isConnected)) {
                    console.log('🔁 Classic observer: container missing → recreating and rendering');
                    const el = ensureSnapContainer();
                    if (el && window.SnapRender && window.SnapRender.render) {
                        window.SnapRender.render();
                    }
                }
            });
            observer.observe(paymentBox, { childList: true, subtree: true });
        } catch (_) {}
    })();

    // Additional safety check after a longer delay
    setTimeout(() => {
        const selectedMethod = $('input[name="payment_method"]:checked').val();
        if (selectedMethod === 'snapfinance_refined') {
            console.log('🔧 Safety check - Snap Finance still selected, ensuring button is rendered');
            go();
        }
    }, 2000);
    console.groupEnd();
});
