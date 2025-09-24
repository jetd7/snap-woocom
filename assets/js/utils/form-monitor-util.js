/**
 * Shared Form Monitoring Utility for Snap Finance
 * Centralizes form field monitoring and re-validation logic
 */

(function() {
    'use strict';

    // Module-level flag to track user interaction
    let hasInteracted = false;

    const FormMonitorUtil = {
        /**
         * Initialize form monitoring for Classic WooCommerce checkout
         * @param {Function} reValidateAndRender - Function to call when form changes
         */
        initClassicMonitoring(reValidateAndRender) {
            console.log('🔍 Initializing Classic checkout form monitoring');
            
            // Create responsive debounced version for better UX
            const debouncedReValidate = this.debounce(reValidateAndRender, 200);
            
            const formFields = [
                'billing_first_name', 'billing_last_name', 'billing_email',
                'billing_postcode', 'billing_address_1', 'billing_city'
            ];

            formFields.forEach((fieldName) => {
                const baseEvents = ['change', 'keyup', 'blur'];
                const events = fieldName === 'billing_postcode' 
                    ? [...baseEvents, 'input'] 
                    : baseEvents;
                if (fieldName === 'billing_postcode') {
                    console.log('📍 Enhanced events for postcode:', events.join(' '));
                }
                events.forEach((evt) => {
                    document.addEventListener(evt, (ev) => {
                        const t = ev.target;
                        if (!t || t.name !== fieldName) return;
                        const selectedRadio = document.querySelector('input[name="payment_method"]:checked');
                        const selectedMethod = selectedRadio ? selectedRadio.value : null;
                        if (selectedMethod === 'snapfinance_refined') {
                            if (!hasInteracted) {
                                hasInteracted = true;
                                console.log('✅ First interaction detected - enabling warnings');
                            }
                            const fieldValue = (t && 'value' in t) ? String(t.value) : '';
                            console.log(`🔄 Form field changed: ${fieldName} = "${fieldValue}" - re-validating Snap Finance`);
                            debouncedReValidate();
                        }
                    }, true); // capture to emulate delegated listening
                });
            });

            // Observe WooCommerce validation class changes on Classic fields
            const classicSelectors = {
                'billing_first_name': '[name="billing_first_name"]',
                'billing_last_name': '[name="billing_last_name"]',
                'billing_email': '[name="billing_email"]',
                'billing_postcode': '[name="billing_postcode"]',
                'billing_address_1': '[name="billing_address_1"]',
                'billing_city': '[name="billing_city"]'
            };
            const classicObserver = new MutationObserver((mutations) => {
                // Only react when Snap is selected
                const selectedRadio = document.querySelector('input[name="payment_method"]:checked');
                if (!selectedRadio || selectedRadio.value !== 'snapfinance_refined') return;
                let changed = false;
                mutations.forEach((m) => {
                    if (m.type === 'attributes' && m.attributeName === 'class') {
                        const el = m.target;
                        const hasInvalid = el.classList.contains('woocommerce-invalid') || el.classList.contains('woocommerce-invalid-required-field');
                        const isValidated = el.classList.contains('woocommerce-validated');
                        if (hasInvalid || isValidated) changed = true;
                    }
                });
                if (changed) {
                    if (!hasInteracted) {
                        hasInteracted = true;
                        console.log('✅ First interaction detected (classic validation) - enabling warnings');
                    }
                    debouncedReValidate();
                }
            });
            Object.values(classicSelectors).forEach((sel) => {
                const el = document.querySelector(sel);
                if (el) {
                    classicObserver.observe(el, { attributes: true, attributeFilter: ['class'] });
                }
            });

            // Listen to WooCommerce Classic lifecycle events
            const classicLifecycleHandler = this.debounce(() => {
                const selectedRadio = document.querySelector('input[name="payment_method"]:checked');
                if (selectedRadio && selectedRadio.value === 'snapfinance_refined') {
                    if (!hasInteracted) hasInteracted = true;
                    debouncedReValidate();
                }
            }, 100);
            document.addEventListener('updated_checkout', classicLifecycleHandler);
            document.addEventListener('checkout_error', classicLifecycleHandler);

            // Check for autofill on load
            setTimeout(() => {
                console.log('🔍 Checking for autofill on load (Classic)');
                const snapParams = window.snap_params;
                if (snapParams && window.SnapTransaction) {
                    const transaction = window.SnapTransaction.build(snapParams);
                    const initialMessages = window.SnapTransaction.validate(transaction, snapParams);
                    if (initialMessages.length === 0) {
                        console.log('✅ Autofill detected - all fields valid, skipping warnings');
                        // Mark as valid but don't show warnings yet
                    } else {
                        console.log('⚠️ Autofill check - some fields missing:', initialMessages);
                        // Don't show warnings yet—wait for interaction
                    }
                }
            }, 100);
        },

        /**
         * Initialize form monitoring for WooCommerce Blocks checkout
         * @param {Function} reValidateAndRender - Function to call when form changes
         */
        initBlocksMonitoring(reValidateAndRender) {
            console.log('🔍 Initializing Blocks checkout form monitoring');
            
            // Create responsive debounced version for better UX
            const debouncedReValidate = this.debounce(reValidateAndRender, 200);
            
            // Hook into WooCommerce's built-in validation system
            this.monitorWooCommerceValidation(debouncedReValidate);
            
            // Also keep the Blocks data store monitoring as backup
            this.monitorBlocksDataStore(debouncedReValidate);
        },

        /**
         * Monitor WooCommerce's built-in validation state using event-driven approach
         * @param {Function} reValidateAndRender - Function to call when validation changes
         */
        monitorWooCommerceValidation(reValidateAndRender) {
            console.log('🔍 Setting up event-driven WooCommerce validation monitoring');
            
            let hasInteracted = false;
            let monitoringActive = true;

            // CRITICAL GATE: Check if Snap Finance is selected
            if (!window.PaymentMethodDetector?.isSnapFinanceSelected?.()) {
                console.log('🔍 Snap Finance not selected - skipping validation monitoring');
                return; // Stay completely idle if Snap Finance is not selected
            }

            // Event-driven validation handler
            const handleValidationChange = (fieldName = null, fieldElement = null) => {
                if (!monitoringActive) return;
                
                // CRITICAL GATE: Check if Snap Finance is selected
                if (!window.PaymentMethodDetector?.isSnapFinanceSelected?.()) {
                    return; // Stay completely idle if Snap Finance is not selected
                }
                
                try {
                    // Mark first interaction
                    if (!hasInteracted) {
                        hasInteracted = true;
                        console.log('✅ First interaction detected (event-driven) - enabling warnings');
                    }
                    
                    console.log('🔄 WooCommerce validation change detected - re-validating Snap Finance');
                    
                    // Trigger our validation
                    reValidateAndRender();
                } catch (e) {
                    console.error('❌ Error in event-driven validation:', e);
                }
            };

            // 1. WooCommerce's built-in validation events
            document.addEventListener('woocommerce_checkout_error', handleValidationChange);
            document.addEventListener('woocommerce_checkout_success', handleValidationChange);
            
            // 2. Field-specific validation events - UPDATED FOR BLOCKS CHECKOUT
            const requiredFields = [
                { name: 'billing_first_name', selector: '#billing-first_name' },
                { name: 'billing_last_name', selector: '#billing-last_name' },
                { name: 'billing_email', selector: '#email' },
                { name: 'billing_postcode', selector: '#billing-postcode' },
                { name: 'billing_address_1', selector: '#billing-address_1' },
                { name: 'billing_city', selector: '#billing-city' }
            ];
            
            requiredFields.forEach(field => {
                const fieldElement = document.querySelector(field.selector);
                if (fieldElement) {
                    console.log(`🔍 Monitoring field: ${field.name} with selector: ${field.selector}`);
                    
                    // Listen to input events
                    fieldElement.addEventListener('input', () => {
                        console.log(`🔄 Input event on ${field.name}: "${fieldElement.value}"`);
                        handleValidationChange(field.name, fieldElement);
                    });
                    
                    fieldElement.addEventListener('blur', () => {
                        console.log(`🔄 Blur event on ${field.name}: "${fieldElement.value}"`);
                        handleValidationChange(field.name, fieldElement);
                    });
                    
                    fieldElement.addEventListener('focus', () => {
                        console.log(`🔄 Focus event on ${field.name}`);
                        handleValidationChange(field.name, fieldElement);
                    });
                } else {
                    console.log(`⚠️ Field not found: ${field.name} with selector: ${field.selector}`);
                }
            });

            // 3. MutationObserver to watch for CSS class changes (most reliable for Blocks)
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        const target = mutation.target;
                        
                        // Check if this is a form field we care about
                        const isFormField = target.id && (
                            target.id.includes('billing-') || 
                            target.id === 'email' ||
                            target.id.includes('postcode')
                        );
                        
                        if (isFormField) {
                            // Check if validation state actually changed
                            const hasError = target.classList.contains('has-error') || 
                                           target.classList.contains('woocommerce-invalid') ||
                                           target.classList.contains('woocommerce-invalid-required-field');
                            const isValid = target.classList.contains('woocommerce-validated') ||
                                          target.classList.contains('is-active');
                            
                            console.log(`🔍 Field validation change: ${target.id} - hasError: ${hasError}, isValid: ${isValid}`);
                            handleValidationChange(target.id, target);
                        }
                    }
                });
            });

            // Observe all required fields for class changes
            requiredFields.forEach(field => {
                const fieldElement = document.querySelector(field.selector);
                if (fieldElement) {
                    observer.observe(fieldElement, { attributes: true, attributeFilter: ['class'] });
                    console.log(`🔍 Observing field for class changes: ${field.name}`);
                }
            });

            // 4. Blocks checkout specific events (if available)
            if (window.wp?.data?.subscribe) {
                wp.data.subscribe(() => {
                    try {
                        const checkoutData = wp.data.select('wc/store/checkout');
                        if (checkoutData) {
                            const validationErrors = checkoutData.getValidationErrors?.();
                            if (validationErrors && Object.keys(validationErrors).length > 0) {
                                console.log('🔍 Blocks validation errors detected:', validationErrors);
                                handleValidationChange();
                            }
                        }
                    } catch (e) {
                        // Blocks data not available yet
                    }
                });
            }

            // 5. Monitor for validation error messages appearing/disappearing
            const errorObserver = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                // Check if validation error was added
                                if (node.classList && (
                                    node.classList.contains('wc-block-components-validation-error') ||
                                    node.classList.contains('validation-error')
                                )) {
                                    console.log('🔍 Validation error message added - re-validating');
                                    handleValidationChange();
                                }
                            }
                        });
                        
                        mutation.removedNodes.forEach((node) => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                // Check if validation error was removed
                                if (node.classList && (
                                    node.classList.contains('wc-block-components-validation-error') ||
                                    node.classList.contains('validation-error')
                                )) {
                                    console.log('🔍 Validation error message removed - re-validating');
                                    handleValidationChange();
                                }
                            }
                        });
                    }
                });
            });

            // Observe the entire form for validation error messages
            const formElement = document.querySelector('.wc-block-components-form');
            if (formElement) {
                errorObserver.observe(formElement, { childList: true, subtree: true });
                console.log('🔍 Observing form for validation error messages');
            }

            // Log monitoring status
            console.log('✅ Event-driven WooCommerce validation monitoring active');
        },

        /**
         * Monitor Blocks data store as backup
         * @param {Function} reValidateAndRender - Function to call when form changes
         */
        monitorBlocksDataStore(reValidateAndRender) {
            let lastSnapshot = null;

            // Subscribe to WooCommerce Blocks data store changes
            if (window.wp?.data?.subscribe) {
                wp.data.subscribe(() => {
                    // CRITICAL GATE: Check if Snap Finance is selected
                    if (!window.PaymentMethodDetector?.isSnapFinanceSelected?.()) {
                        return; // Stay completely idle if Snap Finance is not selected
                    }
                    
                    try {
                        const checkoutData = wp.data.select('wc/store/checkout');
                        if (checkoutData) {
                            const currentSnapshot = {
                                customerData: checkoutData.getCustomerData?.() || {},
                                validationErrors: checkoutData.getValidationErrors?.() || {},
                                isProcessing: checkoutData.isProcessing?.() || false
                            };

                            // Check if data actually changed
                            if (JSON.stringify(currentSnapshot) !== JSON.stringify(lastSnapshot)) {
                                console.log('🔍 Blocks data store changed:', currentSnapshot);
                                lastSnapshot = currentSnapshot;
                                reValidateAndRender();
                            }
                        }
                    } catch (e) {
                        // Blocks data not available yet
                    }
                });
            }
        },

        /**
         * Force interaction state (used when user clicks Snap button)
         */
        forceInteraction() {
            hasInteracted = true;
            console.log('✅ Interaction forced (button click) - enabling warnings');
        },

        /**
         * Check if user has interacted with form
         */
        hasUserInteracted() {
            return hasInteracted;
        },

        /**
         * Debounce function to prevent excessive calls
         */
        debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }
    };

    // Expose to global scope
    window.FormMonitorUtil = FormMonitorUtil;
})();
