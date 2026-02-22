
from odoo import models, fields, api

class MailBotSent(models.Model):
    _name = 'mail.bot.sent'
    _description = 'Mail Bot Sent Items'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'sent_date desc'
    _rec_name = 'subject'

    subject = fields.Char(string='Subject', required=True)
    recipient_name = fields.Char(string='To')
    recipient_email = fields.Char(string='Recipient Email', required=True)
    cc_emails = fields.Char(string='CC')
    bcc_emails = fields.Char(string='BCC')
    body = fields.Html(string='Body', sanitize=False)
    sent_date = fields.Datetime(string='Sent Date', default=fields.Datetime.now, required=True)
    
    state = fields.Selection([
        ('sent', 'Sent'),
        ('delivered', 'Delivered'),
        ('failed', 'Failed'),
        ('bounced', 'Bounced')
    ], string='Status', default='sent', tracking=True)
    
    is_starred = fields.Boolean(string='Starred', default=False)
    has_attachments = fields.Boolean(string='Has Attachments', compute='_compute_has_attachments', store=True)
    attachment_ids = fields.Many2many('ir.attachment', 'mail_bot_sent_attachment_rel',
                                       'sent_id', 'attachment_id', string='Attachments')
    
    message_id = fields.Char(string='Message ID', index=True)
    in_reply_to = fields.Char(string='In Reply To')
    
    user_id = fields.Many2one('res.users', string='Sent By', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    # Computed fields for client action
    display_name = fields.Char(string='Display Name', compute='_compute_display_fields', store=False)
    display_email = fields.Char(string='Display Email', compute='_compute_display_fields', store=False)
    display_date = fields.Datetime(string='Display Date', compute='_compute_display_fields', store=False)

    @api.depends('recipient_name', 'recipient_email', 'sent_date')
    def _compute_display_fields(self):
        for record in self:
            record.display_name = record.recipient_name or record.recipient_email or 'Unknown'
            record.display_email = record.recipient_email or ''
            record.display_date = record.sent_date

    @api.depends('attachment_ids')
    def _compute_has_attachments(self):
        for record in self:
            record.has_attachments = bool(record.attachment_ids)
    
    def action_move_to_trash(self):
        """Move selected messages to trash folder - supports bulk operation"""
        for record in self.sudo():
            trash_vals = {
                'subject': record.subject,
                'sender_name': record.user_id.name,
                'sender_email': record.user_id.email,
                'recipient_email': record.recipient_email,
                'body': record.body,
                'original_folder': 'sent',
                'deleted_date': fields.Datetime.now(),
            }
            self.env['mail.bot.trash'].sudo().create(trash_vals)
        self.sudo().unlink()
        return True

    def action_mark_as_spam(self):
        """Move selected messages to spam folder - supports bulk operation"""
        for record in self:
            spam_vals = {
                'subject': record.subject,
                'sender_name': record.user_id.name,
                'sender_email': record.user_id.email,
                'recipient_email': record.recipient_email,
                'body': record.body,
                'received_date': record.sent_date,
            }
            self.env['mail.bot.spam'].create(spam_vals)
        self.unlink()
        return True
