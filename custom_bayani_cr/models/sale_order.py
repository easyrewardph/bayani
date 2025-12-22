from odoo import models, api, _, fields
from odoo.tools.mail import html_keep_url
from odoo.tools import is_html_empty
import re


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
                order.note = _('Terms & Conditions: %s',
                               baseurl) + '<p><strong>Bank Details:</strong></p><p>Account Name: Bayani Imports Pty Ltd,<span class="oe-tabs" style="width: 34.0625px;">	</span>​</p><p>BSB Number: 032 382</p><p>Account Number: 557 555</p><p>Bank: Westpac</p><p>Send remittance advice to <a href="https://bayani.imports@gmail.com">bayani.imports@gmail.com</a><br></p>'
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
        dry_product = sorted(dry_product, key=lambda l: l.product_id.name)
        for d in dry_product:
            sale_order_line_dry += d
        final = sale_order_line_forzen + sale_order_line_dry
        return final

    def _create_delivery_line(self, carrier, price_unit):
        """Override to prevent automatic delivery fee population."""
        # Do not create delivery line - return empty recordset
        return self.env['sale.order.line']

    def set_delivery_line(self, carrier, amount):
        """Override to prevent automatic delivery fee population when carrier is set."""
        # Remove any existing delivery lines to prevent auto-population
        for order in self:
            order.order_line.filtered(lambda l: l.is_delivery).unlink()
        # Do not create new delivery line - return True without creating anything
        return True

    def _clean_order_lines(self):
        """Clean all order lines from option text and delivery lines."""
        for order in self:
            # Remove delivery lines - DISABLED as per user request to not delete lines
            # order.order_line.filtered(lambda l: l.is_delivery).unlink()
            # Clean option lines from all order lines
            # Clean option lines from all order lines
            for line in order.order_line:
                if line.name and re.search(r'Option(\s+for)?\s*:', line.name, re.IGNORECASE):
                    cleaned_name = line._clean_option_lines(line.name)
                    if cleaned_name != line.name:
                        line.name = cleaned_name

    def write(self, vals):
        """Override write to ensure delivery lines are removed after any update."""
        result = super(SaleOrder, self).write(vals)
        # Clean all order lines (delivery and options) whenever order is saved
        self._clean_order_lines()
        return result

class SaleOrderLine(models.Model):
    _inherit = "sale.order.line"

    expiry_date = fields.Datetime(string="Expiry Date", compute='_compute_expiry_date', store=False, readonly=True)
    custom_test_field = fields.Char(string="Test Field", compute='_compute_custom_test_field')

    def _clean_option_lines(self, name_text):
        """Helper method to remove option lines and original_focus_keyword from name."""
        if not name_text:
            return name_text
        lines = name_text.split('\n')
        filtered_lines = [
            l for l in lines 
            if not re.match(r'^\s*Option(\s+for)?\s*:', l, re.IGNORECASE)
            and 'original_focus_keyword' not in l.lower()
        ]
        result = '\n'.join(filtered_lines)
        # Remove any occurrence of original_focus_keyword and its value from the text
        # Pattern: original_focus_keyword: value or original_focus_keyword = value or just original_focus_keyword
        result = re.sub(r'original_focus_keyword\s*[:=]\s*[^\n]*', '', result, flags=re.IGNORECASE)
        result = re.sub(r'\boriginal_focus_keyword\b\s*', '', result, flags=re.IGNORECASE)
        # Clean up any double newlines that might have been created
        result = re.sub(r'\n\n+', '\n', result)
        return result.strip()

    @api.depends('product_id', 'product_uom', 'product_uom_qty')
    def _compute_name(self):
        """Override to remove 'Option:' and 'Option for:' prefixes from the description."""
        super()._compute_name()git
        for line in self:
            if line.name:
                line.name = self._clean_option_lines(line.name)
    
    def write(self, vals):
        """Override write to clean option lines from name when line is updated."""
        # Clean name before write if it's being set
        if 'name' in vals and vals.get('name'):
            vals['name'] = self._clean_option_lines(vals['name'])
        
        result = super(SaleOrderLine, self).write(vals)
        
        # Always clean option lines after write to ensure they're removed
        for line in self:
            if line.name and re.search(r'Option(\s+for)?\s*:', line.name, re.IGNORECASE):
                line.name = self._clean_option_lines(line.name)
        
        return result
    
    @api.model_create_multi
    def create(self, vals_list):
        """Override create to clean option lines when new lines are created."""
        # Clean names before creation
        for vals in vals_list:
            if 'name' in vals and vals.get('name'):
                vals['name'] = self._clean_option_lines(vals['name'])
        
        lines = super(SaleOrderLine, self).create(vals_list)
        
        # Clean names after creation (in case _compute_name set them with options)
        for line in lines:
            if line.name and re.search(r'Option(\s+for)?\s*:', line.name, re.IGNORECASE):
                line.name = self._clean_option_lines(line.name)
        
        return lines

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

    def _compute_custom_test_field(self):
        for line in self:
            line.custom_test_field = "this is test value"

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
        """Get expiry date from stock move lines."""
        if not self or not self.move_ids:
            return '-'
        
        move = self.move_ids[0]
        if not move:
            return '-'
        
        line = self.env['stock.move.line'].sudo().search([('move_id', '=', move.id)], limit=1)
        if line and line.lot_id and line.lot_id.expiration_date:
            return str(line.lot_id.expiration_date.date())
        
        return '-'
