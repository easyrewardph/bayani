from odoo import models, fields, api
from odoo.http import request


class Website(models.Model):
    _inherit = "website"

    is_search_panel_shown_in_website = fields.Boolean(string='Search Panel Shown in Website')

    @api.model
    def is_public_user(self):
        res = super(Website, self).is_public_user()
        # Safely handle view lookup - only if request is available and view exists
        try:
            if hasattr(request, 'env'):
                model = request.env['ir.ui.view'].sudo().search([('key', '=', 'website_sale.product')], limit=1)
                if model:
                    model_name = model.name
                    model.sudo().write({
                        'name': model_name,
                    })
        except (AttributeError, RuntimeError):
            # request not available in this context, skip
            pass
        return res


