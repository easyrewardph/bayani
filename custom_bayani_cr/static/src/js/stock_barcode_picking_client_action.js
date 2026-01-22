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
        console.log(`[Bayani] _onBarcodeScanned called with barcode: ${barcode}`);
        
        // Ensure strictly initialized state if not present
        if (this.currentLocationId === undefined) {
            this.currentLocationId = null;
        }

        const result = await this.cache.getRecordByBarcode(barcode);
        console.log(`[Bayani] Cache result:`, result);
        
        if (result && result.record) {
            const { record, type } = result;
            console.log(`[Bayani] Record found: Name=${record.display_name}, ID=${record.id}, Model=${record._name}, Type=${type}`);
            console.log(`[Bayani] Current Locked Location ID: ${this.currentLocationId}`);

            // Scenario 1: Location scan validation
            if (record._name === 'stock.location' || type === 'location') {
                if (!this._isValidLocation(record)) {
                    console.log(`[Bayani] Invalid Location scanned: ${record.display_name}`);
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
                // IMPORTANT: This sets the context for subsequent product scans
                this.currentLocationId = record.id;
                console.log(`[Bayani] Location locked to: ${record.display_name} (${record.id})`);
                return super._onBarcodeScanned(barcode);
            }

            // Scenario 2: Product/Lot barcode validation
            // Check if this is a product or lot scan AND we have a location context locked
            // We use a broad check for product/lot types
            const isProductOrLot = 
                record._name === 'stock.lot' || type === 'lot' || 
                record._name === 'product.product' || type === 'product';

            if (isProductOrLot && this.currentLocationId) {
                console.log(`[Bayani] Scanned product/lot while location locked. Validating...`);
                
                // Strict Product Validation
                const isValid = this._isBarcodeInLocation(record, this.currentLocationId);
                console.log(`[Bayani] Validation result: ${isValid}`);

                if (!isValid) {
                    const msg = `Validation Failed. Product ${record.display_name} not in Loc ${this.currentLocationId}`;
                    console.log(`[Bayani] ${msg}`);
                    this._logScan(barcode, 'FAILURE', msg);
                    
                    this.env.services.dialog.add(ConfirmationDialog, {
                        title: _t("Invalid Barcode"),
                        body: _t("This barcode isn't reserved in this location."),
                        confirm: () => {},
                        confirmLabel: _t("OK"),
                        cancel: false,
                    });
                    return; // BLOCK checks
                }
                console.log(`[Bayani] Validation Passed. Product ${record.display_name} in Loc ${this.currentLocationId}`);
                this._logScan(barcode, 'SUCCESS', msg);

            } else if (isProductOrLot && !this.currentLocationId) {
                console.log(`[Bayani] Product scanned but NO location locked. Checking if in picking...`);
                
                // Global Strictness Check
                if (!this._isBarcodeInPicking(record)) {
                    const msg = `Validation Failed. Product ${record.display_name} not in Picking`;
                    console.log(`[Bayani] ${msg}`);
                    this._logScan(barcode, 'FAILURE', msg);
                    
                    this.env.services.dialog.add(ConfirmationDialog, {
                        title: _t("Invalid Barcode"),
                        body: _t("This barcode isn't part of this operation."),
                        confirm: () => {},
                        confirmLabel: _t("OK"),
                        cancel: false,
                    });
                    return; // BLOCK checks
                }

                console.log(`[Bayani] Product in picking. Allowing default behavior.`);
                this._logScan(barcode, 'SUCCESS', 'Product scanned, exists in picking (no location lock)');
            }
        } else {
            console.log(`[Bayani] No record found in cache for barcode.`);
            this._logScan(barcode, 'FAILURE', 'Barcode not found in cache');
        }
        
        // If all validations pass (or no location locked), proceed with normal scan
        return super._onBarcodeScanned(barcode);
    },

    /**
     * @override
     */
    async validate() {
        console.log("[Bayani] Validate called. Running final consistency check...");
        
        // Final Safety Check: Iterate all lines to ensure consistency
        // This catches any manual edits or bypassed states
        const lines = this.pageLines || this.lines || [];
        let hasError = false;

        for (const line of lines) {
            // We only care if qty_done > 0 (or implies some activity)
            // But strict check: Is this line valid in the theoretical context?
            // "If any mismatch reject the save"
            
            // Re-construct a 'dummy' record for our helper functions
            // _isBarcodeInLocation expects a record object with id and _name
            
            const locId = Array.isArray(line.location_id) ? line.location_id[0] : line.location_id;
            const prodId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
            const lotId = line.lot_id ? (Array.isArray(line.lot_id) ? line.lot_id[0] : line.lot_id) : null;
            
            if (!locId || !prodId) continue; // Skip malformed lines

            // Check consistency: Is Product P allowed at Location L?
            // We can reuse logic similar to _isBarcodeInLocation but strictly for line data
            const isValid = this._validateLineConsistency(line);
            
            if (!isValid) {
                console.log(`[Bayani] Consistency Error: Line ${line.id || 'new'} has Product ${prodId} at Loc ${locId} which is invalid.`);
                hasError = true;
                break; // Stop at first error
            }
        }

        if (hasError) {
             this.env.services.dialog.add(ConfirmationDialog, {
                title: _t("Validation Error"),
                body: _t("Cannot validate: Some lines contain location/product mismatches. Please check your data."),
                confirm: () => {},
                confirmLabel: _t("OK"),
                cancel: false,
            });
            return; // STOP SAVE
        }

        console.log("[Bayani] Final check passed. Proceeding with validate.");
        return super.validate(...arguments);
    },

    _validateLineConsistency(line) {
        // Verify that the combination of Product+Location (and Lot if present) on this line
        // actually exists in the original picking scope (theoretical lines).
        // Since 'lines' contains everything, we need to be careful.
        // Simplified Rule: Does this Product EXIST at this Location in the picking?
        // We can search the SAME lines array for a "match" that is valid?
        // Actually, the user requirement is: "If not reserved in location... reject".
        // So we strictly check if there is AT LEAST ONE line in the picking where
        // Product == P AND Location == L.
        
        const locId = Array.isArray(line.location_id) ? line.location_id[0] : line.location_id;
        const prodId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
        const lotId = line.lot_id ? (Array.isArray(line.lot_id) ? line.lot_id[0] : line.lot_id) : null;

        const allLines = this.pageLines || this.lines || [];
        
        // Is there any line in the picking that authorizes P at L?
        // Note: The line we are checking *is* in allLines.
        // But if we edited it to be wrong, we need to know it's wrong.
        // So we need to check against the *original/reserved* state?
        // In Odoo, lines usually contain the reservation.
        // If I scan a product P at Loc L, and it's valid, it increments that line.
        // If I manually change P to Loc Z (where it doesn't belong), we need to detect that.
        // But if I manually changed it, `line` now says Loc Z.
        // How do we know Loc Z is wrong for P?
        // Answer: Is there ANY line where Product=P and Location=Z?
        // If Yes -> It's a valid combination.
        // If No -> It's an invalid combination created by the user (or bug).
        
        return allLines.some(l => {
             const lLocId = Array.isArray(l.location_id) ? l.location_id[0] : l.location_id;
             const lProdId = Array.isArray(l.product_id) ? l.product_id[0] : l.product_id;
             
             // Check for exact Combo match
             return lLocId === locId && lProdId === prodId;
        });
    },

    async _logScan(barcode, status, message) {
        try {
            await this.env.services.orm.call('stock.picking', 'action_log_scan_event', [barcode, status, message]);
        } catch (e) {
            console.error(`[Bayani] Failed to send log to server:`, e);
        }
    },

    _isValidLocation(location) {
        // Check if the location exists in any line of the current picking
        const lines = this.pageLines || this.lines || [];
        return lines.some(line => {
            const lineLocId = Array.isArray(line.location_id) ? line.location_id[0] : line.location_id;
            return lineLocId === location.id;
        });
    },

    _isBarcodeInPicking(record) {
        // Check if the scanned barcode (product or lot) exists anywhere in the picking
        const lines = this.pageLines || this.lines || [];
        
        return lines.some(line => {
             // Match Product or Lot
            if (record._name === 'stock.lot') {
                const lineLotId = Array.isArray(line.lot_id) ? line.lot_id[0] : line.lot_id;
                return lineLotId === record.id;
            }
            
            if (record._name === 'product.product') {
                const lineProductId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
                return lineProductId === record.id;
            }
            return false;
        });
    },

    _isBarcodeInLocation(record, locationId) {
        // Check if the scanned barcode (product or lot) is reserved in the specified location
        const lines = this.pageLines || this.lines || [];
        
        return lines.some(line => {
            const lineLocId = Array.isArray(line.location_id) ? line.location_id[0] : line.location_id;
            
            // 1. Must match the STRICT context location
            if (lineLocId !== locationId) {
                return false;
            }
            
            // 2. Match Product or Lot
            if (record._name === 'stock.lot') {
                // If scanning a lot, it MUST match the line's lot
                const lineLotId = Array.isArray(line.lot_id) ? line.lot_id[0] : line.lot_id;
                return lineLotId === record.id;
            }
            
            if (record._name === 'product.product') {
                // If scanning a product, it MUST match the line's product
                const lineProductId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
                return lineProductId === record.id;
            }
            
            return false;
        });
    }
});
