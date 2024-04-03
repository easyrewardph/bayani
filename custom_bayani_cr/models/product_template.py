from odoo import models, fields


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    tracking = fields.Selection(selection_add=[('lot', 'By Lots')], default='lot')
    use_expiration_date = fields.Boolean(default=True)

    def get_nearest_expiry_lot(self):
        active_lots = self.env['stock.lot'].sudo().search([('product_id', '=', self.product_variant_id.id)]).filtered(
            lambda l: l.expiration_date and l.expiration_date.date() > fields.Date.today() and l.product_qty > 0)
        nearest_expiry_lot = active_lots.sorted(key=lambda l: l.expiration_date)[0] if active_lots else False
        if nearest_expiry_lot and nearest_expiry_lot.expiration_date:
            return nearest_expiry_lot.expiration_date.date()
        else:
            return ''