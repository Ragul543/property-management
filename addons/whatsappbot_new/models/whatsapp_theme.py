# -*- coding: utf-8 -*-
from odoo import models, fields, api
from odoo.exceptions import UserError


class WhatsAppTheme(models.Model):
    _name = 'whatsapp.theme'
    _description = 'WhatsApp Theme Configuration'

    name = fields.Char(string='Theme Name', required=True)
    key = fields.Char(string='Theme Key', required=True, help='Unique identifier for the theme')
    is_active = fields.Boolean(string='Active', default=False)
    
    # Color settings
    primary_color = fields.Char(string='Primary Color', default='#128C7E', help='Main theme color')
    secondary_color = fields.Char(string='Secondary Color', default='#25D366', help='Secondary theme color')
    background_color = fields.Char(string='Background Color', default='#E5DDD5', help='Main background color')
    chat_background_color = fields.Char(string='Chat Background', default='#ECE5DD', help='Chat area background')
    sidebar_background = fields.Char(string='Sidebar Background', default='#FFFFFF', help='Sidebar background')
    header_background = fields.Char(string='Header Background', default='#128C7E', help='Header background')
    message_outgoing_bg = fields.Char(string='Outgoing Message BG', default='#DCF8C6', help='Outgoing message background')
    message_incoming_bg = fields.Char(string='Incoming Message BG', default='#FFFFFF', help='Incoming message background')
    
    # Additional theme settings
    enable_wallpaper = fields.Boolean(string='Enable Wallpaper', default=True)
    wallpaper_opacity = fields.Float(string='Wallpaper Opacity', default=0.06, help='Opacity for background pattern (0.0-1.0)')
    
    # Theme type
    theme_type = fields.Selection([
        ('light', 'Light'),
        ('dark', 'Dark'),
        ('custom', 'Custom'),
    ], string='Theme Type', default='light')

    _sql_constraints = [
        ('key_unique', 'UNIQUE(key)', 'Theme key must be unique!'),
    ]

    @api.model
    def create(self, vals):
        # Only one theme can be active at a time
        if vals.get('is_active'):
            self.env['whatsapp.theme'].search([('is_active', '=', True)]).write({'is_active': False})
        return super().create(vals)

    def write(self, vals):
        # Only one theme can be active at a time
        if vals.get('is_active'):
            self.env['whatsapp.theme'].search([('is_active', '=', True)]).write({'is_active': False})
        return super().write(vals)

    @api.model
    def get_active_theme(self):
        """Get the currently active theme"""
        return self.search([('is_active', '=', True)], limit=1) or self._get_default_theme()

    @api.model
    def _get_default_theme(self):
        """Get or create default theme"""
        theme = self.search([('key', '=', 'default')], limit=1)
        if not theme:
            theme = self.create({
                'name': 'Default WhatsApp Theme',
                'key': 'default',
                'is_active': True,
                'primary_color': '#128C7E',
                'secondary_color': '#25D366',
                'background_color': '#E5DDD5',
                'chat_background_color': '#ECE5DD',
                'sidebar_background': '#FFFFFF',
                'header_background': '#128C7E',
                'message_outgoing_bg': '#DCF8C6',
                'message_incoming_bg': '#FFFFFF',
                'theme_type': 'light',
                'enable_wallpaper': True,
                'wallpaper_opacity': 0.06,
            })
        return theme

    def action_apply_theme(self):
        """Apply this theme as active"""
        self.ensure_one()
        # Deactivate all other themes
        self.env['whatsapp.theme'].search([('id', '!=', self.id)]).write({'is_active': False})
        # Activate this theme
        self.write({'is_active': True})
        
        # Dispatch theme change event to refresh UI
        self.env['bus.bus'].sudo().sendone(
            (self.env.cr.dbname, 'res.users', self.env.user.id),
            {
                'type': 'whatsapp_theme_change',
                'theme_id': self.id,
                'theme_name': self.name,
                'timestamp': fields.Datetime.now(),
            }
        )
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Success',
                'message': f'Theme "{self.name}" has been applied successfully!',
                'type': 'success',
            }
        }

    def action_reset_to_default(self):
        """Reset to default theme"""
        default_theme = self.env['whatsapp.theme'].search([('key', '=', 'default')], limit=1)
        if default_theme:
            default_theme.action_apply_theme()
        else:
            # Create default theme if it doesn't exist
            default_theme = self.env['whatsapp.theme'].create({
                'name': 'Default WhatsApp Theme',
                'key': 'default',
                'is_active': True,
                'primary_color': '#128C7E',
                'secondary_color': '#25D366',
                'background_color': '#E5DDD5',
                'chat_background_color': '#ECE5DD',
                'sidebar_background': '#FFFFFF',
                'header_background': '#128C7E',
                'message_outgoing_bg': '#DCF8C6',
                'message_incoming_bg': '#FFFFFF',
                'theme_type': 'light',
                'enable_wallpaper': True,
                'wallpaper_opacity': 0.06,
            })
            default_theme.action_apply_theme()
        
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': 'Success',
                'message': 'Reset to default theme successfully!',
                'type': 'success',
            }
        }

    @api.model
    def get_theme_css(self):
        """Generate CSS variables for the active theme"""
        theme = self.get_active_theme()
        return {
            'primary_color': theme.primary_color,
            'secondary_color': theme.secondary_color,
            'background_color': theme.background_color,
            'chat_background_color': theme.chat_background_color,
            'sidebar_background': theme.sidebar_background,
            'header_background': theme.header_background,
            'message_outgoing_bg': theme.message_outgoing_bg,
            'message_incoming_bg': theme.message_incoming_bg,
            'wallpaper_opacity': theme.wallpaper_opacity,
            'enable_wallpaper': theme.enable_wallpaper,
        }