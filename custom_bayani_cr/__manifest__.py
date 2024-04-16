# -*- coding: utf-8 -*-
{
    'name': 'Hide Price, Add To Cart Button, Quantity From website',
    'category': 'eCommerce',
    'summary': 'Hide the price, Add TO Cart Button and Quantity of the product if user is not login',
    'version': '17.0.1.0',
    'website': "https://www.candidroot.com/",
    'author': "Candidroot Solutions Pvt. Ltd.",
    'description': """This module helps to Hide the price,Cart Button and quantity of the product if user is not login.""",
    'sequence': 8,
    'depends': ['website_sale','website_sale_wishlist','product_expiry','stock'],
    'data': [
        'views/website_template_inherit.xml',
        'views/res_config_view.xml',
        'views/web_client_template.xml',
    ],
    'license': 'LGPL-3',
    'installable': True,
    'auto_install': False,
    'application': True,
}
