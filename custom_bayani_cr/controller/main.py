from odoo import http, _
from odoo.addons.website.controllers.main import Website
from odoo.addons.website_sale.controllers import main as website_sale_controller_custom
from odoo.http import request


class CustomWebsite(Website):

    @http.route('/website/snippet/autocomplete', type='json', auth='public', website=True)
    def autocomplete(self, search_type=None, term=None, order=None, limit=5, max_nb_chars=999, options=None):
        res = super(CustomWebsite, self).autocomplete(search_type=search_type, term=term, order=order, limit=5,
                                                      max_nb_chars=999, options=options)
        user_id = request.env.user.id
        public_user_id = request.env.ref('base.public_user').id
        for record in res.get('results'):
            if user_id == public_user_id:
                record['detail'] = ''
        return res


class WebsiteSale(website_sale_controller_custom.WebsiteSale):
    def _prepare_product_values(self, product, category='', search='', **kwargs):
        product = request.env['product.template'].sudo().browse(int(product.id))
        return super()._prepare_product_values(product, category, search, **kwargs)

    def _get_shop_payment_values(self, order, **kwargs):
        """Super Call this method due to 'Pay Now' button label change 'Confirm Order'."""

        res = super()._get_shop_payment_values(order=order, kwargs=kwargs)
        if res.get('submit_button_label'):
            res.update({'submit_button_label': _('Confirm Order')})
        return res
