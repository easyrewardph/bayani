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
        console.log(`[Bayani] _onBarcodeScanned strict mode: ${barcode}`);
        
        const result = await this.cache.getRecordByBarcode(barcode);
        
        if (result && result.record) {
            const { record, type } = result;

            // Scenario 1: Location Scan
            if (record._name === 'stock.location' || type === 'location') {
                if (this.currentLocationId && this.currentLocationId !== record.id) {
                     this.env.services.dialog.add(ConfirmationDialog, {
                        title: _t("Location Locked"),
                        body: _t("You are locked to a specific location for this operation. You cannot switch locations."),
                        confirm: () => {},
                        confirmLabel: _t("OK"),
                        cancel: false,
                    });
                    return;
                }
                
                // Allow locking (or re-scanning same locked location)
                this.currentLocationId = record.id;
                console.log(`[Bayani] Location locked to: ${record.display_name}`);
                
                // Visual feedback (optional hooks normally)
                this.env.services.notification.add(_t(`Locked to ${record.display_name}`), { type: 'success' });
                return; 
            }

            // Scenario 2: Product/Lot Scan
            const isProductOrLot = 
                record._name === 'stock.lot' || type === 'lot' || 
                record._name === 'product.product' || type === 'product';

            if (isProductOrLot) {
                if (!this.currentLocationId) {
                     this.env.services.dialog.add(ConfirmationDialog, {
                        title: _t("Action Required"),
                        body: _t("Please scan a destination location first."),
                        confirm: () => {},
                        confirmLabel: _t("OK"),
                        cancel: false,
                    });
                    return;
                }

                // Strict Server-Side Check
                // We call the custom action_scan_product_strict
                try {
                    const res = await this.orm.call(
                        'stock.picking', 
                        'action_scan_product_strict', 
                        [this.props.record.id, barcode, this.currentLocationId]
                    );

                    if (res.status === 'success') {
                         this.env.services.notification.add(res.message, { type: 'success' });
                         // We need to refresh the view or update local state to reflect the change
                         // The server updated the line. We should trigger a reload or update lines.
                         await this.trigger('reload'); 
                    } else {
                        this.env.services.dialog.add(ConfirmationDialog, {
                            title: _t("Invalid Item"),
                            body: res.message,
                            confirm: () => {},
                            confirmLabel: _t("OK"),
                            cancel: false,
                        });
                        this._logScan(barcode, 'FAILURE', res.message);
                    }
                } catch (e) {
                    console.error("Strict scan error", e);
                     this.env.services.dialog.add(ConfirmationDialog, {
                        title: _t("Error"),
                        body: _t("Server error during validation."),
                        confirm: () => {},
                        confirmLabel: _t("OK"),
                        cancel: false,
                    });
                }
                return; // Handled completely here
            }
        } else {
             this.env.services.dialog.add(ConfirmationDialog, {
                title: _t("Unknown Barcode"),
                body: _t("Barcode not found in database."),
                confirm: () => {},
                confirmLabel: _t("OK"),
                cancel: false,
            });
        }
    },

    /**
     * @override
     */
    async validate() {
        // We rely on the server-side button_validate override for final safety.
        // But we can double check here if we want to save authorized RPC calls.
        return super.validate(...arguments);
    },

    async _logScan(barcode, status, message) {
        try {
            await this.orm.call('stock.picking', 'action_log_scan_event', [barcode, status, message]);
        } catch (e) {
            console.error(`[Bayani] Failed to send log to server:`, e);
        }
    },
});

