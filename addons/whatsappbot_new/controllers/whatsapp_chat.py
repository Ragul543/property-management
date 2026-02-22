# -*- coding: utf-8 -*-
import json
import logging
from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)


class WhatsAppChatController(http.Controller):

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
            # Clear cache to ensure fresh data
            request.env['whatsapp.conversation'].invalidate_model()
            conversations = request.env['whatsapp.conversation'].get_conversations_for_user(
                limit=limit,
                offset=offset
            )
            return {'ok': True, 'conversations': conversations}
        except Exception as e:
            _logger.exception(f"Error fetching conversations: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversation/<int:conversation_id>/messages', type='json', auth='user', methods=['POST'])
    def get_messages(self, conversation_id, limit=50, offset=0, **kwargs):
        """Get messages for a conversation"""
        try:
            # Clear cache to ensure fresh data
            request.env['whatsapp.message'].invalidate_model()
            messages = request.env['whatsapp.message'].get_conversation_messages(
                conversation_id=conversation_id,
                limit=limit,
                offset=offset
            )
            return {'ok': True, 'messages': messages}
        except Exception as e:
            _logger.exception(f"Error fetching messages: {e}")
            return {'ok': False, 'error': str(e)}

    @http.route('/whatsapp/conversation/<int:conversation_id>/send', type='json', auth='user', methods=['POST'])
    def send_message(self, conversation_id, message, **kwargs):
        """Send a message in a conversation (individual or group)"""
        try:
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists():
                return {'ok': False, 'error': 'Conversation not found'}

            config = request.env['whatsapp.config'].get_default_config()

            # Determine recipient based on conversation type
            if conversation.is_group:
                # For groups, use group_id
                recipient = conversation.group_id
                result = config.send_message(recipient, message, is_group=True)
            else:
                # For individual chats, use phone number
                recipient = conversation.phone
                result = config.send_message(recipient, message)

            # Create message record
            msg_vals = {
                'conversation_id': conversation.id,
                'body': message,
                'direction': 'outgoing',
                'state': 'sent' if result.get('ok') else 'failed',
                'message_id': result.get('messageId'),
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
            _logger.exception(f"Error sending message: {e}")
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

            conversation = request.env['whatsapp.conversation'].get_or_create(phone, partner_id)
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
            conversation = request.env['whatsapp.conversation'].browse(conversation_id)
            if not conversation.exists():
                return {'ok': False, 'error': 'Conversation not found'}

            config = request.env['whatsapp.config'].get_default_config()

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

    # ==================== Group Endpoints ====================

    @http.route('/whatsapp/groups', type='json', auth='user', methods=['POST'])
    def get_groups(self, limit=50, offset=0, **kwargs):
        """Get list of group conversations"""
        try:
            conversations = request.env['whatsapp.conversation'].search([
                ('is_group', '=', True),
                ('active', '=', True)
            ], limit=limit, offset=offset, order='last_message_date desc')
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

                # Create conversation record for the new group
                conversation = request.env['whatsapp.conversation'].sudo().get_or_create_group(
                    group_id,
                    name,
                    participants
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
