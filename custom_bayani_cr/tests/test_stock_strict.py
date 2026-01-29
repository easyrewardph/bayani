from odoo.tests import common, tagged
from odoo.exceptions import UserError

@tagged('post_install', '-at_install')
class TestStockStrict(common.TransactionCase):

    def setUp(self):
        super(TestStockStrict, self).setUp()
        self.StockPicking = self.env['stock.picking']
        self.Location = self.env['stock.location']
        self.Product = self.env['product.product']
        self.StockMove = self.env['stock.move']

        # Setup Locations
        self.loc_supplier = self.env.ref('stock.stock_location_suppliers')
        self.loc_stock = self.env.ref('stock.stock_location_stock')
        self.loc_shelf1 = self.Location.create({'name': 'Shelf 1', 'usage': 'internal', 'location_id': self.loc_stock.id})
        self.loc_shelf2 = self.Location.create({'name': 'Shelf 2', 'usage': 'internal', 'location_id': self.loc_stock.id})

        # Setup Products
        self.product_a = self.Product.create({'name': 'Product A', 'type': 'product', 'barcode': 'A123'})
        self.product_b = self.Product.create({'name': 'Product B', 'type': 'product', 'barcode': 'B456'})
        self.product_unplanned = self.Product.create({'name': 'Product U', 'type': 'product', 'barcode': 'U789'})

        # Setup Picking (Receipt)
        self.picking_type = self.env['stock.picking.type'].search([('code', '=', 'incoming')], limit=1)
        self.picking = self.StockPicking.create({
            'picking_type_id': self.picking_type.id,
            'location_id': self.loc_supplier.id,
            'location_dest_id': self.loc_shelf1.id,
            'move_type': 'direct',
        })

        # Add Moves (Planned)
        # Move A to Shelf 1 (Qty 2)
        self.move_a = self.StockMove.create({
            'name': 'Move A',
            'product_id': self.product_a.id,
            'product_uom_qty': 2.0,
            'product_uom': self.product_a.uom_id.id,
            'picking_id': self.picking.id,
            'location_id': self.loc_supplier.id,
            'location_dest_id': self.loc_shelf1.id,
        })
        
        # Move B to Shelf 1 (Qty 1)
        self.move_b = self.StockMove.create({
            'name': 'Move B',
            'product_id': self.product_b.id,
            'product_uom_qty': 1.0,
            'product_uom': self.product_a.uom_id.id, # Same UoM
            'picking_id': self.picking.id,
            'location_id': self.loc_supplier.id,
            'location_dest_id': self.loc_shelf1.id,
        })
        
        self.picking.action_confirm()
        self.picking.action_assign() # Reserve

    def test_strict_scan_success(self):
        """ Test scanning a valid product to correct location """
        res = self.StockPicking.action_scan_product_strict(self.picking.id, 'A123', self.loc_shelf1.id)
        self.assertEqual(res['status'], 'success', "Valid scan should succeed")
        
        # Verify done quantity updated
        line = self.env['stock.move.line'].browse(res['line_id'])
        self.assertEqual(line.qty_done, 1.0, "Qty Done should be 1.0")

    def test_strict_scan_wrong_location(self):
        """ Test scanning valid product to WRONG location """
        # Product A exists but for Shelf 1. Try scanning for Shelf 2.
        res = self.StockPicking.action_scan_product_strict(self.picking.id, 'A123', self.loc_shelf2.id)
        self.assertEqual(res['status'], 'error', "Should fail when location doesn't match plan")
        self.assertIn('assigned to wrong location', res['message'])

    def test_strict_scan_unplanned_product(self):
        """ Test scanning a product not in the picking """
        res = self.StockPicking.action_scan_product_strict(self.picking.id, 'U789', self.loc_shelf1.id)
        self.assertEqual(res['status'], 'error', "Should fail for unplanned product")
        self.assertIn('found', res['message']) # "not found" or "invalid item" depending on logic flow

    def test_scaning_excess_quantity(self):
        """ Test scanning more than reserved quantity """
        # Scan 2 times (limit is 2)
        self.StockPicking.action_scan_product_strict(self.picking.id, 'A123', self.loc_shelf1.id)
        self.StockPicking.action_scan_product_strict(self.picking.id, 'A123', self.loc_shelf1.id)
        
        # Scan 3rd time -> Should fail
        res = self.StockPicking.action_scan_product_strict(self.picking.id, 'A123', self.loc_shelf1.id)
        self.assertEqual(res['status'], 'error', "Should not allow over-scanning")
        self.assertIn('already scanned', res['message'])

    def test_validate_strict_consistency(self):
        """ Test button_validate strict checks """
        # 1. Complete picking correctly
        move_line_a = self.move_a.move_line_ids[0]
        move_line_a.qty_done = 2.0
        
        move_line_b = self.move_b.move_line_ids[0]
        move_line_b.qty_done = 1.0
        
        # Validate -> Should succeed
        self.picking.button_validate()
        self.assertEqual(self.picking.state, 'done')

    def test_validate_inconsistent_location(self):
        """ Test blocking validation if line has wrong location """
        move_line_a = self.move_a.move_line_ids[0]
        move_line_a.qty_done = 2.0
        
        # Manually force a wrong location on the line (simulate backend manipulation or bug)
        move_line_a.location_dest_id = self.loc_shelf2.id 
        
        with self.assertRaises(UserError) as cm:
             self.picking._check_strict_compliance(location_dest_id=self.loc_shelf1.id)
             # Note: button_validate calls this. 
             # But testing _check_strict_compliance directly is clearer for unit test if we can't easily trigger button_validate with bad data without it autofixing in standard flows.
             # Actually, let's try calling check directly.
        
        self.assertIn('wrong destination', str(cm.exception))

    def test_validate_extra_unplanned(self):
        """ Test blocking validation if there is an extra line """
        # Add an extra line manually
        move_line = self.env['stock.move.line'].create({
            'picking_id': self.picking.id,
            'product_id': self.product_unplanned.id,
            'product_uom_id': self.product_unplanned.uom_id.id,
            'location_id': self.loc_supplier.id,
            'location_dest_id': self.loc_shelf1.id,
            'qty_done': 1.0,
        })
        
        with self.assertRaises(UserError) as cm:
             self.picking._check_strict_compliance()
             
        self.assertIn('Unplanned item detected', str(cm.exception))
