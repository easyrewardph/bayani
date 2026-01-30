/** @odoo-module **/
console.log("[Bayani] JS Module Loaded! If you see this, the file is being read.");

import { patch } from "@web/core/utils/patch";
import BarcodePickingModel from "@stock_barcode/models/barcode_picking_model";
import { _t } from "@web/core/l10n/translation";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

patch(BarcodePickingModel.prototype, {
    // setup() removed as BarcodePickingModel is not a Component


    /**
     * @override
     */
     async load() {
        console.log("[Bayani] load() called");
        this.bayaniSnapshot = null;
        this.bayaniSession = null;
        this.encryptionKey = null;
        this._setupSyncService();

        await this._initEncryption();
        await super.load(...arguments);
        console.log("[Bayani] super.load() finished");
        await this._bayaniInitialize();
    },

    async _initEncryption() {
        // Simple key generation/retrieval for demo purposes.
        // In prod, consider more secure key management.
        const storedKey = window.localStorage.getItem('bayani_key');
        if (storedKey) {
            this.encryptionKey = await this._importKey(storedKey);
        } else {
            this.encryptionKey = await this._generateKey();
            const exported = await this._exportKey(this.encryptionKey);
            window.localStorage.setItem('bayani_key', exported);
        }
    },

    async _generateKey() {
        return await window.crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );
    },

    async _importKey(jwkJson) {
        return await window.crypto.subtle.importKey(
            "jwk",
            JSON.parse(jwkJson),
            { name: "AES-GCM" },
            true,
            ["encrypt", "decrypt"]
        );
    },

    async _exportKey(key) {
        const exported = await window.crypto.subtle.exportKey("jwk", key);
        return JSON.stringify(exported);
    },

    async _encryptData(data) {
        if (!this.encryptionKey) return null;
        const encoded = new TextEncoder().encode(JSON.stringify(data));
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            this.encryptionKey,
            encoded
        );
        
        // Combine IV and Data for storage
        const ivArr = Array.from(iv);
        const encryptedArr = Array.from(new Uint8Array(encrypted));
        return JSON.stringify({ iv: ivArr, data: encryptedArr });
    },

    async _decryptData(jsonStr) {
        if (!this.encryptionKey || !jsonStr) return null;
        try {
            const { iv, data } = JSON.parse(jsonStr);
            const ivUint = new Uint8Array(iv);
            const dataUint = new Uint8Array(data);
            
            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: ivUint },
                this.encryptionKey,
                dataUint
            );
            return JSON.parse(new TextDecoder().decode(decrypted));
        } catch (e) {
            console.error("Decryption failed", e);
            return null;
        }
    },

    async _bayaniInitialize() {
        if (!this.record) return;
        const pickingId = this.record.id;
        
        // 1. Fetch Picking Snapshot
        try {
            const result = await this.orm.call('stock.picking', 'get_picking_snapshot', [pickingId]);
            if (result.status === 'success') {
                this.bayaniSnapshot = result.data;
                console.log("[Bayani] Snapshot Loaded:", this.bayaniSnapshot);
                this.env.services.notification.add(_t("Bayani Mode Active"), { type: 'success' });
                
                // 2. Pre-Pick Validation (Blocking)
                const blockage = this._bayaniCheckStockAvailability();
                if (blockage) {
                    this._bayaniShowBlockDialog("PICK BLOCKED: INSUFFICIENT STOCK", blockage);
                    return; // Stop further init?
                }

                // 3. Restore Session
                await this._bayaniRestoreSession(pickingId);
            }
        } catch (e) {
            console.error("Bayani Init Error", e);
        }
    },

    _bayaniCheckStockAvailability() {
        if (!this.bayaniSnapshot) return null;
        
        for (const line of this.bayaniSnapshot.lines) {
            if (line.available_qty_at_source < line.qty_reserved) {
                return `Product: ${line.product_name}\nLocation: ${line.location_name}\nRequired: ${line.qty_reserved} | Available: ${line.available_qty_at_source}\nPlease resolve stock discrepancy.`;
            }
        }
        return null;
    },

    _bayaniShowBlockDialog(title, body) {
         this.env.services.dialog.add(ConfirmationDialog, {
            title: title,
            body: body,
            confirm: () => {
                // Redirect to Home or list?
                this.action.doAction('stock_barcode.stock_barcode_action_main_menu');
            },
            confirmLabel: _t("Exit Task"),
            cancel: () => {
                 this.action.doAction('stock_barcode.stock_barcode_action_main_menu');
            }, // Force exit
        });
    },

    async _bayaniRestoreSession(pickingId) {
        const key = `bayani_pick_${pickingId}`;
        const stored = window.localStorage.getItem(key);
        
        if (stored) {
            try {
                // Try decrypting first
                let session = await this._decryptData(stored);
                // Fallback for verification/transition: check if plain JSON
                if (!session) {
                    try { session = JSON.parse(stored); } catch (e) {}
                }
                
                if (session) {
                    this.bayaniSession = session;
                    console.log("Restored Bayani Session", this.bayaniSession);
                    this._reapplyOfflineScans();
                } else {
                    throw new Error("Invalid session data");
                }
            } catch (e) {
                console.error("Session Restore Error", e);
                // Reset if corrupt
                this.bayaniSession = this._createNewSession(pickingId);
            }
        } else {
             this.bayaniSession = this._createNewSession(pickingId);
        }
    },

    _createNewSession(pickingId) {
        return { 
             id: pickingId + '_' + Date.now().toString(),
             scans: [],
             logs: []
         };
    },

    _reapplyOfflineScans() {
        if (!this.bayaniSession || !this.bayaniSnapshot) return;
        
        // Find offline scans
        const offlineScans = this.bayaniSession.scans.filter(s => !s.synced);
        let restoredCount = 0;

        // Optimistically update UI lines for offline scans
        // We look into the loaded model lines to find matches
        const lines = this.env.model ? (this.env.model.lines || this.lines) : null;
        
        if (lines) {
             offlineScans.forEach(scan => {
                 // Try to find a matching line. Ideally we have product_id/barcode in the scan data, 
                 // but currently we only stored `barcode`.
                 // We can resolve barcode to product using cache.
                 // Since resolving is async and we want immediate update, we iterate.
                 // But wait, `cache.getRecordByBarcode` is fast.
                 // However, simpler: match line by matching barcode directly if stored, or just iterate lines?
                 
                 const line = lines.find(l => l.product_id && l.product_id.barcode === scan.barcode);
                 if (line) {
                     line.qty_done = (line.qty_done || 0) + 1;
                     line.bayani_last_scan = scan.timestamp; // Restore timestamp
                     restoredCount++;
                 } else {
                     // Try finding by internal product lookup if possible? 
                     // Ignore for now to avoid errors.
                 }
             });
             
             if (restoredCount > 0) {
                 this.trigger('update'); 
             }
        }
        
        if (offlineScans.length > 0) {
            this.env.services.notification.add(
                _t(`Restored ${offlineScans.length} unsynced scans (${restoredCount} applied to UI). Syncing...`), 
                { type: 'info' }
            );
            this._bayaniSync(); // Trigger sync immediately
        }
    },

    async _bayaniSaveSession() {
        if (!this.record || !this.bayaniSession) return;
        const key = `bayani_pick_${this.record.id}`;
        
        try {
            const encrypted = await this._encryptData(this.bayaniSession);
            if (encrypted) {
                window.localStorage.setItem(key, encrypted);
            }
        } catch (e) {
            console.error("Failed to save session", e);
        }
    },
    
    _setupSyncService() {
        // Run sync every 10 seconds
        this._syncInterval = setInterval(() => {
            this._bayaniSync();
        }, 10000);
    },
    
    async _bayaniSync() {
        if (this.isSyncing) return;
        if (!this.bayaniSession || this.bayaniSession.scans.length === 0) return;
        if (!navigator.onLine) return; // Browser offline check

        const scansToSync = this.bayaniSession.scans.filter(s => !s.synced);
        const logsToSync = this.bayaniSession.logs.filter(l => !l.synced);
        if (scansToSync.length === 0 && logsToSync.length === 0) return;

        try {
            this.isSyncing = true;
            // Sync Scans
            if (scansToSync.length > 0) {
                const res = await this.orm.call('stock.picking', 'process_offline_scans', [this.record.id, scansToSync]);
                if (res.status === 'success') {
                    scansToSync.forEach(s => s.synced = true);
                }
            }
            
            // Sync Logs
            if (logsToSync.length > 0) {
                 const resLog = await this.orm.call('stock.picking', 'action_sync_logs', [this.record.id, logsToSync]);
                 if (resLog) {
                     logsToSync.forEach(l => l.synced = true);
                 }
            }
            
            await this._bayaniSaveSession();
            
            if (scansToSync.length > 0) {
                 this.env.services.notification.add(_t("Background Sync Complete"), { type: 'success' });
                 await this.trigger('reload');
            }
        } catch (e) {
            console.log("Background Sync failed (Network?)", e);
        } finally {
            this.isSyncing = false;
        }
    },

    /**
     * @override
     */
    async _onBarcodeScanned(barcode) {
        console.log("[Bayani] Scan Event:", barcode);
        console.log("[Bayani] Snapshot present?", !!this.bayaniSnapshot);

        // 1. Snapshot Requirement (Strict Block)
        if (!this.bayaniSnapshot) {
            this._bayaniShowError("SYSTEM NOT READY", "Validation data not loaded. Please wait or reload.");
            return;
        }

        // 2. Barcode Lookup (Local Cache)
        const result = await this.cache.getRecordByBarcode(barcode);
        console.log("[Bayani] Cache Lookup:", result);

        // 3. STRICT VALIDATION & HANDLING (No Fallback to Super for Products)
        if (result && result.record) {
             const { record, type } = result;
             
             // A. Location Scan
             if (record._name === 'stock.location' || type === 'location') {
                 // Validate Location
                 const validLocs = [...new Set(this.bayaniSnapshot.lines.map(l => l.location_id))];
                 if (!validLocs.includes(record.id)) {
                      this._bayaniLog('validation_fail', barcode, 'wrong_location', `Expected: ${this.bayaniSnapshot.location_name}`);
                      this._bayaniShowError("WRONG LOCATION", 
                        `Expected: ${this.bayaniSnapshot.location_name}\nScanned: ${record.display_name}\nPlease scan the correct source location.`);
                      return;
                 }
                 
                 // Lock Location
                 this.currentLocationId = record.id;
                 this.env.services.notification.add(_t(`Locked to ${record.display_name}`), { type: 'success' });
                 return; // Handled locally, no super needed for just locking (unless Odoo needs it for state)
             }
             
             // B. Product/Lot Scan
             const isProductOrLot = record._name === 'stock.lot' || type === 'lot' || record._name === 'product.product' || type === 'product';
             if (isProductOrLot) {
                 // B1. Location Lock Check
                 if (!this.currentLocationId) {
                      this._bayaniShowError("ACTION REQUIRED", "Please scan a destination location first.");
                      return;
                 }
                 
                 // B2. Find Valid Line in Snapshot (Strict Match)
                 let validLine = null;
                 
                  // If scanned record is a Lot, we MUST match a line expecting that LOT
                 if (record._name === 'stock.lot' || type === 'lot') {
                     // Find line with matching Lot ID AND Location
                     validLine = this.bayaniSnapshot.lines.find(l => 
                         l.lot_id === record.id && 
                         l.location_id === this.currentLocationId
                     );
                     
                     if (!validLine) {
                         // Check if it's the right product but WRONG lot
                         const productLine = this.bayaniSnapshot.lines.find(l => l.product_id === record.product_id.id && l.location_id === this.currentLocationId);
                         if (productLine) {
                             this._bayaniShowError("LOT/BATCH MISMATCH", 
                                 `Product: ${record.product_id.display_name}\n\nScanned Lot: ${record.name}\nExpected Lot: ${productLine.lot_name || 'Different Batch'}\n\nRejection: Wrong Batch.`);
                         } else {
                             // Wrong Product or Wrong Location completely
                              this._bayaniShowError("INVALID ITEM", "Item not found in this location.");
                         }
                         return; // BLOCK (Don't call super)
                     }
                 } 
                 // If scanned record is a Product
                 else {
                     // Find line with matching Product ID AND Location AND (No Lot Required OR Lot Requirement handled later?)
                     // If product requires lot, scanning product barcode might be allowed if we prompt for lot.
                     // But prompt says: "Strict... no phantom...".
                     // If we scan product barcode for a lot-tracked item, Odoo usually asks for lot.
                     // We need to match valid line first.
                     
                     validLine = this.bayaniSnapshot.lines.find(l => 
                         (l.product_id === record.id || l.product_barcode === barcode) && 
                         l.location_id === this.currentLocationId
                     );
                     
                     if (!validLine) {
                          // Check if it exists in another location
                          const otherLocLine = this.bayaniSnapshot.lines.find(l => (l.product_id === record.id || l.product_barcode === barcode));
                          if (otherLocLine) {
                              this._bayaniShowError("WRONG LOCATION", `Item is in ${otherLocLine.location_name}, not here.`);
                          } else {
                              this._bayaniShowError("UNAUTHORIZED PRODUCT", "Product not in picking.");
                          }
                          return; // BLOCK
                     }
                     
                     // If matched, but line requires Lot and we scanned Product Barcode?
                     // We should let it proceed IF we want to allow manual lot entry? 
                     // But User says "Scanning product... validation...".
                     // If strictly requiring Lot Scan, we should block Product Scan for Lot items?
                     // "If a scanned GTIN does not return a linked lot... block".
                     if (record.tracking === 'lot' || record.tracking === 'serial') {
                          this._bayaniShowError("LOT SCAN REQUIRED", "This product is tracked. Please scan the specific Lot/Serial barcode.");
                          return; // BLOCK
                     }
                 }

                 // B3. Quantity Check
                 // Check local moves
                 // Trust Strict Server Check for final say, but optimized local check:
                 // Count local scans for this specific line/product/lot combination
                 // Note: We might have multiple lines for same product/lot? (Snapshot aggregates? No, snapshot has lines).
                 
                 // We don't track which line ID exactly in local Scan log, just barcode.
                 // So we estimate usage.
                 // Simplified: If Line has 0 remaining, block.
                 if (validLine.qty_done >= validLine.qty_reserved) {
                     // Check if there's another identical line with space?
                     const anySpace = this.bayaniSnapshot.lines.some(l => 
                        l.product_id === validLine.product_id && 
                        l.location_id === validLine.location_id &&
                        (l.lot_id === validLine.lot_id) &&
                        l.qty_done < l.qty_reserved
                     );
                     
                     if (!anySpace) {
                          this._bayaniShowError("QUANTITY EXCEEDED", `All required quantity for ${validLine.product_name} is already scanned.`);
                          return; // BLOCK
                     }
                 }

                 // B4. SUCCESS - Process Scan Locally & Server
                 // Record Scan Locally First
                  const scanEntry = {
                     scan_id: Date.now().toString() + Math.random().toString(36).substring(7),
                     barcode,
                     location_id: this.currentLocationId,
                     timestamp: new Date().toISOString(),
                     synced: false
                  };
                  
                  // Optimistic UI Update
                  validLine.qty_done += 1; 
                  validLine.bayani_last_scan = scanEntry.timestamp;
                  this.bayaniSession.scans.push(scanEntry);
                  await this._bayaniLog('scan', barcode, null, 'Success Scan');
                  await this._bayaniSaveSession();
                  this.trigger('update'); // Force UI redraw

                 // Pass to Server Strict Scan directly
                 try {
                     // Pass Lot ID if found (record.id if lot) to strict server
                     const expectedLotId = (record._name === 'stock.lot' || type === 'lot') ? record.id : null;
                     
                     const res = await this.orm.call('stock.picking', 'action_scan_product_strict', 
                        [this.record.id, barcode, this.currentLocationId, expectedLotId]);
                     
                     if (res.status === 'success') {
                         const details = res.details || {};
                         const successMsg = `${res.message}\nRemaining: ${details.remaining || 0}`;
                         this.env.services.notification.add(successMsg, { type: 'success' });
                         
                         // Mark synced
                         const lastScan = this.bayaniSession.scans.find(s => s.scan_id === scanEntry.scan_id);
                         if (lastScan) {
                            lastScan.synced = true;
                            lastScan.lastSyncStatus = 'success';
                         }
                         await this._bayaniSaveSession();
                     } else {
                         // Rollback optimistic update
                         validLine.qty_done -= 1;
                         
                         // Error Display
                         const errorCode = res.error_code || 'UNKNOWN_ERROR';
                         const details = res.details || {};
                         const errorTitle = this._getErrorTitle(errorCode);
                         const errorBody = this._formatErrorDetails(errorCode, res.message, details);
                         
                         this._bayaniShowError(errorTitle, errorBody);
                         
                         // Update local status
                         const lastScan = this.bayaniSession.scans.find(s => s.scan_id === scanEntry.scan_id);
                         if (lastScan) {
                             lastScan.synced = true; 
                             lastScan.lastSyncStatus = 'failed';
                             lastScan.error_code = errorCode;
                             lastScan.error = res.message;
                         }
                         await this._bayaniSaveSession();
                         this.trigger('update'); // Redraw rollback
                     }
                 } catch (e) {
                     console.warn("Server unreachable, keeping scan in queue", e);
                     this.env.services.notification.add("Offline: Scan Queued", { type: 'warning' });
                 }
                 return; // handled. DO NOT CALL SUPER.
             }
        } 
        else {
            // result is null -> Not in Cache -> Not in Picking
            this._bayaniShowError("UNAUTHORIZED ITEM", "Item not found in this picking (not in database/cache).\n\nValues: " + barcode);
            return; // BLOCK
        }
        
        // Fallback for other barcodes (Commands? Operations?)
        // If it's not a location, product, or lot, maybe it's a command?
        // Let's allow super() only if we are sure it's not a product/lot scan we missed.
        // But strict mode says: "Everything must be validated".
        // If we missed it above, it's safer to block.
        // But what about "Put in Pack" barcode?
        // Commands usually start with "O-CMD".
        
        return super._onBarcodeScanned(barcode);
    },

    validScan(barcode) {
        // Helper hook if needed by parents
        return true;
    },

    _bayaniShowError(title, body) {
        this.env.services.dialog.add(ConfirmationDialog, {
            title: title,
            body: body,
            confirm: () => {},
            confirmLabel: _t("OK"),
            cancel: false,
        });
    },

    _getErrorTitle(errorCode) {
        const titles = {
            'BARCODE_NOT_FOUND': 'BARCODE NOT RECOGNIZED',
            'PRODUCT_NOT_IN_PICKING': 'UNAUTHORIZED PRODUCT',
            'LOCATION_INVALID': 'WRONG LOCATION',
            'LOT_MISMATCH': 'LOT/BATCH MISMATCH',
            'LOT_REQUIRED': 'LOT SCAN REQUIRED',
            'QUANTITY_EXCEEDED': 'QUANTITY EXCEEDED',
            'PICKING_NOT_FOUND': 'TRANSFER NOT FOUND',
        };
        return titles[errorCode] || 'VALIDATION ERROR';
    },

    _formatErrorDetails(errorCode, message, details) {
        let body = `Error Code: ${errorCode}\n\n${message}\n`;
        
        switch (errorCode) {
            case 'BARCODE_NOT_FOUND':
                body += `\nBarcode: ${details.barcode || 'N/A'}`;
                body += `\nSearched in: ${(details.searched_in || []).join(', ')}`;
                break;
                
            case 'PRODUCT_NOT_IN_PICKING':
                body += `\nScanned Product: ${details.product_name || 'N/A'}`;
                body += `\nPicking: ${details.picking_name || 'N/A'}`;
                if (details.expected_products && details.expected_products.length > 0) {
                    body += `\n\nExpected Products:\n- ${details.expected_products.slice(0, 5).join('\n- ')}`;
                    if (details.expected_products.length > 5) {
                        body += `\n  ...and ${details.expected_products.length - 5} more`;
                    }
                }
                break;
                
            case 'LOCATION_INVALID':
                body += `\nScanned Location: ${details.scanned_location || 'N/A'}`;
                body += `\nExpected Location(s): ${(details.expected_locations || []).join(', ')}`;
                break;
                
            case 'LOT_MISMATCH':
                body += `\nScanned Lot: ${details.scanned_lot || details.expected_lot || 'N/A'}`;
                body += `\nExpected Lot(s): ${(details.expected_lots || details.actual_lots || []).join(', ')}`;
                break;
                
            case 'LOT_REQUIRED':
                body += `\nProduct: ${details.product_name || 'N/A'}`;
                body += `\nTracking Type: ${details.tracking_type || 'N/A'}`;
                body += `\n\nPlease scan the lot/serial barcode instead of product barcode.`;
                break;
                
            case 'QUANTITY_EXCEEDED':
                body += `\nProduct: ${details.product_name || 'N/A'}`;
                body += `\nTotal Reserved: ${details.total_reserved || 0}`;
                body += `\nAlready Scanned: ${details.total_scanned || 0}`;
                if (details.lot_name) {
                    body += `\nLot: ${details.lot_name}`;
                }
                break;
                
            default:
                // Show raw details for unknown errors
                body += `\nDetails: ${JSON.stringify(details, null, 2)}`;
        }
        
        body += `\n\n⚠️ This scan has been REJECTED. No quantity was added.`;
        return body;
    },
    
    async _bayaniLog(type, barcode, reason = null, details = null) {
        if (!this.bayaniSession) return;
        this.bayaniSession.logs.push({
            timestamp: new Date().toISOString(),
            event_type: type,
            barcode: barcode,
            reason_code: reason,
            details: details,
            synced: false
        });
        await this._bayaniSaveSession();
    },

    _bayaniRequestOverride(errorTitle, errorBody, callback) {
        this.env.services.dialog.add(ConfirmationDialog, {
            title: "Override Required: " + errorTitle,
            body: errorBody + "\n\nDo you want to override this warning?",
            confirm: async () => {
                // Ask for Reason Code
                // Since we don't have a complex dialog, we use prompt (or simple selection logic if we could)
                // We will require a "Reason" text at minimum.
                // In a real app we'd use a custom component.
                
                // For now, let's assume we proceed and log "Manager Override".
                // We can use a browser prompt for Reason.
                // TODO: Replace with custom Owl Dialog for better UX.
                // const reason = prompt("Enter Override Reason (or Manager PIN):");
                // if (!reason) return; // Cancel if empty
                
                // For this implementation, we'll just log 'manager_override'
                await this._bayaniLog('override', null, 'manager_override', `Overrode: ${errorTitle}`);
                callback();
            },
            confirmLabel: _t("Override (Manager)"),
            cancel: () => {
                this._bayaniLog('validation_fail', null, 'blocked', `User cancelled on: ${errorTitle}`);
            },
            cancelLabel: _t("Cancel")
        });
    },

    _bayaniValidateScan(barcode) {
        // Validation logic moved inside _onBarcodeScanned for context access (result record)
        return null; 
    },
    
    willUnmount() {
        if (this._syncInterval) clearInterval(this._syncInterval);
    }
});
