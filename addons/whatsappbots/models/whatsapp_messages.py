# -*- coding: utf-8 -*-
import logging
from datetime import datetime, timedelta
from odoo import models, fields, api

# Indian Standard Time offset (UTC+5:30)
IST_OFFSET = timedelta(hours=5, minutes=30)

_logger = logging.getLogger(__name__)


def parse_timestamp(ts):
    """Parse timestamp from various formats"""
    if not ts:
        return None
    if isinstance(ts, datetime):
        return ts

    # Try ISO format with Z suffix
    for fmt in [
        '%Y-%m-%dT%H:%M:%S.%fZ',
        '%Y-%m-%dT%H:%M:%SZ',
        '%Y-%m-%dT%H:%M:%S.%f',
        '%Y-%m-%dT%H:%M:%S',
        '%Y-%m-%d %H:%M:%S',
    ]:
        try:
            return datetime.strptime(str(ts).replace('+00:00', 'Z'), fmt)
        except ValueError:
            continue
    return None


class WhatsAppMessage(models.Model):
    _name = 'whatsapp.message'
    _description = 'WhatsApp Message'
    _order = 'timestamp desc, id desc'
    _rec_name = 'display_name'

    message_id = fields.Char(string='Message ID', index=True)
    phone = fields.Char(string='Phone Number', index=True)
    conversation_id = fields.Many2one(
        'whatsapp.conversation',
        string='Conversation',
        index=True,
        ondelete='cascade'
    )
    direction = fields.Selection([
        ('incoming', 'Incoming'),
        ('outgoing', 'Outgoing'),
    ], string='Direction', required=True, default='outgoing')

    # Group fields
    is_group = fields.Boolean(related='conversation_id.is_group', string='Is Group', store=True)
    group_id = fields.Char(string='Group ID', index=True, help='WhatsApp Group ID for group messages')

    body = fields.Text(string='Message')
    message_type = fields.Selection([
        ('chat', 'Text'),
        ('image', 'Image'),
        ('video', 'Video'),
        ('audio', 'Audio'),
        ('document', 'Document'),
        ('sticker', 'Sticker'),
        ('location', 'Location'),
    ], string='Type', default='chat')

    has_media = fields.Boolean(string='Has Media')
    media_mimetype = fields.Char(string='Media Type')
    media_filename = fields.Char(string='Filename')
    media_data = fields.Binary(string='Media', attachment=True)

    partner_id = fields.Many2one('res.partner', string='Contact', index=True)
    employee_id = fields.Many2one('hr.employee', string='Employee', index=True)
    author = fields.Char(string='Author', help='Author phone in group chats')
    author_name = fields.Char(string='Author Name', help='Author display name in group chats')

    state = fields.Selection([
        ('draft', 'Draft'),
        ('sent', 'Sent'),
        ('delivered', 'Delivered'),
        ('read', 'Read'),
        ('failed', 'Failed'),
        ('received', 'Received'),
    ], string='Status', default='draft')

    error_message = fields.Text(string='Error')
    timestamp = fields.Datetime(string='Timestamp', default=fields.Datetime.now)
    display_name = fields.Char(compute='_compute_display_name', store=True)

    @api.depends('phone', 'direction', 'body')
    def _compute_display_name(self):
        for rec in self:
            arrow = 'OUT' if rec.direction == 'outgoing' else 'IN'
            preview = (rec.body or '')[:30]
            if len(rec.body or '') > 30:
                preview += '...'
            rec.display_name = f"[{arrow}] {rec.phone}: {preview}"

    @api.model
    def _normalize_phone(self, phone, default_cc='91'):
        """Normalize phone number to consistent format with country code"""
        if not phone:
            return ''
        digits = ''.join(filter(str.isdigit, str(phone)))
        if not digits:
            return ''
        if len(digits) == 10:
            digits = default_cc + digits
        elif digits.startswith('0'):
            digits = default_cc + digits[1:]
        return digits

    @api.model
    def create_from_webhook(self, data):
        """Create message from webhook data"""
        sender = data.get('from', '')
        is_group = '@g.us' in sender

        if is_group:
            # Group message: 'from' is group ID, 'author' is sender phone
            group_id = sender  # e.g., "123456789@g.us"
            author_raw = data.get('author', '').replace('@c.us', '')
            author_phone = self._normalize_phone(author_raw) if author_raw else ''
            phone = author_phone  # Store author's phone as the phone field

            # Get group info from data
            group_name = data.get('groupName', data.get('notifyName', ''))
            group_participants = data.get('participants', [])
        else:
            # Individual message
            group_id = False
            raw_phone = sender.replace('@c.us', '')
            phone = self._normalize_phone(raw_phone)
            author_phone = ''
            group_name = ''
            group_participants = []

        # Find partner by phone (author for groups, sender for individual)
        partner_model = self.env['res.partner'].sudo()
        partner_fields = partner_model._fields
        search_phone = phone[-10:] if phone else ''

        terms = []
        if search_phone:
            if 'phone' in partner_fields:
                terms.append(('phone', 'ilike', search_phone))
            if 'mobile' in partner_fields:
                terms.append(('mobile', 'ilike', search_phone))
            if 'whatsapp_number' in partner_fields:
                terms.append(('whatsapp_number', '=', phone))

        domain = []
        if terms:
            domain = ['|'] * (len(terms) - 1) + terms

        partner = partner_model.search(domain, limit=1) if domain else partner_model.browse()

        vals = {
            'message_id': data.get('id'),
            'phone': phone,
            'direction': 'incoming',
            'body': data.get('body', ''),
            'message_type': data.get('type', 'chat'),
            'has_media': data.get('hasMedia', False),
            'author': author_phone if is_group else '',
            'author_name': data.get('notifyName', '') if is_group else '',
            'partner_id': partner.id if partner else False,
            'state': 'received',
            'timestamp': parse_timestamp(data.get('timestamp')) or fields.Datetime.now(),
            'group_id': group_id if is_group else False,
        }

        # Handle media attachment
        media = data.get('media')
        if media:
            vals.update({
                'media_mimetype': media.get('mimetype'),
                'media_filename': media.get('filename'),
                'media_data': media.get('data'),
            })

        # Get or create conversation
        ConversationModel = self.env['whatsapp.conversation'].sudo()
        if is_group:
            conversation = ConversationModel.get_or_create_group(
                group_id,
                group_name,
                group_participants
            )
        else:
            conversation = ConversationModel.get_or_create(phone, partner.id if partner else False)

        vals['conversation_id'] = conversation.id

        message = self.sudo().create(vals)

        # Post to partner chatter (only for individual chats)
        # Skip in webhook context (auth='none') as message_post requires user
        if partner and not is_group:
            try:
                # Check if we have a valid user context
                if self.env.uid and self.env.uid > 0:
                    body_html = f"<b>WhatsApp ({phone}):</b><br/>{data.get('body', '')}"
                    partner.sudo().message_post(
                        body=body_html,
                        message_type='comment',
                        subtype_xmlid='mail.mt_note',
                    )
            except Exception as e:
                _logger.debug(f"Skipped partner chatter post: {e}")

        if is_group:
            _logger.info(f"WhatsApp group message received in {group_name} from {author_phone}")
        else:
            _logger.info(f"WhatsApp message received from {phone}")
        return message

    def action_retry_send(self):
        """Retry sending failed messages"""
        for msg in self.filtered(lambda m: m.state == 'failed' and m.direction == 'outgoing'):
            try:
                config = self.env['whatsapp.config'].get_default_config()
                config.send_message(msg.phone, msg.body)
                msg.write({'state': 'sent', 'error_message': False})
            except Exception as e:
                msg.error_message = str(e)

    @api.model_create_multi
    def create(self, vals_list):
        """Override create to auto-link conversation"""
        ConversationModel = self.env['whatsapp.conversation'].sudo()

        for vals in vals_list:
            if vals.get('phone'):
                # Normalize phone number
                vals['phone'] = self._normalize_phone(vals['phone'])

            # Skip conversation auto-creation if already set
            if vals.get('conversation_id'):
                continue

            # Handle group vs individual conversation
            if vals.get('group_id'):
                # Group message - get or create group conversation
                conversation = ConversationModel.get_or_create_group(
                    vals['group_id'],
                    vals.get('group_name', ''),
                    vals.get('participants', [])
                )
                vals['conversation_id'] = conversation.id
            elif vals.get('phone'):
                # Individual message
                phone = vals['phone']
                partner_id = vals.get('partner_id', False)
                conversation = ConversationModel.get_or_create(phone, partner_id)
                vals['conversation_id'] = conversation.id

        records = super().create(vals_list)

        # Update conversation last message info
        for record in records:
            if record.conversation_id:
                record.sudo().conversation_id.update_last_message(record)

        return records

    def _format_for_frontend(self):
        """Format message data for frontend"""
        self.ensure_one()
        try:
            # Convert timestamp to IST for display
            timestamp_ist = None
            if self.timestamp:
                timestamp_ist = self.timestamp + IST_OFFSET

            # Get media data as base64 string if available
            media_data = None
            if self.has_media and self.media_data:
                # media_data is already base64 encoded in Binary field
                if isinstance(self.media_data, bytes):
                    media_data = self.media_data.decode('utf-8')
                else:
                    media_data = self.media_data

            # Get author display name for group messages
            author_display = ''
            if self.is_group and self.direction == 'incoming':
                if self.author_name:
                    author_display = self.author_name
                elif self.partner_id:
                    author_display = self.partner_id.name
                elif self.author:
                    # Format phone number nicely
                    author_display = f"+{self.author[:2]} {self.author[2:]}" if len(self.author) > 10 else self.author

            return {
                'id': self.id,
                'message_id': self.message_id,
                'phone': self.phone,
                'conversation_id': self.conversation_id.id if self.conversation_id else False,
                'direction': self.direction,
                'body': self.body,
                'message_type': self.message_type,
                'has_media': self.has_media,
                'media_mimetype': self.media_mimetype,
                'media_filename': self.media_filename,
                'media_data': media_data,
                'partner_id': self.partner_id.id if self.partner_id else False,
                'partner_name': self.partner_id.name if self.partner_id else False,
                'author': self.author,
                'author_name': self.author_name,
                'author_display': author_display,
                'is_group': self.is_group,
                'group_id': self.group_id,
                'state': self.state,
                'timestamp': timestamp_ist.isoformat() if timestamp_ist else False,
                'error_message': self.error_message,
            }
        except Exception as e:
            _logger.warning(f"Error in message _format_for_frontend: {e}")
            return {
                'id': self.id,
                'message_id': '',
                'phone': self.phone or '',
                'conversation_id': False,
                'direction': 'incoming',
                'body': self.body or '',
                'message_type': 'chat',
                'has_media': False,
                'media_mimetype': False,
                'media_filename': False,
                'media_data': None,
                'partner_id': False,
                'partner_name': False,
                'author': '',
                'author_name': '',
                'author_display': '',
                'is_group': False,
                'group_id': False,
                'state': 'received',
                'timestamp': False,
                'error_message': False,
            }

    @api.model
    def get_conversation_messages(self, conversation_id, limit=50, offset=0):
        """Get messages for a conversation"""
        # Use sudo() to ensure access to all messages in the conversation
        messages = self.sudo().search([
            ('conversation_id', '=', conversation_id)
        ], limit=limit, offset=offset, order='timestamp asc, id asc')
        return [msg._format_for_frontend() for msg in messages]
