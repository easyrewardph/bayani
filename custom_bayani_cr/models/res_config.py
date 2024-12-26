# -*- coding: utf-8 -*-

import logging

from odoo import fields, models, api

_logger = logging.getLogger(__name__)


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    odoo_text_replacement = fields.Char(string='Replace Text "Odoo" With?')
    is_search_panel_shown_in_website = fields.Boolean(string='Search Panel Shown in Website',
                                                      related='website_id.is_search_panel_shown_in_website', store=True, readonly=False)

    @api.model
    def get_debranding_settings(self):
        IrDefault = self.env['ir.default'].sudo()
        odoo_text_replacement = IrDefault._get('res.config.settings', "odoo_text_replacement")
        result = {
            'odoo_text_replacement': odoo_text_replacement,
        }

        return result

    def set_values(self):
        res = super(ResConfigSettings, self).set_values()
        IrDefault = self.env['ir.default'].sudo()
        IrDefault.set('res.config.settings', "odoo_text_replacement", self.odoo_text_replacement)
        return res

    @api.model
    def get_values(self):
        res = super(ResConfigSettings, self).get_values()
        IrDefault = self.env['ir.default'].sudo()
        odoo_text_replacement = IrDefault._get('res.config.settings', "odoo_text_replacement")
        res.update(
            odoo_text_replacement=odoo_text_replacement,
        )
        return res
