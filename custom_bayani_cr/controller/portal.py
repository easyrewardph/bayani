from odoo import http
from odoo.http import request


class CustomFormController(http.Controller):

    @http.route('/request-for-account', type='http', auth='public', website=True, csrf=False)
    def request_for_account_form_load(self, **kwargs):
        # Fetch states and countries
        states = request.env['res.country.state'].sudo().search([])
        countries = request.env['res.country'].sudo().search([])

        return request.render('custom_bayani_cr.req_account_open_view', {
            'states': states,
            'countries': countries
        })

    @http.route(['/submit-form'], type='http', auth='public', website=True, csrf=False)
    def request_for_account_form(self, **post):
        if request.httprequest.method == 'POST':
            # Extract form data
            company = post.get('company')
            name = post.get('name')
            phone = post.get('phone')
            email_from = post.get('email_from')
            abn_from = post.get('abn_from')
            street = post.get('street')
            street2 = post.get('street2')
            city = post.get('city')
            state_id = int(post.get('state')) if post.get('state') != '' else False
            zip_code = post.get('zip')
            country_id = int(post.get('country')) if post.get('country') != '' else False
            contact_tag_id = request.env.ref('custom_bayani_cr.res_partner_category_account_open')

            # Create res.partner record for company
            existing_company_id = request.env['res.partner'].sudo().search(
                [('is_company', '=', True), ('name', '=', company)],
                limit=1)
            if existing_company_id:
                company_id = existing_company_id
            else:
                company_id = request.env['res.partner'].sudo().create({
                    'name': company,
                    'phone': phone,
                    'email': email_from,
                    'street': street,
                    'street2': street2,
                    'city': city,
                    'state_id': state_id,
                    'zip': zip_code,
                    'country_id': country_id,
                    'vat': abn_from,
                    'is_company': True,
                    'category_id': [contact_tag_id.id],
                })

            # Create res.partner record for Individual
            individual_partner_id = request.env['res.partner'].sudo().create({
                'name': name,
                'phone': phone,
                'email': email_from,
                'street': street,
                'street2': street2,
                'city': city,
                'state_id': state_id,
                'zip': zip_code,
                'country_id': country_id,
                'vat': abn_from,
                'is_company': False,
                'parent_id': company_id.id,
                'category_id': [contact_tag_id.id],
            })

            return request.redirect('/account-open-thank-you')
