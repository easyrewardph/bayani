/** @odoo-module **/
console.log("[Bayani] JS Module Loaded! Strict Mode Active.");

import { patch } from "@web/core/utils/patch";
import { registry } from "@web/core/registry";
import BarcodePickingModel from "@stock_barcode/models/barcode_picking_model";
import { _t } from "@web/core/l10n/translation";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

patch(BarcodePickingModel.prototype, {
    
    // -------------------------------------------------------------------------
    // LIFECYCLE & INIT (Preserved)
    // -------------------------------------------------------------------------

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
        try {
            const result = await this.orm.call('stock.picking', 'get_picking_snapshot', [pickingId]);
            if (result.status === 'success') {
                this.bayaniSnapshot = result.data;
                console.log("[Bayani] Snapshot Loaded:", this.bayaniSnapshot);
                this.env.services.notification.add(_t("Bayani V8 Registry Active"), { type: 'success' });
                
                const blockage = this._bayaniCheckStockAvailability();
                if (blockage) {
                    this._bayaniShowBlockDialog("PICK BLOCKED: INSUFFICIENT STOCK", blockage);
                    return;
                }
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
                this.action.doAction('stock_barcode.stock_barcode_action_main_menu');
            },
            confirmLabel: _t("Exit Task"),
            cancel: () => {
                 this.action.doAction('stock_barcode.stock_barcode_action_main_menu');
            },
        });
    },

    async _bayaniRestoreSession(pickingId) {
        const key = `bayani_pick_${pickingId}`;
        const stored = window.localStorage.getItem(key);
        if (stored) {
            try {
                let session = await this._decryptData(stored);
                if (!session) { try { session = JSON.parse(stored); } catch (e) {} }
                if (session) {
                    this.bayaniSession = session;
                    this._reapplyOfflineScans();
                } else {
                    throw new Error("Invalid session data");
                }
            } catch (e) {
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
        const offlineScans = this.bayaniSession.scans.filter(s => !s.synced);
        let restoredCount = 0;
        const lines = this.env.model ? (this.env.model.lines || this.lines) : null;
        
        if (lines) {
             offlineScans.forEach(scan => {
                 const line = lines.find(l => l.product_id && l.product_id.barcode === scan.barcode);
                 if (line) {
                     line.qty_done = (line.qty_done || 0) + 1;
                     line.bayani_last_scan = scan.timestamp;
                     restoredCount++;
                 }
             });
             if (restoredCount > 0) this.trigger('update'); 
        }
        if (offlineScans.length > 0) {
            this.env.services.notification.add(
                _t(`Restored ${offlineScans.length} unsynced scans`), 
                { type: 'info' }
            );
            this._bayaniSync();
        }
    },

    async _bayaniSaveSession() {
        if (!this.record || !this.bayaniSession) return;
        const key = `bayani_pick_${this.record.id}`;
        try {
            const encrypted = await this._encryptData(this.bayaniSession);
            if (encrypted) window.localStorage.setItem(key, encrypted);
        } catch (e) { console.error("Failed to save session", e); }
    },
    
    _setupSyncService() {
        this._syncInterval = setInterval(() => { this._bayaniSync(); }, 10000);
    },
    
    async _bayaniSync() {
        if (this.isSyncing) return;
        if (!this.bayaniSession || this.bayaniSession.scans.length === 0) return;
        if (!navigator.onLine) return;

        const scansToSync = this.bayaniSession.scans.filter(s => !s.synced);
        const logsToSync = this.bayaniSession.logs.filter(l => !l.synced);
        if (scansToSync.length === 0 && logsToSync.length === 0) return;

        try {
            this.isSyncing = true;
            if (scansToSync.length > 0) {
                const res = await this.orm.call('stock.picking', 'process_offline_scans', [this.record.id, scansToSync]);
                if (res.status === 'success') {
                    scansToSync.forEach(s => s.synced = true);
                }
            }
            if (logsToSync.length > 0) {
                 const resLog = await this.orm.call('stock.picking', 'action_sync_logs', [this.record.id, logsToSync]);
                 if (resLog) logsToSync.forEach(l => l.synced = true);
            }
            await this._bayaniSaveSession();
            if (scansToSync.length > 0) {
                 this.env.services.notification.add(_t("Background Sync Complete"), { type: 'success' });
                 await this.trigger('reload');
            }
        } catch (e) {
            console.log("Background Sync failed", e);
        } finally {
            this.isSyncing = false;
        }
    },

    // -------------------------------------------------------------------------
    // STRICT BARCODE INTERCEPTION
    // -------------------------------------------------------------------------

    async _onBarcodeScanned(barcode) {
        try {
            console.log("[Bayani] STRICT _onBarcodeScanned:", barcode);

            // Sanitize Input (Null bytes removal)
            if (typeof barcode === 'string') {
                barcode = barcode.replace(/\0/g, '').trim();
            }

            const picking = this.record; 
            const moveLines = picking.move_line_ids.records || picking.move_line_ids; 

            // 1. Logic Check - System Ready?
            // If picking data isn't fully loaded, we can't validate. Fail loud.
            if (!picking || !picking.location_id) {
                 this.env.services.notification.add(
                    "❌ System Error: Picking data not loaded. Please reload.",
                    { type: "danger" }
                );
                return;
            }

            /* ----------------------------------------------------
             * 1️⃣ STRICT LOCATION VALIDATION
             * ---------------------------------------------------- */
            /* ----------------------------------------------------
             * 1️⃣ STRICT LOCATION VALIDATION
             * ---------------------------------------------------- */
            // Step 1: Gather allowed locations from move lines
             // Step 1: Gather allowed locations from move lines
            // Use this.lines (the loaded model data) instead of raw picking.move_line_ids
            const sourceLines = this.lines || (this.page && this.page.lines) || [];
            
            const allowedLocationIds = sourceLines
                .map(line => line.location_id?.id || line.location_id?.[0])
                .filter(Boolean); // Filter out nulls/undefined
                
            // Debugging
            console.log("[Bayani] Allowed Locations:", allowedLocationIds);

            const location = await this.env.services.orm.searchRead(
                "stock.location",
                [["barcode", "=", barcode]],
                ["id", "display_name"],
                { limit: 1 }
            );

            if (location && location.length) {
                const scannedLocationId = location[0].id;

                if (!allowedLocationIds.includes(scannedLocationId)) {
                    this.env.services.notification.add(
                        `❌ Invalid Location Scan. Allowed locations: ${allowedLocationIds.length}`,
                        { type: "danger" }
                    );
                    return; // ⛔ BLOCK HERE
                }
                // Valid location? Pass to super for default handling (e.g. setting source)
                return await super._onBarcodeScanned(barcode);
            }

            /* ----------------------------------------------------
             * 2️⃣ STRICT PRODUCT VALIDATION
             * ---------------------------------------------------- */
            const product = await this.env.services.orm.searchRead(
                "product.product",
                [["barcode", "=", barcode]],
                ["id", "display_name", "tracking"],
                { limit: 1 }
            );

            if (product && product.length) {
                 const scannedProductId = product[0].id;
                 // Step 3 (from user req): Check if scanned barcode is a product
                 const validProductIds = sourceLines
                    .map(line => line.product_id?.id || line.product_id?.[0])
                    .filter(Boolean);
                 
                 if (!validProductIds.includes(scannedProductId)) {
                    this.env.services.notification.add(
                        "❌ Product not part of this picking",
                        { type: "danger" }
                    );
                    return; // ⛔ BLOCK
                 }
                 
                 // If strictly matched, pass to super
                 return await super._onBarcodeScanned(barcode);
            }

            /* ----------------------------------------------------
             * 3️⃣ STRICT LOT VALIDATION
             * ---------------------------------------------------- */
            const lots = await this.env.services.orm.searchRead(
                "stock.lot",
                [["name", "=", barcode]],
                ["id", "product_id", "name"],
                { limit: 1 }
            );

            if (lots && lots.length) {
                const scannedLotId = lots[0].id;
                
                // Step 2: Gather allowed lots from move lines
                const allowedLotIds = sourceLines
                    .map(line => line.lot_id?.id || line.lot_id?.[0])
                    .filter(Boolean);

                if (!allowedLotIds.includes(scannedLotId)) {
                    this.env.services.notification.add(
                        "❌ Lot not assigned to this picking",
                        { type: "danger" }
                    );
                    return; // ⛔ BLOCK
                }
                
                // If strictly matched, pass to super
                return await super._onBarcodeScanned(barcode);
            }
            
            // 4. UNKNOWN BARCODE
            if (!barcode.startsWith("O-CMD") && !barcode.startsWith("O-BTN")) {
                  this.env.services.notification.add(
                    `❌ Unknown Barcode: ${barcode}`,
                    { type: "danger" }
                );
                return; // Block unknown garbage
            }

            /* ----------------------------------------------------
             * ✅ COMMANDS / DEFAULT FALLBACK
             * ---------------------------------------------------- */
            return await super._onBarcodeScanned(barcode);

        } catch (error) {
            console.error("[Bayani] Scan Error:", error);
            this.env.services.notification.add(
                "❌ System Error during scan validation. Check console.",
                { type: "danger" }
            );
        }
    },

    // -------------------------------------------------------------------------
    // HELPERS
    // -------------------------------------------------------------------------

    async _processValidScan(barcode, record) {
          const scanEntry = {
             scan_id: Date.now().toString() + Math.random().toString(36).substring(7),
             barcode,
             location_id: this.currentLocationId,
             timestamp: new Date().toISOString(),
             synced: false
          };
          
          this.bayaniSession.scans.push(scanEntry);
          await this._bayaniLog('scan', barcode, null, 'Strict Scan Request');
          await this._bayaniSaveSession();

         try {
             // Strict Backend Call
             const res = await this.orm.call('stock.picking', 'action_scan_product_strict', 
                [this.record.id, barcode, this.currentLocationId]);
             
             if (res.status === 'success') {
                 const details = res.details || {};
                 const successMsg = `✅ ${res.message}`;
                 this.env.services.notification.add(successMsg, { type: 'success' });
                 
                 // Update UI locally if needed, or reload
                 this.trigger('update'); 
                 
                 const lastScan = this.bayaniSession.scans.find(s => s.scan_id === scanEntry.scan_id);
                 if (lastScan) { lastScan.synced = true; lastScan.lastSyncStatus = 'success'; }
                 await this._bayaniSaveSession();
             } else {
                 // Backend Rejected
                 this._bayaniShowError(res.error_code || "ERROR", res.message);
             }
         } catch (e) {
             console.warn("Server unreachable", e);
             this.env.services.notification.add("Offline: Scan Queued (Sync Pending)", { type: 'warning' });
         }
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
    
    _bayaniLog(type, barcode, reason, details) {
        if (!this.bayaniSession) return;
        this.bayaniSession.logs.push({
            timestamp: new Date().toISOString(),
            event_type: type,
            barcode, reason_code: reason, details, synced: false
        });
        this._bayaniSaveSession();
    }
});
