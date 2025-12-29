# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging


from odoo import _, models


_logger = logging.getLogger(__name__)


class StockQuant(models.Model):

    _inherit = 'stock.quant'

    def _gather(self, product_id, location_id, lot_id=None, package_id=None, owner_id=None, strict=False, qty=0):
        """ if records in self, the records are filtered based on the wanted characteristics passed to this function
            if not, a search is done with all the characteristics passed.
        """
        removal_strategy = self._get_removal_strategy(product_id, location_id)
        _logger.info("---------removal_strategy----------%s", removal_strategy)
        domain = self._get_gather_domain(product_id, location_id, lot_id, package_id, owner_id, strict)
        _logger.info("---------domain----------%s", domain)
        if removal_strategy == 'least_packages' and qty:
            domain = self._run_least_packages_removal_strategy_astar(domain, qty)
        order = self._get_removal_strategy_order(removal_strategy)
        _logger.info("---------order----------%s",self.env.context)
        quants_cache = self.env.context.get('quants_cache')
        if quants_cache is not None and strict and removal_strategy != 'least_packages':
            res = self.env['stock.quant']
            if lot_id:
                res |= quants_cache[product_id.id, location_id.id, lot_id.id, package_id.id, owner_id.id]
            res |= quants_cache[product_id.id, location_id.id, False, package_id.id, owner_id.id]
        else:
            
            res = self.search(domain, order=order)
        if removal_strategy == "closest":
            # res = res.sorted(lambda q: (q.location_id.complete_name, -q.id)) 
            # sort by expiration date first and then location name with alphabetical order
            # if expiration date is the same, sort by location name alphabetically nearby
            res = res.sorted(lambda q: (q.lot_id.expiration_date, q.location_id.complete_name))        
        return res.sorted(lambda q: not q.lot_id)
