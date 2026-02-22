from odoo import models, fields

class MailBotTheme(models.Model):
    _name = 'mail.bot.theme'
    _description = 'Mail Theme'
    _order = 'sequence, name'

    name = fields.Char(string='Theme Name', required=True)
    sequence = fields.Integer(string='Sequence', default=10)
    active = fields.Boolean(string='Active', default=True)
    is_default = fields.Boolean(string='Default Theme', default=False)

    primary_color = fields.Char(string='Primary Color', default='#7c3aed')
    secondary_color = fields.Char(string='Secondary Color', default='#d6397b')
    sidebar_color = fields.Char(string='Sidebar Color', default='#7c3aed')
    background_color = fields.Char(string='Background Color', default='#f8f9fa')

    font_family = fields.Selection([
        ('default', 'Default'),
        ('arial', 'Arial'),
        ('roboto', 'Roboto'),
        ('open_sans', 'Open Sans'),
    ], string='Font Family', default='default')

    user_id = fields.Many2one('res.users', string='Owner', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    def action_set_default(self):
        self.search([('user_id', '=', self.env.user.id)]).write({'is_default': False})
        self.is_default = True
        return True
