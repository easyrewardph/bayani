from odoo import models, fields


class ProductCategory(models.Model):
    _inherit = "product.category"

    is_forzen = fields.Boolean('Frozen Product')
