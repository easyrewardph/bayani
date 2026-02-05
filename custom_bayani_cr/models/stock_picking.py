from odoo import models, api, fields, _
from odoo.exceptions import UserError
import os
import datetime
import logging

_logger = logging.getLogger(__name__)

class StockPicking(models.Model):
    _inherit = 'stock.picking'

    audit_log_ids = fields.One2many('stock.picking.log', 'picking_id', string='Audit Logs')

    @api.model
    def action_log_scan_event(self, barcode, status, message):
        """
        Log scan events to a daily log file in the 'scanlog' directory.
        """
        try:
            base_dir = os.path.dirname(os.path.dirname(__file__)) 
            log_dir = os.path.join(base_dir, 'scanlog')
            if not os.path.exists(log_dir):
                os.makedirs(log_dir)

            today = datetime.date.today().isoformat()
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

    def button_validate(self):
        return super(StockPicking, self).button_validate()

    @api.model
    def action_scan_product_strict(self, picking_id, barcode, location_dest_id, expected_lot_id=None):
        """
        Strict validation of scanned barcode against picking plan.
        Raises UserError if validation fails.
        """
        picking = self.browse(picking_id)
        if not picking.exists():
            raise UserError(_("Picking not found."))

        # ===== STEP 1: Barcode Lookup =====
        product = self.env['product.product'].search([('barcode', '=', barcode)], limit=1)
        scanned_lot = None
        
        if not product:
            # If not a product barcode, check if it is a lot barcode
            scanned_lot = self.env['stock.lot'].search([('name', '=', barcode)], limit=1)
            if scanned_lot:
                product = scanned_lot.product_id
            
        if not product:
            self.action_log_scan_event(barcode, 'FAILURE', "Barcode not found")
            raise UserError(_("Barcode '%s' not found in system.") % barcode)

        # ===== STEP 2: Strict Context Checks =====
        
        # 1. Location Check (Strict Source)
        # Note: The JS passes `location_dest_id` as the CURRENT SCANNED LOCATION ID.
        # But for 'internal/outgoing' pickings, this MUST be the picking.location_id (Source).
        # We enforce that here.
        # _logger.info("location_dest_id: %s", location_dest_id)
        # _logger.info("picking.move_line_ids: %s", picking.move_line_ids)
        # _logger.info(
        #     "picking.move_line_ids.mapped('location_id.id'): %s",
        #     picking.move_line_ids.mapped('location_id.id'),
        # )
        # _logger.info(
        #     "picking.move_line_ids.mapped('location_id.display_name'): %s",
        #     picking.move_line_ids.mapped('location_id.display_name'),
        # )
        # _logger.info(
        #     "picking.move_line_ids.mapped('location_id.barcode'): %s",
        #     picking.move_line_ids.mapped('location_id.barcode'),
        # )
        # _logger.info(
        #     "picking.move_line_ids.mapped('location_id.name'): %s",
        #     picking.move_line_ids.mapped('location_id.name'),
        # )
        # _logger.info(
        #     "picking.move_line_ids.mapped('location_id.code'): %s",
        #     picking.move_line_ids.mapped('location_id.code'),
        # )
        # _logger.info(
        #     "picking.move_line_ids.mapped('location_id.location_id'): %s",
        #     picking.move_line_ids.mapped('location_id.location_id'),
        # )
        if location_dest_id:
            # We enforce that validation considers all source locations in move lines
            valid_location_ids = picking.move_line_ids.mapped('location_id.id')
            # _logger.info("valid_location_ids: %s", valid_location_ids)
            if int(location_dest_id) not in valid_location_ids:
                 self.action_log_scan_event(barcode, 'FAILURE', "Location Mismatch")
                 raise UserError(_("Invalid Location. Standard Picking requires scanning items from one of the Source Locations: %s") % (", ".join(picking.move_line_ids.mapped('location_id.display_name'))))
            # _logger.info("[Bayani] Location check passed. Proceeding to product validation.")
        else:
            # _logger.info("[Bayani] No location_dest_id provided; skipping location check.")
            pass

        # 2. Product Check (Must be in move lines)
        valid_move_lines = picking.move_line_ids.filtered(lambda l: l.product_id == product)
        # _logger.info("[Bayani] Product scan: %s (id=%s)", product.display_name, product.id)
        # _logger.info("[Bayani] Matching move lines count: %s", len(valid_move_lines))
        if not valid_move_lines:
            self.action_log_scan_event(barcode, 'FAILURE', "Product not in picking")
            raise UserError(_("Product '%s' is not part of this picking.") % product.display_name)

        # 3. Lot Check
        if scanned_lot:
            # If we scanned a lot, it MUST be in the reserved move lines
            # STRICT: Try to find a line with this specific lot
            lot_lines = valid_move_lines.filtered(lambda l: l.lot_id == scanned_lot)
            if not lot_lines:
                 # Check if the picking allows this lot (maybe unreserved but valid?)
                 # The requirement says: "ONLY lots already reserved on move lines are allowed"
                 self.action_log_scan_event(barcode, 'FAILURE', "Lot unauthorized")
                 raise UserError(_("Lot '%s' is not reserved for this picking.") % scanned_lot.name)
            valid_move_lines = lot_lines
            # _logger.info("[Bayani] Lot scan: %s (id=%s)", scanned_lot.name, scanned_lot.id)
        
        elif product.tracking in ('lot', 'serial'):
             # If product is tracked but we scanned a product barcode (not lot)
             # We should probably ask for lot. But if the user code calls this, they might expect it to work?
             # Requirement: "Odoo Stock Barcode (Picking & Packing) ... strict barcode scanning"
             # If tracked, we usually require lot scan. 
             # Let's enforce it if the logic implies we need a lot.
             raise UserError(_("Product '%s' is tracked. Please scan a Lot/Serial Number.") % product.display_name)

        # ===== STEP 3: Quantity Validation & Update =====
        # Find a line that needs this item
        def _reserved_qty(line):
            return (
                getattr(line, 'reserved_uom_qty', None)
                or getattr(line, 'reserved_qty', None)
                or (line.move_id.product_uom_qty if line.move_id else 0.0)
            )

        assignable_line = valid_move_lines.filtered(lambda l: l.qty_done < _reserved_qty(l))
        
        if not assignable_line:
             self.action_log_scan_event(barcode, 'FAILURE', "Qty Exceeded")
             raise UserError(_("All reserved quantity for '%s' has already been scanned.") % product.display_name)
        
        # Apply Mutation
        line = assignable_line[0]
        line.qty_done += 1
        
        msg = f"Scanned: {product.display_name}" + (f" (Lot: {scanned_lot.name})" if scanned_lot else "")
        self.action_log_scan_event(barcode, 'SUCCESS', msg)
        
        reserved_qty = _reserved_qty(line)
        return {
            'status': 'success',
            'message': msg,
            'remaining': reserved_qty - line.qty_done
        }

    @api.model
    def get_picking_snapshot(self, picking_id):
        """
        Return a complete snapshot of the picking for local validation.
        """
        picking = self.sudo().browse(picking_id)
        if not picking.exists():
            return {'status': 'error', 'message': 'Picking not found'}
            
        snapshot = {
            'id': picking.id,
            'name': picking.name,
            'location_id': picking.location_id.id,
            'location_name': picking.location_id.display_name,
            'picking_type_code': picking.picking_type_id.code,
            'lines': [],
            'moveLines': [],
            'locationsByBarcode': {},
            'productsByBarcode': {},
            'lotsByName': {},
        }
        
        products = picking.move_line_ids.mapped('product_id')
        product_templates = products.mapped('product_tmpl_id')

        for line in picking.move_line_ids:
            reserved_qty = (
                getattr(line, 'reserved_uom_qty', None)
                or getattr(line, 'reserved_qty', None)
                or (line.move_id.product_uom_qty if line.move_id else 0.0)
            )
            domain = [
                ('location_id', '=', line.location_id.id),
                ('product_id', '=', line.product_id.id),
            ]
            if line.lot_id:
                domain.append(('lot_id', '=', line.lot_id.id))
            
            quants = self.env['stock.quant'].sudo().search(domain)
            available_qty = sum(quants.mapped('quantity'))
            
            line_data = {
                'id': line.id,
                'product_id': line.product_id.id,
                'product_barcode': line.product_id.barcode,
                'product_name': line.product_id.display_name,
                'product_tracking': line.product_id.tracking,
                'lot_id': line.lot_id.id or False,
                'lot_name': line.lot_id.name or False,
                'qty_reserved': reserved_qty,
                'product_uom_qty': (line.move_id.product_uom_qty if line.move_id else 0.0) or reserved_qty,
                'qty_done': line.qty_done,
                'location_id': line.location_id.id, 
                'location_barcode': line.location_id.barcode,
                'location_name': line.location_id.display_name,
                'location_dest_id': line.location_dest_id.id, 
                'location_dest_name': line.location_dest_id.display_name,
                'available_qty_at_source': available_qty,
                'state': line.state,
            }
            snapshot['lines'].append(line_data)
            snapshot['moveLines'].append({
                'product_id': line.product_id.id,
                'location_id': line.location_id.id,
                'location_barcode': line.location_id.barcode,
                'qty_reserved': reserved_qty,
                'product_uom_qty': (line.move_id.product_uom_qty if line.move_id else 0.0) or reserved_qty,
                'qty_done': line.qty_done,
                'lot_id': line.lot_id.id or False,
                'lot_name': line.lot_id.name or False,
                'product_tracking': line.product_id.tracking,
            })
            if line.location_id.barcode:
                snapshot['locationsByBarcode'][line.location_id.barcode] = line.location_id.id
            if line.location_id.display_name:
                snapshot['locationsByBarcode'][line.location_id.display_name] = line.location_id.id
            if line.location_id.name:
                snapshot['locationsByBarcode'][line.location_id.name] = line.location_id.id
            if line.product_id.barcode:
                snapshot['productsByBarcode'][line.product_id.barcode] = line.product_id.id
            if line.product_id.product_tmpl_id.barcode:
                snapshot['productsByBarcode'][line.product_id.product_tmpl_id.barcode] = line.product_id.id
            if line.lot_id and line.lot_id.name:
                snapshot['lotsByName'][line.lot_id.name] = {
                    'id': line.lot_id.id,
                    'product_id': line.product_id.id,
                }

        packaging_recs = self.env['product.packaging'].sudo().search([
            ('product_id', 'in', products.ids),
            ('barcode', '!=', False),
        ])
        for packaging in packaging_recs:
            snapshot['productsByBarcode'][packaging.barcode] = packaging.product_id.id
            
        return {'status': 'success', 'data': snapshot}

    @api.model
    def process_offline_scans(self, picking_id, scans):
        picking = self.browse(picking_id)
        if not picking.exists():
            return {'status': 'error', 'message': 'Picking not found'}

        results = []
        for scan in scans:
            try:
                res = self.action_scan_product_strict(picking.id, scan['barcode'], scan.get('location_id'))
                results.append({
                    'scan_id': scan.get('scan_id'),
                    'barcode': scan['barcode'], 
                    'status': res.get('status'), 
                    'message': res.get('message')
                })
            except Exception as e:
                # Capture UserError message here
                results.append({
                    'scan_id': scan.get('scan_id'),
                    'barcode': scan['barcode'], 
                    'status': 'error', 
                    'message': str(e)
                })
        
        return {'status': 'success', 'results': results}
