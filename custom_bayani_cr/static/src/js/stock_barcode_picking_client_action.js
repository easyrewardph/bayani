/** @odoo-module **/
console.log("=================================================");
console.log("   BAYANI CUSTOM BARCODE MODULE LOADING (V12)     ");
console.log("=================================================");
console.log("File: custom_bayani_cr/static/src/js/stock_barcode_picking_client_action.js");

import { patch } from "@web/core/utils/patch";
import { registry } from "@web/core/registry";
import BarcodePickingModel from "@stock_barcode/models/barcode_picking_model";
import { _t } from "@web/core/l10n/translation";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

patch(BarcodePickingModel.prototype, {
    _bayaniDebug: true,
    
    // -------------------------------------------------------------------------
    // LIFECYCLE & INIT (Preserved)
    // -------------------------------------------------------------------------

    async load() {
        if (this._bayaniDebug) console.log("[Bayani] load() called");
        this.bayaniSnapshot = null;
        this.bayaniSession = null;
        this.encryptionKey = null;
        this._setupSyncService();

        await this._initEncryption();
        await super.load(...arguments);
        if (this._bayaniDebug) console.log("[Bayani] super.load() finished");
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
            if (this._bayaniDebug) {
                console.log("[Bayani] _bayaniInitialize() start", { pickingId });
            }
            const result = await this.orm.call('stock.picking', 'get_picking_snapshot', [pickingId]);
            if (result.status === 'success') {
                this.bayaniSnapshot = result.data;
                this.snapshot = result.data;
                this._buildAllowedLocations();
                this.activeLocationId = null;
                this.currentLocationId = null;
                if (this._bayaniDebug) {
                    console.log("[Bayani] Snapshot Loaded:", this.bayaniSnapshot);
                }
                this._bayaniNotify(_t("Bayani V8 Registry Active"), "success");
                
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
         if (!this.env?.services?.dialog) {
             console.warn("[Bayani] BLOCK:", title, body);
             return;
         }
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
        const lines = (this.env && this.env.model && this.env.model.lines) || this.lines || null;
        
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
            if (this.env?.services?.notification) {
                this.env.services.notification.add(
                    _t(`Restored ${offlineScans.length} unsynced scans`), 
                    { type: 'info' }
                );
            }
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
                 if (this.env?.services?.notification) {
                     this.env.services.notification.add(_t("Background Sync Complete"), { type: 'success' });
                 }
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
        return await this._bayaniStrictScan(barcode);
    },

    // -------------------------------------------------------------------------
    // HELPERS
    // -------------------------------------------------------------------------

    _buildAllowedLocations() {
        this.bayaniAllowedLocationIds = new Set(
            (this.snapshot?.moveLines || [])
                .map((ml) => ml.location_id)
                .filter(Boolean)
        );
        if (this._bayaniDebug) {
            console.log(
                "[Bayani] Allowed source locations:",
                [...this.bayaniAllowedLocationIds]
            );
        }
    },

    async _processBarcode(barcode) {
        return await this._bayaniStrictScan(barcode);
    },

    async processBarcode(barcode) {
        return await this._bayaniStrictScan(barcode);
    },

    async receiveBarcode(barcode) {
        return await this._bayaniStrictScan(barcode);
    },

    async _receiveBarcode(barcode) {
        return await this._bayaniStrictScan(barcode);
    },

    async _handleBarcode(barcode) {
        return await this._bayaniStrictScan(barcode);
    },

    async handleBarcode(barcode) {
        return await this._bayaniStrictScan(barcode);
    },

    async onBarcodeScanned(barcode) {
        return await this._bayaniStrictScan(barcode);
    },

    async _bayaniStrictScan(barcode) {
        try {
            if (this._bayaniDebug) {
                console.log("[Bayani] STRICT handler HIT for barcode:", barcode);
            }
            const cleaned = this._normalizeBarcode(barcode);
            if (this._bayaniDebug) {
                console.log("[Bayani] normalized barcode:", cleaned);
            }

            const ready = await this._ensureBayaniSnapshot();
            if (!ready) {
                this._bayaniNotify(
                    "❌ System Error: Snapshot not loaded. Please reload.",
                    "danger"
                );
                return;
            }
            if (this._bayaniDebug) {
                console.log("[Bayani] snapshot ready", {
                    picking: this.snapshot?.name,
                    activeLocationId: this.activeLocationId,
                });
            }

            // 1) LOCATION SCAN
            const locId = this.snapshot.locationsByBarcode?.[cleaned];
            if (locId) {
                const allowed = this.bayaniAllowedLocationIds?.has(locId);
                if (this._bayaniDebug) {
                    console.log(
                        "[Bayani] Location scanned",
                        cleaned,
                        "locId=",
                        locId,
                        "allowed=",
                        allowed
                    );
                }
                if (!allowed) {
                    await this._showBayaniStopDialog(
                        "Rejected: this location does not belong to this transfer."
                    );
                    return;
                }
                this.activeLocationId = locId;
                this.currentLocationId = locId;
                const locName = this._getLocationName(locId) || cleaned;
                this.currentLocationName = locName;
                if (this.trigger) this.trigger('update');
                this._bayaniNotify(`Scan a product from ${locName}`, "info");
                return;
            }
            const locationPrefix = this.snapshot.location_name || "";
            if (locationPrefix && cleaned.startsWith(locationPrefix)) {
                if (this._bayaniDebug) {
                    console.log("[Bayani] Location-like barcode rejected by prefix", {
                        cleaned,
                        locationPrefix,
                    });
                }
                await this._showBayaniStopDialog(
                    "Rejected: this location does not belong to this transfer."
                );
                return;
            }

            // 2) LOT OR PRODUCT SCAN
            const lotInfo = this.snapshot.lotsByName?.[cleaned];
            const productId = lotInfo?.product_id || this.snapshot.productsByBarcode?.[cleaned];
            const lotId = lotInfo?.id || null;
            if (productId) {
                if (this._bayaniDebug) {
                    console.log("[Bayani] Product scanned", { cleaned, productId, lotId });
                }
                if (!this.activeLocationId) {
                    await this._showBayaniStopDialog("Scan location first.");
                    return;
                }

                const ok = (this.snapshot.moveLines || []).some((ml) =>
                    ml.product_id === productId &&
                    ml.location_id === this.activeLocationId &&
                    (!lotId || ml.lot_id === lotId) &&
                    (ml.qty_done || 0) < (ml.product_uom_qty || 0)
                );

                if (!ok) {
                    if (this._bayaniDebug) {
                        console.log("[Bayani] Product rejected at location", {
                            productId,
                            lotId,
                            activeLocationId: this.activeLocationId,
                        });
                    }
                    await this._showBayaniStopDialog(
                        "Rejected: this product is not reserved in the scanned location."
                    );
                    return;
                }

                if (this._bayaniDebug) {
                    console.log("[Bayani] Product accepted, processing scan");
                }
                
                // Ensure session is initialized before processing
                if (!this.bayaniSession) {
                    if (this._bayaniDebug) {
                        console.log("[Bayani] Session not ready, initializing...");
                    }
                    if (this.record?.id) {
                        this.bayaniSession = this._createNewSession(this.record.id);
                    } else {
                        this._bayaniNotify("❌ Session initialization failed.", "danger");
                        return;
                    }
                }
                
                await this._processValidScan(cleaned, { productId, lotId });
                return;
            }

            // 3) Unknown / unmatched barcode
            if (this._bayaniDebug) {
                console.log("[Bayani] Unknown barcode", cleaned);
            }
            if (this.activeLocationId) {
                await this._showBayaniStopDialog(
                    "Rejected: this product is not reserved in the scanned location."
                );
            } else {
                await this._showBayaniStopDialog(
                    "Rejected: barcode not part of this transfer."
                );
            }
            return;

        } catch (error) {
            console.error("[Bayani] Scan Error:", error);
            this._bayaniNotify(
                "❌ System Error during scan validation. Check console.",
                "danger"
            );
        }
    },

    async _ensureBayaniSnapshot() {
        if (this._bayaniDebug) {
            console.log("[Bayani] _ensureBayaniSnapshot() called", {
                hasSnapshot: !!this.snapshot,
                recordId: this.record?.id,
            });
        }
        if (this.snapshot) return true;
        if (!this.record?.id) return false;
        if (!this._bayaniInitPromise) {
            this._bayaniInitPromise = (async () => {
                try {
                    if (this._bayaniDebug) {
                        console.log("[Bayani] _bayaniInitialize() triggered from scan");
                    }
                    await this._bayaniInitialize();
                } finally {
                    this._bayaniInitPromise = null;
                }
            })();
        }
        await this._bayaniInitPromise;
        if (this._bayaniDebug) {
            console.log("[Bayani] _ensureBayaniSnapshot() done", {
                hasSnapshot: !!this.snapshot,
            });
        }
        
        // Ensure session exists when snapshot is ready
        if (this.snapshot && !this.bayaniSession && this.record?.id) {
            if (this._bayaniDebug) {
                console.log("[Bayani] Creating session after snapshot initialization");
            }
            this.bayaniSession = this._createNewSession(this.record.id);
        }
        
        return !!this.snapshot;
    },

    _bayaniNotify(message, type = "info") {
        if (this.env?.services?.notification) {
            this.env.services.notification.add(message, { type });
        } else {
            console.warn("[Bayani] Notification:", message);
        }
    },

    _normalizeBarcode(barcode) {
        if (typeof barcode !== 'string') return '';
        return barcode.replace(/\0/g, '').trim();
    },

    _getLocationName(locId) {
        const line = (this.snapshot?.moveLines || []).find((ml) => ml.location_id === locId);
        return line?.location_name || null;
    },

    _isLocationBarcode(barcode) {
        return !!this.snapshot?.locationsByBarcode?.[barcode];
    },

    _isProductBarcode(barcode) {
        return !!this.snapshot?.productsByBarcode?.[barcode];
    },

    async _showBayaniStopDialog(message) {
        if (!this.env?.services?.dialog) {
            console.warn("[Bayani] STOP:", message);
            if (typeof window !== "undefined" && typeof window.alert === "function") {
                window.alert(message);
            }
            return;
        }
        this.env.services.dialog.add(ConfirmationDialog, {
            title: _t("STOP"),
            body: message,
            confirm: () => {},
            confirmLabel: _t("OK"),
            cancel: false,
        });
    },

    async _processValidScan(barcode, { productId, lotId } = {}) {
          // Ensure session exists before processing
          if (!this.bayaniSession) {
              console.error("[Bayani] Session not initialized in _processValidScan");
              this._bayaniNotify("❌ Session not ready. Please reload.", "danger");
              return;
          }
          
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

          // Optimistic update removed - waiting for server confirmation as requested
          this.trigger('update');

         try {
             // Strict Backend Call
             const res = await this.orm.call('stock.picking', 'action_scan_product_strict', 
                [this.record.id, barcode, this.currentLocationId]);
             
              if (res.status === 'success') {
                  const details = res.details || {};
                  const productInfo = details.product || {};
                  
                  // Show Success Notification
                  const successMsg = res.message || `✅ Product Scanned Successfully`;
                  if (this.env?.services?.notification) {
                      this.env.services.notification.add(successMsg, { type: 'success' });
                  }
                  
                  // Mark scan as synced
                  const lastScan = this.bayaniSession.scans.find(s => s.scan_id === scanEntry.scan_id);
                  if (lastScan) { 
                      lastScan.synced = true; 
                      lastScan.lastSyncStatus = 'success'; 
                  }
                   await this._bayaniSaveSession();
                   
                   // MANUAL FRONTEND UPDATE
                   const lines = (this.env && this.env.model && this.env.model.lines) || this.lines || [];
                   const line = lines.find(l => 
                       l.product_id.id === productId && 
                       l.location_id.id === this.currentLocationId && 
                       (!lotId || (l.lot_id && l.lot_id.id === lotId))
                   );
                   
                   if (line) {
                       line.qty_done = (line.qty_done || 0) + 1;
                       console.log("[Bayani] Local line updated:", line);
                       this.trigger('update');
                   } else {
                       console.warn("[Bayani] Line not found for local update, falling back to reload");
                       await this.trigger('reload');
                   }

               } else {
                 // Backend Rejected
                  console.error("[Bayani] Backend Rejected:", res.message);
                 this._bayaniShowError(res.error_code || "ERROR", res.message);
                 // Remove the failed scan from session or mark failed? 
                 // Keeping it in log but maybe we should revert the session add if we were strictly syncing?
                 // For now, leaving it as history.
             }
         } catch (e) {
             console.warn("Server unreachable", e);
             if (this.env?.services?.notification) {
                 this.env.services.notification.add("Offline: Scan Queued (Sync Pending)", { type: 'warning' });
             }
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
