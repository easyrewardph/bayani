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
