/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import BarcodePickingModel from "@stock_barcode/models/barcode_picking_model";
import { _t } from "@web/core/l10n/translation";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

patch(BarcodePickingModel.prototype, {
    /**
     * @override
     */
    async _onBarcodeScanned(barcode) {
        const result = await this.cache.getRecordByBarcode(barcode);
        
        if (result && result.record) {
            const { record, type } = result;

            // Scenario 1: Location scan validation
            if (record._name === 'stock.location' || type === 'location') {
                if (!this._isValidLocation(record)) {
                    this.env.services.dialog.add(ConfirmationDialog, {
                        title: _t("Invalid Location"),
                        body: _t("Location does not exist on this picking slip."),
                        confirm: () => {},
                        confirmLabel: _t("OK"),
                        cancel: false,
                    });
                    return; // Reject the scan completely
                }
                // Valid location - store it and allow scan
                this.currentLocationId = record.id;
                return super._onBarcodeScanned(barcode);
            }

            // Scenario 2: Product/Lot barcode validation
            // Check if this is a product or lot scan
            if (record._name === 'stock.lot' || type === 'lot' || 
                record._name === 'product.product' || type === 'product') {
                
                // If we have a current location, validate the barcode is reserved in that location
                if (this.currentLocationId) {
                    if (!this._isBarcodeInLocation(record, this.currentLocationId)) {
                        this.env.services.dialog.add(ConfirmationDialog, {
                            title: _t("Invalid Barcode"),
                            body: _t("This barcode isn't reserved in this location."),
                            confirm: () => {},
                            confirmLabel: _t("OK"),
                            cancel: false,
                        });
                        return; // Reject the scan completely
                    }
                }
            }
        }
        
        // If all validations pass, proceed with normal scan
        return super._onBarcodeScanned(barcode);
    },

    _isValidLocation(location) {
        // Check if the location exists in any line of the current picking
        const lines = this.pageLines || this.lines || [];
        return lines.some(line => {
            const lineLocId = Array.isArray(line.location_id) ? line.location_id[0] : line.location_id;
            return lineLocId === location.id;
        });
    },

    _isBarcodeInLocation(record, locationId) {
        // Check if the scanned barcode (product or lot) is reserved in the specified location
        const lines = this.pageLines || this.lines || [];
        
        return lines.some(line => {
            const lineLocId = Array.isArray(line.location_id) ? line.location_id[0] : line.location_id;
            
            // Must be in the correct location
            if (lineLocId !== locationId) {
                return false;
            }
            
            // Check if it's a lot barcode
            if (record._name === 'stock.lot') {
                const lineLotId = Array.isArray(line.lot_id) ? line.lot_id[0] : line.lot_id;
                return lineLotId === record.id;
            }
            
            // Check if it's a product barcode
            if (record._name === 'product.product') {
                const lineProductId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
                return lineProductId === record.id;
            }
            
            return false;
        });
    }
});
