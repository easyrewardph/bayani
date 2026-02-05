from odoo import models, fields, api
from odoo.http import request


class Website(models.Model):
    _inherit = "website"

    is_search_panel_shown_in_website = fields.Boolean(string='Search Panel Shown in Website')




