# -*- coding: utf-8 -*-
{
    'name': 'WhatsApp Connector demo',
    'version': '17.0.2.0.0',
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
    'author': 'GEORGE MARIYA NISHANTHINI J',
    'license': 'LGPL-3',
    'depends': ['base', 'contacts', 'mail', 'hr', 'bus', 'web'],
    'data': [
        'security/whatsapp_security.xml',
        'security/ir.model.access.csv',
        'views/whatsapp_config_views.xml',
        'views/whatsapp_message_views.xml',
        'views/whatsapp_conversation_views.xml',
        'views/res_partner_views.xml',
        'views/hr_employee_views.xml',
        'wizards/send_whatsapp_wizard_views.xml',
        'wizards/qr_code_wizard_views.xml',
        'views/menu.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'whatsappbot_new/static/src/scss/whatsapp_discuss.scss',
            'whatsappbot_new/static/src/components/whatsapp_discuss.js',
            'whatsappbot_new/static/src/components/whatsapp_discuss.xml',
        ],
    },
    'installable': True,
    'application': True,
    'auto_install': False,
}
