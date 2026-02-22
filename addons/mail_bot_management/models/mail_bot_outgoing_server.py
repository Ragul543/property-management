import logging
import smtplib
from odoo import models, fields, api, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class MailBotOutgoingServer(models.Model):
    _name = 'mail.bot.outgoing.server'
    _description = 'Outgoing Mail Server (SMTP)'
    _order = 'sequence, name'

    name = fields.Char(string='Name', required=True)
    sequence = fields.Integer(string='Sequence', default=10)
    active = fields.Boolean(string='Active', default=True)

    smtp_host = fields.Char(string='SMTP Server', required=True, help='e.g., smtp.gmail.com')
    smtp_port = fields.Integer(string='SMTP Port', default=587, required=True)
    smtp_encryption = fields.Selection([
        ('none', 'None'),
        ('starttls', 'TLS (STARTTLS)'),
        ('ssl', 'SSL/TLS'),
    ], string='Connection Security', default='starttls', required=True)

    smtp_user = fields.Char(string='Username', required=True, help='Email address or username')
    smtp_pass = fields.Char(string='Password', required=True, help='Password or App Password')

    email_from = fields.Char(string='Email From', required=True, help='Email address to send from')

    state = fields.Selection([
        ('draft', 'Not Configured'),
        ('connected', 'Connected'),
        ('error', 'Connection Error'),
    ], string='Status', default='draft')

    user_id = fields.Many2one('res.users', string='Owner', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    def action_test_connection(self):
        """Test SMTP connection"""
        self.ensure_one()
        try:
            if self.smtp_encryption == 'ssl':
                smtp = smtplib.SMTP_SSL(self.smtp_host, self.smtp_port, timeout=10)
            else:
                smtp = smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=10)

            smtp.ehlo()

            if self.smtp_encryption == 'starttls':
                smtp.starttls()
                smtp.ehlo()

            smtp.login(self.smtp_user, self.smtp_pass)
            smtp.quit()

            self.state = 'connected'
            _logger.info('SMTP connection test successful for %s', self.name)

            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'message': _('Connection successful! SMTP server is configured correctly.'),
                    'type': 'success',
                    'sticky': False,
                }
            }

        except smtplib.SMTPAuthenticationError as e:
            self.state = 'error'
            _logger.error('SMTP authentication failed: %s', str(e))
            raise UserError(_('Authentication failed. Please check your username and password.\n\nFor Gmail, use an App Password instead of your regular password.'))

        except smtplib.SMTPConnectError as e:
            self.state = 'error'
            _logger.error('SMTP connection failed: %s', str(e))
            raise UserError(_('Could not connect to SMTP server. Please check the server address and port.'))

        except Exception as e:
            self.state = 'error'
            _logger.error('SMTP connection error: %s', str(e))
            raise UserError(_('Connection failed: %s') % str(e))

    @api.model
    def get_smtp_connection(self, server_id=None):
        """Get an SMTP connection for sending emails"""
        if server_id:
            server = self.browse(server_id)
        else:
            server = self.search([('active', '=', True), ('state', '=', 'connected')], limit=1)

        if not server:
            raise UserError(_('No configured outgoing mail server found.'))

        try:
            if server.smtp_encryption == 'ssl':
                smtp = smtplib.SMTP_SSL(server.smtp_host, server.smtp_port, timeout=30)
            else:
                smtp = smtplib.SMTP(server.smtp_host, server.smtp_port, timeout=30)

            smtp.ehlo()

            if server.smtp_encryption == 'starttls':
                smtp.starttls()
                smtp.ehlo()

            smtp.login(server.smtp_user, server.smtp_pass)
            return smtp, server

        except Exception as e:
            _logger.error('Failed to get SMTP connection: %s', str(e))
            raise UserError(_('Failed to connect to mail server: %s') % str(e))
