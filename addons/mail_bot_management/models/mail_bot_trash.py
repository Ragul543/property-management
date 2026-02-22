from odoo import models, fields, api
from dateutil.relativedelta import relativedelta

class MailBotTrash(models.Model):
    _name = 'mail.bot.trash'
    _description = 'Mail Bot Trash'
    _order = 'deleted_date desc'
    _rec_name = 'subject'

    subject = fields.Char(string='Subject', required=True)
    sender_name = fields.Char(string='From')
    sender_email = fields.Char(string='Sender Email')
    recipient_email = fields.Char(string='To')
    body = fields.Html(string='Body', sanitize=False)
    deleted_date = fields.Datetime(string='Deleted Date', default=fields.Datetime.now)
    original_folder = fields.Selection([
        ('inbox', 'Inbox'),
        ('sent', 'Sent'),
        ('draft', 'Draft'),
        ('spam', 'Spam')
    ], string='Original Folder', required=True)
    
    message_id = fields.Char(string='Message ID')
    user_id = fields.Many2one('res.users', string='User', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    # Fields for client action compatibility
    is_starred = fields.Boolean(string='Starred', default=False)
    state = fields.Selection([
        ('deleted', 'Deleted'),
    ], string='Status', default='deleted')

    # Computed fields for client action
    display_name = fields.Char(string='Display Name', compute='_compute_display_fields', store=False)
    display_email = fields.Char(string='Display Email', compute='_compute_display_fields', store=False)
    display_date = fields.Datetime(string='Display Date', compute='_compute_display_fields', store=False)

    @api.depends('sender_name', 'sender_email', 'deleted_date')
    def _compute_display_fields(self):
        for record in self:
            record.display_name = record.sender_name or record.recipient_email or 'Unknown'
            record.display_email = record.sender_email or record.recipient_email or ''
            record.display_date = record.deleted_date

    def action_restore(self):
        """Restore message to its original folder"""
        for record in self:
            if record.original_folder == 'inbox':
                restore_vals = {
                    'subject': record.subject or '(No Subject)',
                    'sender_name': record.sender_name or 'Unknown',
                    'sender_email': record.sender_email or '',
                    'recipient_email': record.recipient_email or '',
                    'body': record.body,
                    'state': 'read',
                    'message_id': record.message_id,
                }
                self.env['mail.bot.inbox'].create(restore_vals)
            elif record.original_folder == 'sent':
                restore_vals = {
                    'subject': record.subject or '(No Subject)',
                    'recipient_email': record.recipient_email or '',
                    'body': record.body,
                }
                self.env['mail.bot.sent'].create(restore_vals)
            elif record.original_folder == 'draft':
                restore_vals = {
                    'subject': record.subject,
                    'recipient_email': record.recipient_email or '',
                    'body': record.body,
                }
                self.env['mail.bot.draft'].create(restore_vals)
            elif record.original_folder == 'spam':
                restore_vals = {
                    'subject': record.subject or '(No Subject)',
                    'sender_name': record.sender_name or 'Unknown',
                    'sender_email': record.sender_email or '',
                    'recipient_email': record.recipient_email or '',
                    'body': record.body,
                }
                self.env['mail.bot.spam'].create(restore_vals)

            record.unlink()

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'message': 'Message restored successfully!',
                'type': 'success',
                'sticky': False,
            }
        }
    
    def action_delete_permanently(self):
        self.unlink()
        return True
    
    @api.model
    def _cron_empty_trash(self):
        thirty_days_ago = fields.Datetime.now() - relativedelta(days=30)
        old_trash = self.search([('deleted_date', '<', thirty_days_ago)])
        old_trash.unlink()
        return True