from odoo import models, api, _
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
