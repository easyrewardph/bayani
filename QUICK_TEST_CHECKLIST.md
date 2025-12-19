# Quick Test Checklist

## Pre-Testing
- [ ] Module upgraded in Odoo (Apps → Upgrade)
- [ ] Odoo service restarted
- [ ] Browser cache cleared

---

## Test 1: Delivery Fees Removal (SO2366)

### Quick Test (5 minutes)
- [ ] Create new quotation → Add products → Select carrier → Save
  - ✅ No delivery line appears
  - ✅ Total doesn't include delivery fees
- [ ] Change carrier on existing order → Save
  - ✅ No delivery line created
- [ ] Confirm order with carrier selected
  - ✅ No delivery line in confirmed order

**Status:** [ ] PASS [ ] FAIL

---

## Test 2: Options Feature Removal

### Quick Test (5 minutes)
- [ ] Create quotation with products that have options
  - ✅ Description shows NO "Option:" lines
- [ ] View quotation PDF/report
  - ✅ PDF shows NO "Option:" lines
- [ ] Confirm order
  - ✅ Confirmed order shows NO "Option:" lines

**Status:** [ ] PASS [ ] FAIL

---

## Combined Test
- [ ] Create order with both: products (with options) + carrier
  - ✅ No delivery line
  - ✅ No "Option:" in descriptions
  - ✅ Order saves/confirms correctly

**Status:** [ ] PASS [ ] FAIL

---

## Issues Found
[List any issues here]

---

**Tester:** _______________  
**Date:** _______________  
**Environment:** Dev / Prod

