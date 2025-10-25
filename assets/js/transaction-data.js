(function () {
  'use strict';

  // Invoice caching to prevent unnecessary re-renders
  let __snapInvoiceCache = null;
  let __snapInvoiceBasis = null; // e.g., total + product ids

  function makeInvoiceBasis(tx) {
    const productsBasis = (tx.products || []).map(p => `${p.productId}:${p.price}`).join('|');
    return `${tx.shippingCost}|${productsBasis}`;
  }

  const SnapTransaction = {
    /**
     * Build a transaction matching Snap UK schema.
     * Prefers live Blocks data, falls back to snap_params. No external deps.
     */
    build(snapParams) {
      const deliveryDate  = this.tomorrowISO();
      const total         = this.getTotalMajor(snapParams);
      const customer      = this.getCustomer(snapParams);

      // Build transaction object first
      const transaction = {
        deliveryDate,
        shippingCost: parseFloat(snapParams?.shipping_cost || 0),
        products: [{
          productId: 'WC-TOTAL',
          quantity: 1,
          description: 'Order Total',
          price: total
        }],
        customer,
        // Add validation status flag
        _validationStatus: 'pending', // 'pending', 'valid', 'invalid'
        _lastValidated: null, // timestamp of last validation
        _validationMessages: [] // last validation messages
      };

      // Cache invoice number based on transaction basis
      const basis = makeInvoiceBasis(transaction);
      if (!__snapInvoiceCache || __snapInvoiceBasis !== basis) {
        __snapInvoiceCache = this.makeInvoiceNumber(snapParams?.order_hint || 'WC');
        __snapInvoiceBasis = basis;
        console.log('🔄 Invoice cache updated - new basis:', basis);
      }
      transaction.invoiceNumber = __snapInvoiceCache;

      console.log('📋 Transaction object built:', {
        invoiceNumber: transaction.invoiceNumber,
        total: total,
        customerFields: {
          firstName: !!customer.firstName,
          lastName: !!customer.lastName,
          email: !!customer.email,
          postcode: !!customer.postcode
        },
        validationStatus: transaction._validationStatus,
        timestamp: new Date().toISOString()
      });

      return transaction;
    },

    /**
     * Validate required fields for client-side guidance.
     * Returns array of human-readable messages (empty if OK).
     */
    validate(tx, snapParams) {
      const msgs = [];
      const invRe = /^[a-zA-Z0-9\-._/]{1,10}$/;

      if (!invRe.test(tx.invoiceNumber || '')) {
        msgs.push('Invalid invoice number format');
      }
      const c = tx.customer || {};
      if (!c.firstName) msgs.push('Missing First Name');
      if (!c.lastName)  msgs.push('Missing Last Name');
      if (!this.isValidEmail(c.email)) msgs.push('Invalid Email Address');
      // Mobile number optional by default (most merchants don't require it);
      // Add a gentle warning if completely empty to guide users.
      const mobileValue = (c.mobileNumber || '').trim();
      if (!mobileValue) {
        msgs.push('Missing Mobile Number');
      }
      const postcodeValue = (c.postcode || '').trim();
      if (!postcodeValue) {
        msgs.push('Missing Postcode');
      } else {
        // Validate UK postcode format (case-insensitive, tolerates optional space)
        // Source: widely used UK postcode regex variant
        const pc = postcodeValue.toUpperCase();
        const ukPcRe = /^(GIR 0AA|(?:(?:[A-PR-UWYZ][0-9]{1,2})|(?:[A-PR-UWYZ][A-HK-Y][0-9]{1,2})|(?:[A-PR-UWYZ][0-9][A-HJKPSTUW])|(?:[A-PR-UWYZ][A-HK-Y][0-9][ABEHMNPRVWXY]))\s?[0-9][ABD-HJLNP-UW-Z]{2})$/i;
        if (!ukPcRe.test(pc)) {
          msgs.push('Please enter a valid postcode');
        }
      }
      


      // Validate terms and conditions checkbox
      const termsCheckbox = document.querySelector('#terms');
      if (termsCheckbox && !termsCheckbox.checked) {
        msgs.push('Please accept the terms and conditions to continue.');
      }

      // Validate shipping address if "ship to different address" is checked
      const shipToDifferentAddress = document.querySelector('#ship-to-different-address-checkbox');
      if (shipToDifferentAddress && shipToDifferentAddress.checked) {
        const shippingFields = {
          'shipping_first_name': 'Shipping First Name',
          'shipping_last_name': 'Shipping Last Name', 
          'shipping_address_1': 'Shipping Address',
          'shipping_city': 'Shipping City',
          'shipping_postcode': 'Shipping Postcode'
        };

        for (const [fieldId, fieldName] of Object.entries(shippingFields)) {
          const field = document.querySelector(`#${fieldId}`);
          if (field && !field.value.trim()) {
            msgs.push(`Missing ${fieldName}`);
          }
        }

        // Validate shipping postcode format if provided
        const shippingPostcode = document.querySelector('#shipping_postcode');
        if (shippingPostcode && shippingPostcode.value.trim()) {
          const pc = shippingPostcode.value.trim().toUpperCase();
          const ukPcRe = /^(GIR 0AA|(?:(?:[A-PR-UWYZ][0-9]{1,2})|(?:[A-PR-UWYZ][A-HK-Y][0-9]{1,2})|(?:[A-PR-UWYZ][0-9][A-HJKPSTUW])|(?:[A-PR-UWYZ][A-HK-Y][0-9][ABEHMNPRVWXY]))\s?[0-9][ABD-HJLNP-UW-Z]{2})$/i;
          if (!ukPcRe.test(pc)) {
            msgs.push('Please enter a valid shipping postcode');
          }
        }
      }

      const total = (tx.products?.[0]?.price || 0);
      const minAmount = parseFloat(snapParams?.min_amount ?? '0');
      const maxAmount = parseFloat(snapParams?.max_amount ?? '999999');
      if (isFinite(minAmount) && total < minAmount) msgs.push(`The minimum order amount should not be less than £${minAmount}`);
      if (isFinite(maxAmount) && total > maxAmount) msgs.push(`The maximum order amount should not be more than £${maxAmount}`);

      return msgs;
    },

    /**
     * Lightly highlight missing fields in the checkout UI (Classic & Blocks).
     */
    highlightMissingFields(messages) {
      const needFirst = messages.some(m => /First Name/i.test(m));
      const needLast  = messages.some(m => /Last Name/i.test(m));
      const needEmail = messages.some(m => /Email/i.test(m));
      // Mobile number highlighting removed - WooCommerce doesn't require it
      const needPost  = messages.some(m => /Postcode/i.test(m));
      const needTerms = messages.some(m => /terms and conditions/i.test(m));
      const needAddress1 = messages.some(m => /Missing Address|Address\b/i.test(m));
      const needCity = messages.some(m => /Missing City|\bCity\b/i.test(m));
      const needMobile = messages.some(m => /Mobile Number/i.test(m));
      const needShippingFirst = messages.some(m => /Shipping First Name/i.test(m));
      const needShippingLast = messages.some(m => /Shipping Last Name/i.test(m));
      const needShippingAddress = messages.some(m => /Shipping Address/i.test(m));
      const needShippingCity = messages.some(m => /Shipping City/i.test(m));
      const needShippingPost = messages.some(m => /Shipping Postcode/i.test(m));

      const mark = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return;
        el.setAttribute('aria-invalid', 'true');
        el.style.outline = '2px solid #d63638';
        el.style.outlineOffset = '2px';
      };

      if (needFirst) mark('[name="billing_first_name"]');
      if (needLast)  mark('[name="billing_last_name"]');
      if (needEmail) mark('[name="billing_email"]');
      if (needMobile) mark('[name="billing_phone"]');
      if (needPost)  mark('[name="billing_postcode"]');
      if (needAddress1) mark('[name="billing_address_1"]');
      if (needCity) mark('[name="billing_city"]');
      
      // Highlight terms checkbox
      if (needTerms) mark('#terms');
      
      // Highlight shipping fields
      if (needShippingFirst) mark('#shipping_first_name');
      if (needShippingLast) mark('#shipping_last_name');
      if (needShippingAddress) mark('#shipping_address_1');
      if (needShippingCity) mark('#shipping_city');
      if (needShippingPost) mark('#shipping_postcode');
    },

    /**
     * Clear field highlighting when validation passes.
     * @param {Array} specificFields - Optional array of specific field names to clear (e.g., ['firstName', 'postcode'])
     */
    clearFieldHighlighting(specificFields = null) {
      const fieldMappings = {
        'firstName': '[name="billing_first_name"]',
        'lastName': '[name="billing_last_name"]',
        'email': '[name="billing_email"]',
        'postcode': '[name="billing_postcode"]',
        'address1': '[name="billing_address_1"]',
        'city': '[name="billing_city"]',
        'terms': '#terms',
        'shippingFirstName': '#shipping_first_name',
        'shippingLastName': '#shipping_last_name',
        'shippingAddress': '#shipping_address_1',
        'shippingCity': '#shipping_city',
        'shippingPostcode': '#shipping_postcode'
      };

      let fieldsToClear = [];
      
      if (specificFields && Array.isArray(specificFields)) {
        // Clear only specific fields
        specificFields.forEach(fieldName => {
          const selector = fieldMappings[fieldName];
          if (selector) {
            fieldsToClear.push(selector);
          }
        });
        console.log('🎯 Clearing highlighting for specific fields:', specificFields);
      } else {
        // Clear all fields (backward compatibility)
        fieldsToClear = Object.values(fieldMappings);
        console.log('🎯 Clearing highlighting for all fields');
      }

      fieldsToClear.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) {
          el.removeAttribute('aria-invalid');
          el.style.outline = '';
          el.style.outlineOffset = '';
          console.log('✅ Cleared highlighting for:', selector);
        }
      });
    },

    // ---------- Internals ----------
    makeInvoiceNumber(hint) {
      // Generate a numeric invoice number like Snap SDK example (51174155)
      // Use timestamp + random for uniqueness
      const ts = Date.now().toString().slice(-6); // Last 6 digits of timestamp
      const rnd = Math.floor(Math.random() * 99).toString().padStart(2, '0'); // 2 digit random
      const numericInvoice = parseInt(ts + rnd);
      
      console.log('📋 Generated numeric invoice number:', numericInvoice);
      return numericInvoice;
    },

    tomorrowISO() {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    },

    isValidEmail(email) {
      if (!email) return false;
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
    },

    /**
     * Normalize UK phone numbers: convert leading +44/0044/44 to 0 and strip formatting
     * Examples:
     *  +447894586536 → 07894586536
     *  00447894586536 → 07894586536
     *  44 7894 586 536 → 07894586536
     */
    normalizeUkPhone(phone) {
      try {
        if (!phone) return '';
        let digits = String(phone).replace(/[^0-9+]/g, '');
        // Handle +44 and 0044 explicitly, then bare 44
        if (digits.startsWith('+44')) {
          digits = '0' + digits.slice(3);
        } else if (digits.startsWith('0044')) {
          digits = '0' + digits.slice(4);
        } else {
          // Strip non-digits then handle bare 44
          digits = digits.replace(/\D/g, '');
          if (digits.startsWith('44')) {
            digits = '0' + digits.slice(2);
          }
        }
        // If it doesn't start with 0 but looks like a 10-digit local number, prefix 0
        if (!digits.startsWith('0') && digits.length === 10) {
          digits = '0' + digits;
        }
        return digits;
      } catch(_) { return String(phone || ''); }
    },

    

    getTotalMajor(snapParams) {
      try {
        // Try Blocks data first
        const sel = window.wp?.data?.select('wc/store/cart');
        const totals = sel?.getCartTotals?.();
        
        // Get total with VAT (total_price includes VAT)
        let total = totals?.total_price ?? totals?.totalPrice ?? totals?.total;
        
        // If no total from Blocks, try snap_params
        if (!total || total === 0) {
          total = snapParams?.cart_total;
        }
        
        // Convert to number - use as provided by WooCommerce
        let num = typeof total === 'string' ? parseFloat(total) : (+total || 0);
        
        // Ensure we have a proper decimal price for Snap SDK
        // Snap SDK expects prices like 552.00, not 55200
        if (isFinite(num) && num > 0) {
            // If the number is very large (>10000), it might be in pence
            if (num > 10000 && num < 1000000) {
                num = num / 100; // Convert pence to pounds
                console.log('💰 Converting pence to pounds for Snap SDK:', { original: total, converted: num });
            }
            
            // Format price exactly like the original working version
            // The original used number_format() which creates a string like "1104.00"
            // This ensures the price is always formatted as a decimal string
            const decimalPrice = num.toFixed(2);
            
            console.log('💰 Total calculation:', { 
              blocksTotal: totals?.total_price, 
              snapParamsTotal: snapParams?.cart_total, 
              finalTotal: decimalPrice,
              priceType: typeof decimalPrice,
              priceString: decimalPrice
            });
            
            return decimalPrice;
        }
      } catch (e) {
        console.error('❌ Error getting total:', e);
      }
      
      // Fallback
      const num = parseFloat(snapParams?.cart_total || 0);
      return isFinite(num) ? num : 0;
    },

    getCustomer(snapParams) {
      try {
        // PRIORITY 1: Try WooCommerce Blocks Cart Store (most reliable for Blocks checkout)
        if (window.wp?.data?.select) {
          console.log('🔍 wp.data.select available:', !!window.wp.data.select);
          
          try {
            const cartStore = window.wp.data.select('wc/store/cart');
            console.log('🔍 Cart Store object:', cartStore);
            console.log('🔍 Cart Store methods:', cartStore ? Object.keys(cartStore) : 'null');
            
            if (cartStore && cartStore.getCustomerData) {
              const customerData = cartStore.getCustomerData();
              console.log('🔍 Cart Store customer data:', customerData);
              
              if (customerData && (customerData.billingAddress || customerData.billing)) {
                const billingAddress = customerData.billingAddress || customerData.billing;
                console.log('🔍 Cart Store billing address:', billingAddress);
                
                if (billingAddress && (billingAddress.first_name || billingAddress.last_name || billingAddress.email)) {
                  console.log('✅ Using Cart Store billing data');
          return {
                    firstName: billingAddress.first_name || '',
                    lastName:  billingAddress.last_name  || '',
                    email:     billingAddress.email      || '',
            mobileNumber: this.normalizeUkPhone(billingAddress.phone),
                    streetAddress: billingAddress.address_1 || '',
                    unit:          billingAddress.address_2 || '',
                    city:          billingAddress.city      || '',
                    houseName: '',
                    houseNumber: '',
                    postcode:      billingAddress.postcode  || ''
                  };
                } else {
                  console.log('🔍 Cart Store billing address is empty or null');
                }
              } else {
                console.log('🔍 Cart Store customer data does not contain billing information');
              }
            } else {
              console.log('🔍 Cart Store not available or getCustomerData method missing');
            }
          } catch (e) {
            console.error('❌ Error accessing Cart Store:', e);
          }
        } else {
          console.log('🔍 wp.data.select not available');
        }

        // PRIORITY 2: Try Blocks checkout data store (alternative)
        const sel = window.wp?.data?.select('wc/store/checkout');
        const b = sel?.getBillingData?.();
        if (b) {
          console.log('🔍 Blocks checkout store values:', b);
          console.log('✅ Using Blocks checkout store fallback');
          return {
            firstName: b.first_name || '',
            lastName:  b.last_name  || '',
            email:     b.email      || '',
            mobileNumber: this.normalizeUkPhone(b.phone),
            streetAddress: b.address_1 || '',
            unit:         b.address_2 || '',
            city:         b.city      || '',
            houseName: '',
            houseNumber: '',
            postcode:     b.postcode  || ''
          };
        } else {
          console.log('🔍 Blocks checkout store not available or empty');
        }

        // PRIORITY 3: Try DOM queries (works for Classic checkout)
        const getFormValue = (name) => {
          // Updated selectors for both Classic and Blocks WooCommerce checkout
          const selectors = {
            'billing_first_name': '#billing_first_name, #billing-first_name, [name="billing_first_name"]',
            'billing_last_name': '#billing_last_name, #billing-last_name, [name="billing_last_name"]', 
            'billing_email': '#billing_email, #email, [name="billing_email"]',
            'billing_phone': '#billing_phone, [name="billing_phone"]',
            'billing_address_1': '#billing_address_1, #billing-address_1, [name="billing_address_1"]',
            'billing_address_2': '#billing_address_2, #billing-address_2, [name="billing_address_2"]',
            'billing_city': '#billing_city, #billing-city, [name="billing_city"]',
            'billing_postcode': '#billing_postcode, #billing-postcode, [name="billing_postcode"]'
          };
          
          const selector = selectors[name] || `[name="${name}"]`;
          // Try multiple selectors for Classic vs Blocks compatibility
          const selectorList = selector.split(', ');
          let el = null;
          let usedSelector = '';
          
          for (const sel of selectorList) {
            el = document.querySelector(sel.trim());
            if (el) {
              usedSelector = sel.trim();
              break;
            }
          }
          
          const value = el ? el.value.trim() : '';
          console.log(`🔍 Form field [${name}]: "${value}" (element found: ${!!el}, selector: ${usedSelector || selector})`);
          return value;
        };

        // Debug: List all form fields to see what's available
        const allFormFields = document.querySelectorAll('input[id*="billing"], input[id="email"], input[name*="billing"], input[name*="email"], input[name*="phone"]');
        console.log('🔍 All available form fields:', Array.from(allFormFields).map(el => ({ 
          id: el.id, 
          name: el.name, 
          value: el.value, 
          type: el.type,
          selector: el.id ? `#${el.id}` : `[name="${el.name}"]`
        })));

        // Get real-time form values from DOM
        const realTimeData = {
          firstName: getFormValue('billing_first_name'),
          lastName:  getFormValue('billing_last_name'),
          email:     getFormValue('billing_email'),
          mobileNumber: getFormValue('billing_phone'),
          streetAddress: getFormValue('billing_address_1'),
          unit:          getFormValue('billing_address_2'),
          city:          getFormValue('billing_city'),
          postcode:      getFormValue('billing_postcode')
        };

        console.log('🔍 Real-time form values from DOM:', realTimeData);

        // FALLBACK: Check if we found any real data from DOM
        const hasRealData = Object.values(realTimeData).some(value => value && value.trim() !== '');
        
        // Merge strategy: prefer current DOM values when present, otherwise fall back to server snap_params
        const merged = {
          firstName: hasRealData ? (realTimeData.firstName || window.snap_params?.billing_first_name || '') : (window.snap_params?.billing_first_name || ''),
          lastName:  hasRealData ? (realTimeData.lastName  || window.snap_params?.billing_last_name  || '') : (window.snap_params?.billing_last_name  || ''),
          email:     hasRealData ? (realTimeData.email     || window.snap_params?.billing_email      || '') : (window.snap_params?.billing_email      || ''),
          mobileNumber: this.normalizeUkPhone(hasRealData ? (realTimeData.mobileNumber || window.snap_params?.billing_phone || '') : (window.snap_params?.billing_phone || '')),
          streetAddress: hasRealData ? (realTimeData.streetAddress || window.snap_params?.billing_address_1 || '') : (window.snap_params?.billing_address_1 || ''),
          unit:           hasRealData ? (realTimeData.unit          || window.snap_params?.billing_address_2 || '') : (window.snap_params?.billing_address_2 || ''),
          city:           hasRealData ? (realTimeData.city          || window.snap_params?.billing_city       || '') : (window.snap_params?.billing_city       || ''),
          houseName: '',
          houseNumber: '',
          postcode:      hasRealData ? (realTimeData.postcode      || window.snap_params?.billing_postcode   || '') : (window.snap_params?.billing_postcode   || '')
        };
        console.log('✅ Using merged customer data (DOM preferred, server fallback):', merged);
        return merged;
      } catch (e) {
        console.error('❌ Error getting customer data:', e);
      }

      // Final fallback to snap_params (server-side data)
      console.log('🔍 Using snap_params fallback (server-side data)');
      return {
        firstName: snapParams?.billing_first_name || '',
        lastName:  snapParams?.billing_last_name  || '',
        email:     snapParams?.billing_email      || '',
        mobileNumber: this.normalizeUkPhone(snapParams?.billing_phone),
        streetAddress: snapParams?.billing_address_1 || '',
        unit:          snapParams?.billing_address_2 || '',
        city:          snapParams?.billing_city       || '',
        houseName: '',
        houseNumber: '',
        postcode:      snapParams?.billing_postcode  || ''
      };
    },

    /**
     * Reset invoice cache (call after successful application start)
     */
    resetInvoice() {
      __snapInvoiceCache = null;
      __snapInvoiceBasis = null;
      console.log('🔄 Invoice cache reset');
    },

    /**
     * Update transaction validation status
     * @param {Object} transaction - Transaction object to update
     * @param {Array} validationMessages - Validation messages
     * @param {boolean} isValid - Whether validation passed
     */
    updateValidationStatus(transaction, validationMessages, isValid) {
      if (!transaction) return transaction;
      
      const previousStatus = transaction._validationStatus;
      transaction._validationStatus = isValid ? 'valid' : 'invalid';
      transaction._lastValidated = new Date().toISOString();
      transaction._validationMessages = validationMessages;
      
      console.log('🔍 Transaction validation status updated:', {
        previousStatus: previousStatus,
        newStatus: transaction._validationStatus,
        isValid: isValid,
        messageCount: validationMessages.length,
        messages: validationMessages,
        timestamp: transaction._lastValidated
      });
      
      return transaction;
    },

    /**
     * Check if transaction has valid data
     * @param {Object} transaction - Transaction object to check
     * @returns {boolean} True if transaction is valid
     */
    isTransactionValid(transaction) {
      return transaction && transaction._validationStatus === 'valid';
    },

    /**
     * Get validation status summary
     * @param {Object} transaction - Transaction object
     * @returns {Object} Validation status summary
     */
    getValidationSummary(transaction) {
      if (!transaction) return null;
      
      return {
        status: transaction._validationStatus,
        lastValidated: transaction._lastValidated,
        messageCount: transaction._validationMessages.length,
        messages: transaction._validationMessages,
        hasValidData: this.isTransactionValid(transaction)
      };
    }
  };

  window.SnapTransaction = Object.freeze(SnapTransaction);
})();
