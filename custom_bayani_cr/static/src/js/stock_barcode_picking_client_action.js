/** @odoo-module **/
console.log("[Bayani] JS Module Loaded! If you see this, the file is being read.");

import { patch } from "@web/core/utils/patch";
import { registry } from "@web/core/registry";
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
                this.env.services.notification.add(_t("Bayani V8 Registry Active"), { type: 'success' });
                
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
    // -------------------------------------------------------------------------
    // STRICT ENTRY POINT OVERRIDE
    // -------------------------------------------------------------------------
    
    /**
     * @override
     * Intercepts the scan at the very beginning to ensure strict blocking.
     */
    async scanBarcode(barcode) {
        // Sanitize Input: Remove NUL (0x00) and other non-printable control characters
        // Some scanners send null bytes or special terminators that crash Odoo's SQL driver.
        if (typeof barcode === 'string') {
            barcode = barcode.replace(/\0/g, '').trim(); 
        }
        
        console.log("[Bayani] STRICT SCAN ENTRY:", barcode);
        
        // 1. Snapshot Requirement
        if (!this.bayaniSnapshot) {
             this._bayaniShowError("SYSTEM NOT READY", "Validation data not loaded. Please reload.");
             return; 
        }

        // 2. EXCEPTION: Allow Odoo Commands (e.g. O-CMD.VALIDATE)
        if (barcode && (barcode.startsWith("O-CMD") || barcode.startsWith("O-BTN"))) {
            console.log("[Bayani] Allowing command:", barcode);
            return super.scanBarcode(barcode);
        }

        // 3. Resolve Barcode Locally
        const result = await this.cache.getRecordByBarcode(barcode);
        console.log("[Bayani] Cache lookup result:", result);
        
        // 4. If not found in cache, reject immediately
        if (!result || !result.record) {
            console.log("[Bayani] BLOCKING: Barcode not found in cache:", barcode);
            this._bayaniShowError("UNAUTHORIZED ITEM", "Item not recognized or not in picking.");
            return; // BLOCK
        }

        const { record, type } = result;
        console.log("[Bayani] Record type:", type, "Record model:", record._name);

        // 5. LOCATION VALIDATION - Check snapshot FIRST
        if (record._name === 'stock.location' || type === 'location') {
            console.log("[Bayani] ===== LOCATION SCAN DETECTED =====");
            
            // Get valid IDs
            const validSourceIds = this.bayaniSnapshot.lines.map(l => l.location_id);
            const validDestIds = this.bayaniSnapshot.lines.map(l => l.location_dest_id);
            
            // Check validation based on operation type
            // Picking (Delivery/Internal): Logic requires validation against SOURCE (location_id).
            // Packing/Receipt: Logic might accept DEST (location_dest_id).
            
            const isPicking = ['outgoing', 'internal'].includes(this.bayaniSnapshot.picking_type_code);
            const isReceipt = ['incoming'].includes(this.bayaniSnapshot.picking_type_code);
            
            let isValid = false;
            let errorMsg = "";
            
            if (isReceipt) {
                // Receipt: Just check if it's a valid Destination
                 isValid = validDestIds.includes(record.id) || validSourceIds.includes(record.id);
                 if (!isValid) {
                     const validDestNames = [...new Set(this.bayaniSnapshot.lines.map(l => l.location_dest_name))].join(", ");
                     errorMsg = `The scanned location "${record.display_name}" is not a valid destination for this receipt.\n\nExpected: ${validDestNames}`;
                 }
            } else {
                // Picking / Delivery: STRICT SOURCE CHECK
                // User Requirement: "Picking accepts wrong source locations... strict location validation against lines[].location_id"
                isValid = validSourceIds.includes(record.id);
                
                if (!isValid) {
                     // Check if it was a destination?
                     if (validDestIds.includes(record.id)) {
                         errorMsg = `The scanned location "${record.display_name}" is a DESTINATION location. For Picking, please scan the SOURCE location.`;
                     } else {
                         const validSourceNames = [...new Set(this.bayaniSnapshot.lines.map(l => l.location_name))].join(", ");
                         errorMsg = `Scanned location is not part of this picking.\n\nValid Source Locations: ${validSourceNames}`;
                     }
                }
            }
            
            if (!isValid) {
                console.log("[Bayani] BLOCKING: Location Validation Failed.");
                this._bayaniShowError("INVALID LOCATION", errorMsg);
                return; // BLOCK
            }
            
            // CHECK 2: Does this location have pending work?
            const pendingLocationIds = this.bayaniSnapshot.lines
                .filter(l => l.qty_done < l.qty_reserved)
                .map(l => l.location_id);
            
            const hasPendingWork = pendingLocationIds.includes(record.id);
            
            if (!hasPendingWork) {
                this._bayaniShowError("LOCATION COMPLETE", 
                    `All items from "${record.display_name}" have already been picked.`);
                return; // BLOCK
            }

            // SUCCESS: Lock to this location
            console.log("[Bayani] Locked to:", record.display_name);
            this.currentLocationId = record.id;
            this.env.services.notification.add(_t(`Locked to ${record.display_name}`), { type: 'success' });
            return; // Handled
        }
        
        // 6. PRODUCT/LOT VALIDATION
        const isProductOrLot = record._name === 'stock.lot' || type === 'lot' || record._name === 'product.product' || type === 'product';
        if (isProductOrLot) {
            if (!this.currentLocationId) {
                 this._bayaniShowError("ACTION REQUIRED", "Please scan a source location first.");
                 return; // BLOCK
            }

            // STRICT FILTERING
            // We must find a valid line in our snapshot that matches:
            // 1. The scanned product/lot
            // 2. The CURRENT locked location
            
            let validLine = null;
            
            if (record._name === 'stock.lot' || type === 'lot') {
                validLine = this.bayaniSnapshot.lines.find(l => 
                    l.lot_id === record.id && 
                    l.location_id === this.currentLocationId
                );
                
                if (!validLine) {
                    // Check if it's a valid lot but WRONG location
                    const otherLocLine = this.bayaniSnapshot.lines.find(l => l.lot_id === record.id);
                    if (otherLocLine) {
                        this._bayaniShowError("WRONG LOCATION", "Item cannot be added: this product does not belong to this location.");
                    } else {
                        this._bayaniShowError("LOT MISMATCH", `Scanned Lot "${record.name}" is not in the pick list for this location.`);
                    }
                    return; // BLOCK
                }
            } else {
                // Product Scan
                validLine = this.bayaniSnapshot.lines.find(l => 
                    (l.product_id === record.id || l.product_barcode === barcode) && 
                    l.location_id === this.currentLocationId
                );
                
                if (!validLine) {
                     // Check if valid product but WRONG location
                     const otherLocLine = this.bayaniSnapshot.lines.find(l => (l.product_id === record.id || l.product_barcode === barcode));
                     if (otherLocLine) {
                         this._bayaniShowError("WRONG LOCATION", "Item cannot be added: this product does not belong to this location.");
                     } else {
                         this._bayaniShowError("UNAUTHORIZED PRODUCT", "Product not found in this picking.");
                     }
                     return; // BLOCK
                }
                
                // Lot Requirement Check
                if (record.tracking === 'lot' || record.tracking === 'serial') {
                     this._bayaniShowError("LOT SCAN REQUIRED", "This product is tracked. Please scan the specific Lot/Serial barcode.");
                     return; // BLOCK
                }
            }
            
            // Quantity Check (Pre-Server)
            if (validLine.qty_done >= validLine.qty_reserved) {
                 // Check for ANY space in this location for this product/lot
                 const remaining = this.bayaniSnapshot.lines
                   .filter(l => l.product_id === validLine.product_id && l.location_id === this.currentLocationId && ((!l.lot_id) || l.lot_id === validLine.lot_id))
                   .reduce((sum, l) => sum + (l.qty_reserved - l.qty_done), 0);
                 
                 if (remaining <= 0) {
                     this._bayaniShowError("QUANTITY EXCEEDED", `Required quantity already scanned.`);
                     return; // BLOCK
                 }
            }
            
            // Internal Handler
            return this._processValidScan(barcode, record, validLine);
        }
        
        // 7. If record exists but is NOT Location/Product/Lot (e.g. Package)
        // User requested strict rejection of anything not in list.
        this._bayaniShowError("UNAUTHORIZED TYPE", "Scanned item type is not allowed in this strict mode.");
        return; // BLOCK
    },

    _getValidLocationNames() {
        if (!this.bayaniSnapshot || !this.bayaniSnapshot.lines) return "None";
        const locationNames = [...new Set(this.bayaniSnapshot.lines.map(l => l.location_name))];
        return locationNames.map(name => `  • ${name}`).join('\n');
    },
    
    // Internal handler for valid scans (replacing _onBarcodeScanned logic)
    async _processValidScan(barcode, record, validLine) {
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
          this.trigger('update');

         try {
             const expectedLotId = (record._name === 'stock.lot' || record.type === 'lot') ? record.id : null;
             const res = await this.orm.call('stock.picking', 'action_scan_product_strict', 
                [this.record.id, barcode, this.currentLocationId, expectedLotId]);
             
             if (res.status === 'success') {
                 const details = res.details || {};
                 const successMsg = `${res.message}\nRemaining: ${details.remaining || 0}`;
                 this.env.services.notification.add(successMsg, { type: 'success' });
                 
                 const lastScan = this.bayaniSession.scans.find(s => s.scan_id === scanEntry.scan_id);
                 if (lastScan) {
                    lastScan.synced = true;
                    lastScan.lastSyncStatus = 'success';
                 }
                 await this._bayaniSaveSession();
             } else {
                 validLine.qty_done -= 1; // Rollback
                 
                 const errorCode = res.error_code || 'UNKNOWN_ERROR';
                 const details = res.details || {};
                 const errorTitle = this._getErrorTitle(errorCode);
                 const errorBody = this._formatErrorDetails(errorCode, res.message, details);
                 
                 this._bayaniShowError(errorTitle, errorBody);
                 
                 const lastScan = this.bayaniSession.scans.find(s => s.scan_id === scanEntry.scan_id);
                 if (lastScan) {
                     lastScan.synced = true; 
                     lastScan.lastSyncStatus = 'failed';
                     lastScan.error_code = errorCode;
                     lastScan.error = res.message;
                 }
                 await this._bayaniSaveSession();
                 this.trigger('update');
             }
         } catch (e) {
             console.warn("Server unreachable", e);
             this.env.services.notification.add("Offline: Scan Queued", { type: 'warning' });
         }
    },

    // -------------------------------------------------------------------------
    // OLD METHOD (Disabled/Redirected)
    // -------------------------------------------------------------------------
    async _onBarcodeScanned(barcode) {
        console.log("[Bayani] _onBarcodeScanned (Model) trigger with:", barcode);
        // Force Strict Scan Entry Point
        if (this.scanBarcode) {
             await this.scanBarcode(barcode);
             return; 
        }
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
    
    async _onBarcodeScanned(barcode) {
        console.log("[Bayani] _onBarcodeScanned (Model) trigger with:", barcode);
        // Force Strict Scan Entry Point
        if (this.scanBarcode) {
             await this.scanBarcode(barcode);
             return; 
        }
        return super._onBarcodeScanned(barcode);
    },
    
    /**
     * @override
     * GLOBAL INTERCEPTOR (Model Level)
     * We override scanBarcode to block invalid scans before any processing.
     */
    async scanBarcode(barcode) {
        console.log("[Bayani] MODEL GUARD: Scanning:", barcode);
        
        // -------------------------------------------------------------
        // 1. RESOLVE BARCODE
        // -------------------------------------------------------------
        let record = null;
        let type = null;
        
        if (this.cache && this.cache.getRecordByBarcode) {
             const result = await this.cache.getRecordByBarcode(barcode);
             if (result) {
                 record = result.record;
                 type = result.type;
             }
        }
        
        // -------------------------------------------------------------
        // 2. IDENTIFY ACTIVE CONTEXT
        // -------------------------------------------------------------
        // In Model, `this.record` is the active picking record.
        const activePickingId = this.record ? this.record.id : null;
        
        if (!activePickingId) {
            console.warn("[Bayani] No active picking in model?");
            return super.scanBarcode(barcode);
        }

        // -------------------------------------------------------------
        // 3. STRICT LOCATION GUARD
        // -------------------------------------------------------------
        if (record && (record._name === 'stock.location' || type === 'location')) {
             console.log(`[Bayani] GUARD: Validating Location ${record.display_name}`);
             
             // Get Strict Lines
             const lines = this.lines || [];
             const activeLines = lines.filter(l => l.picking_id && l.picking_id[0] === activePickingId);
             
             // Validation Scope
             const pickingType = (this.record.picking_type_code) || 'internal';
             const isPacking = pickingType === 'incoming';
             
             const validLocIds = activeLines.map(l => 
                 isPacking ? (l.location_dest_id ? l.location_dest_id[0] : null) 
                           : (l.location_id ? l.location_id[0] : null)
             ).filter(id => id);
             
             if (!validLocIds.includes(record.id)) {
                  console.warn(`[Bayani] BLOCKED Location ${record.display_name} - Not in Picking ${activePickingId}`);
                  this.env.services.notification.add(
                      _t("Scanned location is not part of the selected picking"), 
                      { type: 'danger', title: _t("Strict Validation Guard") }
                  );
                  return; // BLOCK
             }
             
             console.log("[Bayani] Location Allowed.");
        }

        // -------------------------------------------------------------
        // 4. STRICT LOT/SERIAL GUARD
        // -------------------------------------------------------------
        if (record && (record._name === 'stock.lot' || type === 'lot')) {
             console.log(`[Bayani] GUARD: Validating Lot ${record.name}`);
             
             const currentLocationId = this.currentLocationId; // Model keeps track of this?
             // If this.currentLocationId is not reliable in Model, we might need another way.
             // But usually BarcodePickingModel maintains strict state if designed well.
             
             if (!currentLocationId) {
                 this.env.services.notification.add(
                      _t("Please scan a Source Location first."), 
                      { type: 'danger', title: _t("Action Required") }
                 );
                 return; // BLOCK
             }
             
             const lines = this.lines || [];
             const validLines = lines.filter(l => 
                 l.picking_id && l.picking_id[0] === activePickingId && 
                 l.location_id && l.location_id[0] === currentLocationId &&
                 l.lot_id && l.lot_id[0] === record.id
             );
             
             if (validLines.length === 0) {
                 const existsInPicking = lines.some(l => l.picking_id[0] === activePickingId && l.lot_id && l.lot_id[0] === record.id);
                 let msg = "This lot does not belong to the selected location or picking.";
                 if (existsInPicking) msg = "This lot exists in the picking but NOT in the selected location.";
                 
                 this.env.services.notification.add(
                      _t(msg), 
                      { type: 'danger', title: _t("Strict Lot Validation") }
                 );
                 return; // BLOCK
             }
             
             // Quantity Check
             const hasSpace = validLines.some(l => (l.qty_reserved || 0) > (l.qty_done || 0));
             if (!hasSpace) {
                  this.env.services.notification.add(
                      _t("All items for this lot at this location have already been scanned."), 
                      { type: 'warning', title: _t("Quantity Exceeded") }
                  );
                  return; // BLOCK
             }
             
             console.log("[Bayani] Lot Allowed.");
        }

        return super.scanBarcode(barcode);
    },
});
