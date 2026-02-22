# -*- coding: utf-8 -*-
from odoo import models, fields, api


class MailBotLead(models.Model):
    _name = 'mail.bot.lead'
    _description = 'Mail Bot Lead/Opportunity'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'create_date desc'
    _rec_name = 'name'

    name = fields.Char(string='Lead Name', required=True, tracking=True)

    # Contact information
    contact_name = fields.Char(string='Contact Name')
    email = fields.Char(string='Email', index=True)
    phone = fields.Char(string='Phone')
    mobile = fields.Char(string='Mobile')

    # Company information
    company_name = fields.Char(string='Company Name')
    website = fields.Char(string='Website')

    # Lead details
    description = fields.Html(string='Description', sanitize=False)
    source = fields.Char(string='Source', default='Email Bot')

    # Classification
    type = fields.Selection([
        ('lead', 'Lead'),
        ('opportunity', 'Opportunity'),
    ], string='Type', default='lead', required=True, tracking=True)

    priority = fields.Selection([
        ('0', 'Low'),
        ('1', 'Normal'),
        ('2', 'High'),
        ('3', 'Very High'),
    ], string='Priority', default='1')

    # Stage tracking
    stage = fields.Selection([
        ('new', 'New'),
        ('qualified', 'Qualified'),
        ('proposition', 'Proposition'),
        ('won', 'Won'),
        ('lost', 'Lost'),
    ], string='Stage', default='new', tracking=True)

    # Financials
    expected_revenue = fields.Float(string='Expected Revenue')
    probability = fields.Float(string='Probability (%)', default=10.0)

    # Relationships
    partner_id = fields.Many2one('res.partner', string='Customer')
    user_id = fields.Many2one('res.users', string='Salesperson', default=lambda self: self.env.user, tracking=True)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)

    # Origin tracking
    source_email_id = fields.Many2one('mail.bot.inbox', string='Source Email', ondelete='set null')

    # Tags
    tag_ids = fields.Many2many('mail.bot.lead.tag', string='Tags')

    # Dates
    date_deadline = fields.Date(string='Expected Closing')
    date_conversion = fields.Datetime(string='Conversion Date')

    # Color for kanban
    color = fields.Integer(string='Color Index')

    def action_convert_to_opportunity(self):
        """Convert lead to opportunity"""
        self.ensure_one()
        self.write({
            'type': 'opportunity',
            'date_conversion': fields.Datetime.now(),
        })
        return True

    def action_mark_won(self):
        """Mark lead as won"""
        self.ensure_one()
        self.write({'stage': 'won'})
        return True

    def action_mark_lost(self):
        """Mark lead as lost"""
        self.ensure_one()
        self.write({'stage': 'lost'})
        return True


class MailBotLeadTag(models.Model):
    _name = 'mail.bot.lead.tag'
    _description = 'Lead Tag'
    _order = 'name'

    name = fields.Char(string='Tag Name', required=True)
    color = fields.Integer(string='Color Index')
