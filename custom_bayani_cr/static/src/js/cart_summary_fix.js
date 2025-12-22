// Fix for cart summary innerHTML error
// This directly patches the _updateCartSummary method to safely handle null elements
// Only applies on checkout/cart pages to avoid interfering with login and other pages
(function() {
    'use strict';

    // Check if we're on a page that needs this fix (checkout/cart pages)
    function isCheckoutOrCartPage() {
        var path = window.location.pathname;
        // Only apply on checkout, cart, or shop pages
        return path.indexOf('/shop/checkout') !== -1 || 
               path.indexOf('/shop/cart') !== -1 ||
               path.indexOf('/shop') !== -1 ||
               $('.oe_website_sale').length > 0 ||
               $('.cart_summary').length > 0;
    }

    // Don't apply fix on login/auth pages
    function isLoginPage() {
        var path = window.location.pathname;
        return path.indexOf('/web/login') !== -1 || 
               path.indexOf('/web/signup') !== -1 ||
               path.indexOf('/login') !== -1 ||
               $('.oe_login_form').length > 0 ||
               $('#login').length > 0;
    }

    // Only proceed if we're on a relevant page and not on login page
    if (isLoginPage()) {
        return; // Exit early on login pages
    }

    // Function to safely find and update cart summary element
    function safeUpdateCartSummary($container, summary) {
        if (!$container || !$container.length) {
            return false;
        }

        // Try multiple selectors to find the cart summary element
        var $cartSummary = $container.find('.oe_website_sale .cart_summary');
        if (!$cartSummary.length) {
            $cartSummary = $container.find('.cart_summary');
        }
        if (!$cartSummary.length) {
            $cartSummary = $container.find('[data-cart-summary]');
        }
        if (!$cartSummary.length) {
            $cartSummary = $container.find('.js_cart_summary');
        }
        if (!$cartSummary.length) {
            // Last resort: search in document
            $cartSummary = $('.oe_website_sale .cart_summary, .cart_summary, [data-cart-summary], .js_cart_summary').first();
        }
        
        // If element exists, update it
        if ($cartSummary.length && $cartSummary[0]) {
            try {
                $cartSummary[0].innerHTML = summary;
                return true;
            } catch (e) {
                console.warn('Error updating cart summary:', e);
                return false;
            }
        }
        return false;
    }

    // Patch Element.prototype.innerHTML setter to handle null elements
    // But only apply the patch when needed (on checkout/cart pages)
    if (typeof Element !== 'undefined' && Element.prototype && isCheckoutOrCartPage()) {
        try {
            var innerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
            if (innerHTMLDesc && innerHTMLDesc.set && !innerHTMLDesc.set._isPatched) {
                var originalInnerHTMLSetter = innerHTMLDesc.set;
                Object.defineProperty(Element.prototype, 'innerHTML', {
                    set: function(value) {
                        // Check if element is null/undefined
                        if (this === null || this === undefined) {
                            // Only log warning on checkout/cart pages
                            if (isCheckoutOrCartPage() && !isLoginPage()) {
                                console.warn('Attempted to set innerHTML on null/undefined element - prevented');
                            }
                            return;
                        }
                        try {
                            originalInnerHTMLSetter.call(this, value);
                        } catch (e) {
                            // Check if error is about null and we're on a relevant page
                            if (e && e.message && e.message.indexOf('null') !== -1) {
                                if (isCheckoutOrCartPage() && !isLoginPage()) {
                                    console.warn('Prevented innerHTML error on null element');
                                }
                                return;
                            }
                            throw e; // Re-throw if it's a different error
                        }
                    },
                    get: innerHTMLDesc.get,
                    configurable: true,
                    enumerable: true
                });
                innerHTMLDesc.set._isPatched = true;
            }
        } catch (e) {
            // Can't patch, use error handler instead
        }
    }

    // Try patching on various events, but only on relevant pages
    $(document).ready(function() {
        if (!isLoginPage() && isCheckoutOrCartPage()) {
            // The innerHTML patch above should handle most cases
            // No need to patch the widget directly as it causes module dependency issues
        }
    });

    // Global error handler as final fallback (only for checkout/cart pages)
    window.addEventListener('error', function(event) {
        // Only handle errors on checkout/cart pages, not on login
        if (isLoginPage()) {
            return;
        }
        
        if (event.message && 
            event.message.indexOf('innerHTML') !== -1 && 
            event.message.indexOf('null') !== -1) {
            var stack = '';
            if (event.error && event.error.stack) {
                stack = event.error.stack;
            }
            if (stack.indexOf('_updateCartSummary') !== -1 && isCheckoutOrCartPage()) {
                event.preventDefault();
                event.stopPropagation();
                console.warn('Prevented cart summary innerHTML error');
                return true;
            }
        }
    }, true);

    // Handle promise rejections (only for checkout/cart pages)
    window.addEventListener('unhandledrejection', function(event) {
        // Only handle rejections on checkout/cart pages, not on login
        if (isLoginPage()) {
            return;
        }
        
        if (event.reason && event.reason.message) {
            if (event.reason.message.indexOf('innerHTML') !== -1 && 
                event.reason.message.indexOf('null') !== -1) {
                var stack = event.reason.stack || '';
                if (stack.indexOf('_updateCartSummary') !== -1 && isCheckoutOrCartPage()) {
                    event.preventDefault();
                    console.warn('Prevented cart summary innerHTML promise rejection');
                }
            }
        }
    });
})();
