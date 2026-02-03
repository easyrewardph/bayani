from odoo.tests import common, tagged
from odoo.exceptions import UserError

@tagged('post_install', '-at_install')
class TestStrictBarcodeMultiLocation(common.TransactionCase):

    def setUp(self):
        super(TestStrictBarcodeMultiLocation, self).setUp()
        self.StockPicking = self.env['stock.picking']
        self.StockMove = self.env['stock.move']
        self.StockMoveLine = self.env['stock.move.line']
        self.Location = self.env['stock.location']
        self.Product = self.env['product.product']

        # 1. Setup Data
        self.loc_stock = self.env.ref('stock.stock_location_stock')
        self.loc_shelf_a = self.Location.create({'name': 'Shelf A', 'usage': 'internal', 'location_id': self.loc_stock.id})
        self.loc_shelf_b = self.Location.create({'name': 'Shelf B', 'usage': 'internal', 'location_id': self.loc_stock.id})
        self.loc_shelf_c = self.Location.create({'name': 'Shelf C', 'usage': 'internal', 'location_id': self.loc_stock.id})
        self.loc_cust = self.env.ref('stock.stock_location_customers')

        self.product_1 = self.Product.create({'name': 'Product 1', 'type': 'product', 'barcode': 'P001'})
        self.product_2 = self.Product.create({'name': 'Product 2', 'type': 'product', 'barcode': 'P002'})

        # Picking Type: Internal for simplicity, or Delivery
        self.picking_type = self.env['stock.picking.type'].search([('code', '=', 'internal')], limit=1)
        
        # Create Picking
        self.picking = self.StockPicking.create({
            'picking_type_id': self.picking_type.id,
            'location_id': self.loc_stock.id, # Parent location
            'location_dest_id': self.loc_cust.id,
        })

        # Create Move Lines (Reserved)
        # Line 1: P1 from Shelf A
        self.move_1 = self.StockMove.create({
            'name': 'Move P1',
            'product_id': self.product_1.id,
            'product_uom_qty': 1,
            'product_uom': self.product_1.uom_id.id,
            'picking_id': self.picking.id,
            'location_id': self.loc_shelf_a.id, # Explicit Source
            'location_dest_id': self.loc_cust.id,
            'state': 'confirmed'
        })
        
        # Line 2: P2 from Shelf B
        self.move_2 = self.StockMove.create({
            'name': 'Move P2',
            'product_id': self.product_2.id,
            'product_uom_qty': 1,
            'product_uom': self.product_2.uom_id.id,
            'picking_id': self.picking.id,
            'location_id': self.loc_shelf_b.id, # Explicit Source
            'location_dest_id': self.loc_cust.id,
            'state': 'confirmed'
        })

        self.picking.action_confirm()
        # Direct Move Line creation to simulate reservation/setup without needing quants
        # (Since we are testing barcode logic validation, not stock availability logic)
        
        # Odoo 16/17+ needs move lines
        self.ml_1 = self.StockMoveLine.create({
            'picking_id': self.picking.id,
            'move_id': self.move_1.id,
            'product_id': self.product_1.id,
            'product_uom_id': self.product_1.uom_id.id,
            'location_id': self.loc_shelf_a.id,
            'location_dest_id': self.loc_cust.id,
            'reserved_uom_qty': 1.0, 
            'qty_done': 0.0
        })
        
        self.ml_2 = self.StockMoveLine.create({
            'picking_id': self.picking.id,
            'move_id': self.move_2.id,
            'product_id': self.product_2.id,
            'product_uom_id': self.product_2.uom_id.id,
            'location_id': self.loc_shelf_b.id,
            'location_dest_id': self.loc_cust.id,
            'reserved_uom_qty': 1.0,
            'qty_done': 0.0
        })
        
    def test_strict_multi_location_success(self):
        """ Test that we can scan products from their respective allowed locations """
        
        # 1. Scan P1 from Shelf A (Valid)
        res = self.StockPicking.action_scan_product_strict(self.picking.id, 'P001', self.loc_shelf_a.id)
        self.assertEqual(res['status'], 'success')
        self.assertEqual(res['message'], 'Scanned: Product 1')
        self.assertEqual(self.ml_1.qty_done, 1.0)

        # 2. Key Check: Scan P2 from Shelf B (Valid) - Different location than P1
        res = self.StockPicking.action_scan_product_strict(self.picking.id, 'P002', self.loc_shelf_b.id)
        self.assertEqual(res['status'], 'success')
        self.assertEqual(self.ml_2.qty_done, 1.0)
        
    def test_strict_fail_wrong_location(self):
        """ Test scanning from a location NOT in the picking """
        
        # Scan P1 from Shelf C (Shelf C is not in any move line)
        with self.assertRaises(UserError) as cm:
             self.StockPicking.action_scan_product_strict(self.picking.id, 'P001', self.loc_shelf_c.id)
        self.assertIn("Invalid Location", str(cm.exception))
        self.assertIn("Source Locations", str(cm.exception))

    def test_strict_fail_product_mismatch(self):
        """ Test scanning a product not in picking """
        with self.assertRaises(UserError) as cm:
             self.StockPicking.action_scan_product_strict(self.picking.id, 'BAD_P', self.loc_shelf_a.id)
        self.assertIn("not found in system", str(cm.exception)) 

    def test_strict_fail_unassigned_product(self):
         """ Test scanning a valid system product but not in this picking """
         p3 = self.Product.create({'name': 'P3', 'barcode': 'P003', 'type': 'product'})
         with self.assertRaises(UserError) as cm:
              self.StockPicking.action_scan_product_strict(self.picking.id, 'P003', self.loc_shelf_a.id)
         self.assertIn("not part of this picking", str(cm.exception))

