# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import UserError


class CrmLead(models.Model):
    _inherit = 'crm.lead'

    property_interest_type = fields.Selection(
        [('sale', 'Sale'), ('rent', 'Rent'),('auction','Auction')],
        string='Interest Type',
        help='What the client is looking for')
    property_ids = fields.Many2many(
        'property.property', string='Interested Properties',
        help='Properties shown or of interest to this client')
    selected_property_id = fields.Many2one(
        'property.property', string='Selected Property',
        help='The final chosen property for the deal')
    property_sale_id = fields.Many2one(
        'property.sale', string='Property Sale',
        help='Linked property sale order')
    property_rental_id = fields.Many2one(
        'property.rental', string='Property Rental',
        help='Linked property rental order')
    property_auction_id = fields.Many2one(
        'property.auction', string='Property Auction',
        help='Linked property auction')
    property_sale_count = fields.Integer(
        string='Sale Count', compute='_compute_property_sale_count')
    property_rental_count = fields.Integer(
        string='Rental Count', compute='_compute_property_rental_count')
    property_auction_count = fields.Integer(
        string='Auction Count', compute='_compute_property_auction_count')
    property_sale_rent_filter = fields.Selection(
        [('for_sale', 'For Sale'), ('for_tenancy', 'For Tenancy'),
         ('for_auction', 'For Auction')],
        compute='_compute_property_sale_rent_filter',
        help='Maps interest type to property sale_rent value for domain filtering')
    budget_min = fields.Monetary(
        string='Min Budget', currency_field='company_currency',
        help="Client's minimum budget")
    budget_max = fields.Monetary(
        string='Max Budget', currency_field='company_currency',
        help="Client's maximum budget")

    @api.depends('property_interest_type')
    def _compute_property_sale_rent_filter(self):
        mapping = {
            'sale': 'for_sale',
            'rent': 'for_tenancy',
            'auction': 'for_auction',
        }
        for lead in self:
            lead.property_sale_rent_filter = mapping.get(
                lead.property_interest_type, False)

    @api.onchange('property_interest_type')
    def _onchange_property_interest_type(self):
        """Clear property selections when interest type changes."""
        self.property_ids = [(5, 0, 0)]
        self.selected_property_id = False

    @api.depends('property_sale_id')
    def _compute_property_sale_count(self):
        for lead in self:
            lead.property_sale_count = 1 if lead.property_sale_id else 0

    @api.depends('property_rental_id')
    def _compute_property_rental_count(self):
        for lead in self:
            lead.property_rental_count = 1 if lead.property_rental_id else 0

    @api.depends('property_auction_id')
    def _compute_property_auction_count(self):
        for lead in self:
            lead.property_auction_count = 1 if lead.property_auction_id else 0

    def action_create_property_sale(self):
        """Create a property.sale from this lead."""
        self.ensure_one()
        if not self.selected_property_id:
            raise UserError(_('Please select a property before creating a sale order.'))
        if self.property_sale_id:
            raise UserError(_('A sale order already exists for this lead.'))
        if not self.partner_id:
            raise UserError(_('Please set a customer on this lead before creating a sale order.'))
        sale_vals = {
            'property_id': self.selected_property_id.id,
            'partner_id': self.partner_id.id,
            'order_date': fields.Date.today(),
            'lead_id': self.id,
            'salesperson_id': self.user_id.id or self.env.uid,
        }
        if self.user_id:
            sale_vals['any_broker'] = True
            sale_vals['broker_id'] = self.user_id.partner_id.id
        sale = self.env['property.sale'].create(sale_vals)
        self.property_sale_id = sale.id
        return {
            'name': _('Property Sale'),
            'view_mode': 'form',
            'res_model': 'property.sale',
            'res_id': sale.id,
            'type': 'ir.actions.act_window',
        }

    def action_create_property_rental(self):
        """Create a property.rental from this lead."""
        self.ensure_one()
        if not self.selected_property_id:
            raise UserError(_('Please select a property before creating a rental.'))
        if self.property_rental_id:
            raise UserError(_('A rental order already exists for this lead.'))
        if not self.partner_id:
            raise UserError(_('Please set a customer on this lead before creating a rental.'))
        rental = self.env['property.rental'].create({
            'property_id': self.selected_property_id.id,
            'renter_id': self.partner_id.id,
            'start_date': fields.Date.today(),
            'end_date': fields.Date.add(fields.Date.today(), months=12),
            'lead_id': self.id,
            'salesperson_id': self.user_id.id or self.env.uid,
        })
        self.property_rental_id = rental.id
        return {
            'name': _('Property Rental'),
            'view_mode': 'form',
            'res_model': 'property.rental',
            'res_id': rental.id,
            'type': 'ir.actions.act_window',
        }

    def action_create_property_auction(self):
        """Create a property.auction from this lead."""
        self.ensure_one()
        if not self.selected_property_id:
            raise UserError(_('Please select a property before creating an auction.'))
        if self.property_auction_id:
            raise UserError(_('An auction already exists for this lead.'))
        if not self.partner_id:
            raise UserError(_('Please set a customer on this lead before creating an auction.'))
        now = fields.Datetime.now()
        auction = self.env['property.auction'].create({
            'property_id': self.selected_property_id.id,
            'responsible_id': self.user_id.id or self.env.uid,
            'bid_start_price': self.selected_property_id.unit_price,
            'start_time': now,
            'end_time': fields.Datetime.add(now, days=7),
            'lead_id': self.id,
        })
        self.property_auction_id = auction.id
        return {
            'name': _('Property Auction'),
            'view_mode': 'form',
            'res_model': 'property.auction',
            'res_id': auction.id,
            'type': 'ir.actions.act_window',
        }

    def action_set_won_rainbowman(self):
        """Override to auto-create sale/rental/auction when lead is won."""
        res = super().action_set_won_rainbowman()
        for lead in self:
            if lead.selected_property_id and lead.property_interest_type:
                if lead.property_interest_type == 'sale' and not lead.property_sale_id:
                    lead.action_create_property_sale()
                elif lead.property_interest_type == 'rent' and not lead.property_rental_id:
                    lead.action_create_property_rental()
                elif lead.property_interest_type == 'auction' and not lead.property_auction_id:
                    lead.action_create_property_auction()
        return res

    def action_view_property_sale(self):
        """Smart button to view linked sale."""
        self.ensure_one()
        return {
            'name': _('Property Sale'),
            'view_mode': 'form',
            'res_model': 'property.sale',
            'res_id': self.property_sale_id.id,
            'type': 'ir.actions.act_window',
        }

    def action_view_property_rental(self):
        """Smart button to view linked rental."""
        self.ensure_one()
        return {
            'name': _('Property Rental'),
            'view_mode': 'form',
            'res_model': 'property.rental',
            'res_id': self.property_rental_id.id,
            'type': 'ir.actions.act_window',
        }

    def action_view_property_auction(self):
        """Smart button to view linked auction."""
        self.ensure_one()
        return {
            'name': _('Property Auction'),
            'view_mode': 'form',
            'res_model': 'property.auction',
            'res_id': self.property_auction_id.id,
            'type': 'ir.actions.act_window',
        }

    def action_view_properties(self):
        """Smart button to view interested properties."""
        self.ensure_one()
        return {
            'name': _('Properties'),
            'view_mode': 'tree,form',
            'res_model': 'property.property',
            'type': 'ir.actions.act_window',
            'domain': [('id', 'in', self.property_ids.ids)],
        }
