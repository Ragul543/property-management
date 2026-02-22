import logging
import imaplib
import poplib
import email
from email.header import decode_header
from email.utils import parseaddr, parsedate_to_datetime
import base64
import json

from odoo import models, fields, api, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class MailBotServer(models.Model):
    _name = 'mail.bot.server'
    _description = 'Incoming Mail Server'
    _order = 'sequence, name'

    name = fields.Char(string='Name', required=True)
    sequence = fields.Integer(string='Sequence', default=10)
    active = fields.Boolean(string='Active', default=True)

    server_type = fields.Selection([
        ('imap', 'IMAP'),
        ('pop3', 'POP3'),
    ], string='Server Type', default='imap', required=True)

    server_host = fields.Char(string='Server Host', required=True, help='e.g., imap.gmail.com')
    server_port = fields.Integer(string='Port', default=993)
    use_ssl = fields.Boolean(string='Use SSL/TLS', default=True)

    username = fields.Char(string='Username', required=True, help='Email address')
    password = fields.Char(string='Password', required=True, help='Password or App Password')

    state = fields.Selection([
        ('draft', 'Not Configured'),
        ('connected', 'Connected'),
        ('error', 'Connection Error'),
    ], string='Status', default='draft')

    last_fetch_date = fields.Datetime(string='Last Fetch Date')
    fetch_interval = fields.Integer(string='Fetch Interval (minutes)', default=5)
    fetch_limit = fields.Integer(string='Fetch Limit', default=50, help='Maximum emails to fetch per run')

    user_id = fields.Many2one('res.users', string='Owner', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    def action_test_connection(self):
        """Test connection to mail server"""
        self.ensure_one()
        try:
            if self.server_type == 'imap':
                self._test_imap_connection()
            else:
                self._test_pop3_connection()

            self.state = 'connected'
            _logger.info('Mail server connection test successful for %s', self.name)

            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'message': _('Connection successful!'),
                    'type': 'success',
                    'sticky': False,
                }
            }

        except Exception as e:
            self.state = 'error'
            _logger.error('Mail server connection failed: %s', str(e))
            raise UserError(_('Connection failed: %s') % str(e))

    def _test_imap_connection(self):
        """Test IMAP connection"""
        if self.use_ssl:
            imap = imaplib.IMAP4_SSL(self.server_host, self.server_port)
        else:
            imap = imaplib.IMAP4(self.server_host, self.server_port)

        imap.login(self.username, self.password)
        imap.select('INBOX')
        imap.logout()

    def _test_pop3_connection(self):
        """Test POP3 connection"""
        if self.use_ssl:
            pop = poplib.POP3_SSL(self.server_host, self.server_port)
        else:
            pop = poplib.POP3(self.server_host, self.server_port)

        pop.user(self.username)
        pop.pass_(self.password)
        pop.quit()

    def action_fetch_emails(self):
        """Manually fetch emails"""
        self.ensure_one()
        if self.state != 'connected':
            raise UserError(_('Please test the connection first.'))

        try:
            if self.server_type == 'imap':
                count = self._fetch_imap_emails()
            else:
                count = self._fetch_pop3_emails()

            self.last_fetch_date = fields.Datetime.now()

            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'message': _('%d new email(s) fetched successfully!') % count,
                    'type': 'success',
                    'sticky': False,
                }
            }

        except Exception as e:
            _logger.error('Failed to fetch emails: %s', str(e))
            raise UserError(_('Failed to fetch emails: %s') % str(e))

    def _fetch_imap_emails(self):
        """Fetch emails via IMAP"""
        if self.use_ssl:
            imap = imaplib.IMAP4_SSL(self.server_host, self.server_port)
        else:
            imap = imaplib.IMAP4(self.server_host, self.server_port)

        imap.login(self.username, self.password)
        imap.select('INBOX')

        # Search for unseen emails
        status, messages = imap.search(None, 'UNSEEN')
        if status != 'OK':
            imap.logout()
            return 0

        email_ids = messages[0].split()
        if not email_ids:
            imap.logout()
            return 0

        # Limit the number of emails to fetch
        email_ids = email_ids[-self.fetch_limit:]
        count = 0

        for email_id in email_ids:
            try:
                status, msg_data = imap.fetch(email_id, '(RFC822)')
                if status != 'OK':
                    continue

                raw_email = msg_data[0][1]
                msg = email.message_from_bytes(raw_email)

                # Parse email and create inbox record
                if self._process_email(msg):
                    count += 1
                    # Mark as seen
                    imap.store(email_id, '+FLAGS', '\\Seen')

            except Exception as e:
                _logger.error('Error processing email %s: %s', email_id, str(e))
                continue

        imap.logout()
        return count

    def _fetch_pop3_emails(self):
        """Fetch emails via POP3"""
        if self.use_ssl:
            pop = poplib.POP3_SSL(self.server_host, self.server_port)
        else:
            pop = poplib.POP3(self.server_host, self.server_port)

        pop.user(self.username)
        pop.pass_(self.password)

        num_messages = len(pop.list()[1])
        count = 0

        # Get last N messages
        start = max(1, num_messages - self.fetch_limit + 1)

        for i in range(start, num_messages + 1):
            try:
                response, lines, octets = pop.retr(i)
                raw_email = b'\n'.join(lines)
                msg = email.message_from_bytes(raw_email)

                # Check if already processed
                message_id = msg.get('Message-ID', '')
                if message_id and self.env['mail.bot.inbox'].search([('message_id', '=', message_id)]):
                    continue

                if self._process_email(msg):
                    count += 1

            except Exception as e:
                _logger.error('Error processing email %d: %s', i, str(e))
                continue

        pop.quit()
        return count

    def _decode_header(self, header_value):
        """Decode email header"""
        if not header_value:
            return ''

        decoded_parts = []
        for part, charset in decode_header(header_value):
            if isinstance(part, bytes):
                try:
                    decoded_parts.append(part.decode(charset or 'utf-8', errors='replace'))
                except:
                    decoded_parts.append(part.decode('utf-8', errors='replace'))
            else:
                decoded_parts.append(part)

        return ' '.join(decoded_parts)

    def _get_email_body(self, msg):
        """Extract email body (HTML or plain text)"""
        body_html = ''
        body_text = ''

        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                content_disposition = str(part.get('Content-Disposition', ''))

                if 'attachment' in content_disposition:
                    continue

                if content_type == 'text/html':
                    payload = part.get_payload(decode=True)
                    charset = part.get_content_charset() or 'utf-8'
                    body_html = payload.decode(charset, errors='replace')
                elif content_type == 'text/plain' and not body_html:
                    payload = part.get_payload(decode=True)
                    charset = part.get_content_charset() or 'utf-8'
                    body_text = payload.decode(charset, errors='replace')
        else:
            payload = msg.get_payload(decode=True)
            charset = msg.get_content_charset() or 'utf-8'
            if msg.get_content_type() == 'text/html':
                body_html = payload.decode(charset, errors='replace')
            else:
                body_text = payload.decode(charset, errors='replace')

        return body_html or f'<pre>{body_text}</pre>', body_text

    def _get_attachments(self, msg):
        """Extract attachments from email"""
        attachments = []

        if msg.is_multipart():
            for part in msg.walk():
                content_disposition = str(part.get('Content-Disposition', ''))

                if 'attachment' in content_disposition:
                    filename = part.get_filename()
                    if filename:
                        filename = self._decode_header(filename)
                        payload = part.get_payload(decode=True)

                        if payload:
                            attachment = self.env['ir.attachment'].create({
                                'name': filename,
                                'datas': base64.b64encode(payload),
                                'type': 'binary',
                            })
                            attachments.append(attachment.id)

        return attachments

    def _process_email(self, msg):
        """Process email message and create inbox record"""
        try:
            # Parse headers
            subject = self._decode_header(msg.get('Subject', '(No Subject)'))
            from_header = msg.get('From', '')
            sender_name, sender_email = parseaddr(from_header)
            sender_name = self._decode_header(sender_name) or sender_email.split('@')[0]

            to_header = msg.get('To', '')
            _, recipient_email = parseaddr(to_header)

            cc_header = msg.get('Cc', '')
            bcc_header = msg.get('Bcc', '')
            message_id = msg.get('Message-ID', '')
            in_reply_to = msg.get('In-Reply-To', '')
            references = msg.get('References', '')

            # Parse date
            date_str = msg.get('Date')
            try:
                received_date = parsedate_to_datetime(date_str) if date_str else fields.Datetime.now()
            except:
                received_date = fields.Datetime.now()

            # Check if recipient is a registered bot address
            bot_address = self.env['mail.bot.address'].search([
                ('email', '=ilike', recipient_email or self.username),
                ('active', '=', True)
            ], limit=1)

            if bot_address:
                # This email is addressed to a bot - process command
                _logger.info('Email addressed to bot: %s', bot_address.email)
                return self._process_bot_command(msg, bot_address, sender_email, sender_name, subject)

            # Check for duplicates (only for regular emails)
            if message_id and self.env['mail.bot.inbox'].search([('message_id', '=', message_id)]):
                _logger.info('Skipping duplicate email: %s', message_id)
                return False

            # Get body and attachments
            body_html, body_text = self._get_email_body(msg)
            attachment_ids = self._get_attachments(msg)

            # Create inbox record
            inbox_vals = {
                'subject': subject,
                'sender_name': sender_name,
                'sender_email': sender_email,
                'recipient_email': recipient_email or self.username,
                'cc_emails': cc_header,
                'bcc_emails': bcc_header,
                'body': body_html,
                'body_text': body_text,
                'received_date': received_date,
                'message_id': message_id,
                'in_reply_to': in_reply_to,
                'references': references,
                'state': 'unread',
                'user_id': self.user_id.id,
                'company_id': self.company_id.id,
            }

            if attachment_ids:
                inbox_vals['attachment_ids'] = [(6, 0, attachment_ids)]

            self.env['mail.bot.inbox'].create(inbox_vals)
            _logger.info('Created inbox record for email: %s', subject)
            return True

        except Exception as e:
            _logger.error('Error processing email: %s', str(e))
            return False

    @api.model
    def _cron_fetch_emails(self):
        """Cron job to fetch emails from all active servers"""
        servers = self.search([('active', '=', True), ('state', '=', 'connected')])

        for server in servers:
            try:
                if server.server_type == 'imap':
                    server._fetch_imap_emails()
                else:
                    server._fetch_pop3_emails()

                server.last_fetch_date = fields.Datetime.now()
                _logger.info('Cron: Fetched emails from server %s', server.name)

            except Exception as e:
                _logger.error('Cron: Failed to fetch emails from %s: %s', server.name, str(e))
                continue

    # ========================================
    # Bot Command Processing Methods
    # ========================================

    def _process_bot_command(self, msg, bot_address, sender_email, sender_name, subject):
        """Process email as bot command"""
        _logger.info('Processing bot command from %s to bot %s', sender_email, bot_address.email)

        # Check sender authorization
        if not bot_address._is_sender_allowed(sender_email):
            _logger.warning('Sender %s not authorized for bot %s', sender_email, bot_address.email)
            self._log_bot_action(bot_address, sender_email, sender_name, 'access_denied',
                                 state='failed', error='Sender not authorized')
            if bot_address.auto_reply:
                self._send_bot_response(bot_address, sender_email, subject,
                                        'Access Denied',
                                        '<p>You are not authorized to send commands to this bot.</p>')
            return True

        # Get email body
        body_html, body_text = self._get_email_body(msg)

        # Parse command
        parser = self.env['mail.bot.command.parser']
        parse_result = parser.parse_email(subject, body_text, body_html)

        command = parse_result.get('command')
        data = parse_result.get('data', {})

        if not command:
            # Unknown command
            _logger.info('No command detected in email from %s', sender_email)
            self._log_bot_action(bot_address, sender_email, sender_name, 'unknown_command',
                                 state='failed', raw_command=parse_result.get('raw_text'))
            if bot_address.auto_reply:
                self._send_bot_response(bot_address, sender_email, subject,
                                        'Unknown Command',
                                        self._get_help_message(bot_address))
            return True

        # Check if command is allowed for this bot
        if bot_address.command_ids and command not in bot_address.command_ids:
            _logger.warning('Command %s not allowed for bot %s', command.code, bot_address.email)
            self._log_bot_action(bot_address, sender_email, sender_name, 'access_denied',
                                 command_id=command.id, state='failed',
                                 error='Command not allowed for this bot')
            if bot_address.auto_reply:
                self._send_bot_response(bot_address, sender_email, subject,
                                        'Command Not Allowed',
                                        '<p>This command is not available for this bot.</p>')
            return True

        # Execute command
        try:
            result = self._execute_bot_command(command, data, sender_email, sender_name, bot_address)

            # Log success
            self._log_bot_action(
                bot_address, sender_email, sender_name, command.code,
                command_id=command.id, state='success',
                res_model=result.get('model'), res_id=result.get('id'),
                parsed_data=json.dumps(data)
            )

            # Send success response
            if bot_address.auto_reply:
                response_body = self._format_success_response(command, result)
                self._send_bot_response(bot_address, sender_email, subject,
                                        f'Success: {command.name}', response_body)

            _logger.info('Bot command executed successfully: %s -> %s', command.code, result)

        except Exception as e:
            _logger.error('Bot command execution failed: %s', str(e))
            self._log_bot_action(bot_address, sender_email, sender_name, 'error',
                                 command_id=command.id, state='failed', error=str(e),
                                 parsed_data=json.dumps(data))
            if bot_address.auto_reply:
                self._send_bot_response(bot_address, sender_email, subject,
                                        'Command Failed', f'<p>Error: {str(e)}</p>')

        return True

    def _execute_bot_command(self, command, data, sender_email, sender_name, bot_address):
        """Execute the bot command and create the record"""
        if command.target_model == 'mail.bot.lead':
            return self._create_lead(data, sender_email, sender_name)
        elif command.target_model == 'res.partner':
            return self._create_contact(data, sender_email, sender_name)
        elif command.target_model == 'mail.bot.task':
            return self._create_task(data, sender_email, sender_name)
        else:
            raise ValueError(f'Unknown target model: {command.target_model}')

    def _create_lead(self, data, sender_email, sender_name):
        """Create a lead from parsed data"""
        lead_vals = {
            'name': data.get('name') or 'New Lead from Email',
            'contact_name': data.get('contact_name') or sender_name,
            'email': data.get('email') or sender_email,
            'phone': data.get('phone'),
            'company_name': data.get('company_name'),
            'description': data.get('description'),
            'source': 'Email Bot',
            'type': 'lead',
        }
        lead = self.env['mail.bot.lead'].sudo().create(lead_vals)
        return {'model': 'mail.bot.lead', 'id': lead.id, 'name': lead.name}

    def _create_contact(self, data, sender_email, sender_name):
        """Create a contact from parsed data"""
        partner_vals = {
            'name': data.get('name') or sender_name or 'New Contact',
            'email': data.get('email') or sender_email,
            'phone': data.get('phone'),
            'mobile': data.get('mobile'),
            'street': data.get('street'),
            'city': data.get('city'),
        }
        partner = self.env['res.partner'].sudo().create(partner_vals)
        return {'model': 'res.partner', 'id': partner.id, 'name': partner.name}

    def _create_task(self, data, sender_email, sender_name):
        """Create a task from parsed data"""
        task_vals = {
            'name': data.get('name') or 'New Task from Email',
            'description': data.get('description'),
            'priority': data.get('priority') or '1',
            'date_deadline': data.get('date_deadline'),
            'state': 'draft',
        }
        task = self.env['mail.bot.task'].sudo().create(task_vals)
        return {'model': 'mail.bot.task', 'id': task.id, 'name': task.name}

    def _log_bot_action(self, bot_address, sender_email, sender_name, action_type,
                        command_id=None, state='pending', res_model=None, res_id=None,
                        raw_command=None, parsed_data=None, error=None):
        """Log bot action for auditing"""
        if not bot_address.log_actions:
            return

        self.env['mail.bot.action.log'].sudo().create({
            'bot_address_id': bot_address.id,
            'command_id': command_id,
            'sender_email': sender_email,
            'sender_name': sender_name,
            'action_type': action_type,
            'state': state,
            'res_model': res_model,
            'res_id': res_id,
            'raw_command': raw_command,
            'parsed_data': parsed_data,
            'error_message': error,
        })

    def _send_bot_response(self, bot_address, recipient_email, original_subject, response_subject, body_html):
        """Send response email using the bot's outgoing server"""
        outgoing_server = bot_address.outgoing_server_id
        if not outgoing_server:
            outgoing_server = self.env['mail.bot.outgoing.server'].search([
                ('active', '=', True),
                ('state', '=', 'connected')
            ], limit=1)

        if not outgoing_server:
            _logger.warning('No outgoing server configured for bot response')
            return False

        # Create draft and send
        full_subject = f'Re: {original_subject}' if not response_subject.startswith('Re:') else response_subject
        draft_vals = {
            'subject': full_subject,
            'recipient_email': recipient_email,
            'body': self._wrap_response_body(body_html, bot_address),
        }

        draft = self.env['mail.bot.draft'].sudo().create(draft_vals)

        try:
            draft.action_send()
            _logger.info('Bot response sent to %s', recipient_email)
            return True
        except Exception as e:
            _logger.error('Failed to send bot response: %s', str(e))
            return False

    def _wrap_response_body(self, content, bot_address):
        """Wrap response content in a formatted email template"""
        return f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #875A7B; color: white; padding: 20px; text-align: center;">
                <h2 style="margin: 0;">{bot_address.name}</h2>
                <p style="margin: 5px 0 0 0; opacity: 0.8;">Automated Response</p>
            </div>
            <div style="padding: 20px; background: #f9f9f9;">
                {content}
            </div>
            <div style="padding: 15px 20px; background: #eee; font-size: 12px; color: #666;">
                <p>This is an automated message from {bot_address.name}.</p>
                <p>Please do not reply directly to this email.</p>
            </div>
        </div>
        """

    def _format_success_response(self, command, result):
        """Format success response based on command type"""
        if result.get('model') == 'mail.bot.lead':
            return f"""
            <h3 style="color: #28a745;">Lead Created Successfully!</h3>
            <p><strong>Lead Name:</strong> {result.get('name')}</p>
            <p><strong>Record ID:</strong> {result.get('id')}</p>
            <p>Your lead has been created and is ready for follow-up.</p>
            """
        elif result.get('model') == 'res.partner':
            return f"""
            <h3 style="color: #28a745;">Contact Created Successfully!</h3>
            <p><strong>Contact Name:</strong> {result.get('name')}</p>
            <p><strong>Record ID:</strong> {result.get('id')}</p>
            """
        elif result.get('model') == 'mail.bot.task':
            return f"""
            <h3 style="color: #28a745;">Task Created Successfully!</h3>
            <p><strong>Task Name:</strong> {result.get('name')}</p>
            <p><strong>Record ID:</strong> {result.get('id')}</p>
            """

        return f"<p>Record created successfully: {result.get('name')} (ID: {result.get('id')})</p>"

    def _get_help_message(self, bot_address):
        """Generate help message with available commands"""
        commands = bot_address.command_ids or self.env['mail.bot.command'].search([('active', '=', True)])

        help_lines = ["<h3>Available Commands</h3><ul>"]
        for cmd in commands:
            keywords = ', '.join(cmd.get_keywords_list()[:3])
            help_lines.append(f"<li><strong>{cmd.name}</strong>: Use keywords like '{keywords}'</li>")
        help_lines.append("</ul>")

        help_lines.append("<h4>Example Usage:</h4>")
        help_lines.append("<p>To create a lead, send an email with:</p>")
        help_lines.append("<pre style='background: #f5f5f5; padding: 10px;'>Create Lead\nName: New Project Inquiry\nContact: John Smith\nPhone: 555-1234\nCompany: Acme Corp</pre>")

        return '\n'.join(help_lines)
