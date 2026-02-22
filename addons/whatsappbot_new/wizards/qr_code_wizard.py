# -*- coding: utf-8 -*-
import requests
import logging
from odoo import models, fields, api
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class QRCodeWizard(models.TransientModel):
    _name = 'whatsapp.qr.wizard'
    _description = 'WhatsApp QR Code'

    config_id = fields.Many2one('whatsapp.config', string='Configuration', required=True)
    qr_image = fields.Binary(string='QR Code', readonly=True)
    state = fields.Selection([
        ('loading', 'Loading'),
        ('qr', 'Scan QR'),
        ('connected', 'Connected'),
        ('error', 'Error'),
    ], default='loading', readonly=True)
    message = fields.Text(string='Message', readonly=True, default='Initializing...')
    auto_refresh = fields.Boolean(default=True)

    @api.model
    def default_get(self, fields_list):
        res = super().default_get(fields_list)
        try:
            config = self.env['whatsapp.config'].get_default_config()
            res['config_id'] = config.id
        except Exception as e:
            _logger.error(f"QR Wizard: Failed to get config: {e}")
        return res

    @api.model
    def create(self, vals):
        record = super().create(vals)
        # Don't auto-refresh - let user click the button to avoid UI flicker
        record.write({
            'state': 'loading',
            'message': 'Click "Load QR Code" to fetch the QR code.'
        })
        return record

    def action_refresh_qr(self):
        """Fetch QR code from WhatsApp server"""
        self.ensure_one()
        _logger.info(f"QR Wizard: Refreshing QR for config {self.config_id.name if self.config_id else 'None'}")

        if not self.config_id:
            self.write({
                'state': 'error',
                'message': 'No WhatsApp configuration found.',
                'qr_image': False
            })
            return self._return_wizard()

        server_url = self.config_id.server_url
        api_key = self.config_id.api_key

        _logger.info(f"QR Wizard: Fetching from {server_url}/qr")

        try:
            response = requests.get(
                f"{server_url.rstrip('/')}/qr",
                headers={'X-API-Key': api_key or ''},
                timeout=15
            )
            _logger.info(f"QR Wizard: Response status {response.status_code}")

            data = response.json()
            _logger.info(f"QR Wizard: Response data keys: {list(data.keys())}")

            if data.get('ready'):
                # Already authenticated
                self.write({
                    'state': 'connected',
                    'message': 'WhatsApp is already connected! You can close this window.',
                    'qr_image': False
                })
                return self._return_wizard()

            if data.get('ok') and data.get('qr_base64'):
                # QR code available
                qr_base64 = data['qr_base64']
                # Remove data URI prefix if present
                if ',' in qr_base64:
                    qr_base64 = qr_base64.split(',')[1]

                expires_in = data.get('expires_in_seconds', 60)
                self.write({
                    'qr_image': qr_base64,
                    'state': 'qr',
                    'message': f'Scan this QR code with WhatsApp.\nExpires in {expires_in} seconds.\n\nOpen WhatsApp > Settings > Linked Devices > Link a Device'
                })
                _logger.info("QR Wizard: QR code set successfully")
                return self._return_wizard()

            if data.get('error'):
                self.write({
                    'state': 'loading',
                    'message': f"Server: {data.get('error')}\n\nClick Load QR Code to try again.",
                    'qr_image': False
                })
                return self._return_wizard()

            # Unexpected response
            self.write({
                'state': 'loading',
                'message': f"Waiting for QR code...\nServer response: {str(data)[:200]}",
                'qr_image': False
            })

        except requests.exceptions.ConnectionError as e:
            _logger.error(f"QR Wizard: Connection error: {e}")
            self.write({
                'state': 'error',
                'message': f'Cannot connect to WhatsApp server at:\n{server_url}\n\nMake sure the server is running.',
                'qr_image': False
            })
        except requests.exceptions.Timeout:
            _logger.error("QR Wizard: Request timeout")
            self.write({
                'state': 'error',
                'message': 'Connection timeout. Server might be busy.\n\nClick Refresh to try again.',
                'qr_image': False
            })
        except Exception as e:
            _logger.error(f"QR Wizard: Unexpected error: {e}")
            self.write({
                'state': 'error',
                'message': f'Error: {str(e)}',
                'qr_image': False
            })

        return self._return_wizard()

    def _return_wizard(self):
        """Return action to keep wizard open"""
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'whatsapp.qr.wizard',
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'new',
        }

    def action_check_status(self):
        """Check if connected after scanning"""
        self.ensure_one()

        try:
            response = requests.get(
                f"{self.config_id.server_url.rstrip('/')}/health",
                headers={'X-API-Key': self.config_id.api_key or ''},
                timeout=10
            )
            data = response.json()

            if data.get('ready'):
                self.write({
                    'state': 'connected',
                    'message': 'WhatsApp connected successfully!',
                    'qr_image': False
                })

                # Update config state
                self.config_id.write({
                    'state': 'connected',
                    'last_check': fields.Datetime.now()
                })

                return {
                    'type': 'ir.actions.client',
                    'tag': 'display_notification',
                    'params': {
                        'title': 'Success',
                        'message': 'WhatsApp connected successfully!',
                        'type': 'success',
                        'sticky': False,
                    }
                }
            else:
                # Not connected yet, refresh QR
                self.action_refresh_qr()

        except Exception as e:
            self.write({
                'state': 'error',
                'message': f'Error checking status: {str(e)}'
            })

        return {
            'type': 'ir.actions.act_window',
            'res_model': 'whatsapp.qr.wizard',
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'new',
        }
