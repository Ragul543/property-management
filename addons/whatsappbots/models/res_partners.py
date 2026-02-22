# -*- coding: utf-8 -*-
from odoo import models, fields, api
from odoo.exceptions import UserError


class ResPartner(models.Model):
    _inherit = 'res.partner'

    whatsapp_number = fields.Char(
        string='WhatsApp Number',
        help='WhatsApp number with country code (e.g., 919876543210)'
    )
    is_whatsapp_verified = fields.Boolean(string='WhatsApp Verified')
    whatsapp_message_ids = fields.One2many(
        'whatsapp.message', 'partner_id', string='WhatsApp Messages'
    )
    whatsapp_message_count = fields.Integer(
        compute='_compute_whatsapp_message_count', string='Messages'
    )

    @api.depends('whatsapp_message_ids')
    def _compute_whatsapp_message_count(self):
        for partner in self:
            partner.whatsapp_message_count = len(partner.whatsapp_message_ids)

    def _get_whatsapp_number(self):
        """Get WhatsApp number for this partner"""
        self.ensure_one()
        if self.whatsapp_number:
            return self.whatsapp_number
        number = False
        if 'mobile' in self._fields and self.mobile:
            number = self.mobile
        if not number and 'phone' in self._fields and self.phone:
            number = self.phone
        if not number:
            raise UserError(f"No phone number for {self.name}")
        return ''.join(filter(str.isdigit, number))

    def action_send_whatsapp(self):
        """Open send WhatsApp wizard"""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'Send WhatsApp',
            'res_model': 'send.whatsapp.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_partner_id': self.id,
                'default_phone': self._get_whatsapp_number(),
            }
        }

    def action_verify_whatsapp(self):
        """Verify if number is on WhatsApp"""
        self.ensure_one()
        try:
            config = self.env['whatsapp.config'].get_default_config()
            number = self._get_whatsapp_number()
            exists = config.check_number(number)

            self.is_whatsapp_verified = exists
            if exists:
                self.whatsapp_number = number

            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': 'WhatsApp',
                    'message': 'Number verified!' if exists else 'Number not on WhatsApp',
                    'type': 'success' if exists else 'warning',
                }
            }
        except Exception as e:
            raise UserError(str(e))

    def action_view_whatsapp_messages(self):
        """View WhatsApp messages"""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': f'WhatsApp - {self.name}',
            'res_model': 'whatsapp.message',
            'view_mode': 'tree,form',
            'domain': [('partner_id', '=', self.id)],
            'context': {'default_partner_id': self.id},
        }
