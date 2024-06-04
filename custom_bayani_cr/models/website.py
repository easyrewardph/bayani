from odoo import models, fields


class Website(models.Model):
    _inherit = "website"

    is_search_panel_shown_in_website = fields.Boolean(string='Search Panel Shown in Website')
