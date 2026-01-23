from odoo import models, api
import os
import datetime
import logging

_logger = logging.getLogger(__name__)

class StockPicking(models.Model):
    _inherit = 'stock.picking'

    @api.model
    def action_log_scan_event(self, barcode, status, message):
        """
        Log scan events to a daily log file in the 'scanlog' directory.
        :param barcode: The scanned barcode string
        :param status: 'SUCCESS' or 'FAILURE'
        :param message: Description of the event
        """
        try:
            # Define log directory
            base_dir = os.path.dirname(os.path.dirname(__file__)) # custom_bayani_cr/
            # User asked for "scanlog" folder. Let's put it in the module root or project root?
            # Request: "create a folder named scanlog"
            # I will put it in the module root for now, or the odoo root?
            # "if folder not exist then create"
            # Safest is the module directory or a specific data directory. 
            # Given the context "folder named scanlog", I'll try to put it in the directory above the module if possible, 
            # or just inside the module to be safe with permissions. 
            # Actually, standard Odoo structure suggests avoiding writing inside module code. 
            # However, for this quick request, I'll place it in the module root: `custom_bayani_cr/scanlog/`.
            
            log_dir = os.path.join(base_dir, 'scanlog')
            if not os.path.exists(log_dir):
                os.makedirs(log_dir)

            today = datetime.date.today().isoformat() # YYYY-MM-DD
            log_file_path = os.path.join(log_dir, f"{today}.log")
            
            timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            log_entry = f"[{timestamp}] Barcode: {barcode} | Status: {status} | Message: {message}\n"

            with open(log_file_path, 'a') as f:
                f.write(log_entry)
                
            _logger.info(f"[ScanLog] {log_entry.strip()}")
            return True
        except Exception as e:
            _logger.error(f"Failed to log scan event: {str(e)}")
            return False

    def _check_strict_compliance(self, location_dest_id=None):
        """
        DISABLED TEMPORARILY (2026-01-23)
        Reason: Blocking urgent deliveries; incorrect field usage (move_line.product_uom_qty doesn't exist)
        The correct field is on stock.move.product_uom_qty, not stock.move.line
        Re-enable only after:
        - Proper UX feedback mechanism
        - Correct field mapping (use move_id.product_uom_qty or reserved_uom_qty)
        - Better error messages with line IDs
        """
        # Original implementation commented out - see above for reasons
        return

    def button_validate(self):
        """
        STRICT COMPLIANCE CHECK TEMPORARILY DISABLED (2026-01-23)
        Reason: Blocking urgent deliveries; incorrect field usage (move_line.product_uom_qty)
        Re-enable only after proper UX + correct field mapping (use move.product_uom_qty)
        """
        # Emergency fix: Bypass strict validation to unblock production transfers
        # Original strict check in _check_strict_compliance() has been disabled
        return super(StockPicking, self).button_validate()

    @api.model
    def action_scan_product_strict(self, picking_id, barcode, location_dest_id):
        """
        Validate scan against plan and locked location.
        """
        picking = self.browse(picking_id)
        if not picking.exists():
            return {'status': 'error', 'message': 'Picking not found'}

        # Find matching product/lot from barcode
        # Simplified lookup logic matching Odoo's standard process or passed strictly
        product = self.env['product.product'].search([('barcode', '=', barcode)], limit=1)
        # Note: could be a Lot scan too, but prompt emphasizes "Strict Product...". 
        # I will assume Product barcode for now. If Lot, logic similar.
        
        if not product:
            return {'status': 'error', 'message': f'Product barcode {barcode} not found.'}

        # Validate against move lines
        # Check 1: Must exist in move_line_ids
        # Check 2: Must be for correct location
        
        valid_line = picking.move_line_ids.filtered(lambda l: 
            l.product_id == product and 
            l.location_dest_id.id == location_dest_id
        )

        if not valid_line:
             return {'status': 'error', 'message': f"Invalid item: {product.display_name} not part of this transfer or assigned to wrong location."}

        # Check 3: Quantity space?
        # We need to find a line that has space (qty_done < reserved)
        assignable_line = valid_line.filtered(lambda l: l.qty_done < l.reserved_uom_qty)
        
        if not assignable_line:
             return {'status': 'error', 'message': f"All reserved quantity for {product.display_name} already scanned."}

        # Update the first available line
        line_to_update = assignable_line[0]
        line_to_update.qty_done += 1
        
        return {
            'status': 'success', 
            'message': f"Scanned {product.display_name}", 
            'line_id': line_to_update.id,
            'new_qty_done': line_to_update.qty_done
        }

