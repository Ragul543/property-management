# -*- coding: utf-8 -*-
import json
import base64
import logging
from odoo import http
from odoo.http import request, Response

_logger = logging.getLogger(__name__)

CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
}


def json_response(data, status=200):
    """Helper to return JSON response with CORS headers"""
    return Response(
        json.dumps(data, default=str),
        status=status,
        headers=CORS_HEADERS,
    )


class PropertyAPI(http.Controller):
    """REST API controller for React frontend integration"""

    # ── CORS preflight ───────────────────────────────────────────
    @http.route(
        ['/api/properties', '/api/properties/<int:prop_id>',
         '/api/property-types', '/api/contact', '/api/inquiry',
         '/api/property-image/<string:model>/<int:rec_id>'],
        type='http', auth='public', methods=['OPTIONS'], csrf=False,
    )
    def options_handler(self, **kw):
        """Handle CORS preflight requests"""
        return Response('', status=200, headers=CORS_HEADERS)

    # ── Public Image Endpoint ─────────────────────────────────────
    @http.route('/api/property-image/<string:model>/<int:rec_id>',
                type='http', auth='public', methods=['GET'], csrf=False)
    def get_property_image(self, model, rec_id, **kw):
        """
        GET /api/property-image/<model>/<id>
        Serves property images publicly using sudo() to bypass access rights.
        Supported models: property, gallery, user, partner
        """
        try:
            model_map = {
                'property': ('property.property', 'image'),
                'gallery': ('property.image', 'image'),
                'user': ('res.users', 'avatar_128'),
                'partner': ('res.partner', 'avatar_128'),
            }
            if model not in model_map:
                return Response('Not found', status=404)

            odoo_model, field_name = model_map[model]
            record = request.env[odoo_model].sudo().browse(rec_id)
            if not record.exists():
                return Response('Not found', status=404)

            image_data = record[field_name]
            if not image_data:
                return Response('No image', status=404)

            image_bytes = base64.b64decode(image_data)
            headers = {
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=86400',
                'Access-Control-Allow-Origin': '*',
            }
            return Response(image_bytes, status=200, headers=headers)

        except Exception as e:
            _logger.exception("Error serving property image")
            return Response('Error', status=500)

    # ── List Properties ──────────────────────────────────────────
    @http.route('/api/properties', type='http', auth='public',
                methods=['GET'], csrf=False)
    def get_properties(self, **kw):
        """
        GET /api/properties
        Query params: search, type, price_min, price_max, sort, limit, offset
        Returns list of properties with key fields.
        """
        try:
            domain = [('state', 'in', ['available', 'draft'])]

            # Search filter
            search = kw.get('search', '').strip()
            if search:
                domain += [
                    '|', '|', '|',
                    ('name', 'ilike', search),
                    ('city', 'ilike', search),
                    ('location', 'ilike', search),
                    ('street', 'ilike', search),
                ]

            # Property type filter
            prop_type = kw.get('type', '').strip()
            if prop_type:
                domain += [('property_type', '=', prop_type)]

            # Sale/Rent filter
            sale_rent = kw.get('sale_rent', '').strip()
            if sale_rent:
                domain += [('sale_rent', '=', sale_rent)]

            # Price filter
            price_min = kw.get('price_min')
            price_max = kw.get('price_max')
            if price_min:
                domain += [('unit_price', '>=', float(price_min))]
            if price_max:
                domain += [('unit_price', '<=', float(price_max))]

            # Sorting
            sort = kw.get('sort', '')
            order_map = {
                'price-low': 'unit_price asc',
                'price-high': 'unit_price desc',
                'newest': 'create_date desc',
                'sqft': 'total_sq_feet desc',
                'name': 'name asc',
            }
            order = order_map.get(sort, 'create_date desc')

            # Pagination
            limit = int(kw.get('limit', 50))
            offset = int(kw.get('offset', 0))

            properties = request.env['property.property'].sudo().search(
                domain, order=order, limit=limit, offset=offset
            )
            total = request.env['property.property'].sudo().search_count(domain)

            base_url = request.env['ir.config_parameter'].sudo().get_param('web.base.url')

            data = []
            for prop in properties:
                # Get image URL via public API endpoint
                image_url = ''
                if prop.image:
                    image_url = f'{base_url}/api/property-image/property/{prop.id}'

                # Get gallery images with overview_image type
                images = []
                if prop.image:
                    images.append({
                        'id': prop.id,
                        'url': image_url,
                        'name': prop.name or '',
                        'overview_image': 'front',
                    })
                for img in prop.property_image_ids:
                    images.append({
                        'id': img.id,
                        'url': f'{base_url}/api/property-image/gallery/{img.id}',
                        'name': img.name or '',
                        'overview_image': img.overview_image or 'others',
                    })

                # Get facilities
                facilities = [f.facility for f in prop.facility_ids]

                # Get tags
                tags = [t.tag for t in prop.property_tags]

                # Build location string
                location_parts = [
                    prop.city or '',
                    prop.state_id.name if prop.state_id else '',
                    prop.country_id.name if prop.country_id else '',
                ]
                location = ', '.join([p for p in location_parts if p])

                data.append({
                    'id': prop.id,
                    'name': prop.name,
                    'code': prop.code or '',
                    'property_type': prop.property_type or '',
                    'sale_rent': prop.sale_rent or '',
                    'state': prop.state or '',
                    'price': prop.unit_price or 0,
                    'rent_month': prop.rent_month or 0,
                    'location': location,
                    'street': prop.street or '',
                    'street2': prop.street2 or '',
                    'city': prop.city or '',
                    'state_name': prop.state_id.name if prop.state_id else '',
                    'country': prop.country_id.name if prop.country_id else '',
                    'zip': prop.zip or '',
                    'latitude': prop.latitude or 0,
                    'longitude': prop.longitude or 0,
                    'beds': prop.bedroom or 0,
                    'baths': prop.bathroom or 0,
                    'parking': prop.parking or 0,
                    'sqft': prop.total_sq_feet or 0,
                    'total_floor': prop.total_floor or 0,
                    'furnishing': prop.furnishing or '',
                    'construct_year': prop.construct_year or '',
                    'description': prop.description or '',
                    'image': image_url,
                    'images': images,
                    'facilities': facilities,
                    'tags': tags,
                    'landlord': prop.landlord_id.name if prop.landlord_id else '',
                    'responsible': prop.responsible_id.name if prop.responsible_id else '',
                })

            return json_response({
                'status': 'success',
                'total': total,
                'limit': limit,
                'offset': offset,
                'data': data,
            })

        except Exception as e:
            _logger.exception("Error in get_properties API")
            return json_response({'status': 'error', 'message': str(e)}, 500)

    # ── Single Property Detail ───────────────────────────────────
    @http.route('/api/properties/<int:prop_id>', type='http',
                auth='public', methods=['GET'], csrf=False)
    def get_property_detail(self, prop_id, **kw):
        """
        GET /api/properties/<id>
        Returns detailed property information including areas, nearby, legal.
        """
        try:
            prop = request.env['property.property'].sudo().browse(prop_id)
            if not prop.exists():
                return json_response(
                    {'status': 'error', 'message': 'Property not found'}, 404
                )

            base_url = request.env['ir.config_parameter'].sudo().get_param('web.base.url')

            # Main image + gallery with overview_image type
            images = []
            if prop.image:
                images.append({
                    'id': prop.id,
                    'url': f'{base_url}/api/property-image/property/{prop.id}',
                    'name': prop.name or '',
                    'overview_image': 'front',
                })
            for img in prop.property_image_ids:
                images.append({
                    'id': img.id,
                    'url': f'{base_url}/api/property-image/gallery/{img.id}',
                    'name': img.name or '',
                    'overview_image': img.overview_image or 'others',
                })

            # Facilities
            facilities = [f.facility for f in prop.facility_ids]

            # Tags
            tags = [t.tag for t in prop.property_tags]

            # Area measurements
            areas = []
            for area in prop.area_measurement_ids:
                areas.append({
                    'name': area.name,
                    'length': area.length,
                    'width': area.width,
                    'height': area.height,
                    'area': area.area,
                })

            # Nearby connectivity
            nearby = []
            for nb in prop.nearby_connectivity_ids:
                nearby.append({
                    'name': nb.name,
                    'direction': nb.direction or '',
                    'distance_km': nb.kilometer,
                })

            # Location string
            location_parts = [
                prop.city or '',
                prop.state_id.name if prop.state_id else '',
                prop.country_id.name if prop.country_id else '',
            ]
            location = ', '.join([p for p in location_parts if p])

            # Agent / responsible person info
            agent = {}
            if prop.responsible_id:
                agent = {
                    'name': prop.responsible_id.name or '',
                    'email': prop.responsible_id.email or '',
                    'phone': prop.responsible_id.phone or
                             (prop.responsible_id.partner_id.phone if prop.responsible_id.partner_id else ''),
                    'image': f'{base_url}/api/property-image/user/{prop.responsible_id.id}',
                }
            elif prop.landlord_id:
                agent = {
                    'name': prop.landlord_id.name or '',
                    'email': prop.landlord_id.email or '',
                    'phone': prop.landlord_id.phone or '',
                    'image': f'{base_url}/api/property-image/partner/{prop.landlord_id.id}',
                }

            data = {
                'id': prop.id,
                'name': prop.name,
                'code': prop.code or '',
                'property_type': prop.property_type or '',
                'sale_rent': prop.sale_rent or '',
                'state': prop.state or '',
                'price': prop.unit_price or 0,
                'rent_month': prop.rent_month or 0,
                'location': location,
                'street': prop.street or '',
                'street2': prop.street2 or '',
                'city': prop.city or '',
                'state_name': prop.state_id.name if prop.state_id else '',
                'country': prop.country_id.name if prop.country_id else '',
                'zip': prop.zip or '',
                'latitude': prop.latitude or 0,
                'longitude': prop.longitude or 0,
                'beds': prop.bedroom or 0,
                'baths': prop.bathroom or 0,
                'parking': prop.parking or 0,
                'sqft': prop.total_sq_feet or 0,
                'total_floor': prop.total_floor or 0,
                'furnishing': prop.furnishing or '',
                'construct_year': prop.construct_year or '',
                'description': prop.description or '',
                'license_no': prop.license_no or '',
                'type_residence': prop.type_residence or '',
                'images': images,
                'facilities': facilities,
                'tags': tags,
                'areas': areas,
                'nearby': nearby,
                'agent': agent,
                'landlord': prop.landlord_id.name if prop.landlord_id else '',
            }

            return json_response({'status': 'success', 'data': data})

        except Exception as e:
            _logger.exception("Error in get_property_detail API")
            return json_response({'status': 'error', 'message': str(e)}, 500)

    # ── Property Types (for filters) ─────────────────────────────
    @http.route('/api/property-types', type='http', auth='public',
                methods=['GET'], csrf=False)
    def get_property_types(self, **kw):
        """GET /api/property-types - Returns available property types & counts"""
        try:
            properties = request.env['property.property'].sudo().search([])
            type_counts = {}
            for prop in properties:
                ptype = prop.property_type or 'other'
                type_counts[ptype] = type_counts.get(ptype, 0) + 1

            sale_rent_counts = {}
            for prop in properties:
                sr = prop.sale_rent or 'unknown'
                sale_rent_counts[sr] = sale_rent_counts.get(sr, 0) + 1

            return json_response({
                'status': 'success',
                'property_types': type_counts,
                'sale_rent_types': sale_rent_counts,
                'total': len(properties),
            })
        except Exception as e:
            _logger.exception("Error in get_property_types API")
            return json_response({'status': 'error', 'message': str(e)}, 500)

    # ── Submit Inquiry ───────────────────────────────────────────
    @http.route('/api/inquiry', type='http', auth='public',
                methods=['POST'], csrf=False)
    def submit_inquiry(self, **kw):
        """
        POST /api/inquiry
        Body JSON: { property_id, name, email, phone, message }
        Creates a CRM lead linked to the property.
        """
        try:
            data = json.loads(request.httprequest.data or '{}')
            property_id = data.get('property_id')
            name = data.get('name', '')
            email = data.get('email', '')
            phone = data.get('phone', '')
            message = data.get('message', '')

            if not property_id:
                return json_response(
                    {'status': 'error', 'message': 'property_id is required'}, 400
                )

            prop = request.env['property.property'].sudo().browse(int(property_id))
            if not prop.exists():
                return json_response(
                    {'status': 'error', 'message': 'Property not found'}, 404
                )

            # Create or find partner
            partner = request.env['res.partner'].sudo().search(
                [('email', '=', email)], limit=1
            )
            if not partner and email:
                partner = request.env['res.partner'].sudo().create({
                    'name': name,
                    'email': email,
                    'phone': phone,
                })

            # Create CRM lead
            lead_vals = {
                'name': f'Inquiry: {prop.name} - {name}',
                'partner_id': partner.id if partner else False,
                'contact_name': name,
                'email_from': email,
                'phone': phone,
                'description': message,
                'property_ids': [(4, prop.id)],
                'selected_property_id': prop.id,
            }

            # Set interest type based on property sale_rent
            if prop.sale_rent == 'for_sale':
                lead_vals['property_interest_type'] = 'sale'
            elif prop.sale_rent == 'for_tenancy':
                lead_vals['property_interest_type'] = 'rent'
            elif prop.sale_rent == 'for_auction':
                lead_vals['property_interest_type'] = 'auction'

            lead = request.env['crm.lead'].sudo().create(lead_vals)

            return json_response({
                'status': 'success',
                'message': 'Inquiry submitted successfully',
                'lead_id': lead.id,
            })

        except Exception as e:
            _logger.exception("Error in submit_inquiry API")
            return json_response({'status': 'error', 'message': str(e)}, 500)

    # ── Contact Form ─────────────────────────────────────────────
    @http.route('/api/contact', type='http', auth='public',
                methods=['POST'], csrf=False)
    def submit_contact(self, **kw):
        """
        POST /api/contact
        Body JSON: { name, email, phone, subject, message }
        Creates a general CRM lead (not linked to specific property).
        """
        try:
            data = json.loads(request.httprequest.data or '{}')
            name = data.get('name', '')
            email = data.get('email', '')
            phone = data.get('phone', '')
            subject = data.get('subject', 'General Inquiry')
            message = data.get('message', '')

            # Create or find partner
            partner = request.env['res.partner'].sudo().search(
                [('email', '=', email)], limit=1
            )
            if not partner and email:
                partner = request.env['res.partner'].sudo().create({
                    'name': name,
                    'email': email,
                    'phone': phone,
                })

            lead = request.env['crm.lead'].sudo().create({
                'name': f'Website Contact: {subject} - {name}',
                'partner_id': partner.id if partner else False,
                'contact_name': name,
                'email_from': email,
                'phone': phone,
                'description': message,
            })

            return json_response({
                'status': 'success',
                'message': 'Message sent successfully',
                'lead_id': lead.id,
            })

        except Exception as e:
            _logger.exception("Error in submit_contact API")
            return json_response({'status': 'error', 'message': str(e)}, 500)
