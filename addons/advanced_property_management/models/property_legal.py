# -*- coding: utf-8 -*-
from odoo import api, fields, models, _


class PropertyPropertyLegal(models.Model):
    """Extend property.property with Tamil Nadu legal verification fields"""

    _inherit = "property.property"

    # ── Overall Legal Verification Status ──
    legal_verification_status = fields.Selection([
        ('not_started', 'Not Started'),
        ('in_progress', 'In Progress'),
        ('verified', 'Verified'),
        ('issues_found', 'Issues Found'),
    ], string="Legal Verification Status", default='not_started', tracking=True)
    legal_verified_by = fields.Many2one(
        'res.users', string="Verified By", tracking=True)
    legal_verified_date = fields.Date(string="Verified Date")
    legal_overall_remarks = fields.Text(string="Overall Legal Remarks")

    # ═══════════════════════════════════════════════
    # 1. PROPERTY IDENTITY (Survey Details)
    # ═══════════════════════════════════════════════
    legal_district = fields.Char(string="District")
    legal_taluk = fields.Char(string="Taluk")
    legal_village = fields.Char(string="Village / Ward")
    legal_survey_no = fields.Char(string="Survey Number")
    legal_subdivision_no = fields.Char(string="Sub-Division Number")

    # ═══════════════════════════════════════════════
    # 2. PATTA & CHITTA (Ownership & Land Type)
    # ═══════════════════════════════════════════════
    patta_no = fields.Char(string="Patta Number")
    chitta_no = fields.Char(string="Chitta Number")
    patta_owner_name = fields.Char(string="Owner Name (as per Patta)")
    patta_land_area = fields.Char(string="Area (as per Patta)")
    patta_land_type = fields.Selection([
        ('wet', 'Wet (Nanjai)'),
        ('dry', 'Dry (Punjai)'),
        ('manavai', 'Manavai (House Site)'),
        ('urban', 'Urban'),
    ], string="Land Classification")
    patta_tax_status = fields.Char(string="Tax Status")
    patta_verified = fields.Selection([
        ('not_verified', 'Not Verified'),
        ('verified', 'Verified'),
        ('discrepancy', 'Discrepancy Found'),
    ], string="Patta Verification", default='not_verified')
    patta_document = fields.Binary(string="Patta/Chitta Document")
    patta_document_filename = fields.Char(string="Patta Filename")
    patta_notes = fields.Text(string="Patta/Chitta Notes")

    # ═══════════════════════════════════════════════
    # 3. ENCUMBRANCE CERTIFICATE (EC)
    # ═══════════════════════════════════════════════
    ec_number = fields.Char(string="EC Number")
    ec_from_date = fields.Date(string="EC Period From")
    ec_to_date = fields.Date(string="EC Period To")
    ec_status = fields.Selection([
        ('clear', 'Clear (No Encumbrance)'),
        ('encumbered', 'Encumbered'),
        ('pending', 'Pending Verification'),
    ], string="EC Status", default='pending')
    ec_remarks = fields.Text(string="EC Remarks")
    ec_verified = fields.Selection([
        ('not_verified', 'Not Verified'),
        ('verified', 'Verified'),
        ('discrepancy', 'Discrepancy Found'),
    ], string="EC Verification", default='not_verified')
    ec_document = fields.Binary(string="EC Document")
    ec_document_filename = fields.Char(string="EC Filename")

    # ═══════════════════════════════════════════════
    # 4. FMB / TSLR (Survey Boundary Sketch)
    # ═══════════════════════════════════════════════
    fmb_tslr_type = fields.Selection([
        ('fmb', 'FMB (Field Measurement Book)'),
        ('tslr', 'TSLR (Town Survey Land Register)'),
    ], string="Survey Sketch Type")
    fmb_boundary_north = fields.Char(string="North Boundary")
    fmb_boundary_south = fields.Char(string="South Boundary")
    fmb_boundary_east = fields.Char(string="East Boundary")
    fmb_boundary_west = fields.Char(string="West Boundary")
    fmb_verified = fields.Selection([
        ('not_verified', 'Not Verified'),
        ('verified', 'Verified'),
        ('discrepancy', 'Discrepancy Found'),
    ], string="FMB/TSLR Verification", default='not_verified')
    fmb_document = fields.Binary(string="FMB/TSLR Document")
    fmb_document_filename = fields.Char(string="FMB Filename")
    fmb_notes = fields.Text(string="FMB/TSLR Notes")

    # ═══════════════════════════════════════════════
    # 5. LAYOUT APPROVAL (CMDA / DTCP / Local Body)
    # ═══════════════════════════════════════════════
    layout_approval_no = fields.Char(string="Approval Number")
    layout_approval_date = fields.Date(string="Approval Date")
    layout_approved_by = fields.Selection([
        ('cmda', 'CMDA'),
        ('dtcp', 'DTCP'),
        ('local_body', 'Local Body / Municipality'),
        ('other', 'Other'),
    ], string="Approved By")
    layout_approval_status = fields.Selection([
        ('approved', 'Approved'),
        ('not_approved', 'Not Approved'),
        ('pending', 'Pending Verification'),
        ('not_applicable', 'Not Applicable'),
    ], string="Layout Approval Status", default='pending')
    layout_conditions = fields.Text(string="Approval Conditions / Restrictions")
    layout_verified = fields.Selection([
        ('not_verified', 'Not Verified'),
        ('verified', 'Verified'),
        ('discrepancy', 'Discrepancy Found'),
    ], string="Layout Verification", default='not_verified')
    layout_document = fields.Binary(string="Layout Approval Document")
    layout_document_filename = fields.Char(string="Layout Filename")

    # ═══════════════════════════════════════════════
    # 6. LAND USE / ZONING
    # ═══════════════════════════════════════════════
    zoning_type = fields.Selection([
        ('residential', 'Residential'),
        ('commercial', 'Commercial'),
        ('agricultural', 'Agricultural'),
        ('industrial', 'Industrial'),
        ('mixed', 'Mixed Use'),
    ], string="Zoning Classification")
    zoning_authority = fields.Char(string="Zoning Authority")
    zoning_permitted_use = fields.Text(string="Permitted Use")
    zoning_restrictions = fields.Text(string="Zoning Restrictions")
    zoning_verified = fields.Selection([
        ('not_verified', 'Not Verified'),
        ('verified', 'Verified'),
        ('discrepancy', 'Discrepancy Found'),
    ], string="Zoning Verification", default='not_verified')
    zoning_document = fields.Binary(string="Zoning Document")
    zoning_document_filename = fields.Char(string="Zoning Filename")

    # ═══════════════════════════════════════════════
    # 7. SELLER VERIFICATION / TITLE CHAIN
    # ═══════════════════════════════════════════════
    seller_name = fields.Char(string="Seller Name")
    seller_id_type = fields.Selection([
        ('aadhaar', 'Aadhaar'),
        ('pan', 'PAN Card'),
        ('passport', 'Passport'),
        ('voter_id', 'Voter ID'),
        ('other', 'Other'),
    ], string="Seller ID Type")
    seller_id_no = fields.Char(string="Seller ID Number")
    sale_deed_no = fields.Char(string="Sale Deed Number")
    sale_deed_date = fields.Date(string="Sale Deed Date")
    sale_deed_sro = fields.Char(string="Sub-Registrar Office (SRO)")
    title_chain_clear = fields.Selection([
        ('yes', 'Clear'),
        ('no', 'Not Clear'),
        ('pending', 'Pending Verification'),
    ], string="Title Chain Status", default='pending')
    title_chain_remarks = fields.Text(string="Title Chain Remarks")
    title_verified = fields.Selection([
        ('not_verified', 'Not Verified'),
        ('verified', 'Verified'),
        ('discrepancy', 'Discrepancy Found'),
    ], string="Title Verification", default='not_verified')
    seller_document = fields.Binary(string="Sale Deed / Title Document")
    seller_document_filename = fields.Char(string="Sale Deed Filename")
    seller_id_document = fields.Binary(string="Seller ID Document")
    seller_id_document_filename = fields.Char(string="Seller ID Filename")

    # ═══════════════════════════════════════════════
    # 8. TAX & DUES
    # ═══════════════════════════════════════════════
    property_tax_no = fields.Char(string="Assessment / Tax Number")
    tax_paid_upto = fields.Date(string="Tax Paid Up To")
    tax_due_amount = fields.Float(string="Tax Due Amount")
    tax_authority = fields.Char(string="Tax Authority (Municipal Body)")
    tax_status = fields.Selection([
        ('paid', 'Fully Paid'),
        ('due', 'Dues Pending'),
        ('pending', 'Pending Verification'),
    ], string="Tax Status", default='pending')
    tax_verified = fields.Selection([
        ('not_verified', 'Not Verified'),
        ('verified', 'Verified'),
        ('discrepancy', 'Discrepancy Found'),
    ], string="Tax Verification", default='not_verified')
    tax_document = fields.Binary(string="Tax Receipt Document")
    tax_document_filename = fields.Char(string="Tax Filename")

    # ═══════════════════════════════════════════════
    # 9. ADDITIONAL LEGAL DOCUMENTS (One2many)
    # ═══════════════════════════════════════════════
    legal_document_ids = fields.One2many(
        'property.legal.document', 'property_id',
        string="Additional Legal Documents")

    # ── Computed: Legal Progress ──
    legal_progress = fields.Float(
        string="Verification Progress (%)",
        compute='_compute_legal_progress', store=True)

    @api.depends(
        'patta_verified', 'ec_verified', 'fmb_verified',
        'layout_verified', 'zoning_verified', 'title_verified',
        'tax_verified')
    def _compute_legal_progress(self):
        verification_fields = [
            'patta_verified', 'ec_verified', 'fmb_verified',
            'layout_verified', 'zoning_verified', 'title_verified',
            'tax_verified',
        ]
        for rec in self:
            verified_count = sum(
                1 for f in verification_fields
                if getattr(rec, f) == 'verified'
            )
            rec.legal_progress = (verified_count / len(verification_fields)) * 100


class PropertyLegalDocument(models.Model):
    """Model for additional legal documents attached to a property"""

    _name = "property.legal.document"
    _description = "Property Legal Document"
    _order = "date desc, id desc"

    property_id = fields.Many2one(
        'property.property', string="Property",
        required=True, ondelete='cascade')
    name = fields.Char(string="Document Name", required=True)
    document_type = fields.Selection([
        ('patta', 'Patta / Chitta'),
        ('ec', 'Encumbrance Certificate'),
        ('fmb', 'FMB Sketch'),
        ('tslr', 'TSLR Extract'),
        ('sale_deed', 'Sale Deed'),
        ('layout_approval', 'Layout Approval'),
        ('tax_receipt', 'Tax Receipt'),
        ('legal_opinion', 'Legal Opinion'),
        ('noc', 'NOC (No Objection Certificate)'),
        ('power_of_attorney', 'Power of Attorney'),
        ('partition_deed', 'Partition Deed'),
        ('will', 'Will / Settlement Deed'),
        ('mutation_order', 'Mutation Order'),
        ('adangal', 'Adangal Extract'),
        ('a_register', 'A-Register Extract'),
        ('other', 'Other'),
    ], string="Document Type", required=True)
    document = fields.Binary(string="Upload Document", required=True)
    document_filename = fields.Char(string="Filename")
    date = fields.Date(string="Document Date", default=fields.Date.today)
    verified = fields.Selection([
        ('not_verified', 'Not Verified'),
        ('verified', 'Verified'),
        ('discrepancy', 'Discrepancy Found'),
    ], string="Status", default='not_verified')
    notes = fields.Text(string="Notes / Remarks")
