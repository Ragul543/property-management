from odoo import models, fields, api, _
from odoo.exceptions import ValidationError

class MailBotInbox(models.Model):
    _name = 'mail.bot.inbox'
    _description = 'Mail Bot Inbox'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'received_date desc'
    _rec_name = 'subject'

    subject = fields.Char(string='Subject', required=True, tracking=True)
    sender_name = fields.Char(string='From', required=True)
    sender_email = fields.Char(string='Sender Email', required=True)
    recipient_email = fields.Char(string='To', required=True)
    cc_emails = fields.Char(string='CC')
    bcc_emails = fields.Char(string='BCC')
    body = fields.Html(string='Body', sanitize=False)
    body_text = fields.Text(string='Body Plain Text')
    received_date = fields.Datetime(string='Received Date', default=fields.Datetime.now, required=True)
    
    state = fields.Selection([
        ('unread', 'Unread'),
        ('read', 'Read'),
        ('flagged', 'Flagged'),
        ('snoozed', 'Snoozed'),
        ('archived', 'Archived')
    ], string='Status', default='unread', tracking=True)

    snooze_date = fields.Datetime(string='Snooze Until')
    
    priority = fields.Selection([
        ('0', 'Normal'),
        ('1', 'Low'),
        ('2', 'High'),
        ('3', 'Urgent')
    ], string='Priority', default='0')
    
    is_spam = fields.Boolean(string='Is Spam', default=False)
    is_starred = fields.Boolean(string='Starred', default=False)
    is_important = fields.Boolean(string='Important', default=False)
    has_attachments = fields.Boolean(string='Has Attachments', compute='_compute_has_attachments', store=True)
    attachment_ids = fields.Many2many('ir.attachment', 'mail_bot_inbox_attachment_rel', 
                                       'inbox_id', 'attachment_id', string='Attachments')
    attachment_count = fields.Integer(string='Attachment Count', compute='_compute_attachment_count')
    
    message_id = fields.Char(string='Message ID', index=True)
    in_reply_to = fields.Char(string='In Reply To')
    references = fields.Text(string='References')
    
    thread_id = fields.Many2one('mail.bot.thread', string='Thread')
    user_id = fields.Many2one('res.users', string='Assigned To', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)
    
    tag_ids = fields.Many2many('mail.bot.tag', string='Tags')

    # Computed fields for client action
    display_name = fields.Char(string='Display Name', compute='_compute_display_fields', store=False)
    display_email = fields.Char(string='Display Email', compute='_compute_display_fields', store=False)
    display_date = fields.Datetime(string='Display Date', compute='_compute_display_fields', store=False)

    @api.depends('sender_name', 'sender_email', 'received_date')
    def _compute_display_fields(self):
        for record in self:
            record.display_name = record.sender_name or 'Unknown'
            record.display_email = record.sender_email or ''
            record.display_date = record.received_date

    @api.depends('attachment_ids')
    def _compute_has_attachments(self):
        for record in self:
            record.has_attachments = bool(record.attachment_ids)
    
    @api.depends('attachment_ids')
    def _compute_attachment_count(self):
        for record in self:
            record.attachment_count = len(record.attachment_ids)
    
    def action_mark_as_read(self):
        self.write({'state': 'read'})
        return True
    
    def action_mark_as_unread(self):
        self.write({'state': 'unread'})
        return True
    
    def action_mark_as_spam(self):
        """Move selected messages to spam folder - supports bulk operation"""
        for record in self:
            spam_vals = {
                'subject': record.subject,
                'sender_name': record.sender_name,
                'sender_email': record.sender_email,
                'recipient_email': record.recipient_email,
                'body': record.body,
                'received_date': record.received_date,
                'message_id': record.message_id,
                'attachment_ids': [(6, 0, record.attachment_ids.ids)]
            }
            self.env['mail.bot.spam'].create(spam_vals)
        self.unlink()
        return True

    def action_move_to_trash(self):
        """Move selected messages to trash folder - supports bulk operation"""
        for record in self.sudo():
            trash_vals = {
                'subject': record.subject,
                'sender_name': record.sender_name,
                'sender_email': record.sender_email,
                'recipient_email': record.recipient_email,
                'body': record.body,
                'original_folder': 'inbox',
                'deleted_date': fields.Datetime.now(),
                'message_id': record.message_id,
            }
            self.env['mail.bot.trash'].sudo().create(trash_vals)
        self.sudo().unlink()
        return True
    
    def action_reply(self):
        return {
            'type': 'ir.actions.act_window',
            'name': 'Reply',
            'res_model': 'mail.bot.draft',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_recipient_email': self.sender_email,
                'default_subject': f"Re: {self.subject}",
                'default_in_reply_to': self.message_id,
            }
        }
    
    def action_toggle_star(self):
        self.is_starred = not self.is_starred
        return True

    def action_archive(self):
        """Archive the message - move to All Mail"""
        self.write({'state': 'archived'})
        return True

    def action_unarchive(self):
        """Unarchive the message - move back to Inbox"""
        self.write({'state': 'read'})
        return True
