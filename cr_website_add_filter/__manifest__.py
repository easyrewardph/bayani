# __manifest__.py
{
    'name': 'Website Add Filter',
    'version': '18.0.0.1',
    'summary': 'Website add Filter in IN_stock and out_stock',
    'author': 'candidroot',
    'category': 'website',
    'depends': ['base','website','sale','stock','website_sale'],
    'data': [
        'views/stock_temmplate.xml'
    ],

    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}
