from odoo import models, fields, api

class MailBotSpam(models.Model):
    _name = 'mail.bot.spam'
    _description = 'Mail Bot Spam'
    _order = 'received_date desc'
    _rec_name = 'subject'

    subject = fields.Char(string='Subject', required=True)
    sender_name = fields.Char(string='From')
    sender_email = fields.Char(string='Sender Email', required=True)
    recipient_email = fields.Char(string='To')
    body = fields.Html(string='Body', sanitize=False)
    received_date = fields.Datetime(string='Received Date', default=fields.Datetime.now)

    spam_score = fields.Float(string='Spam Score', default=0.0)
    spam_reason = fields.Text(string='Spam Reason')

    attachment_ids = fields.Many2many('ir.attachment', 'mail_bot_spam_attachment_rel',
                                       'spam_id', 'attachment_id', string='Attachments')

    message_id = fields.Char(string='Message ID', index=True)
    user_id = fields.Many2one('res.users', string='User', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    # Fields for client action compatibility
    is_starred = fields.Boolean(string='Starred', default=False)
    state = fields.Selection([
        ('spam', 'Spam'),
    ], string='Status', default='spam')

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
    
    def action_not_spam(self):
        """Move selected messages back to inbox - supports bulk operation"""
        for record in self:
            inbox_vals = {
                'subject': record.subject,
                'sender_name': record.sender_name,
                'sender_email': record.sender_email,
                'recipient_email': record.recipient_email,
                'body': record.body,
                'received_date': record.received_date,
                'state': 'unread',
                'attachment_ids': [(6, 0, record.attachment_ids.ids)]
            }
            self.env['mail.bot.inbox'].create(inbox_vals)
        self.unlink()
        return True

    def action_delete_permanently(self):
        """Permanently delete selected messages - supports bulk operation"""
        self.unlink()
        return True

    def action_move_to_trash(self):
        """Move selected messages to trash folder - supports bulk operation"""
        for record in self:
            trash_vals = {
                'subject': record.subject,
                'sender_name': record.sender_name,
                'sender_email': record.sender_email,
                'recipient_email': record.recipient_email,
                'body': record.body,
                'original_folder': 'spam',
                'deleted_date': fields.Datetime.now(),
                'message_id': record.message_id,
            }
            self.env['mail.bot.trash'].create(trash_vals)
        self.unlink()
        return True