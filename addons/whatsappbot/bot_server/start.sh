#!/bin/bash

# WhatsApp Bot Server Startup Script

echo "========================================="
echo "   WhatsApp Bot Server for Odoo"
echo "========================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed!"
    echo "Please install Node.js (v16 or higher):"
    echo "  Ubuntu/Debian: sudo apt install nodejs npm"
    echo "  Or visit: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "ERROR: Node.js version 16+ required (current: $(node -v))"
    exit 1
fi

# Go to script directory
cd "$(dirname "$0")"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install

    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to install dependencies!"
        exit 1
    fi
fi

# Create .env if not exists
if [ ! -f ".env" ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "Please edit .env to configure your settings!"
fi

# Check for Chrome/Chromium (required by puppeteer)
if ! command -v google-chrome &> /dev/null && ! command -v chromium-browser &> /dev/null && ! command -v chromium &> /dev/null; then
    echo ""
    echo "WARNING: Chrome/Chromium not found!"
    echo "Please install Chrome or Chromium:"
    echo "  Ubuntu/Debian: sudo apt install chromium-browser"
    echo "  Or: sudo apt install google-chrome-stable"
    echo ""
fi

echo ""
echo "Starting WhatsApp Bot Server..."
echo "Server will run on: http://localhost:${PORT:-3002}"
echo ""
echo "IMPORTANT: Scan the QR code in Odoo to connect WhatsApp"
echo "           Go to: WhatsApp > Configuration > Settings > Get QR Code"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Start the server
node server.js
