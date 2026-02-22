# -*- coding: utf-8 -*-
import json
import logging
from datetime import datetime
from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)


class WhatsAppChatController(http.Controller):

    @http.route('/whatsapp/status', type='json', auth='user', methods=['POST'])
    def check_status(self, **kwargs):
        """Check WhatsApp configuration and connection status"""
        try:
            # Check if config exists, create default if not
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            if not config:
                # Create default configuration
                config = request.env['whatsapp.config'].sudo().create({
                    'name': 'WhatsApp Server',
                    'server_url': 'http://localhost:3006',
                    'api_key': 'whatsapp-api-key',
                    'default_country_code': '91',
                    'active': True,
                    'state': 'disconnected',
                })
                _logger.info("Created default WhatsApp configuration")

            # Check if server is reachable
            import requests
            try:
                response = requests.get(
                    f"{config.server_url.rstrip('/')}/health",
                    timeout=5
                )
                server_data = response.json()
                server_ok = server_data.get('ready', False)
                server_has_qr = server_data.get('hasQr', False)
            except Exception as e:
                _logger.error(f"Cannot reach WhatsApp server: {e}")
                return {
                    'ok': False,
                    'configured': True,
                    'server_url': config.server_url,
                    'connected': False,
                    'error': f'Cannot reach WhatsApp bot server at {config.server_url}. Make sure the bot server is running.'
                }

            return {
                'ok': True,
                'configured': True,
                'server_url': config.server_url,
                'connected': server_ok,
                'needs_qr': server_has_qr and not server_ok,
                'state': config.state,
                'logged_in_phone': config.logged_in_phone or False,
                'message': 'Ready to send messages' if server_ok else (
                    'Scan QR code to connect WhatsApp' if server_has_qr else 'Waiting for WhatsApp connection'
                )
            }
        except Exception as e:
            _logger.exception(f"Error checking status: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/current_user', type='json', auth='user', methods=['POST'])
    def get_current_user(self, **kwargs):
        """Get current user ID for bus subscription"""
        try:
            return {
                'ok': True,
                'user_id': request.env.uid,
                'user_name': request.env.user.name
            }
        except Exception as e:
            _logger.exception(f"Error getting current user: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversations', type='json', auth='user', methods=['POST'])
    def get_conversations(self, limit=50, offset=0, **kwargs):
        """Get list of conversations for current user"""
        try:
            # Get logged_in_phone from config to filter conversations
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            owner_phone = config.logged_in_phone if config else False

            conversations = request.env['whatsapp.conversation'].sudo().get_conversations_for_user(
                limit=limit,
                offset=offset,
                owner_phone=owner_phone
            )
            return {'ok': True, 'conversations': conversations, 'logged_in_phone': owner_phone}
        except Exception as e:
            _logger.exception(f"Error fetching conversations: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversation/<int:conversation_id>/messages', type='json', auth='user', methods=['POST'])
    def get_messages(self, conversation_id, limit=50, offset=0, **kwargs):
        """Get messages for a conversation"""
        try:
            # Get logged_in_phone from config to validate conversation ownership
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            owner_phone = config.logged_in_phone if config else False

            # Validate conversation belongs to logged-in user
            conversation = request.env['whatsapp.conversation'].sudo().browse(conversation_id)
            if not conversation.exists():
                return {'ok': False, 'error': 'Conversation not found', 'messages': []}

            # If owner_phone is set, verify conversation belongs to this owner
            if owner_phone and conversation.owner_phone and conversation.owner_phone != owner_phone:
                return {'ok': False, 'error': 'Conversation not accessible', 'messages': []}

            messages = request.env['whatsapp.message'].sudo().get_conversation_messages(
                conversation_id=conversation_id,
                limit=limit,
                offset=offset
            )
            return {'ok': True, 'messages': messages}
        except Exception as e:
            _logger.exception(f"Error fetching messages: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversation/<int:conversation_id>/send', type='json', auth='user', methods=['POST'])
    def send_message(self, conversation_id, message, reply_to_id=None, **kwargs):
        """Send a message in a conversation (individual or group)

        Args:
            conversation_id: The conversation to send to
            message: The message text
            reply_to_id: Optional message ID to reply to (quoted reply)
        """
        conversation = request.env['whatsapp.conversation'].sudo().browse(conversation_id)
        if not conversation.exists():
            return {'ok': False, 'error': 'Conversation not found'}

        if not message or not message.strip():
            return {'ok': False, 'error': 'Message cannot be empty'}

        # Ensure conversation has owner_phone set
        if not conversation.owner_phone:
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            if config and config.logged_in_phone:
                conversation.owner_phone = config.logged_in_phone

        # Prepare message values
        msg_vals = {
            'conversation_id': conversation.id,
            'body': message.strip(),
            'direction': 'outgoing',
            'state': 'sent',
            'timestamp': datetime.now(),
        }

        # Handle reply_to (quoted reply)
        quoted_message_id = None
        if reply_to_id:
            reply_msg = request.env['whatsapp.message'].sudo().browse(reply_to_id)
            if reply_msg.exists():
                msg_vals['reply_to_id'] = reply_to_id
                quoted_message_id = reply_msg.message_id  # WhatsApp message ID for the API

        if conversation.is_group:
            msg_vals['group_id'] = conversation.group_id
        else:
            msg_vals['phone'] = conversation.phone
            msg_vals['partner_id'] = conversation.partner_id.id if conversation.partner_id else False

        # Try to send via WhatsApp first
        send_error = None
        message_id = None

        try:
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            if config and config.server_url and config.api_key:
                if conversation.is_group:
                    result = config.send_message(conversation.group_id, message, is_group=True, quoted_message_id=quoted_message_id)
                else:
                    result = config.send_message(conversation.phone, message, quoted_message_id=quoted_message_id)

                if result.get('ok'):
                    message_id = result.get('messageId')
                else:
                    send_error = result.get('error', 'Failed to send')
                    msg_vals['state'] = 'failed'
                    msg_vals['error_message'] = send_error
        except Exception as e:
            send_error = str(e)
            msg_vals['state'] = 'failed'
            msg_vals['error_message'] = send_error
            _logger.warning(f"WhatsApp send error: {send_error}")

        if message_id:
            msg_vals['message_id'] = message_id

        # Create the message record
        try:
            msg = request.env['whatsapp.message'].sudo().create(msg_vals)
            _logger.info(f"Message created with ID: {msg.id}, state: {msg.state}")

            return {
                'ok': True,
                'message': msg._format_for_frontend(),
                'send_error': send_error
            }
        except Exception as e:
            _logger.exception(f"Error creating message: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversation/<int:conversation_id>/read', type='json', auth='user', methods=['POST'])
    def mark_as_read(self, conversation_id, **kwargs):
        """Mark conversation as read"""
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if conversation.exists():
                conversation.mark_as_read()
            return {'ok': True}
        except Exception as e:
            _logger.exception(f"Error marking as read: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/new_conversation', type='json', auth='user', methods=['POST'])
    def new_conversation(self, phone, partner_id=False, **kwargs):
        """Start a new conversation"""
        try:
            phone = ''.join(filter(str.isdigit, str(phone)))
            if not phone:
                return {'ok': False, 'error': 'Invalid phone number'}

            # Get logged_in_phone from config to set as owner
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            owner_phone = config.logged_in_phone if config else False

            conversation = request.env['whatsapp.conversation'].get_or_create(phone, partner_id, owner_phone=owner_phone)
            return {
                'ok': True,
                'conversation': conversation._format_for_frontend()
            }
        except Exception as e:
            _logger.exception(f"Error creating conversation: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/search_contacts', type='json', auth='user', methods=['POST'])
    def search_contacts(self, query='', limit=50, **kwargs):
        """Search contacts for new conversation. Returns contacts with phone numbers."""
        try:
            # If query is provided, filter by name/phone/email
            if query and query.strip():
                search_domain = [
                    '|', '|',
                    ('name', 'ilike', query),
                    ('phone', 'ilike', query),
                    ('email', 'ilike', query),
                ]
            else:
                # No query: return all contacts
                search_domain = []

            partners = request.env['res.partner'].search(
                search_domain,
                limit=limit * 3,  # Fetch more to filter those with phones
                order='name asc'
            )

            _logger.info(f"Found {len(partners)} partners for query: '{query}'")

            results = []
            for partner in partners:
                try:
                    # Get phone field
                    phone = None
                    if partner.phone:
                        phone = str(partner.phone).strip()

                    # Skip if no phone number
                    if not phone:
                        continue

                    # Clean phone number - extract digits
                    clean_phone = ''.join(c for c in phone if c.isdigit())
                    if not clean_phone:
                        continue

                    # Get avatar safely
                    avatar = False
                    try:
                        if partner.image_128:
                            if isinstance(partner.image_128, bytes):
                                avatar = partner.image_128.decode('utf-8')
                            else:
                                avatar = partner.image_128
                    except Exception:
                        avatar = False

                    results.append({
                        'id': partner.id,
                        'name': partner.name or 'Unknown',
                        'phone': clean_phone,
                        'display_phone': phone,
                        'email': partner.email or '',
                        'avatar': avatar,
                    })

                    # Stop when we have enough results
                    if len(results) >= limit:
                        break

                except Exception as partner_error:
                    _logger.warning(f"Error processing partner {partner.id}: {partner_error}")
                    continue

            _logger.info(f"Returning {len(results)} contacts with phone numbers")
            return {'ok': True, 'contacts': results, 'count': len(results)}

        except Exception as e:
            _logger.exception(f"Error searching contacts: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/contact/create', type='json', auth='user', methods=['POST'])
    def create_contact(self, name, phone, conversation_id=None, **kwargs):
        """Create a new contact from an unknown WhatsApp number"""
        try:
            if not name or not phone:
                return {'ok': False, 'error': 'Name and phone are required'}

            # Clean phone number
            clean_phone = ''.join(c for c in str(phone) if c.isdigit())
            if not clean_phone:
                return {'ok': False, 'error': 'Invalid phone number'}

            # Check if partner already exists with this phone
            existing = request.env['res.partner'].search([
                ('phone', 'ilike', clean_phone)
            ], limit=1)

            if existing:
                partner = existing
                _logger.info(f"Found existing partner {partner.id} for phone {clean_phone}")
            else:
                # Create new partner
                partner = request.env['res.partner'].create({
                    'name': name.strip(),
                    'phone': clean_phone,
                })
                _logger.info(f"Created new partner {partner.id}: {name} ({clean_phone})")

            # Link to conversation if provided
            if conversation_id:
                conversation = request.env['whatsapp.conversation'].browse(conversation_id)
                if conversation.exists() and not conversation.partner_id:
                    conversation.partner_id = partner.id
                    _logger.info(f"Linked partner {partner.id} to conversation {conversation_id}")

            return {
                'ok': True,
                'partner_id': partner.id,
                'name': partner.name,
                'phone': partner.phone
            }

        except Exception as e:
            _logger.exception(f"Error creating contact: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversation/<int:conversation_id>', type='json', auth='user', methods=['POST'])
    def get_conversation(self, conversation_id, **kwargs):
        """Get single conversation details"""
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists():
                return {'ok': False, 'error': 'Conversation not found'}
            return {
                'ok': True,
                'conversation': conversation._format_for_frontend()
            }
        except Exception as e:
            _logger.exception(f"Error fetching conversation: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/send_media', type='json', auth='user', methods=['POST'])
    def send_media(self, conversation_id, media_base64=None, media_url=None,
                   caption=None, filename=None, mimetype=None, **kwargs):
        """Send media in a conversation (individual or group)"""
        try:
            conversation = request.env['whatsapp.conversation'].sudo().browse(conversation_id)
            if not conversation.exists():
                return {'ok': False, 'error': 'Conversation not found'}

            config = request.env['whatsapp.config'].get_default_config()

            # Ensure conversation has owner_phone set
            if not conversation.owner_phone and config.logged_in_phone:
                conversation.owner_phone = config.logged_in_phone

            # Determine recipient based on conversation type
            if conversation.is_group:
                recipient = conversation.group_id
            else:
                recipient = conversation.phone

            # Send via WhatsApp
            result = config.send_media(
                recipient,
                media_url=media_url,
                media_base64=media_base64,
                caption=caption,
                filename=filename,
                mimetype=mimetype,
                is_group=conversation.is_group
            )

            # Determine message type from mimetype
            msg_type = 'document'
            if mimetype:
                if mimetype.startswith('image/'):
                    msg_type = 'image'
                elif mimetype.startswith('video/'):
                    msg_type = 'video'
                elif mimetype.startswith('audio/'):
                    msg_type = 'audio'

            # Create message record
            msg_vals = {
                'conversation_id': conversation.id,
                'body': caption or '',
                'direction': 'outgoing',
                'state': 'sent' if result.get('ok') else 'failed',
                'message_id': result.get('messageId'),
                'message_type': msg_type,
                'has_media': True,
                'media_filename': filename,
                'media_mimetype': mimetype,
            }

            if conversation.is_group:
                msg_vals['group_id'] = conversation.group_id
            else:
                msg_vals['phone'] = conversation.phone
                msg_vals['partner_id'] = conversation.partner_id.id if conversation.partner_id else False

            msg = request.env['whatsapp.message'].create(msg_vals)

            return {
                'ok': True,
                'message': msg._format_for_frontend()
            }
        except Exception as e:
            _logger.exception(f"Error sending media: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/normalize_phones', type='http', auth='none', csrf=False, methods=['POST', 'GET'])
    def normalize_phones(self, **kwargs):
        """Normalize all phone numbers and merge duplicate conversations"""
        try:
            merged_count = request.env['whatsapp.conversation'].sudo().normalize_all_phones()
            return json.dumps({'ok': True, 'merged_count': merged_count})
        except Exception as e:
            _logger.exception(f"Error normalizing phones: {e}")
            return json.dumps({'ok': False, 'error': str(e)})

    @http.route('/whatsapp/migrate_conversations', type='json', auth='user', methods=['POST'])
    def migrate_conversations_to_owner(self, **kwargs):
        """Migrate conversations without owner_phone to the current logged-in phone.
        This assigns orphan conversations to the currently connected WhatsApp account."""
        try:
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            if not config or not config.logged_in_phone:
                return {'ok': False, 'error': 'No logged-in phone number found. Please connect to WhatsApp first.'}

            owner_phone = config.logged_in_phone

            # Find conversations without owner_phone
            orphan_conversations = request.env['whatsapp.conversation'].sudo().search([
                ('owner_phone', '=', False),
                ('active', '=', True)
            ])

            if not orphan_conversations:
                return {'ok': True, 'message': 'No orphan conversations to migrate', 'count': 0}

            # Update owner_phone for orphan conversations
            orphan_conversations.write({'owner_phone': owner_phone})

            _logger.info(f"Migrated {len(orphan_conversations)} conversations to owner_phone: {owner_phone}")

            return {
                'ok': True,
                'message': f'Migrated {len(orphan_conversations)} conversations to current account',
                'count': len(orphan_conversations),
                'owner_phone': owner_phone
            }
        except Exception as e:
            _logger.exception(f"Error migrating conversations: {e}")
            return {'ok': False, 'error': str(e)}

    # ==================== Group Endpoints ====================

    @http.route('/whatsapp/groups', type='json', auth='user', methods=['POST'])
    def get_groups(self, limit=50, offset=0, **kwargs):
        """Get list of group conversations"""
        try:
            # Get logged_in_phone from config to filter groups
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            owner_phone = config.logged_in_phone if config else False

            domain = [
                ('is_group', '=', True),
                ('active', '=', True)
            ]
            # Filter by owner_phone if available
            if owner_phone:
                domain.append(('owner_phone', '=', owner_phone))

            conversations = request.env['whatsapp.conversation'].sudo().search(
                domain, limit=limit, offset=offset, order='last_message_date desc'
            )
            return {
                'ok': True,
                'groups': [conv._format_for_frontend() for conv in conversations]
            }
        except Exception as e:
            _logger.exception(f"Error fetching groups: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/group/create', type='json', auth='user', methods=['POST'])
    def create_group(self, name, participants, admin_only=False, **kwargs):
        """Create a new WhatsApp group

        Args:
            name: Group name
            participants: List of phone numbers
            admin_only: If True, only admins can send messages
        """
        try:
            if not name or not participants:
                return {'ok': False, 'error': 'Group name and participants are required'}

            config = request.env['whatsapp.config'].get_default_config()

            # Call bot to create group with admin_only setting
            result = config.create_group(name, participants, admin_only=admin_only)
            _logger.info(f"Group creation result: {result}")

            if result.get('ok'):
                # Get group ID from response - bot returns it in result.group.id
                group_data = result.get('group', {})
                group_id = group_data.get('id') or result.get('groupId') or result.get('gid')

                if not group_id:
                    return {'ok': False, 'error': 'Group created but no group ID returned'}

                # Get logged_in_phone from config to set as owner
                owner_phone = config.logged_in_phone if config else False

                # Create conversation record for the new group
                conversation = request.env['whatsapp.conversation'].sudo().get_or_create_group(
                    group_id,
                    name,
                    participants,
                    owner_phone=owner_phone
                )

                if not conversation:
                    return {'ok': False, 'error': 'Failed to create conversation record'}

                return {
                    'ok': True,
                    'group': conversation._format_for_frontend()
                }
            else:
                return {'ok': False, 'error': result.get('error', 'Failed to create group')}

        except Exception as e:
            _logger.exception(f"Error creating group: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/group/<int:conversation_id>/info', type='json', auth='user', methods=['POST'])
    def get_group_info(self, conversation_id, **kwargs):
        """Get group information including participants"""
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists() or not conversation.is_group:
                return {'ok': False, 'error': 'Group not found'}

            # Try to refresh group info from WhatsApp
            config = request.env['whatsapp.config'].get_default_config()
            result = config.get_group_info(conversation.group_id)

            if result.get('ok'):
                # Update local record
                update_vals = {}
                if result.get('name'):
                    update_vals['group_name'] = result['name']
                if result.get('description'):
                    update_vals['group_description'] = result['description']
                if result.get('participants'):
                    update_vals['group_participants'] = json.dumps(result['participants'])
                if update_vals:
                    conversation.write(update_vals)

            return {
                'ok': True,
                'group': conversation._format_for_frontend()
            }
        except Exception as e:
            _logger.exception(f"Error fetching group info: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/group/<int:conversation_id>/add_participant', type='json', auth='user', methods=['POST'])
    def add_group_participant(self, conversation_id, phone, **kwargs):
        """Add a participant to a group"""
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists() or not conversation.is_group:
                return {'ok': False, 'error': 'Group not found'}

            phone = ''.join(filter(str.isdigit, str(phone)))
            if not phone:
                return {'ok': False, 'error': 'Invalid phone number'}

            config = request.env['whatsapp.config'].get_default_config()
            result = config.add_group_participant(conversation.group_id, phone)

            if result.get('ok'):
                # Update local participants list
                participants = []
                if conversation.group_participants:
                    try:
                        participants = json.loads(conversation.group_participants)
                    except:
                        participants = []
                if phone not in participants:
                    participants.append(phone)
                    conversation.group_participants = json.dumps(participants)

            return result

        except Exception as e:
            _logger.exception(f"Error adding participant: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/group/<int:conversation_id>/remove_participant', type='json', auth='user', methods=['POST'])
    def remove_group_participant(self, conversation_id, phone, **kwargs):
        """Remove a participant from a group (admin only)"""
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists() or not conversation.is_group:
                return {'ok': False, 'error': 'Group not found'}

            # Check if current user is admin
            if not conversation.created_by_uid or conversation.created_by_uid.id != request.env.uid:
                return {'ok': False, 'error': 'Only group admin can remove participants'}

            phone = ''.join(filter(str.isdigit, str(phone)))
            if not phone:
                return {'ok': False, 'error': 'Invalid phone number'}

            config = request.env['whatsapp.config'].get_default_config()
            result = config.remove_group_participant(conversation.group_id, phone)

            if result.get('ok'):
                # Update local participants list
                participants = []
                if conversation.group_participants:
                    try:
                        participants = json.loads(conversation.group_participants)
                    except:
                        participants = []
                if phone in participants:
                    participants.remove(phone)
                    conversation.group_participants = json.dumps(participants)

            return result

        except Exception as e:
            _logger.exception(f"Error removing participant: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/group/<int:conversation_id>/set_admin', type='json', auth='user', methods=['POST'])
    def set_group_admin(self, conversation_id, **kwargs):
        """Set current user as admin of a group (only if no admin exists)"""
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists() or not conversation.is_group:
                return {'ok': False, 'error': 'Group not found'}

            # Only allow if no admin is set yet
            if conversation.created_by_uid:
                if conversation.created_by_uid.id == request.env.uid:
                    return {'ok': True, 'message': 'You are already the admin'}
                else:
                    return {'ok': False, 'error': 'This group already has an admin'}

            # Set current user as admin
            conversation.created_by_uid = request.env.uid
            _logger.info(f"User {request.env.uid} set as admin of group {conversation.group_name}")

            return {
                'ok': True,
                'message': 'You are now the admin of this group',
                'group': conversation._format_for_frontend()
            }

        except Exception as e:
            _logger.exception(f"Error setting admin: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/group/<int:conversation_id>/settings', type='json', auth='user', methods=['POST'])
    def update_group_settings(self, conversation_id, admin_only, **kwargs):
        """Update group settings (message permissions)

        Args:
            conversation_id: The conversation ID
            admin_only: If True, only admins can send messages. If False, all members can send.
        """
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists() or not conversation.is_group:
                return {'ok': False, 'error': 'Group not found'}

            # Check if current user is admin
            if not conversation.created_by_uid or conversation.created_by_uid.id != request.env.uid:
                return {'ok': False, 'error': 'Only group admin can change settings'}

            config = request.env['whatsapp.config'].get_default_config()
            result = config.set_group_settings(conversation.group_id, admin_only)

            if result.get('ok'):
                _logger.info(f"Group {conversation.group_name} settings updated: admin_only={admin_only}")

            return result

        except Exception as e:
            _logger.exception(f"Error updating group settings: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/group/<int:conversation_id>/leave', type='json', auth='user', methods=['POST'])
    def leave_group(self, conversation_id, **kwargs):
        """Leave a WhatsApp group"""
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists() or not conversation.is_group:
                return {'ok': False, 'error': 'Group not found'}

            config = request.env['whatsapp.config'].get_default_config()
            result = config.leave_group(conversation.group_id)

            if result.get('ok'):
                # Archive the conversation
                conversation.active = False

            return result

        except Exception as e:
            _logger.exception(f"Error leaving group: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/group/<int:conversation_id>/rename', type='json', auth='user', methods=['POST'])
    def rename_group(self, conversation_id, name, **kwargs):
        """Rename a WhatsApp group"""
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists() or not conversation.is_group:
                return {'ok': False, 'error': 'Group not found'}

            if not name or not name.strip():
                return {'ok': False, 'error': 'Group name is required'}

            config = request.env['whatsapp.config'].get_default_config()
            result = config.rename_group(conversation.group_id, name.strip())

            if result.get('ok'):
                # Update local record
                conversation.group_name = name.strip()

            return {
                'ok': result.get('ok', False),
                'group': conversation._format_for_frontend() if result.get('ok') else None,
                'error': result.get('error')
            }

        except Exception as e:
            _logger.exception(f"Error renaming group: {e}")
            return {'ok': False, 'error': str(e)}

    # ==================== Chat Settings Endpoints (WhatsApp-like) ====================

    @http.route('/whatsapp/conversation/<int:conversation_id>/pin', type='json', auth='user', methods=['POST'])
    def pin_conversation(self, conversation_id, **kwargs):
        """Pin or unpin a conversation"""
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists():
                return {'ok': False, 'error': 'Conversation not found'}

            conversation.action_pin()
            return {
                'ok': True,
                'is_pinned': conversation.is_pinned,
                'message': 'Conversation pinned' if conversation.is_pinned else 'Conversation unpinned'
            }
        except Exception as e:
            _logger.exception(f"Error pinning conversation: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversation/<int:conversation_id>/mute', type='json', auth='user', methods=['POST'])
    def mute_conversation(self, conversation_id, duration=None, **kwargs):
        """Mute or unmute a conversation

        Args:
            duration: 'forever', '8hours', '1week', 'unmute', or None to toggle
        """
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists():
                return {'ok': False, 'error': 'Conversation not found'}

            conversation.action_mute(duration)

            if conversation.is_muted:
                if conversation.mute_until:
                    msg = f'Muted until {conversation.mute_until}'
                else:
                    msg = 'Muted'
            else:
                msg = 'Unmuted'

            return {
                'ok': True,
                'is_muted': conversation.is_muted,
                'mute_until': conversation.mute_until.isoformat() if conversation.mute_until else False,
                'message': msg
            }
        except Exception as e:
            _logger.exception(f"Error muting conversation: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversation/<int:conversation_id>/block', type='json', auth='user', methods=['POST'])
    def block_conversation(self, conversation_id, **kwargs):
        """Block or unblock a contact"""
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists():
                return {'ok': False, 'error': 'Conversation not found'}

            if conversation.is_group:
                return {'ok': False, 'error': 'Cannot block groups'}

            conversation.action_block()
            return {
                'ok': True,
                'is_blocked': conversation.is_blocked,
                'message': 'Contact blocked' if conversation.is_blocked else 'Contact unblocked'
            }
        except Exception as e:
            _logger.exception(f"Error blocking contact: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversation/<int:conversation_id>/archive', type='json', auth='user', methods=['POST'])
    def archive_conversation(self, conversation_id, **kwargs):
        """Archive or unarchive a conversation"""
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists():
                return {'ok': False, 'error': 'Conversation not found'}

            conversation.action_archive()
            return {
                'ok': True,
                'is_archived': conversation.is_archived,
                'message': 'Chat archived' if conversation.is_archived else 'Chat unarchived'
            }
        except Exception as e:
            _logger.exception(f"Error archiving conversation: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversation/<int:conversation_id>/clear', type='json', auth='user', methods=['POST'])
    def clear_conversation(self, conversation_id, **kwargs):
        """Clear all messages in a conversation"""
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists():
                return {'ok': False, 'error': 'Conversation not found'}

            conversation.action_clear_chat()
            return {
                'ok': True,
                'message': 'Chat cleared',
                'conversation': conversation._format_for_frontend()
            }
        except Exception as e:
            _logger.exception(f"Error clearing conversation: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversation/<int:conversation_id>/delete', type='json', auth='user', methods=['POST'])
    def delete_conversation(self, conversation_id, **kwargs):
        """Delete a conversation and all its messages"""
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists():
                return {'ok': False, 'error': 'Conversation not found'}

            conversation.action_delete_chat()
            return {
                'ok': True,
                'message': 'Chat deleted'
            }
        except Exception as e:
            _logger.exception(f"Error deleting conversation: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversation/<int:conversation_id>/wallpaper', type='json', auth='user', methods=['POST'])
    def set_wallpaper(self, conversation_id, wallpaper=None, **kwargs):
        """Set chat wallpaper"""
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists():
                return {'ok': False, 'error': 'Conversation not found'}

            conversation.wallpaper = wallpaper
            return {
                'ok': True,
                'wallpaper': wallpaper,
                'message': 'Wallpaper updated' if wallpaper else 'Wallpaper removed'
            }
        except Exception as e:
            _logger.exception(f"Error setting wallpaper: {e}")
            return {'ok': False, 'error': str(e)}

    # ==================== Message Action Endpoints ====================

    @http.route('/whatsapp/message/<int:message_id>/star', type='json', auth='user', methods=['POST'])
    def star_message(self, message_id, **kwargs):
        """Star or unstar a message"""
        try:
            message = request.env['whatsapp.message'].sudo().browse(message_id)
            if not message.exists():
                return {'ok': False, 'error': 'Message not found'}

            message.is_starred = not message.is_starred
            if message.is_starred:
                message.starred_at = datetime.now()
            else:
                message.starred_at = False

            return {
                'ok': True,
                'is_starred': message.is_starred,
                'message': 'Message starred' if message.is_starred else 'Message unstarred'
            }
        except Exception as e:
            _logger.exception(f"Error starring message: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/message/<int:message_id>/delete', type='json', auth='user', methods=['POST'])
    def delete_message(self, message_id, delete_for='me', **kwargs):
        """Delete a message

        Args:
            message_id: The message ID
            delete_for: 'me' or 'everyone'
        """
        try:
            message = request.env['whatsapp.message'].sudo().browse(message_id)
            if not message.exists():
                return {'ok': False, 'error': 'Message not found'}

            # Only allow delete for everyone on outgoing messages
            if delete_for == 'everyone' and message.direction != 'outgoing':
                return {'ok': False, 'error': 'Can only delete your own messages for everyone'}

            # Try to delete on WhatsApp if delete_for_everyone
            if delete_for == 'everyone' and message.message_id:
                try:
                    config = request.env['whatsapp.config'].get_default_config()
                    # Note: This requires bot server support for message deletion
                    # config.delete_message(message.message_id)
                except Exception as e:
                    _logger.warning(f"Could not delete message on WhatsApp: {e}")

            message.write({
                'is_deleted': True,
                'deleted_at': datetime.now(),
                'deleted_for': delete_for,
            })

            return {
                'ok': True,
                'message': message._format_for_frontend()
            }
        except Exception as e:
            _logger.exception(f"Error deleting message: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/message/<int:message_id>/edit', type='json', auth='user', methods=['POST'])
    def edit_message(self, message_id, new_body, **kwargs):
        """Edit a message (only own outgoing messages)"""
        try:
            message = request.env['whatsapp.message'].sudo().browse(message_id)
            if not message.exists():
                return {'ok': False, 'error': 'Message not found'}

            if message.direction != 'outgoing':
                return {'ok': False, 'error': 'Can only edit your own messages'}

            if message.is_deleted:
                return {'ok': False, 'error': 'Cannot edit deleted message'}

            # Store original body if not already edited
            if not message.is_edited:
                message.original_body = message.body

            message.write({
                'body': new_body.strip(),
                'is_edited': True,
                'edited_at': datetime.now(),
            })

            return {
                'ok': True,
                'message': message._format_for_frontend()
            }
        except Exception as e:
            _logger.exception(f"Error editing message: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/message/forward', type='json', auth='user', methods=['POST'])
    def forward_message(self, message_id, conversation_ids, **kwargs):
        """Forward a message to one or more conversations

        Args:
            message_id: The message to forward
            conversation_ids: List of conversation IDs to forward to
        """
        try:
            original_message = request.env['whatsapp.message'].sudo().browse(message_id)
            if not original_message.exists():
                return {'ok': False, 'error': 'Message not found'}

            if not conversation_ids:
                return {'ok': False, 'error': 'No conversations selected'}

            forwarded_messages = []
            config = request.env['whatsapp.config'].get_default_config()

            for conv_id in conversation_ids:
                conversation = request.env['whatsapp.conversation'].sudo().browse(conv_id)
                if not conversation.exists():
                    continue

                # Ensure conversation has owner_phone set
                if not conversation.owner_phone and config.logged_in_phone:
                    conversation.owner_phone = config.logged_in_phone

                # Prepare message values
                msg_vals = {
                    'conversation_id': conversation.id,
                    'body': original_message.body,
                    'direction': 'outgoing',
                    'state': 'sent',
                    'timestamp': datetime.now(),
                    'is_forwarded': True,
                    'forwarded_from_id': original_message.id,
                    'message_type': original_message.message_type,
                    'has_media': original_message.has_media,
                    'media_data': original_message.media_data,
                    'media_mimetype': original_message.media_mimetype,
                    'media_filename': original_message.media_filename,
                }

                if conversation.is_group:
                    msg_vals['group_id'] = conversation.group_id
                else:
                    msg_vals['phone'] = conversation.phone
                    msg_vals['partner_id'] = conversation.partner_id.id if conversation.partner_id else False

                # Send via WhatsApp
                try:
                    if original_message.has_media and original_message.media_data:
                        # Forward media
                        result = config.send_media(
                            conversation.group_id if conversation.is_group else conversation.phone,
                            media_base64=original_message.media_data,
                            caption=original_message.body,
                            filename=original_message.media_filename,
                            mimetype=original_message.media_mimetype,
                            is_group=conversation.is_group
                        )
                    else:
                        # Forward text
                        result = config.send_message(
                            conversation.group_id if conversation.is_group else conversation.phone,
                            original_message.body,
                            is_group=conversation.is_group
                        )

                    if result.get('ok'):
                        msg_vals['message_id'] = result.get('messageId')
                    else:
                        msg_vals['state'] = 'failed'
                        msg_vals['error_message'] = result.get('error')
                except Exception as e:
                    msg_vals['state'] = 'failed'
                    msg_vals['error_message'] = str(e)

                msg = request.env['whatsapp.message'].sudo().create(msg_vals)
                forwarded_messages.append(msg._format_for_frontend())

            return {
                'ok': True,
                'forwarded_count': len(forwarded_messages),
                'messages': forwarded_messages
            }
        except Exception as e:
            _logger.exception(f"Error forwarding message: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/message/<int:message_id>/react', type='json', auth='user', methods=['POST'])
    def react_to_message(self, message_id, emoji, **kwargs):
        """Add or remove a reaction to a message"""
        try:
            message = request.env['whatsapp.message'].sudo().browse(message_id)
            if not message.exists():
                return {'ok': False, 'error': 'Message not found'}

            result = request.env['whatsapp.reaction'].sudo().add_reaction(message_id, emoji)

            # Try to send reaction to WhatsApp
            if message.message_id:
                try:
                    config = request.env['whatsapp.config'].get_default_config()
                    # Note: This requires bot server support for reactions
                    # config.react_to_message(message.message_id, emoji if result['action'] != 'removed' else '')
                except Exception as e:
                    _logger.warning(f"Could not send reaction to WhatsApp: {e}")

            # Get updated reaction summary
            message.invalidate_recordset(['reaction_summary'])
            reactions = {}
            if message.reaction_summary:
                try:
                    reactions = json.loads(message.reaction_summary)
                except:
                    pass

            return {
                'ok': True,
                'action': result['action'],
                'emoji': result['emoji'],
                'reactions': reactions
            }
        except Exception as e:
            _logger.exception(f"Error reacting to message: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/search', type='json', auth='user', methods=['POST'])
    def search_messages(self, query, conversation_id=None, limit=50, **kwargs):
        """Search messages

        Args:
            query: Search text
            conversation_id: Optional - search within specific conversation
            limit: Max results to return
        """
        try:
            if not query or len(query.strip()) < 2:
                return {'ok': False, 'error': 'Search query too short'}

            # Get logged_in_phone from config to filter by owner
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            owner_phone = config.logged_in_phone if config else False

            domain = [
                ('body', 'ilike', query.strip()),
                ('is_deleted', '=', False),
            ]

            # Filter by owner_phone through conversation
            if owner_phone:
                domain.append(('conversation_id.owner_phone', '=', owner_phone))

            if conversation_id:
                domain.append(('conversation_id', '=', conversation_id))

            messages = request.env['whatsapp.message'].sudo().search(
                domain,
                limit=limit,
                order='timestamp desc'
            )

            results = []
            for msg in messages:
                result = msg._format_for_frontend()
                # Add conversation info for global search
                if not conversation_id and msg.conversation_id:
                    result['conversation_name'] = msg.conversation_id.display_name
                results.append(result)

            return {
                'ok': True,
                'results': results,
                'count': len(results)
            }
        except Exception as e:
            _logger.exception(f"Error searching messages: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/starred', type='json', auth='user', methods=['POST'])
    def get_starred_messages(self, limit=50, offset=0, **kwargs):
        """Get all starred messages"""
        try:
            # Get logged_in_phone from config to filter by owner
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            owner_phone = config.logged_in_phone if config else False

            domain = [
                ('is_starred', '=', True),
                ('is_deleted', '=', False),
            ]

            # Filter by owner_phone through conversation
            if owner_phone:
                domain.append(('conversation_id.owner_phone', '=', owner_phone))

            messages = request.env['whatsapp.message'].sudo().search(
                domain, limit=limit, offset=offset, order='starred_at desc'
            )

            results = []
            for msg in messages:
                result = msg._format_for_frontend()
                if msg.conversation_id:
                    result['conversation_name'] = msg.conversation_id.display_name
                results.append(result)

            return {
                'ok': True,
                'messages': results,
                'count': len(results)
            }
        except Exception as e:
            _logger.exception(f"Error fetching starred messages: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversations/archived', type='json', auth='user', methods=['POST'])
    def get_archived_conversations(self, limit=50, offset=0, **kwargs):
        """Get archived conversations"""
        try:
            # Get logged_in_phone from config to filter archived conversations
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            owner_phone = config.logged_in_phone if config else False

            domain = [
                ('is_archived', '=', True),
                ('active', '=', True),
            ]
            # Filter by owner_phone if available
            if owner_phone:
                domain.append(('owner_phone', '=', owner_phone))

            conversations = request.env['whatsapp.conversation'].sudo().search(
                domain, limit=limit, offset=offset, order='last_message_date desc'
            )

            return {
                'ok': True,
                'conversations': [conv._format_for_frontend() for conv in conversations],
                'count': len(conversations)
            }
        except Exception as e:
            _logger.exception(f"Error fetching archived conversations: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversation/<int:conversation_id>/media', type='json', auth='user', methods=['POST'])
    def get_conversation_media(self, conversation_id, media_type=None, limit=50, offset=0, **kwargs):
        """Get media messages from a conversation

        Args:
            conversation_id: The conversation ID
            media_type: Optional filter - 'image', 'video', 'audio', 'document'
            limit: Max results
            offset: Pagination offset
        """
        try:
            domain = [
                ('conversation_id', '=', conversation_id),
                ('has_media', '=', True),
                ('is_deleted', '=', False),
            ]

            if media_type:
                domain.append(('message_type', '=', media_type))

            messages = request.env['whatsapp.message'].sudo().search(
                domain,
                limit=limit,
                offset=offset,
                order='timestamp desc'
            )

            return {
                'ok': True,
                'media': [msg._format_for_frontend() for msg in messages],
                'count': len(messages)
            }
        except Exception as e:
            _logger.exception(f"Error fetching media: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversation/<int:conversation_id>/typing', type='json', auth='user', methods=['POST'])
    def send_typing_indicator(self, conversation_id, typing=True, **kwargs):
        """Send typing indicator to a conversation"""
        try:
            conversation = request.env['whatsapp.conversation'].sudo().browse(conversation_id)
            if not conversation.exists():
                return {'ok': False, 'error': 'Conversation not found'}

            # Send typing indicator to WhatsApp
            try:
                config = request.env['whatsapp.config'].get_default_config()
                if config and config.server_url:
                    import requests
                    headers = {
                        'Content-Type': 'application/json',
                        'X-API-Key': config.api_key,
                    }
                    payload = {'typing': typing}
                    if conversation.is_group:
                        payload['groupId'] = conversation.group_id
                    else:
                        payload['number'] = conversation.phone

                    requests.post(
                        f"{config.server_url.rstrip('/')}/typing",
                        headers=headers,
                        json=payload,
                        timeout=5
                    )
            except Exception as e:
                _logger.debug(f"Could not send typing indicator: {e}")

            return {'ok': True}
        except Exception as e:
            _logger.exception(f"Error sending typing indicator: {e}")
            return {'ok': False, 'error': str(e)}

    # ==================== WhatsApp Session Management ====================

    @http.route('/whatsapp/logout', type='json', auth='user', methods=['POST'])
    def logout_whatsapp(self, **kwargs):
        """Logout from WhatsApp and disconnect the session"""
        try:
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            if not config:
                return {'ok': False, 'error': 'No WhatsApp configuration found'}

            # Call the config's action_logout method
            import requests as req
            response = req.post(
                f"{config.server_url.rstrip('/')}/logout",
                headers={
                    'Content-Type': 'application/json',
                    'X-API-Key': config.api_key,
                },
                timeout=30
            )
            data = response.json()

            if data.get('ok'):
                config.state = 'disconnected'
                config.logged_in_phone = False  # Clear logged in phone on logout
                _logger.info("WhatsApp logged out successfully")
                return {
                    'ok': True,
                    'message': 'Successfully logged out from WhatsApp'
                }
            else:
                return {'ok': False, 'error': data.get('error', 'Failed to logout')}

        except Exception as e:
            _logger.exception(f"Error logging out from WhatsApp: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/qr', type='json', auth='user', methods=['POST'])
    def get_qr_code(self, **kwargs):
        """Get QR code for WhatsApp login"""
        try:
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            if not config:
                return {'ok': False, 'error': 'No WhatsApp configuration found'}

            import requests as req
            # First check status
            try:
                health_response = req.get(
                    f"{config.server_url.rstrip('/')}/health",
                    timeout=5
                )
                health_data = health_response.json()

                if health_data.get('ready'):
                    # Already connected
                    config.state = 'connected'
                    # Try to get logged_in_phone from the bot server response
                    phone = health_data.get('phone', health_data.get('me', {}).get('phone', health_data.get('wid', '')))
                    if phone:
                        normalized_phone = request.env['whatsapp.conversation'].sudo()._normalize_phone(
                            str(phone).replace('@c.us', '')
                        )
                        if normalized_phone and config.logged_in_phone != normalized_phone:
                            config.logged_in_phone = normalized_phone
                            _logger.info(f"Updated logged_in_phone from QR health check: {normalized_phone}")
                    return {
                        'ok': True,
                        'connected': True,
                        'logged_in_phone': config.logged_in_phone or False,
                        'message': 'WhatsApp is already connected'
                    }
            except Exception as e:
                _logger.warning(f"Health check failed: {e}")

            # Get QR code
            response = req.get(
                f"{config.server_url.rstrip('/')}/qr",
                headers={
                    'Content-Type': 'application/json',
                    'X-API-Key': config.api_key,
                },
                timeout=30
            )

            if response.status_code == 200:
                data = response.json()
                if data.get('qr'):
                    return {
                        'ok': True,
                        'qr': data['qr'],
                        'connected': False
                    }
                elif data.get('connected') or data.get('ready'):
                    config.state = 'connected'
                    # Try to get logged_in_phone from the response
                    phone = data.get('phone', data.get('me', {}).get('phone', data.get('wid', '')))
                    if phone:
                        normalized_phone = request.env['whatsapp.conversation'].sudo()._normalize_phone(
                            str(phone).replace('@c.us', '')
                        )
                        if normalized_phone and config.logged_in_phone != normalized_phone:
                            config.logged_in_phone = normalized_phone
                            _logger.info(f"Updated logged_in_phone from QR response: {normalized_phone}")
                    return {
                        'ok': True,
                        'connected': True,
                        'logged_in_phone': config.logged_in_phone or False,
                        'message': 'WhatsApp is connected'
                    }
                else:
                    return {'ok': False, 'error': 'No QR code available. Try again.'}
            else:
                return {'ok': False, 'error': f'Server returned status {response.status_code}'}

        except Exception as e:
            _logger.exception(f"Error getting QR code: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/check_connection', type='json', auth='user', methods=['POST'])
    def check_connection(self, **kwargs):
        """Check if WhatsApp is connected"""
        try:
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            if not config:
                return {'ok': False, 'connected': False, 'error': 'No WhatsApp configuration found'}

            import requests as req
            response = req.get(
                f"{config.server_url.rstrip('/')}/health",
                timeout=5
            )
            data = response.json()

            connected = data.get('ready', False)
            if connected:
                config.state = 'connected'
                # Try to get logged_in_phone from the bot server response
                phone = data.get('phone', data.get('me', {}).get('phone', data.get('wid', '')))
                if phone:
                    normalized_phone = request.env['whatsapp.conversation'].sudo()._normalize_phone(
                        str(phone).replace('@c.us', '')
                    )
                    if normalized_phone and config.logged_in_phone != normalized_phone:
                        config.logged_in_phone = normalized_phone
                        _logger.info(f"Updated logged_in_phone from health check: {normalized_phone}")
            else:
                config.state = 'disconnected'

            return {
                'ok': True,
                'connected': connected,
                'hasQr': data.get('hasQr', False),
                'logged_in_phone': config.logged_in_phone or False
            }

        except Exception as e:
            _logger.exception(f"Error checking connection: {e}")
            return {'ok': False, 'connected': False, 'error': str(e)}

    @http.route('/whatsapp/me', type='json', auth='user', methods=['POST'])
    def get_current_account(self, **kwargs):
        """Get current logged-in WhatsApp account info from bot server"""
        try:
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            if not config:
                return {'ok': False, 'error': 'No WhatsApp configuration found'}

            import requests as req
            response = req.get(
                f"{config.server_url.rstrip('/')}/me",
                headers={
                    'Content-Type': 'application/json',
                    'X-API-Key': config.api_key,
                },
                timeout=10
            )
            data = response.json()

            if data.get('ok') and data.get('phone'):
                # Normalize and store the phone number
                normalized_phone = request.env['whatsapp.conversation'].sudo()._normalize_phone(
                    str(data['phone'])
                )
                if normalized_phone and config.logged_in_phone != normalized_phone:
                    config.logged_in_phone = normalized_phone
                    _logger.info(f"Updated logged_in_phone from /me endpoint: {normalized_phone}")

                return {
                    'ok': True,
                    'phone': normalized_phone,
                    'pushname': data.get('pushname'),
                    'connected': data.get('connected', False)
                }
            elif data.get('ok') and not data.get('phone'):
                return {'ok': True, 'phone': False, 'error': 'Not connected or phone not available'}
            else:
                return {'ok': False, 'error': data.get('error', 'Failed to get account info')}

        except Exception as e:
            _logger.exception(f"Error getting current account: {e}")
            return {'ok': False, 'error': str(e)}
