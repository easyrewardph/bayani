from odoo import http
from odoo.addons.website.controllers.main import Website
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
