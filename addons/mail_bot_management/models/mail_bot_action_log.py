# -*- coding: utf-8 -*-
from odoo import models, fields, api


class MailBotActionLog(models.Model):
    _name = 'mail.bot.action.log'
    _description = 'Mail Bot Action Log'
    _order = 'create_date desc'
    _rec_name = 'display_name'

    # Source information
    inbox_id = fields.Many2one('mail.bot.inbox', string='Source Email', ondelete='set null')
    bot_address_id = fields.Many2one('mail.bot.address', string='Bot Address', required=True)
    command_id = fields.Many2one('mail.bot.command', string='Command Executed')

    # Sender info
    sender_email = fields.Char(string='Sender Email', required=True, index=True)
    sender_name = fields.Char(string='Sender Name')

    # Action details
    action_type = fields.Selection([
        ('create_lead', 'Create Lead'),
        ('create_contact', 'Create Contact'),
        ('create_task', 'Create Task'),
        ('unknown_command', 'Unknown Command'),
        ('access_denied', 'Access Denied'),
        ('error', 'Error'),
    ], string='Action Type', required=True, index=True)

    # Result tracking
    state = fields.Selection([
        ('success', 'Success'),
        ('failed', 'Failed'),
        ('pending', 'Pending'),
    ], string='Status', default='pending', required=True)

    # Created record reference (generic)
    res_model = fields.Char(string='Result Model')
    res_id = fields.Integer(string='Result Record ID')

    # Details
    raw_command = fields.Text(string='Raw Email Content')
    parsed_data = fields.Text(string='Parsed Data (JSON)')
    error_message = fields.Text(string='Error Message')

    # Response
    response_sent = fields.Boolean(string='Response Sent', default=False)
    response_email_id = fields.Many2one('mail.bot.sent', string='Response Email')

    # Timestamps
    processed_date = fields.Datetime(string='Processed Date', default=fields.Datetime.now)

    user_id = fields.Many2one('res.users', string='Processing User', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    display_name = fields.Char(string='Display Name', compute='_compute_display_name', store=True)

    @api.depends('action_type', 'sender_email', 'processed_date')
    def _compute_display_name(self):
        for record in self:
            action_label = dict(self._fields['action_type'].selection).get(record.action_type, record.action_type)
            date_str = record.processed_date.strftime('%Y-%m-%d %H:%M') if record.processed_date else ''
            record.display_name = f"{action_label} - {record.sender_email} - {date_str}"

    def action_view_created_record(self):
        """Open the created record"""
        self.ensure_one()
        if self.res_model and self.res_id:
            return {
                'type': 'ir.actions.act_window',
                'res_model': self.res_model,
                'res_id': self.res_id,
                'view_mode': 'form',
                'target': 'current',
            }
