# -*- coding: utf-8 -*-
import logging
from datetime import timedelta
from odoo import models, fields, api

# Indian Standard Time offset (UTC+5:30)
IST_OFFSET = timedelta(hours=5, minutes=30)

_logger = logging.getLogger(__name__)


class WhatsAppConversation(models.Model):
    _name = 'whatsapp.conversation'
    _description = 'WhatsApp Conversation'
    _order = 'last_message_date desc'
    _rec_name = 'display_name'

    # Basic fields
    phone = fields.Char(string='Phone Number', index=True)
    partner_id = fields.Many2one('res.partner', string='Contact', index=True)
    display_name = fields.Char(compute='_compute_display_name', store=True)
    avatar = fields.Binary(compute='_compute_avatar', store=False)

    # Group fields
    is_group = fields.Boolean(string='Is Group', default=False, index=True)
    group_id = fields.Char(string='Group ID', index=True, help='WhatsApp Group ID (e.g., 123456789@g.us)')
    group_name = fields.Char(string='Group Name')
    group_description = fields.Text(string='Group Description')
    group_participants = fields.Text(string='Participants (JSON)', help='JSON list of participant phone numbers')
    group_admins = fields.Text(string='Admins (JSON)', help='JSON list of admin phone numbers')
    group_owner = fields.Char(string='Group Owner Phone')
    created_by_uid = fields.Many2one('res.users', string='Created By', help='Odoo user who created this group')

    message_ids = fields.One2many('whatsapp.message', 'conversation_id', string='Messages')
    message_count = fields.Integer(string='Message Count', default=0)  # Updated explicitly
    unread_count = fields.Integer(string='Unread Messages', default=0)

    last_message_body = fields.Text(string='Last Message')
    last_message_date = fields.Datetime(string='Last Message Date')
    last_message_direction = fields.Selection([
        ('incoming', 'Incoming'),
        ('outgoing', 'Outgoing'),
    ], string='Last Message Direction')
    last_message_author = fields.Char(string='Last Message Author', help='For group chats')

    is_pinned = fields.Boolean(string='Pinned', default=False)
    is_muted = fields.Boolean(string='Muted', default=False)
    active = fields.Boolean(default=True)

    _sql_constraints = [
        ('phone_group_unique', 'unique(phone, group_id)', 'A conversation with this identifier already exists!'),
    ]

    @api.depends('partner_id', 'partner_id.name', 'phone', 'is_group', 'group_name')
    def _compute_display_name(self):
        for rec in self:
            if rec.is_group:
                rec.display_name = rec.group_name or 'Unknown Group'
            elif rec.partner_id:
                rec.display_name = rec.partner_id.name
            else:
                # Format phone number nicely
                phone = rec.phone or ''
                if len(phone) > 10:
                    rec.display_name = f"+{phone[:2]} {phone[2:]}"
                else:
                    rec.display_name = phone

    def _compute_avatar(self):
        for rec in self:
            if rec.is_group:
                # Groups don't have avatars stored locally (could be enhanced)
                rec.avatar = False
            elif rec.partner_id and rec.partner_id.image_128:
                rec.avatar = rec.partner_id.image_128
            else:
                rec.avatar = False

    # message_count is now updated explicitly in update_last_message()

    @api.model
    def _normalize_phone(self, phone, default_cc='91'):
        """Normalize phone number to consistent format with country code"""
        if not phone:
            return ''
        # Strip all non-digits
        digits = ''.join(filter(str.isdigit, str(phone)))
        if not digits:
            return ''
        # If 10 digits, add country code
        if len(digits) == 10:
            digits = default_cc + digits
        # If starts with 0, remove it and add country code
        elif digits.startswith('0'):
            digits = default_cc + digits[1:]
        return digits

    @api.model
    def get_or_create(self, phone, partner_id=False):
        """Get existing conversation or create new one (for individual chats)"""
        normalized_phone = self._normalize_phone(phone)
        if not normalized_phone:
            return self.browse()

        # Try exact match first (individual chat)
        conversation = self.search([
            ('phone', '=', normalized_phone),
            ('is_group', '=', False)
        ], limit=1)

        # If not found, try matching last 10 digits (for legacy data)
        if not conversation and len(normalized_phone) >= 10:
            last_10 = normalized_phone[-10:]
            all_convs = self.search([('is_group', '=', False)])
            for conv in all_convs:
                if conv.phone and conv.phone[-10:] == last_10:
                    # Update to normalized format
                    conv.phone = normalized_phone
                    conversation = conv
                    break
        if not conversation:
            vals = {
                'phone': normalized_phone,
                'partner_id': partner_id,
                'is_group': False,
            }
            conversation = self.create(vals)
            _logger.info(f"Created new WhatsApp conversation for {normalized_phone}")
        elif partner_id and not conversation.partner_id:
            conversation.partner_id = partner_id

        return conversation

    @api.model
    def get_or_create_group(self, group_id, group_name=False, participants=None, created_by_uid=False):
        """Get existing group conversation or create new one"""
        import json
        if not group_id:
            return self.browse()

        # Try exact match by group_id
        conversation = self.search([
            ('group_id', '=', group_id),
            ('is_group', '=', True)
        ], limit=1)

        if not conversation:
            vals = {
                'is_group': True,
                'group_id': group_id,
                'group_name': group_name or 'Unknown Group',
                'group_participants': json.dumps(participants or []),
            }
            # Set creator if provided, otherwise use current user
            if created_by_uid:
                vals['created_by_uid'] = created_by_uid
            elif self.env.uid:
                vals['created_by_uid'] = self.env.uid

            conversation = self.create(vals)
            _logger.info(f"Created new WhatsApp group conversation: {group_name} ({group_id}) by user {vals.get('created_by_uid')}")
        else:
            # Update group name if provided and changed
            update_vals = {}
            if group_name and group_name != conversation.group_name:
                update_vals['group_name'] = group_name
            if participants:
                update_vals['group_participants'] = json.dumps(participants)
            if update_vals:
                conversation.write(update_vals)

        return conversation

    def update_last_message(self, message):
        """Update conversation with last message info"""
        self.ensure_one()

        # Calculate current message count explicitly
        current_count = self.env['whatsapp.message'].sudo().search_count([
            ('conversation_id', '=', self.id)
        ])

        vals = {
            'last_message_body': (message.body or '')[:100],
            'last_message_date': message.timestamp or fields.Datetime.now(),
            'last_message_direction': message.direction,
            'message_count': current_count,  # Explicitly set message count
        }
        # For group chats, track the author
        if self.is_group and message.author:
            vals['last_message_author'] = message.author
        if message.direction == 'incoming':
            vals['unread_count'] = self.unread_count + 1

        self.write(vals)
        _logger.info(f"Updated conversation {self.id}: last_message='{vals['last_message_body'][:30]}...', count={current_count}, direction={message.direction}")

    def mark_as_read(self):
        """Mark all messages in conversation as read"""
        self.ensure_one()
        self.unread_count = 0
        self.message_ids.filtered(
            lambda m: m.direction == 'incoming' and m.state == 'received'
        ).write({'state': 'read'})

    def action_pin(self):
        """Toggle pin status"""
        self.ensure_one()
        self.is_pinned = not self.is_pinned

    def action_mute(self):
        """Toggle mute status"""
        self.ensure_one()
        self.is_muted = not self.is_muted

    def _format_for_frontend(self):
        """Format conversation data for frontend"""
        import json
        self.ensure_one()

        try:
            avatar_data = False
            if self.partner_id and self.partner_id.image_128:
                avatar = self.partner_id.image_128
                if isinstance(avatar, bytes):
                    avatar_data = avatar.decode('utf-8')
                elif avatar:
                    avatar_data = avatar

            # Convert last_message_date to IST
            last_msg_date_ist = None
            if self.last_message_date:
                last_msg_date_ist = self.last_message_date + IST_OFFSET

            # Parse group participants if available
            participants = []
            if self.is_group and self.group_participants:
                try:
                    participants = json.loads(self.group_participants)
                except:
                    participants = []

            # Check if current user is the group admin (creator)
            # Handle auth='none' context where env.user might be empty
            is_admin = False
            if self.is_group and self.created_by_uid:
                try:
                    current_uid = getattr(self.env, 'uid', False) or False
                    if current_uid:
                        is_admin = self.created_by_uid.id == current_uid
                except Exception:
                    pass

            # Get last message ID for change detection (explicitly get latest by ID)
            last_msg = self.env['whatsapp.message'].sudo().search(
                [('conversation_id', '=', self.id)],
                order='id desc',
                limit=1
            )

            # Safely get created_by_uid
            created_by = False
            try:
                if self.created_by_uid:
                    created_by = self.created_by_uid.id
            except Exception:
                pass

            return {
                'id': self.id,
                'phone': self.phone,
                'display_name': self.display_name,
                'partner_id': self.partner_id.id if self.partner_id else False,
                'avatar': avatar_data,
                'unread_count': self.unread_count,
                'last_message': self.last_message_body,
                'last_message_date': last_msg_date_ist.isoformat() if last_msg_date_ist else False,
                'last_message_time': last_msg_date_ist.isoformat() if last_msg_date_ist else False,
                'last_message_id': last_msg.id if last_msg else False,
                'last_message_direction': self.last_message_direction,
                'last_message_author': self.last_message_author if self.is_group else False,
                'is_pinned': self.is_pinned,
                'is_muted': self.is_muted,
                'message_count': self.message_count,
                # Group fields
                'is_group': self.is_group,
                'group_id': self.group_id,
                'group_name': self.group_name,
                'group_description': self.group_description,
                'participants': participants,
                'participant_count': len(participants),
                'is_admin': is_admin,
                'created_by_uid': created_by,
            }
        except Exception as e:
            # Fallback for any error - return minimal data
            _logger.warning(f"Error in _format_for_frontend: {e}")
            return {
                'id': self.id,
                'phone': self.phone or '',
                'display_name': self.phone or 'Unknown',
                'partner_id': False,
                'avatar': False,
                'unread_count': 0,
                'last_message': '',
                'last_message_date': False,
                'last_message_time': False,
                'last_message_id': False,
                'last_message_direction': 'incoming',
                'last_message_author': False,
                'is_pinned': False,
                'is_muted': False,
                'message_count': 0,
                'is_group': False,
                'group_id': False,
                'group_name': False,
                'group_description': False,
                'participants': [],
                'participant_count': 0,
                'is_admin': False,
                'created_by_uid': False,
            }

    @api.model
    def get_conversations_for_user(self, limit=50, offset=0):
        """Get all conversations for current user"""
        # Use sudo() to ensure access to all conversations
        conversations = self.sudo().search(
            [('active', '=', True)],
            limit=limit,
            offset=offset,
            order='is_pinned desc, last_message_date desc'
        )
        return [conv._format_for_frontend() for conv in conversations]

    @api.model
    def migrate_existing_messages(self):
        """Migrate existing messages without conversation_id"""
        Message = self.env['whatsapp.message'].sudo()
        orphan_messages = Message.search([('conversation_id', '=', False)])

        count = 0
        for msg in orphan_messages:
            phone = ''.join(filter(str.isdigit, str(msg.phone or '')))
            if phone:
                conv = self.sudo().get_or_create(phone, msg.partner_id.id if msg.partner_id else False)
                msg.conversation_id = conv.id
                conv.update_last_message(msg)
                count += 1

        _logger.info(f"Migrated {count} orphan messages to conversations")
        return count

    @api.model
    def merge_duplicate_conversations(self):
        """Merge conversations with same phone number (last 10 digits) - only for individual chats"""
        all_convs = self.sudo().search([('is_group', '=', False)])
        phone_map = {}  # last_10_digits -> list of conversations

        for conv in all_convs:
            if conv.phone and len(conv.phone) >= 10:
                last_10 = conv.phone[-10:]
                if last_10 not in phone_map:
                    phone_map[last_10] = []
                phone_map[last_10].append(conv)

        merged_count = 0
        for last_10, convs in phone_map.items():
            if len(convs) > 1:
                # Keep the one with normalized phone (with country code)
                convs.sort(key=lambda c: len(c.phone), reverse=True)
                primary = convs[0]
                normalized_phone = self._normalize_phone(primary.phone)
                primary.phone = normalized_phone

                # Merge others into primary
                for duplicate in convs[1:]:
                    # Move all messages to primary conversation
                    duplicate.message_ids.write({'conversation_id': primary.id})
                    # Update unread count
                    primary.unread_count += duplicate.unread_count
                    # Archive duplicate
                    duplicate.active = False
                    merged_count += 1
                    _logger.info(f"Merged conversation {duplicate.phone} into {primary.phone}")

                # Update primary's last message info
                last_msg = self.env['whatsapp.message'].sudo().search([
                    ('conversation_id', '=', primary.id)
                ], order='timestamp desc', limit=1)
                if last_msg:
                    primary.update_last_message(last_msg)

        _logger.info(f"Merged {merged_count} duplicate conversations")
        return merged_count

    @api.model
    def normalize_all_phones(self):
        """Normalize all phone numbers in conversations and messages"""
        # Normalize conversations
        convs = self.sudo().search([])
        for conv in convs:
            normalized = self._normalize_phone(conv.phone)
            if normalized and normalized != conv.phone:
                conv.phone = normalized

        # Normalize messages
        Message = self.env['whatsapp.message'].sudo()
        messages = Message.search([])
        for msg in messages:
            normalized = self._normalize_phone(msg.phone)
            if normalized and normalized != msg.phone:
                msg.phone = normalized

        # Now merge duplicates
        return self.merge_duplicate_conversations()
