from odoo import models, fields, api

class StockPickingLog(models.Model):
    _name = 'stock.picking.log'
    _description = 'Stock Picking Audit Log'
    _order = 'timestamp desc'

    picking_id = fields.Many2one('stock.picking', string='Picking', required=True, ondelete='cascade')
    user_id = fields.Many2one('res.users', string='User') # Optional, as device might be offline/anonymous initially? No, we should try to link to user.
    timestamp = fields.Datetime(string='Timestamp', default=fields.Datetime.now)
    event_type = fields.Selection([
        ('scan', 'Scan'),
        ('validation_fail', 'Validation Failure'),
        ('override', 'Override'),
        ('error', 'System Error')
    ], string='Event Type', required=True)
    barcode = fields.Char(string='Scanned Barcode')
    reason_code = fields.Selection([
        ('short_stock', 'Short Stock'),
        ('wrong_product', 'Wrong Product'),
        ('damaged', 'Damaged'),
        ('expiry', 'Expiry Mismatch'),
        ('manager_override', 'Manager Override'),
        ('other', 'Other')
    ], string='Reason Code')
    details = fields.Text(string='Details') # JSON or text description
