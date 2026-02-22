# -*- coding: utf-8 -*-
import requests
import logging
from odoo import models, fields, api
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class WhatsAppConfig(models.Model):
    _name = 'whatsapp.config'
    _description = 'WhatsApp Configuration'
    _rec_name = 'name'

    name = fields.Char(string='Name', default='WhatsApp Server', required=True)
    server_url = fields.Char(
        string='Server URL',
        required=True,
        default='http://localhost:3006',
        help='WhatsApp bot server URL'
    )
    api_key = fields.Char(
        string='API Key',
        required=True,
        help='API key for authentication'
    )
    webhook_secret = fields.Char(
        string='Webhook Secret',
        help='Secret for verifying incoming webhooks'
    )
    default_country_code = fields.Char(
        string='Default Country Code',
        default='91',
        help='Default country code for phone numbers'
    )
    active = fields.Boolean(default=True)
    state = fields.Selection([
        ('disconnected', 'Disconnected'),
        ('connecting', 'Connecting'),
        ('connected', 'Connected'),
    ], string='Status', default='disconnected', readonly=True)
    last_check = fields.Datetime(string='Last Status Check', readonly=True)

    def _get_headers(self):
        return {
            'Content-Type': 'application/json',
            'X-API-Key': self.api_key,
        }

    def action_check_status(self):
        """Check WhatsApp server status"""
        self.ensure_one()
        try:
            response = requests.get(
                f"{self.server_url.rstrip('/')}/health",
                timeout=10
            )
            data = response.json()

            if data.get('ready'):
                self.state = 'connected'
            elif data.get('initializing'):
                self.state = 'connecting'
            else:
                self.state = 'disconnected'

            self.last_check = fields.Datetime.now()

            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': 'WhatsApp Status',
                    'message': f"Status: {self.state.replace('_', ' ').title()}",
                    'type': 'success' if self.state == 'connected' else 'warning',
                }
            }
        except Exception as e:
            self.state = 'disconnected'
            self.last_check = fields.Datetime.now()
            raise UserError(f"Connection failed: {str(e)}")

    def action_get_qr(self):
        """Open QR code wizard"""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'WhatsApp QR Code',
            'res_model': 'whatsapp.qr.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {'default_config_id': self.id},
        }

    def action_logout(self):
        """Logout from WhatsApp and disconnect the session"""
        self.ensure_one()
        try:
            response = requests.post(
                f"{self.server_url.rstrip('/')}/logout",
                headers=self._get_headers(),
                timeout=30
            )
            data = response.json()

            if data.get('ok'):
                self.state = 'disconnected'
                self.last_check = fields.Datetime.now()
                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': 'WhatsApp Logout',
                        'message': 'Successfully logged out from WhatsApp. You will need to scan QR code again to reconnect.',
                        'type': 'success',
                        'sticky': False,
                    }
                }
            else:
                raise UserError(data.get('error', 'Failed to logout'))

        except requests.exceptions.RequestException as e:
            raise UserError(f"Logout failed: {str(e)}")

    def send_message(self, recipient, message, is_group=False):
        """Send a WhatsApp text message to individual or group"""
        self.ensure_one()

        if is_group:
            # For groups, recipient is the group_id (e.g., "123456789@g.us")
            chat_id = recipient
        else:
            # For individuals, normalize phone number
            phone = ''.join(filter(str.isdigit, str(recipient)))
            if len(phone) == 10:
                phone = self.default_country_code + phone
            chat_id = phone

        try:
            payload = {'message': message}
            if is_group:
                payload['groupId'] = chat_id
            else:
                payload['number'] = chat_id

            response = requests.post(
                f"{self.server_url.rstrip('/')}/send",
                headers=self._get_headers(),
                json=payload,
                timeout=30
            )
            data = response.json()

            if not data.get('ok'):
                raise UserError(data.get('error', 'Failed to send message'))

            return data

        except requests.exceptions.RequestException as e:
            raise UserError(f"Request failed: {str(e)}")

    def send_media(self, recipient, media_url=None, media_base64=None, caption=None, filename=None, mimetype=None, is_group=False):
        """Send media via WhatsApp to individual or group"""
        self.ensure_one()

        if is_group:
            chat_id = recipient
        else:
            phone = ''.join(filter(str.isdigit, str(recipient)))
            if len(phone) == 10:
                phone = self.default_country_code + phone
            chat_id = phone

        payload = {}
        if is_group:
            payload['groupId'] = chat_id
        else:
            payload['number'] = chat_id

        if media_url:
            payload['mediaUrl'] = media_url
        if media_base64:
            payload['mediaBase64'] = media_base64
        if caption:
            payload['caption'] = caption
        if filename:
            payload['filename'] = filename
        if mimetype:
            payload['mimetype'] = mimetype

        try:
            response = requests.post(
                f"{self.server_url.rstrip('/')}/send-media",
                headers=self._get_headers(),
                json=payload,
                timeout=60
            )
            data = response.json()

            if not data.get('ok'):
                raise UserError(data.get('error', 'Failed to send media'))

            return data

        except requests.exceptions.RequestException as e:
            raise UserError(f"Request failed: {str(e)}")

    def check_number(self, phone):
        """Check if number is on WhatsApp"""
        self.ensure_one()

        phone = ''.join(filter(str.isdigit, str(phone)))
        if len(phone) == 10:
            phone = self.default_country_code + phone

        try:
            response = requests.get(
                f"{self.server_url.rstrip('/')}/check-number",
                headers=self._get_headers(),
                params={'number': phone},
                timeout=30
            )
            data = response.json()
            return data.get('exists', False)
        except:
            return False

    @api.model
    def get_default_config(self):
        """Get active WhatsApp configuration"""
        config = self.search([('active', '=', True)], limit=1)
        if not config:
            raise UserError("No WhatsApp configuration found. Please configure WhatsApp settings.")
        return config

    # ==================== Group Methods ====================

    def create_group(self, name, participants, admin_only=False):
        """Create a new WhatsApp group

        Args:
            name: Group name
            participants: List of phone numbers
            admin_only: If True, only admins can send messages. If False, all members can send.
        """
        self.ensure_one()

        # Normalize participant phone numbers
        normalized_participants = []
        for phone in participants:
            phone = ''.join(filter(str.isdigit, str(phone)))
            if len(phone) == 10:
                phone = self.default_country_code + phone
            normalized_participants.append(phone)

        try:
            response = requests.post(
                f"{self.server_url.rstrip('/')}/group/create",
                headers=self._get_headers(),
                json={
                    'name': name,
                    'participants': normalized_participants,
                    'adminOnly': admin_only
                },
                timeout=30
            )
            data = response.json()
            return data

        except requests.exceptions.RequestException as e:
            return {'ok': False, 'error': str(e)}

    def get_group_info(self, group_id):
        """Get information about a WhatsApp group"""
        self.ensure_one()

        try:
            response = requests.get(
                f"{self.server_url.rstrip('/')}/group/info",
                headers=self._get_headers(),
                params={'groupId': group_id},
                timeout=30
            )
            data = response.json()
            return data

        except requests.exceptions.RequestException as e:
            return {'ok': False, 'error': str(e)}

    def add_group_participant(self, group_id, phone):
        """Add a participant to a WhatsApp group"""
        self.ensure_one()

        phone = ''.join(filter(str.isdigit, str(phone)))
        if len(phone) == 10:
            phone = self.default_country_code + phone

        try:
            response = requests.post(
                f"{self.server_url.rstrip('/')}/group/add-participant",
                headers=self._get_headers(),
                json={
                    'groupId': group_id,
                    'participant': phone
                },
                timeout=30
            )
            data = response.json()
            return data

        except requests.exceptions.RequestException as e:
            return {'ok': False, 'error': str(e)}

    def remove_group_participant(self, group_id, phone):
        """Remove a participant from a WhatsApp group"""
        self.ensure_one()

        phone = ''.join(filter(str.isdigit, str(phone)))
        if len(phone) == 10:
            phone = self.default_country_code + phone

        try:
            response = requests.post(
                f"{self.server_url.rstrip('/')}/group/remove-participant",
                headers=self._get_headers(),
                json={
                    'groupId': group_id,
                    'participant': phone
                },
                timeout=30
            )
            data = response.json()
            return data

        except requests.exceptions.RequestException as e:
            return {'ok': False, 'error': str(e)}

    def leave_group(self, group_id):
        """Leave a WhatsApp group"""
        self.ensure_one()

        try:
            response = requests.post(
                f"{self.server_url.rstrip('/')}/group/leave",
                headers=self._get_headers(),
                json={'groupId': group_id},
                timeout=30
            )
            data = response.json()
            return data

        except requests.exceptions.RequestException as e:
            return {'ok': False, 'error': str(e)}

    def get_all_groups(self):
        """Get all groups from WhatsApp"""
        self.ensure_one()

        try:
            response = requests.get(
                f"{self.server_url.rstrip('/')}/groups",
                headers=self._get_headers(),
                timeout=30
            )
            data = response.json()
            return data

        except requests.exceptions.RequestException as e:
            return {'ok': False, 'error': str(e)}

    def rename_group(self, group_id, new_name):
        """Rename a WhatsApp group"""
        self.ensure_one()

        try:
            response = requests.post(
                f"{self.server_url.rstrip('/')}/group/rename",
                headers=self._get_headers(),
                json={
                    'groupId': group_id,
                    'name': new_name
                },
                timeout=30
            )

            # Check if response has content
            if not response.text:
                return {'ok': False, 'error': 'Empty response from server'}

            try:
                data = response.json()
            except ValueError as json_err:
                _logger.error(f"Invalid JSON response: {response.text[:500]}")
                return {'ok': False, 'error': f'Invalid response from server: {str(json_err)}'}

            return data

        except requests.exceptions.RequestException as e:
            _logger.error(f"Request error renaming group: {e}")
            return {'ok': False, 'error': str(e)}

    def set_group_settings(self, group_id, admin_only):
        """Update group message permission settings

        Args:
            group_id: The WhatsApp group ID
            admin_only: If True, only admins can send messages. If False, all members can send.
        """
        self.ensure_one()

        try:
            response = requests.post(
                f"{self.server_url.rstrip('/')}/group/settings",
                headers=self._get_headers(),
                json={
                    'groupId': group_id,
                    'adminOnly': admin_only
                },
                timeout=30
            )

            if not response.text:
                return {'ok': False, 'error': 'Empty response from server'}

            try:
                data = response.json()
            except ValueError as json_err:
                _logger.error(f"Invalid JSON response: {response.text[:500]}")
                return {'ok': False, 'error': f'Invalid response from server: {str(json_err)}'}

            return data

        except requests.exceptions.RequestException as e:
            _logger.error(f"Request error setting group settings: {e}")
            return {'ok': False, 'error': str(e)}
