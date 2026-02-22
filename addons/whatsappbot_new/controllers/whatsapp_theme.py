# -*- coding: utf-8 -*-
import json
import logging
from odoo import http
from odoo.http import request

_logger = logging.getLogger(__name__)


class WhatsAppThemeController(http.Controller):

    @http.route('/whatsapp/theme/css', type='json', auth='user', methods=['POST'])
    def get_theme_css(self, **kwargs):
        """Get current theme CSS variables"""
        try:
            theme_model = request.env['whatsapp.theme']
            css_vars = theme_model.get_theme_css()
            return {
                'ok': True,
                'css_vars': css_vars
            }
        except Exception as e:
            _logger.exception(f"Error getting theme CSS: {e}")
            return {'ok': False, 'error': str(e)}