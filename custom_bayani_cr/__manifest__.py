{
    'name': 'Hide Price, Add To Cart Button, Quantity From website',
    'category': 'eCommerce',
    'summary': 'Hide the price, Add TO Cart Button and Quantity of the product if user is not login',
    'version': '18.0.1.0',
    'website': "https://www.candidroot.com/",
    'author': "Candidroot Solutions Pvt. Ltd.",
    'description': """This module helps to Hide the price,Cart Button and quantity of the product if user is not login.""",
    'sequence': 8,
    'depends': ['website_sale', 'website_sale_wishlist', 'product_expiry', 'stock', 'website', 'sale'],
    'data': [
        'data/contact_tag.xml',
        'views/product_category.xml',
        'views/website_template_inherit.xml',
        'views/res_config_view.xml',
        'views/web_client_template.xml',
        'views/website_page.xml',
        'views/website_thankyou_page.xml',
        'views/website_menu.xml',
        'views/report_layout_extend.xml',
        'views/report_extend.xml',
    ],
    'assets': {
        'web.assets_frontend': [
            'custom_bayani_cr/static/src/scss/product_page.scss',
            'custom_bayani_cr/static/src/js/custom_qty_selection.js',
        ],
    },
    'license': 'LGPL-3',
    'installable': True,
    'auto_install': False,
    'application': True,
}
# -*- coding: utf-8 -*-
