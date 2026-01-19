/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { PickingController } from "@stock_barcode/views/client_action/picking_client_action";
import { _t } from "@web/core/l10n/translation";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

patch(PickingController.prototype, {
    /**
     * @override
     */
    async _onBarcodeScanned(barcode) {
        const result = await this.model.cache.getRecordByBarcode(barcode);
        
        if (result && result.record) {
            const { record, type } = result;

            if (record._name === 'stock.location' || type === 'location') {
                 if (!this._isValidLocation(record)) {
                      this.env.services.dialog.add(ConfirmationDialog, {
                          title: _t("Wrong location"),
                          body: _t("The scanned location is not in the active picking list."),
                          confirm: () => {},
                          cancel: () => {},
                          confirmLabel: _t("Ok"),
                          cancelLabel: "", // Hide cancel
                      });
                      return; // Block execution
                 }
                 this.currentLocationId = record.id;
            } else if (record._name === 'stock.lot' || type === 'lot') {
                 if (this.currentLocationId) {
                      if (!this._isValidLot(record)) {
                           this.env.services.dialog.add(ConfirmationDialog, {
                               title: _t("Wrong barcode"),
                               body: _t("The scanned lot does not belong to the selected location."),
                               confirm: () => {},
                               cancel: () => {},
                               confirmLabel: _t("Ok"),
                               cancelLabel: "", // Hide cancel
                           });
                           return; // Block execution
                      }
                 }
            }
        }
        
        return super._onBarcodeScanned(barcode);
    },

    _isValidLocation(location) {
        // Check if the location is present in the current picking lines
        const lines = this.model.pageLines || this.model.lines || [];
        return lines.some(l => {
            const lineLocId = Array.isArray(l.location_id) ? l.location_id[0] : l.location_id;
            return lineLocId === location.id;
        });
    },

    _isValidLot(lot) {
        // Check if the lot is valid for the current location
        // If no location has been scanned yet (currentLocationId is null), we might want to allow 
        // logic depends on strictness, but prompt implies "once correct location is scanned".
        // If they scan lot without location, the original flow (super) will likely handle it or suggest a default.
        // Here we strictly check: IF we possess a currentLocationId, the lot MUST match it.
        const lines = this.model.pageLines || this.model.lines || [];
        return lines.some(l => {
            const lineLocId = Array.isArray(l.location_id) ? l.location_id[0] : l.location_id;
            const lineLotId = Array.isArray(l.lot_id) ? l.lot_id[0] : l.lot_id;
            // Case 1: Active location scan mode check
            if (this.currentLocationId) {
                return lineLocId === this.currentLocationId && lineLotId === lot.id;
            }
            // Case 2: Just checking if lot exists in picking at all (if we wanted loose check)
            // But requirement says: "check the picking to see if thats lot barcode is on the picking list IN THAT LOCATION"
            // So this function is called inside `if (this.currentLocationId)` logic in _onBarcodeScanned.
            return lineLotId === lot.id; 
        });
    }
});
