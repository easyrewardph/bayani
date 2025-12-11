from odoo import models, fields, api, _
# from odoo.tools import is_html_empty, html_keep_url
from odoo.tools.mail import html_keep_url
from odoo.tools import (
    is_html_empty
)


class AccountMove(models.Model):
    _inherit = "account.move"

    @api.depends('move_type', 'partner_id', 'company_id')
    def _compute_narration(self):
        use_invoice_terms = self.env['ir.config_parameter'].sudo().get_param('account.use_invoice_terms')
        for move in self:
            if not move.is_sale_document(include_receipts=True):
                continue
            if not use_invoice_terms:
                move.narration = False
            else:
                lang = move.partner_id.lang or self.env.user.lang
                if not move.company_id.terms_type == 'html':
                    narration = move.company_id.with_context(lang=lang).invoice_terms if not is_html_empty(
                        move.company_id.invoice_terms) else ''
                else:
                    baseurl = html_keep_url(self.env.company.get_base_url() + '/terms')
                    context = {'lang': lang}
                    narration = _('Terms & Conditions: %s',
                                  baseurl) + '<p><strong>Bank Details:</strong></p><p>Account Name: Bayani Imports Pty Ltd,<span class="oe-tabs" style="width: 34.0625px;">	</span>​</p><p>BSB Number: 032 382</p><p>Account Number: 557 555</p><p>Bank: Westpac</p><p>Send remittance advice to <a href="https://bayani.imports@gmail.com">bayani.imports@gmail.com</a><br></p>'
                    del context
                move.narration = narration or False

    def check_font_limit(self):
        for line in self.invoice_line_ids:
            if len(line.display_name) > 51:
                return 1

        return 0

    def reorder_lines(self, base_lines):
        account_move_line_forzen = self.env['account.move.line']
        account_move_line_dry = self.env['account.move.line']
        lines = base_lines.filtered(lambda s: s.product_id)
        forzen_product = sorted(
            lines.filtered(lambda l: l.product_id.categ_id.is_forzen),
            key=lambda l: l.product_id.name
        )
        for r in forzen_product:
            account_move_line_forzen += r

        dry_product = lines - account_move_line_forzen
        dry_product = sorted(dry_product,key=lambda l: l.product_id.name)
        for d in dry_product:
            account_move_line_dry += d
        final = account_move_line_forzen + account_move_line_dry
        return final

class AccountMoveLine(models.Model):
    _inherit = "account.move.line"

    unit_price_per_unit = fields.Monetary(
        string="Unit Price ex GST / unit",
        compute="_compute_unit_price_per_unit",
        currency_field="currency_id",
        store=False,
    )

    @api.depends("price_subtotal", "quantity", "product_id.base_unit_count")
    def _compute_unit_price_per_unit(self):
        """
        unit price per piece = final line subtotal (ex GST)
                               / (invoice qty in boxes * units per box)

        This uses the REAL price charged on the invoice, independent
        of the product's base unit price or pricelist config.
        """
        for line in self:
            base_count = line.product_id.base_unit_count if line.product_id else 0.0
            qty = line.quantity or 0.0
            total_units = qty * base_count

            if total_units:
                # price_subtotal is ex GST, so this stays "Unit price ex GST"
                line.unit_price_per_unit = (line.price_subtotal or 0.0) / total_units
            else:
                # fallback: if we can't compute, show box price
                line.unit_price_per_unit = line.price_unit or 0.0

    def get_expiry_date(self):
        if self.sale_line_ids and self.sale_line_ids.move_ids:
            move = self.sale_line_ids.move_ids
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
