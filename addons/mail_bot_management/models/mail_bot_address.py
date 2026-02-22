# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
from odoo.exceptions import ValidationError


class MailBotAddress(models.Model):
    _name = 'mail.bot.address'
    _description = 'Mail Bot Email Address'
    _order = 'name'
    _rec_name = 'email'

    name = fields.Char(string='Bot Name', required=True, help='Friendly name for this bot')
    email = fields.Char(string='Bot Email Address', required=True, index=True,
                        help='Email address that triggers bot processing')
    active = fields.Boolean(string='Active', default=True)

    # Link to servers
    server_id = fields.Many2one('mail.bot.server', string='Incoming Server',
                                help='Server that receives emails for this bot')
    outgoing_server_id = fields.Many2one('mail.bot.outgoing.server',
                                         string='Outgoing Server',
                                         help='Server to send response emails')

    # Bot configuration
    auto_reply = fields.Boolean(string='Auto Reply', default=True,
                                help='Send confirmation email after processing command')
    log_actions = fields.Boolean(string='Log Actions', default=True,
                                 help='Log all bot actions for auditing')

    # Command restriction
    command_ids = fields.Many2many('mail.bot.command', string='Allowed Commands',
                                   help='Leave empty to allow all commands')

    # Access control
    allowed_sender_domains = fields.Text(string='Allowed Sender Domains',
                                         help='Comma-separated list of allowed domains (e.g., company.com,partner.com). Leave empty to allow all.')
    allowed_user_ids = fields.Many2many('res.users', string='Allowed Users',
                                        help='Users allowed to send commands. Leave empty to allow all.')

    user_id = fields.Many2one('res.users', string='Owner', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    # Statistics
    action_count = fields.Integer(string='Actions', compute='_compute_action_count')

    _sql_constraints = [
        ('email_uniq', 'unique(email)', 'Bot email address must be unique!')
    ]

    @api.constrains('email')
    def _check_email(self):
        for record in self:
            if record.email and '@' not in record.email:
                raise ValidationError(_('Please enter a valid email address.'))

    @api.depends()
    def _compute_action_count(self):
        for record in self:
            record.action_count = self.env['mail.bot.action.log'].search_count([
                ('bot_address_id', '=', record.id)
            ])

    def _is_sender_allowed(self, sender_email):
        """Check if sender is allowed to use this bot"""
        self.ensure_one()

        # Check domain restriction
        if self.allowed_sender_domains:
            domains = [d.strip().lower() for d in self.allowed_sender_domains.split(',') if d.strip()]
            sender_domain = sender_email.lower().split('@')[-1] if '@' in sender_email else ''
            if domains and sender_domain not in domains:
                return False

        # Check user restriction
        if self.allowed_user_ids:
            user = self.env['res.users'].search([('email', '=ilike', sender_email)], limit=1)
            if not user or user not in self.allowed_user_ids:
                return False

        return True

    def action_view_action_logs(self):
        """View action logs for this bot"""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Bot Action Logs'),
            'res_model': 'mail.bot.action.log',
            'view_mode': 'tree,form',
            'domain': [('bot_address_id', '=', self.id)],
            'context': {'default_bot_address_id': self.id},
        }
