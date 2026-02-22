# -*- coding: utf-8 -*-
from odoo import models, fields, api, _


class MailBotCommand(models.Model):
    _name = 'mail.bot.command'
    _description = 'Mail Bot Command Definition'
    _order = 'sequence, name'

    name = fields.Char(string='Command Name', required=True)
    sequence = fields.Integer(string='Sequence', default=10)
    active = fields.Boolean(string='Active', default=True)

    # Command identification
    code = fields.Char(string='Command Code', required=True,
                       help='Internal code (e.g., create_lead, create_contact, create_task)')
    keywords = fields.Text(string='Keywords', required=True,
                           help='Comma-separated keywords that trigger this command (e.g., create lead, new lead, add lead)')

    # Target model
    target_model = fields.Selection([
        ('mail.bot.lead', 'Lead/Opportunity'),
        ('res.partner', 'Contact'),
        ('mail.bot.task', 'Task'),
    ], string='Target Model', required=True)

    # Response templates
    success_template = fields.Html(string='Success Response Template',
                                   default='<p>Command executed successfully!</p>')
    error_template = fields.Html(string='Error Response Template',
                                 default='<p>An error occurred while processing your request.</p>')

    description = fields.Text(string='Description', help='Help text shown to users')

    user_id = fields.Many2one('res.users', string='Created By', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    _sql_constraints = [
        ('code_uniq', 'unique(code, company_id)', 'Command code must be unique per company!')
    ]

    def get_keywords_list(self):
        """Return list of keywords for this command"""
        self.ensure_one()
        if not self.keywords:
            return []
        return [k.strip().lower() for k in self.keywords.split(',') if k.strip()]
