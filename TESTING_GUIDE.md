# Testing Guide for Custom Bayani CR Module Changes

## Overview
This guide covers testing for two main changes:
1. **SO2366**: Remove auto-populate delivery fees
2. **SO Quotation**: Remove options feature from product descriptions

---

## Pre-Testing Setup

### 1. Module Update
```bash
# Navigate to Odoo directory
cd /home/dell/Desktop/Projects/Odoo-final

# Restart Odoo service (adjust based on your setup)
# If using systemd:
sudo systemctl restart odoo

# If running manually:
# Stop current Odoo process, then restart
```

### 2. Upgrade Module in Odoo
1. Go to **Apps** menu
2. Remove **Apps** filter (if active)
3. Search for **"Hide Price, Add To Cart Button, Quantity From website"** or **"custom_bayani_cr"**
4. Click **Upgrade** button
5. Wait for upgrade to complete

### 3. Clear Browser Cache
- Clear browser cache or use **Incognito/Private mode**
- Or do a hard refresh: `Ctrl + Shift + R` (Linux/Windows) or `Cmd + Shift + R` (Mac)

---

## Test Case 1: SO2366 - Remove Auto-Populate Delivery Fees

### Objective
Verify that delivery fees are NOT automatically added to sale orders when:
- A carrier is selected
- Order is created/updated
- Delivery method is changed

### Test Scenarios

#### Scenario 1.1: Create New Sale Order with Carrier
**Steps:**
1. Navigate to **Sales** → **Quotations**
2. Click **New** to create a new quotation
3. Select a **Customer**
4. Add one or more **Product Lines**
5. In the **Delivery Method** field, select a carrier (e.g., "Standard Delivery", "Express Delivery")
6. Click **Save**

**Expected Result:**
- ✅ Sale order saves successfully
- ✅ **NO delivery line** appears in the order lines
- ✅ Order total does NOT include delivery fees
- ✅ Delivery method field shows the selected carrier, but no delivery line is created

**Actual Result:** [Fill in during testing]
- [ ]

---

#### Scenario 1.2: Update Existing Order with Carrier
**Steps:**
1. Open an existing **Sale Order** (quotation or confirmed order)
2. Ensure it has product lines but NO delivery line
3. Select a **Delivery Method** (carrier)
4. Click **Save**
5. Check the order lines

**Expected Result:**
- ✅ Order saves successfully
- ✅ **NO delivery line** is created
- ✅ Order total remains unchanged (no delivery fees added)

**Actual Result:** [Fill in during testing]
- [ ]

---

#### Scenario 1.3: Change Delivery Method on Existing Order
**Steps:**
1. Open a sale order that already has a delivery method selected
2. Change the **Delivery Method** to a different carrier
3. Click **Save**
4. Check order lines

**Expected Result:**
- ✅ Delivery method updates to new carrier
- ✅ **NO delivery line** is created
- ✅ Order total does NOT change

**Actual Result:** [Fill in during testing]
- [ ]

---

#### Scenario 1.4: Update Order with Other Fields
**Steps:**
1. Open a sale order
2. Modify any field (e.g., customer, product quantity, date)
3. Click **Save**
4. Check if any delivery lines appear

**Expected Result:**
- ✅ Order updates successfully
- ✅ **NO delivery line** appears after save
- ✅ If a delivery line existed before, it should be removed

**Actual Result:** [Fill in during testing]
- [ ]

---

#### Scenario 1.5: Confirm Order with Carrier Selected
**Steps:**
1. Create a quotation with:
   - Customer selected
   - Product lines added
   - Delivery method selected
2. Click **Confirm Sale** button
3. Check the confirmed order lines

**Expected Result:**
- ✅ Order confirms successfully
- ✅ **NO delivery line** appears in the confirmed order
- ✅ Order total does NOT include delivery fees

**Actual Result:** [Fill in during testing]
- [ ]

---

#### Scenario 1.6: Manual Delivery Line Addition (if applicable)
**Steps:**
1. Create a sale order
2. Try to manually add a delivery product/service line
3. Check if it persists after saving

**Expected Result:**
- ⚠️ If manually added delivery lines are removed, this is expected behavior
- ⚠️ If manual addition is allowed, verify it's intentional

**Actual Result:** [Fill in during testing]
- [ ]

---

### Test Case 1 Summary
- [ ] All scenarios passed
- [ ] Issues found: [List any issues]
- [ ] Notes: [Any additional observations]

---

## Test Case 2: SO Quotation - Remove Options Feature

### Objective
Verify that product descriptions do NOT show lines starting with "Option:" prefix in sale order quotations.

### Test Scenarios

#### Scenario 2.1: Product with Options in Description
**Steps:**
1. Navigate to **Sales** → **Quotations**
2. Click **New** to create a quotation
3. Select a **Customer**
4. Add a product that has options configured (products with variants/options)
5. Check the **Description** field in the order line
6. View the quotation PDF/report

**Expected Result:**
- ✅ Product description shows product name and details
- ✅ **NO lines starting with "Option:"** appear in the description
- ✅ Description is clean without option prefixes
- ✅ Quotation PDF/report does NOT show "Option:" lines

**Actual Result:** [Fill in during testing]
- [ ]

---

#### Scenario 2.2: Multiple Products with Options
**Steps:**
1. Create a new quotation
2. Add multiple products that have options/variants
3. Check each product line description
4. Save and view the quotation

**Expected Result:**
- ✅ All product descriptions are clean
- ✅ **NO "Option:" lines** in any product description
- ✅ All descriptions display correctly

**Actual Result:** [Fill in during testing]
- [ ]

---

#### Scenario 2.3: Update Existing Order Line
**Steps:**
1. Open an existing quotation with product lines
2. Modify a product line (change quantity, etc.)
3. Check if description updates correctly
4. Verify no "Option:" lines appear

**Expected Result:**
- ✅ Description updates correctly
- ✅ **NO "Option:" lines** appear after update
- ✅ Description remains clean

**Actual Result:** [Fill in during testing]
- [ ]

---

#### Scenario 2.4: Quotation Report/PDF
**Steps:**
1. Create a quotation with products that have options
2. Click **Print** → **Quotation/Order**
3. Review the PDF/report
4. Check product descriptions in the report

**Expected Result:**
- ✅ PDF generates successfully
- ✅ Product descriptions in PDF do NOT show "Option:" lines
- ✅ Report is clean and professional

**Actual Result:** [Fill in during testing]
- [ ]

---

#### Scenario 2.5: Confirmed Order with Options
**Steps:**
1. Create a quotation with products having options
2. Confirm the sale order
3. Check the confirmed order lines
4. View the order report

**Expected Result:**
- ✅ Order confirms successfully
- ✅ Product descriptions remain clean (no "Option:" lines)
- ✅ Order report does NOT show "Option:" lines

**Actual Result:** [Fill in during testing]
- [ ]

---

#### Scenario 2.6: Website Order (if applicable)
**Steps:**
1. Place an order through the website (if e-commerce is enabled)
2. Check the created quotation/order in backend
3. Verify product descriptions

**Expected Result:**
- ✅ Order created from website
- ✅ Product descriptions do NOT show "Option:" lines
- ✅ Description is clean

**Actual Result:** [Fill in during testing]
- [ ]

---

### Test Case 2 Summary
- [ ] All scenarios passed
- [ ] Issues found: [List any issues]
- [ ] Notes: [Any additional observations]

---

## Integration Testing

### Test Both Features Together
**Steps:**
1. Create a new quotation
2. Add products with options
3. Select a delivery method
4. Save the quotation
5. Check:
   - No delivery lines appear
   - No "Option:" lines in descriptions
6. Confirm the order
7. Verify both features work in confirmed order

**Expected Result:**
- ✅ Both features work correctly together
- ✅ No conflicts between the two changes

**Actual Result:** [Fill in during testing]
- [ ]

---

## Regression Testing

### Verify Existing Functionality Still Works
Test that other sale order features are not affected:

- [ ] Product lines can be added/removed
- [ ] Quantities can be modified
- [ ] Prices calculate correctly
- [ ] Discounts work (if applicable)
- [ ] Taxes calculate correctly
- [ ] Order can be confirmed
- [ ] Invoices can be created from orders
- [ ] Delivery addresses work correctly
- [ ] Other custom fields/functions work

---

## Performance Testing

### Check for Performance Impact
- [ ] Order creation is fast (no noticeable delay)
- [ ] Order updates are fast
- [ ] Large orders (10+ lines) work correctly
- [ ] No errors in Odoo logs related to these changes

**Check Odoo Logs:**
```bash
# Check for errors (adjust log path based on your setup)
tail -f /var/log/odoo/odoo.log | grep -i error

# Or if using different log location
tail -f /path/to/odoo.log
```

---

## Browser/Environment Testing

Test in different environments:
- [ ] Chrome/Chromium
- [ ] Firefox
- [ ] Safari (if on Mac)
- [ ] Mobile view (responsive)
- [ ] Different user roles (Sales User, Manager, etc.)

---

## Rollback Plan (if issues found)

If critical issues are found:

1. **Revert Code Changes:**
   ```bash
   cd /home/dell/Desktop/Projects/Odoo-final
   git checkout HEAD~1 custom_bayani_cr/models/sale_order.py
   # Or restore from backup
   ```

2. **Upgrade Module Again:**
   - Go to Apps → Find module → Upgrade

3. **Clear Cache:**
   - Restart Odoo
   - Clear browser cache

---

## Test Sign-off

**Tester Name:** _________________

**Date:** _________________

**Environment:** [ ] Development [ ] Production

**Overall Status:** [ ] Pass [ ] Fail [ ] Pass with Issues

**Comments:**
_________________________________________________
_________________________________________________
_________________________________________________

---

## Quick Reference: What Changed

### Change 1: SO2366 - Delivery Fees Removal
**Files Modified:** `custom_bayani_cr/models/sale_order.py`
- `_create_delivery_line()` - Returns empty recordset (no delivery line created)
- `set_delivery_line()` - Removes existing delivery lines, doesn't create new ones
- `write()` - Removes delivery lines after any order update

### Change 2: Options Feature Removal
**Files Modified:** `custom_bayani_cr/models/sale_order.py`
- `_compute_name()` in `SaleOrderLine` - Filters out lines starting with "Option:" from product descriptions

---

## Support Contacts

If issues are found, document:
- Error messages
- Steps to reproduce
- Screenshots
- Odoo log entries
- Browser console errors (F12 → Console)

---

**Last Updated:** [Date]
**Version:** 1.0

