odoo.define('custom_bayani_cr.cart_summary_fix', function (require) {
    'use strict';

    var publicWidget = require('web.public.widget');

    // Function to safely find and update cart summary element
    function safeUpdateCartSummary($container, summary) {
        if (!$container || !$container.length) {
            console.warn('Container not found for cart summary update');
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
            // Try to find by common parent container
            $cartSummary = $container.find('.oe_website_sale').find('.cart_summary, [class*="summary"]');
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
        } else {
            // Log warning but don't throw error - this prevents the crash
            console.warn('Cart summary element not found. Unable to update cart summary.');
            return false;
        }
    }

    // Patch the website sale delivery widget to handle null cart summary elements
    // Use a deferred approach to ensure the widget is registered
    var patchWidget = function() {
        if (publicWidget.registry.website_sale_delivery) {
            publicWidget.registry.website_sale_delivery.include({
                /**
                 * Override _updateCartSummary to check if element exists before setting innerHTML
                 * This prevents the "Cannot set properties of null (setting 'innerHTML')" error
                 */
                _updateCartSummary: function (summary) {
                    return safeUpdateCartSummary(this.$, summary);
                },
            });
            return true;
        }
        return false;
    };

    // Try to patch immediately
    if (!patchWidget()) {
        // If widget not registered yet, wait for it
        $(document).ready(function() {
            // Try multiple times with small delays
            var attempts = 0;
            var maxAttempts = 10;
            var interval = setInterval(function() {
                attempts++;
                if (patchWidget() || attempts >= maxAttempts) {
                    clearInterval(interval);
                }
            }, 100);
        });
    }
});

