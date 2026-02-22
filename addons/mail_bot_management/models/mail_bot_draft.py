import logging
from odoo import models, fields, api, _
from odoo.exceptions import ValidationError, UserError

_logger = logging.getLogger(__name__)

class MailBotDraft(models.Model):
    _name = 'mail.bot.draft'
    _description = 'Mail Bot Drafts'
    _inherit = ['mail.thread']
    _order = 'write_date desc'
    _rec_name = 'subject'

    subject = fields.Char(string='Subject')
    recipient_email = fields.Char(string='To')
    cc_emails = fields.Char(string='CC')
    bcc_emails = fields.Char(string='BCC')
    body = fields.Html(string='Body', sanitize=False)

    attachment_ids = fields.Many2many('ir.attachment', 'mail_bot_draft_attachment_rel',
                                       'draft_id', 'attachment_id', string='Attachments')

    in_reply_to = fields.Char(string='In Reply To')
    scheduled_date = fields.Datetime(string='Scheduled Send Date')

    user_id = fields.Many2one('res.users', string='Owner', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    # Fields for client action compatibility
    is_starred = fields.Boolean(string='Starred', default=False)
    state = fields.Selection([
        ('draft', 'Draft'),
    ], string='Status', default='draft')

    # Computed fields for client action
    display_name = fields.Char(string='Display Name', compute='_compute_display_fields', store=False)
    display_email = fields.Char(string='Display Email', compute='_compute_display_fields', store=False)
    display_date = fields.Datetime(string='Display Date', compute='_compute_display_fields', store=False)

    @api.depends('recipient_email', 'write_date')
    def _compute_display_fields(self):
        for record in self:
            record.display_name = record.recipient_email or 'Draft'
            record.display_email = record.recipient_email or ''
            record.display_date = record.write_date

    def action_send(self):
        import smtplib
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText
        from email.mime.base import MIMEBase
        from email import encoders
        import base64

        self.ensure_one()

        if not self.recipient_email:
            raise ValidationError(_('Recipient email is required.'))

        # Get custom outgoing mail server first
        outgoing_server = self.env['mail.bot.outgoing.server'].search([
            ('user_id', '=', self.env.user.id),
            ('active', '=', True),
            ('state', '=', 'connected')
        ], limit=1)

        if not outgoing_server:
            outgoing_server = self.env['mail.bot.outgoing.server'].search([
                ('active', '=', True),
                ('state', '=', 'connected')
            ], limit=1)

        # Fallback to Odoo's built-in mail server
        odoo_mail_server = None
        if not outgoing_server:
            odoo_mail_server = self.env['ir.mail_server'].sudo().search([
                ('active', '=', True)
            ], limit=1)

        if not outgoing_server and not odoo_mail_server:
            raise UserError(_('No configured outgoing mail server found. Please configure SMTP settings in Settings > Technical > Outgoing Mail Servers, or configure a Mail Bot Outgoing Server.'))

        # Prepare email values
        subject = self.subject or '(No Subject)'
        email_to = self.recipient_email
        email_cc = self.cc_emails or ''
        email_bcc = self.bcc_emails or ''
        body_html = self.body or ''

        send_state = 'failed'
        message_id = ''
        error_message = None

        try:
            if outgoing_server:
                # Use custom SMTP server directly
                email_from = outgoing_server.email_from or self.env.user.email

                # Create MIME message
                msg = MIMEMultipart('alternative')
                msg['Subject'] = subject
                msg['From'] = email_from
                msg['To'] = email_to
                if email_cc:
                    msg['Cc'] = email_cc

                # Add HTML body
                html_part = MIMEText(body_html, 'html', 'utf-8')
                msg.attach(html_part)

                # Add attachments
                if self.attachment_ids:
                    for attachment in self.attachment_ids:
                        part = MIMEBase('application', 'octet-stream')
                        part.set_payload(base64.b64decode(attachment.datas))
                        encoders.encode_base64(part)
                        part.add_header('Content-Disposition', f'attachment; filename="{attachment.name}"')
                        msg.attach(part)

                # Build recipient list
                recipients = [email_to]
                if email_cc:
                    recipients.extend([e.strip() for e in email_cc.split(',') if e.strip()])
                if email_bcc:
                    recipients.extend([e.strip() for e in email_bcc.split(',') if e.strip()])

                # Connect and send
                if outgoing_server.smtp_encryption == 'ssl':
                    smtp = smtplib.SMTP_SSL(outgoing_server.smtp_host, outgoing_server.smtp_port, timeout=30)
                else:
                    smtp = smtplib.SMTP(outgoing_server.smtp_host, outgoing_server.smtp_port, timeout=30)

                smtp.ehlo()

                if outgoing_server.smtp_encryption == 'starttls':
                    smtp.starttls()
                    smtp.ehlo()

                smtp.login(outgoing_server.smtp_user, outgoing_server.smtp_pass)
                smtp.sendmail(email_from, recipients, msg.as_string())
                smtp.quit()

                send_state = 'sent'
                message_id = msg.get('Message-ID', '')
                _logger.info('Email sent successfully via custom SMTP to %s', email_to)

            else:
                # Use Odoo's built-in mail server
                email_from = odoo_mail_server.smtp_user or self.env.user.email

                mail_values = {
                    'subject': subject,
                    'email_from': email_from,
                    'email_to': email_to,
                    'email_cc': email_cc,
                    'body_html': body_html,
                    'auto_delete': False,
                }

                mail = self.env['mail.mail'].sudo().create(mail_values)

                if self.attachment_ids:
                    mail.write({'attachment_ids': [(6, 0, self.attachment_ids.ids)]})

                mail.send()
                send_state = 'sent' if mail.state == 'sent' else 'failed'
                message_id = mail.message_id or ''

        except smtplib.SMTPAuthenticationError as e:
            _logger.error('SMTP authentication failed: %s', str(e))
            send_state = 'failed'
            error_message = _('SMTP authentication failed. Please check your username and password.')

        except smtplib.SMTPRecipientsRefused as e:
            _logger.error('Recipients refused: %s', str(e))
            send_state = 'failed'
            error_message = _('The recipient email address was rejected.')

        except smtplib.SMTPException as e:
            _logger.error('SMTP error: %s', str(e))
            send_state = 'failed'
            error_message = _('SMTP error occurred.')

        except Exception as e:
            _logger.error('Failed to send email: %s', str(e))
            send_state = 'failed'
            error_message = str(e)

        # Always create sent record (even if sending failed)
        sent_vals = {
            'subject': subject,
            'recipient_name': self.recipient_email.split('@')[0] if self.recipient_email else '',
            'recipient_email': self.recipient_email,
            'cc_emails': self.cc_emails,
            'bcc_emails': self.bcc_emails,
            'body': self.body,
            'sent_date': fields.Datetime.now(),
            'attachment_ids': [(6, 0, self.attachment_ids.ids)],
            'in_reply_to': self.in_reply_to,
            'message_id': message_id,
            'state': send_state,
        }
        sent_record = self.env['mail.bot.sent'].sudo().create(sent_vals)

        if self.attachment_ids:
            self.attachment_ids.sudo().write({
                'res_model': 'mail.bot.sent',
                'res_id': sent_record.id,
            })

        # Delete the draft
        self.sudo().unlink()

        if send_state == 'failed':
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'message': error_message or _('Email sending failed. Check your SMTP configuration.'),
                    'type': 'warning',
                    'sticky': True,
                }
            }

        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'message': _('Email sent successfully!'),
                'type': 'success',
                'sticky': False,
            }
        }

    def action_add_attachments(self, attachments=None):
        self.ensure_one()
        self.check_access_rights('write')
        self.check_access_rule('write')

        created_ids = []
        for attachment in attachments or []:
            datas = attachment.get('datas')
            if not datas:
                continue
            vals = {
                'name': attachment.get('name') or 'Attachment',
                'datas': datas,
                'mimetype': attachment.get('mimetype') or False,
                'type': 'binary',
                'res_model': self._name,
                'res_id': self.id,
            }
            created = self.env['ir.attachment'].sudo().create(vals)
            created_ids.append(created.id)

        if created_ids:
            self.write({'attachment_ids': [(6, 0, created_ids)]})

        return created_ids

    def action_discard(self):
        self.unlink()
        return {'type': 'ir.actions.act_window_close'}

    def action_move_to_trash(self):
        """Move selected drafts to trash folder - supports bulk operation"""
        for record in self:
            trash_vals = {
                'subject': record.subject or '(No Subject)',
                'sender_name': record.user_id.name,
                'sender_email': record.user_id.email,
                'recipient_email': record.recipient_email,
                'body': record.body,
                'original_folder': 'draft',
                'deleted_date': fields.Datetime.now(),
            }
            self.env['mail.bot.trash'].create(trash_vals)
        self.unlink()
        return True
