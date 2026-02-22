# -*- coding: utf-8 -*-
{
    'name': 'Mail Bot Management',
    'version': '17.0.1.0.0',
    'category': 'Productivity/Mail',
    'summary': 'Custom Mail Bot Management System with Inbox, Sent, Draft, Spam',
    'description': '''
Advanced Mail Bot Management System
====================================
Features:
- Custom Inbox with read/unread status
- Sent Items tracking and delivery status
- Draft messages with compose functionality
- Spam detection and management
- Trash/Archive with restore capability
- Email threading and conversation view
- Attachment support (images, documents, PDFs)
- Email starring and flagging
- Priority levels (Normal, Low, High, Urgent)
- Activity tracking and chatter integration
- Advanced search and filtering
- Multi-company support
- Automated trash cleanup (30 days)
- Email templates
- Reply and forward functionality
- User and Manager access levels
    ''',
    'author': 'NARMATHA',
    'license': 'LGPL-3',
    'depends': [
        'base',
        'mail',
        'web',
    ],
    'data': [
        'security/mail_bot_security.xml',
        'security/ir.model.access.csv',
        'data/mail_bot_data.xml',
        'data/mail_bot_sample_data.xml',
        'views/mail_bot_inbox_views.xml',
        'views/mail_bot_sent_views.xml',
        'views/mail_bot_draft_views.xml',
        'views/mail_bot_spam_views.xml',
        'views/mail_bot_trash_views.xml',
        'views/mail_bot_config_views.xml',
        'views/mail_bot_client_action.xml',
        'views/mail_bot_address_views.xml',
        'views/mail_bot_command_views.xml',
        'views/mail_bot_action_log_views.xml',
        'views/mail_bot_lead_views.xml',
        'views/mail_bot_task_views.xml',
        'views/mail_bot_menu.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'mail_bot_management/static/src/css/mail_bot.css',
            'mail_bot_management/static/src/js/mail_bot_client_action.js',
            'mail_bot_management/static/src/xml/mail_bot_client_action.xml',
        ],
    },
    'images': ['static/description/banner.png'],
    'installable': True,
    'application': True,
    'auto_install': False,
}
