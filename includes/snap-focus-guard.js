/**
 * Snap Finance Focus Guard
 * 
 * Safe and generic cursor/focus protection for Snap Finance modal
 * Runs without jQuery dependency and handles content protection plugins
 */
(function() {
    'use strict';
    
    // Exit early if Snap container doesn't exist
    if (!document.getElementById('snap-uk-checkout')) {
        return;
    }

    console.log('🛡️ Snap Finance Focus Guard initializing...');

    // Remove common "protection" classes that block selection/cursor
    document.documentElement.classList.remove('unselectable', 'no-select');
    document.body.classList.remove('unselectable', 'no-select');

    // Force cursor & selection just for checkout area
    const css = `
        #snap-uk-checkout, #snap-uk-checkout * {
            cursor: auto !important;
            user-select: text !important;
            -webkit-user-select: text !important;
            -moz-user-select: text !important;
            -ms-user-select: text !important;
            pointer-events: auto !important;
        }
        
        /* Ensure iframe content can receive focus */
        #snap-uk-checkout iframe {
            pointer-events: auto !important;
        }
        
        /* Global caret visibility */
        body, input, textarea {
            caret-color: auto !important;
        }
    `;
    
    const style = document.createElement('style');
    style.setAttribute('data-snap-focus-guard', 'true');
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);

    // When the button renders, keep focus within the modal container
    const target = document.getElementById('snap-uk-checkout');
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // If SDK injects an iframe/button, try to focus on it
                const focusableElement = target.querySelector('iframe, button, [tabindex], [role="button"]');
                if (focusableElement && typeof focusableElement.focus === 'function') {
                    setTimeout(function() {
                        try {
                            focusableElement.focus({ preventScroll: true });
                            console.log('🎯 Focus applied to Snap element');
                        } catch (e) {
                            // Focus may fail on some elements, that's OK
                            console.log('ℹ️ Focus attempt completed');
                        }
                    }, 100);
                }
            }
        });
    });
    
    observer.observe(target, { childList: true, subtree: true });
    
    console.log('✅ Snap Finance Focus Guard active');
    
})();
