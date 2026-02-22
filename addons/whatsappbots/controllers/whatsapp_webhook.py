# -*- coding: utf-8 -*-
import json
import hmac
import hashlib
import logging
from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)


class WhatsAppWebhookController(http.Controller):

    def _get_webhook_secret(self):
        """Get webhook secret from config"""
        try:
            config = request.env['whatsapp.config'].sudo().search([('active', '=', True)], limit=1)
            return config.webhook_secret if config else None
        except:
            return None

    def _verify_signature(self, data, signature):
        """Verify HMAC signature"""
        secret = self._get_webhook_secret()
        if not secret or not signature:
            return True  # Skip verification if no secret configured

        expected = hmac.new(
            secret.encode(),
            json.dumps(data).encode(),
            hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(signature, expected)

    @http.route('/whatsapp/webhook', type='http', auth='none', csrf=False, methods=['POST'])
    def receive_message(self, **kwargs):
        """Receive incoming WhatsApp messages"""
        try:
            # Parse plain JSON from request body
            try:
                raw_data = request.httprequest.data.decode('utf-8')
                data = json.loads(raw_data) if raw_data else {}
            except Exception as parse_err:
                _logger.error(f"Failed to parse webhook JSON: {parse_err}")
                return json.dumps({'ok': False, 'error': 'Invalid JSON'})

            _logger.info(f"Webhook received data: {data}")

            # Verify signature
            signature = request.httprequest.headers.get('X-Webhook-Signature')
            if not self._verify_signature(data, signature):
                _logger.warning("Invalid webhook signature")
                return json.dumps({'ok': False, 'error': 'Invalid signature'})

            event = data.get('event')
            message_data = data.get('data', {})

            _logger.info(f"WhatsApp webhook: {event} from {message_data.get('from')}")

            # Use a new cursor to ensure transaction is committed
            db_name = request.env.cr.dbname
            _logger.info(f"[WEBHOOK DEBUG] Database: {db_name}")

            with request.env.registry.cursor() as new_cr:
                new_env = request.env(cr=new_cr)

                if event == 'message_received':
                    _logger.info(f"[WEBHOOK DEBUG] Processing message_received event")
                    _logger.info(f"[WEBHOOK DEBUG] Message data: from={message_data.get('from')}, body={message_data.get('body', '')[:50]}")

                    try:
                        message = new_env['whatsapp.message'].sudo().create_from_webhook(message_data)
                        _logger.info(f"[WEBHOOK DEBUG] Message created with ID: {message.id}")
                    except Exception as create_err:
                        _logger.exception(f"[WEBHOOK DEBUG] Error creating message: {create_err}")
                        raise

                    conv = message.conversation_id
                    _logger.info(f"=== INCOMING MESSAGE ===")
                    _logger.info(f"Message ID: {message.id}, Body: '{message.body[:50] if message.body else ''}...'")
                    _logger.info(f"Conversation: {conv.id if conv else 'None'}, last_message: '{conv.last_message_body[:50] if conv and conv.last_message_body else ''}...'")
                    _logger.info(f"Conversation message_count: {conv.message_count if conv else 0}, unread: {conv.unread_count if conv else 0}")

                    # Re-read conversation to verify values before commit
                    conv_check = new_env['whatsapp.conversation'].sudo().browse(conv.id)
                    _logger.info(f"[WEBHOOK DEBUG] Pre-commit verification: conv_id={conv_check.id}, last_msg='{conv_check.last_message_body[:30] if conv_check.last_message_body else 'None'}', count={conv_check.message_count}")

                    # Commit the transaction to ensure data is visible
                    new_cr.commit()
                    _logger.info(f"[WEBHOOK DEBUG] Transaction committed")

                    # Broadcast to connected users (after commit)
                    self._broadcast_new_message_with_env(new_env, message)

                elif event == 'message_ack':
                    # Handle message delivery/read status update
                    self._handle_message_ack_with_env(new_env, message_data)
                    new_cr.commit()

                elif event == 'group_join':
                    # Someone joined a group
                    self._handle_group_update(message_data, 'join')
                    new_cr.commit()

                elif event == 'group_leave':
                    # Someone left a group
                    self._handle_group_update(message_data, 'leave')
                    new_cr.commit()

                elif event == 'group_update':
                    # Group info updated (name, description, etc.)
                    self._handle_group_metadata_update(message_data)
                    new_cr.commit()

            return json.dumps({'ok': True})

        except Exception as e:
            _logger.exception(f"Webhook error: {str(e)}")
            return json.dumps({'ok': False, 'error': str(e)})

    def _handle_message_ack_with_env(self, env, data):
        """Handle message acknowledgement with specific environment"""
        try:
            message_id = data.get('messageId')
            status = data.get('status')

            if not message_id or not status:
                return

            # Map status to Odoo states
            status_map = {
                'pending': 'draft',
                'sent': 'sent',
                'delivered': 'delivered',
                'read': 'read',
                'failed': 'failed',
            }

            odoo_status = status_map.get(status, 'sent')

            # Find message by WhatsApp message ID
            message = env['whatsapp.message'].sudo().search([
                ('message_id', '=', message_id)
            ], limit=1)

            if message:
                message.write({'state': odoo_status})
                _logger.info(f"Message {message_id} status updated to {odoo_status}")

                # Broadcast status update
                self._broadcast_message_status_with_env(env, message)

        except Exception as e:
            _logger.warning(f"Failed to handle message ack: {e}")

    def _handle_message_ack(self, data):
        """Handle message acknowledgement (delivery/read status) - legacy method"""
        try:
            message_id = data.get('messageId')
            status = data.get('status')

            if not message_id or not status:
                return

            # Find the message by message_id
            MessageModel = request.env['whatsapp.message'].sudo()
            message = MessageModel.search([('message_id', '=', message_id)], limit=1)

            if message:
                # Update message state
                message.state = status
                _logger.info(f"Updated message {message_id} status to: {status}")

                # Broadcast status update to connected users
                self._broadcast_message_status(message)

        except Exception as e:
            _logger.warning(f"Failed to handle message ack: {e}")

    def _broadcast_message_status_with_env(self, env, message):
        """Broadcast message status update with specific environment"""
        try:
            if not message or not message.conversation_id:
                return

            users = env['res.users'].sudo().search([
                ('active', '=', True),
                ('share', '=', False)
            ])

            bus_model = env['bus.bus'].sudo()
            for user in users:
                channel = f'whatsapp_conversation_{user.id}'
                payload = {
                    'type': 'message_status',
                    'payload': {
                        'message_id': message.id,
                        'whatsapp_message_id': message.message_id,
                        'status': message.state,
                        'conversation_id': message.conversation_id.id,
                    }
                }
                try:
                    bus_model._sendone(channel, 'whatsapp_notification', payload)
                except Exception:
                    bus_model._sendone(channel, 'message_status', payload.get('payload', {}))

            _logger.info(f"Broadcasted message status update to {len(users)} users")

        except Exception as e:
            _logger.warning(f"Failed to broadcast message status: {e}")

    def _broadcast_message_status(self, message):
        """Broadcast message status update to connected users"""
        self._broadcast_message_status_with_env(request.env, message)

    def _broadcast_new_message_with_env(self, env, message):
        """Broadcast new message with specific environment"""
        try:
            if not message or not message.conversation_id:
                return

            # Get all active internal users
            users = env['res.users'].sudo().search([
                ('active', '=', True),
                ('share', '=', False)  # Only internal users
            ])

            bus_model = env['bus.bus'].sudo()
            message_data = message._format_for_frontend()
            conversation_data = message.conversation_id._format_for_frontend()

            # Send notification to each user's channel
            for user in users:
                channel = f'whatsapp_conversation_{user.id}'
                payload = {
                    'type': 'new_message',
                    'payload': {
                        'message': message_data,
                        'conversation_id': message.conversation_id.id,
                        'conversation': conversation_data,
                    }
                }
                try:
                    bus_model._sendone(channel, 'whatsapp_notification', payload)
                except Exception:
                    bus_model._sendone(channel, 'new_message', payload.get('payload', {}))

            _logger.info(f"Broadcasted incoming message to {len(users)} users")

        except Exception as e:
            _logger.warning(f"Failed to broadcast new message: {e}")

    def _broadcast_new_message(self, message):
        """Broadcast new message to all connected users"""
        self._broadcast_new_message_with_env(request.env, message)

    def _handle_group_update(self, data, action):
        """Handle group participant updates (join/leave)"""
        try:
            group_id = data.get('group_id') or data.get('from', '')
            if not group_id or '@g.us' not in group_id:
                return

            ConversationModel = request.env['whatsapp.conversation'].sudo()
            conversation = ConversationModel.search([
                ('group_id', '=', group_id),
                ('is_group', '=', True)
            ], limit=1)

            if conversation:
                participants = []
                if conversation.group_participants:
                    try:
                        participants = json.loads(conversation.group_participants)
                    except:
                        participants = []

                participant = data.get('participant', '').replace('@c.us', '')
                if action == 'join' and participant and participant not in participants:
                    participants.append(participant)
                elif action == 'leave' and participant in participants:
                    participants.remove(participant)

                conversation.group_participants = json.dumps(participants)
                _logger.info(f"Group {action}: {participant} in {conversation.group_name}")

        except Exception as e:
            _logger.warning(f"Failed to handle group update: {e}")

    def _handle_group_metadata_update(self, data):
        """Handle group metadata updates (name, description, etc.)"""
        try:
            group_id = data.get('group_id') or data.get('from', '')
            if not group_id or '@g.us' not in group_id:
                return

            ConversationModel = request.env['whatsapp.conversation'].sudo()
            conversation = ConversationModel.search([
                ('group_id', '=', group_id),
                ('is_group', '=', True)
            ], limit=1)

            if conversation:
                update_vals = {}
                if data.get('groupName'):
                    update_vals['group_name'] = data['groupName']
                if data.get('description'):
                    update_vals['group_description'] = data['description']
                if data.get('participants'):
                    update_vals['group_participants'] = json.dumps(data['participants'])

                if update_vals:
                    conversation.write(update_vals)
                    _logger.info(f"Updated group metadata for {conversation.group_name}")

        except Exception as e:
            _logger.warning(f"Failed to handle group metadata update: {e}")

    @http.route('/whatsapp/webhook/test', type='http', auth='none', csrf=False, methods=['GET'])
    def test_webhook(self):
        """Test endpoint to verify webhook is accessible"""
        return json.dumps({
            'ok': True,
            'message': 'WhatsApp webhook is working',
            'endpoint': '/whatsapp/webhook'
        })

    @http.route('/whatsapp/webhook/debug', type='http', auth='none', csrf=False, methods=['GET'])
    def debug_webhook(self):
        """Debug endpoint to check message and conversation counts"""
        try:
            db_name = request.env.cr.dbname
            with request.env.registry.cursor() as new_cr:
                new_env = request.env(cr=new_cr)

                # Get counts
                msg_count = new_env['whatsapp.message'].sudo().search_count([])
                conv_count = new_env['whatsapp.conversation'].sudo().search_count([('active', '=', True)])

                # Get last 5 messages
                last_messages = new_env['whatsapp.message'].sudo().search([], order='id desc', limit=5)
                msgs = []
                for m in last_messages:
                    msgs.append({
                        'id': m.id,
                        'phone': m.phone,
                        'body': (m.body or '')[:50],
                        'direction': m.direction,
                        'conv_id': m.conversation_id.id if m.conversation_id else None,
                        'timestamp': str(m.timestamp) if m.timestamp else None
                    })

                # Get last 5 conversations with their message counts
                last_convs = new_env['whatsapp.conversation'].sudo().search([('active', '=', True)], order='last_message_date desc', limit=5)
                convs = []
                for c in last_convs:
                    convs.append({
                        'id': c.id,
                        'phone': c.phone,
                        'display_name': c.display_name,
                        'last_message': (c.last_message_body or '')[:30],
                        'message_count': c.message_count,
                        'unread_count': c.unread_count,
                        'last_date': str(c.last_message_date) if c.last_message_date else None
                    })

                return json.dumps({
                    'ok': True,
                    'database': db_name,
                    'total_messages': msg_count,
                    'total_conversations': conv_count,
                    'recent_messages': msgs,
                    'recent_conversations': convs
                }, indent=2)

        except Exception as e:
            _logger.exception(f"Debug endpoint error: {e}")
            return json.dumps({'ok': False, 'error': str(e)})
