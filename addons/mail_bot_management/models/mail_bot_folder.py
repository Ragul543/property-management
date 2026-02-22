from odoo import models, fields, api

class MailBotFolder(models.Model):
    _name = 'mail.bot.folder'
    _description = 'Mail Folder'
    _order = 'sequence, name'

    name = fields.Char(string='Folder Name', required=True)
    sequence = fields.Integer(string='Sequence', default=10)
    active = fields.Boolean(string='Active', default=True)

    folder_type = fields.Selection([
        ('system', 'System Folder'),
        ('custom', 'Custom Folder'),
    ], string='Folder Type', default='custom')

    parent_id = fields.Many2one('mail.bot.folder', string='Parent Folder')
    child_ids = fields.One2many('mail.bot.folder', 'parent_id', string='Subfolders')

    color = fields.Integer(string='Color Index')
    icon = fields.Char(string='Icon', default='fa-folder')

    user_id = fields.Many2one('res.users', string='Owner', default=lambda self: self.env.user)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    message_count = fields.Integer(string='Messages', compute='_compute_message_count')

    @api.depends()
    def _compute_message_count(self):
        for record in self:
            record.message_count = 0
