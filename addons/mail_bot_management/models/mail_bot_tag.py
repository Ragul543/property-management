from odoo import models, fields

class MailBotTag(models.Model):
    _name = 'mail.bot.tag'
    _description = 'Mail Tag'
    _order = 'sequence, name'

    name = fields.Char(string='Tag Name', required=True)
    sequence = fields.Integer(string='Sequence', default=10)
    active = fields.Boolean(string='Active', default=True)

    color = fields.Integer(string='Color Index')

    user_id = fields.Many2one('res.users', string='Owner', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    _sql_constraints = [
        ('name_uniq', 'unique (name, user_id)', 'Tag name must be unique per user!')
    ]
