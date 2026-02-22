# -*- coding: utf-8 -*-
import re
import logging
from datetime import datetime, timedelta
from odoo import models, api, fields

_logger = logging.getLogger(__name__)


class MailBotCommandParser(models.AbstractModel):
    _name = 'mail.bot.command.parser'
    _description = 'Mail Bot Command Parser'

    @api.model
    def parse_email(self, subject, body_text, body_html=None):
        """
        Parse email to extract command and data.
        Returns: dict with 'command', 'data', 'raw_text'
        """
        # Combine subject and body for analysis
        full_text = f"{subject or ''}\n{body_text or ''}"

        # Clean HTML if body_text is empty
        if not body_text and body_html:
            full_text = f"{subject or ''}\n{self._strip_html(body_html)}"

        # Detect command
        command = self._detect_command(full_text)

        # Extract data based on command type
        data = {}
        if command:
            data = self._extract_data(full_text, command.code)

        return {
            'command': command,
            'data': data,
            'raw_text': full_text,
        }

    @api.model
    def _detect_command(self, text):
        """Detect which command matches the email content"""
        text_lower = text.lower()

        # Get all active commands
        commands = self.env['mail.bot.command'].search([('active', '=', True)])

        for command in commands:
            keywords = command.get_keywords_list()
            for keyword in keywords:
                if keyword in text_lower:
                    _logger.info('Detected command: %s (keyword: %s)', command.code, keyword)
                    return command

        return None

    @api.model
    def _extract_data(self, text, command_code):
        """Extract structured data from email text based on command type"""
        data = {}

        if command_code in ('create_lead', 'create_opportunity'):
            data = self._extract_lead_data(text)
        elif command_code == 'create_contact':
            data = self._extract_contact_data(text)
        elif command_code == 'create_task':
            data = self._extract_task_data(text)

        return data

    @api.model
    def _extract_lead_data(self, text):
        """Extract lead information from text"""
        data = {
            'name': self._extract_field(text, ['lead name', 'subject', 'title', 'name']),
            'contact_name': self._extract_field(text, ['contact', 'contact name', 'person']),
            'email': self._extract_email_from_content(text),
            'phone': self._extract_phone(text),
            'company_name': self._extract_field(text, ['company', 'company name', 'organization']),
            'description': self._extract_field(text, ['description', 'details', 'notes']),
        }

        # If no name found, use first meaningful line
        if not data['name']:
            data['name'] = self._get_first_meaningful_line(text, ['create lead', 'new lead', 'add lead'])

        return data

    @api.model
    def _extract_contact_data(self, text):
        """Extract contact information from text"""
        data = {
            'name': self._extract_field(text, ['name', 'contact name', 'full name']),
            'email': self._extract_email_from_content(text),
            'phone': self._extract_phone(text),
            'mobile': self._extract_field(text, ['mobile', 'cell']),
            'company_name': self._extract_field(text, ['company', 'company name', 'organization']),
            'street': self._extract_field(text, ['address', 'street']),
            'city': self._extract_field(text, ['city']),
        }

        if not data['name']:
            data['name'] = self._get_first_meaningful_line(text, ['create contact', 'new contact', 'add contact'])

        return data

    @api.model
    def _extract_task_data(self, text):
        """Extract task information from text"""
        data = {
            'name': self._extract_field(text, ['task', 'task name', 'title', 'subject']),
            'description': self._extract_field(text, ['description', 'details', 'notes']),
            'priority': self._extract_priority(text),
            'date_deadline': self._extract_date(text),
        }

        if not data['name']:
            data['name'] = self._get_first_meaningful_line(text, ['create task', 'add task', 'new task', 'todo'])

        return data

    @api.model
    def _extract_field(self, text, field_labels):
        """
        Extract field value using pattern: 'label: value' or 'label - value'
        """
        for label in field_labels:
            # Pattern: "label: value" or "label - value" or "label= value"
            pattern = rf'{label}\s*[:=\-]\s*(.+?)(?:\n|$)'
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1).strip()
        return None

    @api.model
    def _extract_email_from_content(self, text):
        """Extract email address from text content (not the sender)"""
        # Look for labeled email first
        labeled = self._extract_field(text, ['email', 'e-mail', 'mail'])
        if labeled:
            # Verify it's a valid email
            email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', labeled)
            if email_match:
                return email_match.group(0)

        # Find all emails in text
        email_pattern = r'[\w\.-]+@[\w\.-]+\.\w+'
        matches = re.findall(email_pattern, text)

        # Return the first non-sender email if multiple found
        # (first email is likely the command target)
        if matches:
            return matches[0]
        return None

    @api.model
    def _extract_phone(self, text):
        """Extract phone number from text"""
        # Try labeled patterns first
        labeled = self._extract_field(text, ['phone', 'tel', 'telephone', 'mobile', 'cell'])
        if labeled:
            # Clean the phone number
            phone = re.sub(r'[^\d\+\-\(\)\s]', '', labeled)
            if phone and len(phone.replace(' ', '').replace('-', '')) >= 7:
                return phone.strip()

        # Try to find phone patterns in text
        patterns = [
            r'\+?\d{1,3}[\s\-]?\(?\d{1,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4}',
        ]
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                return match.group(0).strip()
        return None

    @api.model
    def _extract_priority(self, text):
        """Extract priority from text"""
        text_lower = text.lower()
        if any(word in text_lower for word in ['urgent', 'asap', 'critical', 'emergency']):
            return '3'
        elif any(word in text_lower for word in ['high priority', 'important', 'high']):
            return '2'
        elif any(word in text_lower for word in ['low priority', 'low', 'when possible', 'whenever']):
            return '0'
        return '1'

    @api.model
    def _extract_date(self, text):
        """Extract date from text"""
        text_lower = text.lower()
        now = fields.Datetime.now()

        # Check for relative dates
        if 'tomorrow' in text_lower:
            return now + timedelta(days=1)
        elif 'next week' in text_lower:
            return now + timedelta(weeks=1)
        elif 'next month' in text_lower:
            return now + timedelta(days=30)
        elif 'today' in text_lower:
            return now

        # Try to parse labeled dates
        date_str = self._extract_field(text, ['deadline', 'due', 'by', 'date'])
        if date_str:
            try:
                # Try common date formats
                for fmt in ['%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y']:
                    try:
                        return datetime.strptime(date_str.strip(), fmt)
                    except ValueError:
                        continue
            except Exception:
                pass

        return None

    @api.model
    def _strip_html(self, html):
        """Remove HTML tags from text"""
        if not html:
            return ''
        clean = re.compile('<.*?>')
        text = re.sub(clean, ' ', html)
        # Clean up whitespace
        text = re.sub(r'\s+', ' ', text)
        return text.strip()

    @api.model
    def _get_first_meaningful_line(self, text, skip_keywords):
        """Get first line that doesn't contain command keywords"""
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        for line in lines:
            line_lower = line.lower()
            if not any(kw in line_lower for kw in skip_keywords):
                # Skip lines that are just labels
                if ':' in line and len(line.split(':')[0]) < 20:
                    continue
                return line[:100]
        return 'New Record from Email Bot'
