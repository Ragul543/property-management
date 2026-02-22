# -*- coding: utf-8 -*-
{
    'name': 'Whatsapp Bot',
    'version': '17.0.1.0.0',
    'category': 'Sales/CRM',
    'summary': 'Send and receive WhatsApp messages from Odoo',
    'description': '''
WhatsApp Integration for Odoo
=============================
Features:
- Send WhatsApp messages from contacts
- Receive incoming messages via webhook
- Message history and logging
- Partner integration
- Media support (images, documents, videos)
- Discuss-like chat interface
    ''',
    'author': 'NARMATHA S',
    'license': 'LGPL-3',
    'depends': ['base', 'contacts', 'mail', 'hr', 'bus', 'web'],
    'data': [
        'security/whatsapp_securitys.xml',
        'security/ir.model.access.csv',
        'views/whatsapp_configs_views.xml',
        'views/whatsapp_messages_views.xml',
        'views/whatsapp_conversations_views.xml',
        'views/res_partners_views.xml',
        'views/hr_employees_views.xml',
        'wizards/send_whatsapps_wizard_views.xml',
        'wizards/qr_codes_wizard_views.xml',
        'views/menus.xml',
    ],
    'assets': {
       'web.assets_backend': [
           'whatsappbot/static/src/scss/whatsapps_discuss.scss',
           'whatsappbot/static/src/components/whatsapp_discuss.js',
           'whatsappbot/static/src/components/whatsapp_discuss.xml',
       ],
   },


    'installable': True,
    'application': True,
    'auto_install': False,
}
