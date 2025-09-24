/**
 * Snap Finance Diagnostic Utilities
 * 
 * Provides debugging and diagnostic functions for troubleshooting
 * focus, cursor, and DOM interaction issues.
 */

/**
 * Manual diagnostic function that can be called from console
 * Usage: snapDiagnostic()
 */
function createManualDiagnostic() {
    window.snapDiagnostic = function() {
        console.log('🔍 === MANUAL SNAP DIAGNOSTIC ===');
        
        const focused = document.activeElement;
        console.log('🎯 Currently focused:', focused.tagName.toLowerCase() + (focused.id ? '#' + focused.id : '') + (focused.className ? '.' + focused.className.replace(/\s+/g, '.') : ''));
        
        // Show DOM path upward
        console.log('📁 DOM path from focus:');
        let el = focused;
        let depth = 0;
        while (el && el !== document.documentElement && depth < 10) {
            const tag = el.tagName.toLowerCase();
            const id = el.id ? '#' + el.id : '';
            const cls = el.className ? '.' + el.className.split(' ').slice(0, 2).join('.') : '';
            console.log(`  ${depth}: ${tag}${id}${cls}`);
            el = el.parentElement;
            depth++;
        }
        
        console.log('🖱️ Text selection:', document.getSelection().toString() || 'none');
        console.log('🔍 === END MANUAL DIAGNOSTIC ===');
    };
    
    console.log('💡 TIP: Run snapDiagnostic() in console anytime for instant focus check!');
}

/**
 * Comprehensive diagnostic that runs automatically after Snap button creation
 * @param {number} delay - Delay in milliseconds before running diagnostic
 */
function runComprehensiveDiagnostic(delay = 10000) {
    setTimeout(function() {
        console.log('🔍 === DOCUMENT FOCUS & CURSOR DIAGNOSTIC (10s after button creation) ===');
        
        // Get the currently focused element
        const focusedElement = document.activeElement;
        console.log('🎯 Currently focused element:', focusedElement);
        console.log('   Tag:', focusedElement.tagName);
        console.log('   ID:', focusedElement.id || 'none');
        console.log('   Classes:', focusedElement.className || 'none');
        
        // Walk up the DOM tree to show all parent containers
        console.log('📁 DOM Path from focused element to document root:');
        let currentElement = focusedElement;
        let level = 0;
        while (currentElement && currentElement !== document.documentElement) {
            const indent = '  '.repeat(level);
            const tagInfo = `${currentElement.tagName.toLowerCase()}`;
            const idInfo = currentElement.id ? `#${currentElement.id}` : '';
            const classInfo = currentElement.className ? `.${currentElement.className.replace(/\s+/g, '.')}` : '';
            
            console.log(`${indent}${level}: ${tagInfo}${idInfo}${classInfo}`);
            
            // Show relevant CSS properties if it's a container
            if (currentElement.tagName.toLowerCase() === 'div' || currentElement.tagName.toLowerCase() === 'iframe') {
                const style = window.getComputedStyle(currentElement);
                console.log(`${indent}    CSS: user-select:${style.userSelect}, pointer-events:${style.pointerEvents}, position:${style.position}`);
            }
            
            currentElement = currentElement.parentElement;
            level++;
            
            // Prevent infinite loops
            if (level > 20) {
                console.log(`${indent}... (truncated - too deep)`);
                break;
            }
        }
        
        // Check what's under the mouse cursor (if possible)
        console.log('🖱️ Document cursor info:');
        console.log('   Selection:', document.getSelection().toString() || 'none');
        console.log('   Active element can receive input:', 
            focusedElement.tagName === 'INPUT' || 
            focusedElement.tagName === 'TEXTAREA' || 
            focusedElement.contentEditable === 'true'
        );
        
        // Show any elements with problematic CSS
        console.log('⚠️ Elements with user-select: none:');
        const unselectableElements = document.querySelectorAll('*');
        let unselectableCount = 0;
        for (let i = 0; i < Math.min(unselectableElements.length, 50); i++) { // Limit to first 50 to avoid spam
            const el = unselectableElements[i];
            const style = window.getComputedStyle(el);
            if (style.userSelect === 'none' && (el.tagName === 'DIV' || el.tagName === 'IFRAME' || el.classList.contains('unselectable'))) {
                unselectableCount++;
                if (unselectableCount <= 5) { // Only show first 5
                    console.log(`   ${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.replace(/\s+/g, '.') : ''}`);
                }
            }
        }
        if (unselectableCount > 5) {
            console.log(`   ... and ${unselectableCount - 5} more elements`);
        }
        
        console.log('🔍 === END DIAGNOSTIC ===');
    }, delay);
}

/**
 * Quick diagnostic for immediate button click feedback
 * Also applies focus remediation techniques
 */
function logButtonClickDiagnostic() {
    console.log('🚀 === SNAP BUTTON CLICKED - IMMEDIATE DIAGNOSTIC ===');
    console.log('⏰ Timestamp:', new Date().toISOString());
    console.log('🎯 About to launch Snap Finance modal...');
    
    // Apply focus remediation BEFORE modal opens
    applyFocusRemediation();
    
    console.log('📊 Current page inputs:', document.querySelectorAll('input').length);
    console.log('📱 Current iframes:', document.querySelectorAll('iframe').length);
    console.log('🚀 === END IMMEDIATE DIAGNOSTIC ===');
}

/**
 * Apply focus remediation techniques for UK checkout UX
 */
function applyFocusRemediation() {
    console.log('🔧 Applying focus remediation...');
    
    // 1. Blur any problematic focused elements
    if (document.activeElement && document.activeElement !== document.body) {
        console.log('👁️ Blurring current focus:', document.activeElement.tagName);
        document.activeElement.blur();
    }
    
    // 2. Remove unselectable class from body
    document.body.classList.remove('unselectable');
    
    // 3. Remove tabindex=-1 from common wrappers that might trap focus
    document.querySelectorAll('[tabindex="-1"]').forEach(function(el) {
        el.removeAttribute('tabindex');
        console.log('🔓 Removed tabindex=-1 from:', el.tagName);
    });
    
    // 4. Ensure caret visibility
    const style = document.createElement('style');
    style.textContent = `
        body, input, textarea { 
            caret-color: auto !important; 
        }
        .snap-finance-notice { 
            -webkit-user-select: text !important; 
            user-select: text !important; 
        }
    `;
    document.head.appendChild(style);
    
    console.log('✅ Focus remediation applied');
}

/**
 * Return focus to payment section after modal closes
 */
function returnFocusToPaymentSection() {
    console.log('🎯 Returning focus to payment section...');
    
    const targets = [
        '.payment_box.payment_method_snapfinance_refined button',
        '.payment_box.payment_method_snapfinance_refined [role="button"]', 
        '.payment_box.payment_method_snapfinance_refined input',
        '.payment_box.payment_method_snapfinance_refined a',
        '#place_order',
        'body'
    ];
    
    for (const selector of targets) {
        const element = document.querySelector(selector);
        if (element) {
            console.log('🎯 Focusing:', selector);
            element.focus({ preventScroll: false });
            break;
        }
    }
}

/**
 * Set up button click monitoring for diagnostic purposes
 * @param {HTMLElement} buttonContainer - The container where Snap button will be added
 */
function setupButtonClickDiagnostic(buttonContainer) {
    if (!buttonContainer) return;
    
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // Button content was added - likely the Snap button
                setTimeout(function() {
                    const snapButton = buttonContainer.querySelector('button, [role="button"], svg');
                    if (snapButton) {
                        snapButton.addEventListener('click', logButtonClickDiagnostic, { once: false });
                    }
                }, 100);
            }
        });
    });
    observer.observe(buttonContainer, { childList: true, subtree: true });
}

// Export functions for use in main checkout script
if (typeof window !== 'undefined') {
    window.SnapDiagnosticUtils = {
        createManualDiagnostic: createManualDiagnostic,
        runComprehensiveDiagnostic: runComprehensiveDiagnostic,
        logButtonClickDiagnostic: logButtonClickDiagnostic,
        setupButtonClickDiagnostic: setupButtonClickDiagnostic,
        applyFocusRemediation: applyFocusRemediation,
        returnFocusToPaymentSection: returnFocusToPaymentSection
    };
}
