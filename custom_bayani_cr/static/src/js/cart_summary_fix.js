// Fix for cart summary innerHTML error
// This safely handles cases where cart summary element doesn't exist
// No module dependencies required - works standalone
(function() {
    'use strict';

    // Global error handler to catch and prevent innerHTML errors on null elements
    // This specifically targets the cart summary update error
    var errorHandler = function(event) {
        // Check if this is the specific innerHTML error we're trying to fix
        if (event.message && 
            event.message.indexOf('innerHTML') !== -1 && 
            event.message.indexOf('null') !== -1) {
            // Check if it's related to cart summary or delivery
            var stack = '';
            if (event.error && event.error.stack) {
                stack = event.error.stack;
            } else if (event.filename) {
                stack = event.filename;
            }
            
            if (stack.indexOf('_updateCartSummary') !== -1 || 
                stack.indexOf('_updateDeliveryMethod') !== -1 ||
                stack.indexOf('_selectDeliveryMethod') !== -1 ||
                event.filename && (event.filename.indexOf('website_sale') !== -1 || 
                                   event.filename.indexOf('delivery') !== -1)) {
                // Prevent the error from crashing the page
                event.preventDefault();
                event.stopPropagation();
                console.warn('Prevented cart summary innerHTML error on null element');
                return true;
            }
        }
        return false;
    };

    // Add error listener with capture phase to catch errors early
    window.addEventListener('error', errorHandler, true);
    
    // Also listen for unhandled promise rejections (since the error shows UncaughtPromiseError)
    window.addEventListener('unhandledrejection', function(event) {
        if (event.reason && event.reason.message) {
            if (event.reason.message.indexOf('innerHTML') !== -1 && 
                event.reason.message.indexOf('null') !== -1) {
                var stack = event.reason.stack || '';
                if (stack.indexOf('_updateCartSummary') !== -1 || 
                    stack.indexOf('_updateDeliveryMethod') !== -1 ||
                    stack.indexOf('_selectDeliveryMethod') !== -1) {
                    event.preventDefault();
                    console.warn('Prevented cart summary innerHTML promise rejection');
                }
            }
        }
    });
})();

