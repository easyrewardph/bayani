from odoo import models, fields, api
from odoo.http import request


class Website(models.Model):
    _inherit = "website"

    is_search_panel_shown_in_website = fields.Boolean(string='Search Panel Shown in Website')

    @api.model
    def is_public_user(self):
        res = super(Website, self).is_public_user()
        model = request.env['ir.ui.view'].sudo().search([('key', '=', 'website_sale.product')], limit=1)
        model_name = model.name
        model.sudo().write({
            'name': model_name,
        })
        return res


