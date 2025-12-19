#!/usr/bin/env python3
import re
"""
Script to clean existing sale orders from:
1. Delivery lines (is_delivery = True)
2. Option lines in product descriptions

Run this in Odoo shell:
    odoo-bin shell -d your_database_name < clean_existing_orders.py
    
Or copy-paste the code below into Odoo shell.
"""

# Get all sale orders
orders = env['sale.order'].search([])
print(f"Found {len(orders)} sale orders to process...")

cleaned_orders = 0
cleaned_lines = 0
removed_delivery_lines = 0

for order in orders:
    order_modified = False
    
    # Remove delivery lines
    delivery_lines = order.order_line.filtered(lambda l: l.is_delivery)
    if delivery_lines:
        removed_delivery_lines += len(delivery_lines)
        delivery_lines.unlink()
        order_modified = True
    
    # Clean option lines from descriptions
    for line in order.order_line:
        if line.name and re.search(r'Option(\s+for)?\s*:', line.name, re.IGNORECASE):
            lines = line.name.split('\n')
            filtered_lines = [
                l for l in lines 
                if not re.match(r'^\s*Option(\s+for)?\s*:', l, re.IGNORECASE)
            ]
            new_name = '\n'.join(filtered_lines)
            if new_name != line.name:
                line.name = new_name
                cleaned_lines += 1
                order_modified = True
    
    if order_modified:
        cleaned_orders += 1
        print(f"Cleaned order: {order.name}")

print(f"\nSummary:")
print(f"  - Orders cleaned: {cleaned_orders}")
print(f"  - Lines with options removed: {cleaned_lines}")
print(f"  - Delivery lines removed: {removed_delivery_lines}")
print("Done!")

