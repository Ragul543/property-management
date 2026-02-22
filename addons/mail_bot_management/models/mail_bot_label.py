from odoo import models, fields

class MailBotLabel(models.Model):
    _name = 'mail.bot.label'
    _description = 'Mail Label'
    _order = 'sequence, name'

    name = fields.Char(string='Label Name', required=True)
    sequence = fields.Integer(string='Sequence', default=10)
    active = fields.Boolean(string='Active', default=True)

    color = fields.Integer(string='Color Index')

    label_color = fields.Char(string='Label Color', default='#875A7B')
    text_color = fields.Char(string='Text Color', default='#FFFFFF')

    user_id = fields.Many2one('res.users', string='Owner', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    _sql_constraints = [
        ('name_uniq', 'unique (name, user_id)', 'Label name must be unique per user!')
    ]
