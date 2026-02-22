# -*- coding: utf-8 -*-
import base64
from odoo import models, fields, api
from odoo.exceptions import UserError


class SendWhatsAppWizard(models.TransientModel):
    _name = 'send.whatsapp.wizard'
    _description = 'Send WhatsApp Message'

    partner_id = fields.Many2one('res.partner', string='Contact')
    employee_id = fields.Many2one('hr.employee', string='Employee')
    phone = fields.Char(string='Phone Number', required=True)
    message = fields.Text(string='Message', required=True)

    # Media fields
    attachment_ids = fields.Many2many(
        'ir.attachment',
        string='Attachments',
        help='Attach images, documents, etc.'
    )
    media_caption = fields.Char(string='Media Caption')

    @api.onchange('partner_id')
    def _onchange_partner_id(self):
        if self.partner_id:
            self.phone = self.partner_id._get_whatsapp_number()

    @api.onchange('employee_id')
    def _onchange_employee_id(self):
        if self.employee_id:
            self.phone = self.employee_id._get_whatsapp_number()

    def action_send(self):
        """Send WhatsApp message"""
        self.ensure_one()

        if not self.phone:
            raise UserError("Phone number is required")
        if not self.message and not self.attachment_ids:
            raise UserError("Message or attachment is required")

        config = self.env['whatsapp.config'].get_default_config()

        try:
            # Send text message
            if self.message:
                result = config.send_message(self.phone, self.message)

                # Log the message
                self.env['whatsapp.message'].create({
                    'phone': self.phone,
                    'direction': 'outgoing',
                    'body': self.message,
                    'message_type': 'chat',
                    'partner_id': self.partner_id.id if self.partner_id else False,
                    'employee_id': self.employee_id.id if self.employee_id else False,
                    'state': 'sent',
                    'message_id': result.get('message_id'),
                })

            # Send attachments
            for attachment in self.attachment_ids:
                media_base64 = base64.b64encode(base64.b64decode(attachment.datas)).decode()

                config.send_media(
                    phone=self.phone,
                    media_base64=media_base64,
                    filename=attachment.name,
                    mimetype=attachment.mimetype,
                    caption=self.media_caption or None,
                )

                # Log media message
                self.env['whatsapp.message'].create({
                    'phone': self.phone,
                    'direction': 'outgoing',
                    'body': self.media_caption or f"[Sent: {attachment.name}]",
                    'message_type': self._get_media_type(attachment.mimetype),
                    'has_media': True,
                    'media_filename': attachment.name,
                    'media_mimetype': attachment.mimetype,
                    'partner_id': self.partner_id.id if self.partner_id else False,
                    'employee_id': self.employee_id.id if self.employee_id else False,
                    'state': 'sent',
                })

            # Show success notification
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': 'WhatsApp',
                    'message': 'Message sent successfully!',
                    'type': 'success',
                    'sticky': False,
                }
            }

        except Exception as e:
            # Log failed message
            self.env['whatsapp.message'].create({
                'phone': self.phone,
                'direction': 'outgoing',
                'body': self.message,
                'partner_id': self.partner_id.id if self.partner_id else False,
                'employee_id': self.employee_id.id if self.employee_id else False,
                'state': 'failed',
                'error_message': str(e),
            })
            raise UserError(f"Failed to send: {str(e)}")

    def _get_media_type(self, mimetype):
        """Get message type from mimetype"""
        if not mimetype:
            return 'document'
        if mimetype.startswith('image/'):
            return 'image'
        if mimetype.startswith('video/'):
            return 'video'
        if mimetype.startswith('audio/'):
            return 'audio'
        return 'document'
