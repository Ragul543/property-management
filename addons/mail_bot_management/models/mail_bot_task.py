# -*- coding: utf-8 -*-
from odoo import models, fields, api


class MailBotTask(models.Model):
    _name = 'mail.bot.task'
    _description = 'Mail Bot Task'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'priority desc, date_deadline, id'
    _rec_name = 'name'

    name = fields.Char(string='Task Name', required=True, tracking=True)
    description = fields.Html(string='Description', sanitize=False)

    # Priority and State
    priority = fields.Selection([
        ('0', 'Low'),
        ('1', 'Normal'),
        ('2', 'High'),
        ('3', 'Urgent'),
    ], string='Priority', default='1')

    state = fields.Selection([
        ('draft', 'Draft'),
        ('open', 'In Progress'),
        ('pending', 'Pending'),
        ('done', 'Done'),
        ('cancelled', 'Cancelled'),
    ], string='Status', default='draft', tracking=True)

    # Assignment
    user_id = fields.Many2one('res.users', string='Assigned To',
                              default=lambda self: self.env.user, tracking=True)
    partner_id = fields.Many2one('res.partner', string='Related Contact')

    # Dates
    date_deadline = fields.Datetime(string='Deadline')
    date_start = fields.Datetime(string='Start Date')
    date_end = fields.Datetime(string='End Date')

    # Time tracking
    planned_hours = fields.Float(string='Planned Hours')
    effective_hours = fields.Float(string='Hours Spent')

    # Origin
    source_email_id = fields.Many2one('mail.bot.inbox', string='Source Email', ondelete='set null')
    lead_id = fields.Many2one('mail.bot.lead', string='Related Lead')

    # Tags
    tag_ids = fields.Many2many('mail.bot.task.tag', string='Tags')

    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    # Color for kanban
    color = fields.Integer(string='Color Index')

    def action_start(self):
        """Start the task"""
        self.write({'state': 'open', 'date_start': fields.Datetime.now()})

    def action_done(self):
        """Mark task as done"""
        self.write({'state': 'done', 'date_end': fields.Datetime.now()})

    def action_cancel(self):
        """Cancel the task"""
        self.write({'state': 'cancelled'})

    def action_reopen(self):
        """Reopen a closed task"""
        self.write({'state': 'open'})


class MailBotTaskTag(models.Model):
    _name = 'mail.bot.task.tag'
    _description = 'Task Tag'
    _order = 'name'

    name = fields.Char(string='Tag Name', required=True)
    color = fields.Integer(string='Color Index')
