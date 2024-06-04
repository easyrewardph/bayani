from odoo import models, api, _
from odoo.tools import is_html_empty, html_keep_url


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
