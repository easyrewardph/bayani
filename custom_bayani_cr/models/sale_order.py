from odoo import models, api, _, fields
# from odoo.tools import html_keep_url, is_html_empty
from odoo.tools.mail import html_keep_url
from odoo.tools import (
    is_html_empty
)


class SaleOrder(models.Model):
    _inherit = "sale.order"

    @api.depends('partner_id')
    def _compute_note(self):
        use_invoice_terms = self.env['ir.config_parameter'].sudo().get_param('account.use_invoice_terms')
        if not use_invoice_terms:
            return
        for order in self:
            order = order.with_company(order.company_id)
            if order.terms_type == 'html' and self.env.company.invoice_terms_html:
                baseurl = html_keep_url(order._get_note_url() + '/terms')
                context = {'lang': order.partner_id.lang or self.env.user.lang}
                order.note = _('Terms & Conditions: %s',
                               baseurl) + '<p><strong>Bank Details:</strong></p><p>Account Name: Bayani Imports Pty Ltd,<span class="oe-tabs" style="width: 34.0625px;">	</span>​</p><p>BSB Number: 032 382</p><p>Account Number: 557 555</p><p>Bank: Westpac</p><p>Send remittance advice to <a href="https://bayani.imports@gmail.com">bayani.imports@gmail.com</a><br></p>'
                del context
            elif not is_html_empty(self.env.company.invoice_terms):
                order.note = order.with_context(lang=order.partner_id.lang).env.company.invoice_terms

    def check_font_limit(self):
        for line in self.order_line:
            if len(line.display_name) > 51:
                return 1

        return 0

    def reorder_lines(self, base_lines):
        sale_order_line_forzen = self.env['sale.order.line']
        sale_order_line_dry = self.env['sale.order.line']
        lines = base_lines.filtered(lambda s: s.product_id)

        forzen_product = sorted(
            lines.filtered(lambda l: l.product_id.categ_id.is_forzen),
            key=lambda l: l.product_id.name
        )
        for r in forzen_product:
            sale_order_line_forzen += r

        dry_product = lines - sale_order_line_forzen
        dry_product = sorted(dry_product,key=lambda l: l.product_id.name)
        for d in dry_product:
            sale_order_line_dry += d
        final = sale_order_line_forzen + sale_order_line_dry
        return final

class SaleOrderLine(models.Model):
    _inherit = "sale.order.line"

    expiry_date = fields.Datetime(string="Expiry Date", compute='_compute_expiry_date', store=False, readonly=True)

    @api.depends('product_id', 'product_uom', 'product_uom_qty')
    def _compute_name(self):
        """Override to remove 'Option:' prefix from the description."""
        super()._compute_name()
        for line in self:
            if line.name:
                # Remove lines that start with "Option:" from the description
                lines = line.name.split('\n')
                filtered_lines = [l for l in lines if not l.strip().startswith('Option:')]
                line.name = '\n'.join(filtered_lines)

    unit_price_per_unit = fields.Monetary(
        string="Unit Price / unit",
        compute="_compute_unit_price_per_unit",
        currency_field="currency_id",
        store=False,
    )

    @api.depends("price_subtotal", "product_uom_qty", "product_id.base_unit_count")
    def _compute_unit_price_per_unit(self):
        """
        unit price per piece = final line subtotal
                               / (qty in boxes * units per box)

        This uses the REAL price charged, independent of the product's
        base unit price or pricelist config.
        """
        for line in self:
            base_count = line.product_id.base_unit_count if line.product_id else 0.0
            qty = line.product_uom_qty or 0.0
            total_units = qty * base_count

            if total_units:
                line.unit_price_per_unit = (line.price_subtotal or 0.0) / total_units
            else:
                # fallback: if we can't compute, show box price
                line.unit_price_per_unit = line.price_unit or 0.0

    @api.depends('product_id', 'product_uom_qty')
    def _compute_expiry_date(self):
        for line in self:
            expiry_date = False
            if line.product_id:
                quants = self.env['stock.quant'].search([
                    ('product_id', '=', line.product_id.id),
                    ('quantity', '>', 0),
                    ('location_id.usage', '=', 'internal'),
                ])

                valid_lots = [
                    q.lot_id for q in quants
                    if (q.quantity - q.reserved_quantity > 0)
                       and q.lot_id and q.lot_id.expiration_date
                ]
                if valid_lots:
                    valid_lots.sort(key=lambda lot: lot.expiration_date)
                    expiry_date = valid_lots[0].expiration_date

            line.expiry_date = expiry_date

    def get_saleline_expiry_date(self):
        if self and self.move_ids:
            move = self.move_ids
            if move:
                line = self.env['stock.move.line'].sudo().search([('move_id', '=', int(move[0].id))])
                if line.mapped('lot_id') and line.mapped('lot_id').mapped('expiration_date'):
                    return str(max(line.mapped('lot_id').mapped('expiration_date')).date())
                else:
                    return '-'
            else:
                return '-'
        else:
            return '-'
