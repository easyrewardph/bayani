// Fix for cart summary innerHTML error
// This directly patches the _updateCartSummary method to safely handle null elements
(function() {
    'use strict';

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

    // Also patch via direct property descriptor override for Element prototype
    if (typeof Element !== 'undefined' && Element.prototype) {
        try {
            var innerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
            if (innerHTMLDesc && innerHTMLDesc.set && !innerHTMLDesc.set._isPatched) {
                var originalInnerHTMLSetter = innerHTMLDesc.set;
                Object.defineProperty(Element.prototype, 'innerHTML', {
                    set: function(value) {
                        // Check if element is null/undefined
                        if (this === null || this === undefined) {
                            console.warn('Attempted to set innerHTML on null/undefined element - prevented');
                            return;
                        }
                        try {
                            originalInnerHTMLSetter.call(this, value);
                        } catch (e) {
                            // Check if error is about null
                            if (e && e.message && e.message.indexOf('null') !== -1) {
                                console.warn('Prevented innerHTML error on null element');
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

    // Function to try patching the widget when available
    function tryPatchWidget() {
        // Try to find and patch the widget through various methods
        if (typeof odoo !== 'undefined' && odoo.define) {
            // Use odoo.define but don't require the module - just wait for it
            try {
                odoo.define('custom_bayani_cr.cart_summary_fix', function(require) {
                    try {
                        var publicWidget = require('web.public.widget');
                        if (publicWidget && publicWidget.registry && publicWidget.registry.website_sale_delivery) {
                            var widgetClass = publicWidget.registry.website_sale_delivery;
                            if (widgetClass && widgetClass.prototype) {
                                var originalMethod = widgetClass.prototype._updateCartSummary;
                                if (originalMethod && !originalMethod._isPatched) {
                                    widgetClass.prototype._updateCartSummary = function(summary) {
                                        // Use our safe method
                                        if (!safeUpdateCartSummary(this.$, summary)) {
                                            // If not found, try original but catch errors
                                            try {
                                                if (originalMethod) {
                                                    return originalMethod.call(this, summary);
                                                }
                                            } catch (e) {
                                                // Silently handle - element doesn't exist
                                                console.warn('Cart summary update skipped - element not found');
                                            }
                                        }
                                    };
                                    originalMethod._isPatched = true;
                                }
                            }
                        }
                    } catch (e) {
                        // Module not available, will retry
                    }
                });
            } catch (e) {
                // odoo.define failed
            }
        }
    }

    // Try patching on various events
    $(document).ready(function() {
        tryPatchWidget();
        setTimeout(tryPatchWidget, 100);
        setTimeout(tryPatchWidget, 500);
        setTimeout(tryPatchWidget, 1000);
        setTimeout(tryPatchWidget, 2000);
    });

    // Global error handler as final fallback
    window.addEventListener('error', function(event) {
        if (event.message && 
            event.message.indexOf('innerHTML') !== -1 && 
            event.message.indexOf('null') !== -1) {
            var stack = '';
            if (event.error && event.error.stack) {
                stack = event.error.stack;
            }
            if (stack.indexOf('_updateCartSummary') !== -1) {
                event.preventDefault();
                event.stopPropagation();
                console.warn('Prevented cart summary innerHTML error');
                return true;
            }
        }
    }, true);

    // Handle promise rejections
    window.addEventListener('unhandledrejection', function(event) {
        if (event.reason && event.reason.message) {
            if (event.reason.message.indexOf('innerHTML') !== -1 && 
                event.reason.message.indexOf('null') !== -1) {
                var stack = event.reason.stack || '';
                if (stack.indexOf('_updateCartSummary') !== -1) {
                    event.preventDefault();
                    console.warn('Prevented cart summary innerHTML promise rejection');
                }
            }
        }
    });
})();
