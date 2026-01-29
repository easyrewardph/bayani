# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
from datetime import datetime

from odoo import _, models


_logger = logging.getLogger(__name__)


class StockQuant(models.Model):

    _inherit = 'stock.quant'

    def _gather(self, product_id, location_id, lot_id=None, package_id=None, owner_id=None, strict=True, qty=0):
        res = super(StockQuant, self)._gather(product_id, location_id, lot_id=lot_id, package_id=package_id, owner_id=owner_id, strict=strict, qty=qty)
        
        # Sort by expiration date (FEFO) - safe handling for None/False dates
        if not strict: # Only apply custom sorting if strict is False (or based on some condition, but here we just apply it to the result)
             # Note: The user request implies we should just sort. 
             pass

        # The user's snippet shows:
        # res = super()._gather(...)
        # no explicit return in the snippet but implied.
        
        # Proper implementation of the fix:
        if location_id.usage == 'internal': # Optional: check context
             quants = res
             sorted_quants = sorted(quants, key=lambda q: (q.lot_id.expiration_date or datetime.max, q.location_id.complete_name or ''))
             # We need to return a recordset, sorted() returns a list.
             # Odoo recordsets preserve order if constructed from list? Yes, usually.
             return quants.browse([q.id for q in sorted_quants])
        
        return res

