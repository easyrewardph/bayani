/** @odoo-module **/

import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";

const strictLocationGuard = {
    name: 'strict_location_guard',
    priority: 10, // High priority to run before default commands
    
    /**
     * Match function:
     * Returns true ONLY if the barcode is a location that SHOULD BE BLOCKED.
     * If it returns true, the 'action' will be executed and the loop stops.
     * If it returns false, Odoo continues to the next command (e.g. default location handling).
     */
    match: async (env, barcode) => {
        // 1. Check Context: Are we in a Picking?
        const model = env.model;
        if (!model || !model.root || model.root.resModel !== 'stock.picking') {
            return false;
        }
        
        const activePickingId = model.root.resId;
        if (!activePickingId) return false;

        // 2. Resolve Barcode Type
        let record = null;
        let type = null;
        
        if (model.cache && model.cache.getRecordByBarcode) {
            const result = await model.cache.getRecordByBarcode(barcode);
            if (result) {
                record = result.record;
                type = result.type;
            }
        }
        
        // If not a location, we don't care. Pass it on.
        if (!record || (record._name !== 'stock.location' && type !== 'location')) {
            return false;
        }
        
        // 3. STRICT VALIDATION LOGIC
        // It IS a location. Now check if it belongs to the picking.
        const getId = (f) => {
             if (!f) return null;
             if (Array.isArray(f)) return f[0];
             return f;
        };
        
        // Use model.lines which contains the fully loaded move lines
        const lines = model.lines || []; 
        const activeLines = lines.filter(l => getId(l.picking_id) === activePickingId);
        
        const rootData = model.root.data || {};
        const pickingType = rootData.picking_type_code || 'internal';
        const isPacking = pickingType === 'incoming';
        
        const validLocIds = activeLines.map(l => 
            isPacking ? getId(l.location_dest_id) 
                      : getId(l.location_id)
        ).filter(id => id);
        
        // console.log(`[Bayani] Valid Locations for Picking ${activePickingId}:`, validLocIds);
        
        // 4. THE DECISION
        if (!validLocIds.includes(record.id)) {
            // It is a location, but NOT allowed in this picking.
            // Match = TRUE to block it.
            return true;
        }
        
        // Valid location. Match = FALSE to allow default handler.
        return false;
    },
    
    action: (env, barcode) => {
        console.warn(`[Bayani] StrictGuard: Blocked barcode ${barcode}`);
        env.services.notification.add(
            _t("This location does not belong to the selected picking"),
            { type: 'danger', title: _t("Strict Location Validation") }
        );
        // Do NOT set current location.
        // Do NOT mutate context.
        // Simply returning finishes the command chain.
    }
};

// Register command with high priority
registry.category("barcode_commands").add("strict_location_guard", strictLocationGuard);
