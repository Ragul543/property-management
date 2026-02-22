# -*- coding: utf-8 -*-
from odoo import models, fields, api

class WhatsAppReaction(models.Model):
    _name = 'whatsapp.reaction'
    _description = 'WhatsApp Message Reaction'
    _order = 'create_date desc'

    message_id = fields.Many2one(
        'whatsapp.message',
        string='Message',
        required=True,
        ondelete='cascade',
        index=True
    )
    emoji = fields.Char(string='Emoji', required=True)
    user_id = fields.Many2one('res.users', string='User', default=lambda self: self.env.user)
    phone = fields.Char(string='Phone', help='Phone number of reactor (for incoming reactions)')

    _sql_constraints = [
        ('unique_user_reaction', 'unique(message_id, user_id)', 'User can only have one reaction per message'),
    ]

    @api.model
    def add_reaction(self, message_id, emoji, phone=None):
        """Add or update reaction on a message"""
        existing = self.search([
            ('message_id', '=', message_id),
            ('user_id', '=', self.env.uid if not phone else False),
            ('phone', '=', phone if phone else False),
        ], limit=1)

        if existing:
            if existing.emoji == emoji:
                # Same emoji - remove reaction
                existing.unlink()
                return {'action': 'removed', 'emoji': emoji}
            else:
                # Different emoji - update
                existing.write({'emoji': emoji})
                return {'action': 'updated', 'emoji': emoji}
        else:
            # New reaction
            self.create({
                'message_id': message_id,
                'emoji': emoji,
                'phone': phone,
            })
            return {'action': 'added', 'emoji': emoji}

    def _format_for_frontend(self):
        """Format reaction for frontend"""
        self.ensure_one()
        return {
            'id': self.id,
            'emoji': self.emoji,
            'user_id': self.user_id.id if self.user_id else False,
            'user_name': self.user_id.name if self.user_id else self.phone,
            'phone': self.phone,
        }
