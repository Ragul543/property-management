# -*- coding: utf-8 -*-
{
    'name': 'Botwhatsapp',
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
        'security/whatsapp_security.xml',
        'security/ir.model.access.csv',
        'data/whatsapp_config_data.xml',
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
            'whatsappbot/static/src/scss/whatsapp_discuss.scss',
            'whatsappbot/static/src/components/**/*.js',
            'whatsappbot/static/src/components/**/*.xml',
        ],
    },
    'installable': True,
    'application': True,
    'auto_install': False,
}
