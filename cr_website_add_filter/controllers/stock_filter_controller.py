from odoo import http
from odoo.addons.website_sale.controllers.main import WebsiteSale
from odoo.http import request


class CustomWebsiteSale(WebsiteSale):
    @http.route([
        '/shop',
        '/shop/page/<int:page>',
        '/shop/category/<model("product.public.category"):category>',
        '/shop/category/<model("product.public.category"):category>/page/<int:page>',
    ], type='http', auth="public", website=True, )
    def shop(self, page=0, category=None, search='', ppg=False, stock=None, **post):

        if not stock:
            stock = 'in_stock'
        response = super(CustomWebsiteSale, self).shop(page=page, category=category, search=search, stock=stock,
                                                       ppg=ppg, **post)

        products = response.qcontext.get('products')
        for prod in products:
            if stock in ['in_stock', 'out_stock']:
                if prod.qty_available > 0 and stock == 'in_stock':
                    prodduct = prod
                    response.qcontext['products'] = prodduct
                    response.qcontext['stock_filter'] = stock
                else:
                    if prod.qty_available <= 0 and stock == 'out_stock':
                        prodduct = prod
                        response.qcontext['products'] = prodduct
                        response.qcontext['stock_filter'] = stock
        return response

    def _shop_lookup_products(self, attrib_set, options, post, search, website):
        product_count, details, fuzzy_search_term = website._search_with_fuzzy("products_only", search,
                                                                               limit=None,
                                                                               order=self._get_search_order(post),
                                                                               options=options)

        search_result = details[0].get('results', request.env['product.template']).with_context(bin_size=True)
        if post.get('stock') == 'in_stock':
            search_result = request.env['product.template'].sudo().with_context(bin_size=True).search(
                [('id', 'in', search_result.ids), ('qty_available', '>', 0)])
        if post.get('stock') == 'out_stock':
            search_result = request.env['product.template'].sudo().with_context(bin_size=True).search(
                [('id', 'in', search_result.ids), ('qty_available', '=', 0)])

        return fuzzy_search_term, product_count, search_result

    def _shop_get_query_url_kwargs(self, category, search, min_price, max_price, attrib=None, order=None, tags=None,
                                   **post):
        """
        Super Call the method and added Stock Filter Keep while changed the Another Filter or category.

        """
        res = super()._shop_get_query_url_kwargs(category=category, search=search, min_price=min_price,
                                                 max_price=max_price, attrib=attrib, order=order, tags=tags, **post)
        if post.get('stock'):
            res.update({
                'stock': post.get('stock')
            })
        return res
