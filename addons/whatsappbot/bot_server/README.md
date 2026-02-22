# WhatsApp Bot Server for Odoo

This is the WhatsApp Bot Server that connects the Odoo WhatsApp addon to real WhatsApp messaging using WhatsApp Web.

## Requirements

- **Node.js** v16 or higher
- **Chrome/Chromium** browser (for WhatsApp Web automation)
- **Odoo** with the whatsappbot addon installed

## Quick Start

### 1. Install System Dependencies

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nodejs npm chromium-browser

# Or install Chrome
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
sudo apt -f install
```

### 2. Install Node.js Dependencies

```bash
cd /opt/tr22/addons/whatsappbot/bot_server
npm install
```

### 3. Configure the Server

```bash
# Copy example config
cp .env.example .env

# Edit configuration
nano .env
```

Configure these settings in `.env`:
- `PORT`: Server port (default: 3002)
- `API_KEY`: API key for authentication (set same value in Odoo)
- `WEBHOOK_URL`: Your Odoo webhook URL (e.g., http://localhost:8069/whatsapp/webhook)
- `WEBHOOK_SECRET`: Optional secret for webhook signature verification

### 4. Start the Server

```bash
./start.sh
# Or
npm start
```

### 5. Connect WhatsApp in Odoo

1. Go to **WhatsApp > Configuration > Settings**
2. Set the **Server URL**: `http://localhost:3006`
3. Set the same **API Key** you configured in `.env`
4. Click **Check Status** to verify connection
5. Click **Get QR Code** and scan with your WhatsApp mobile app
6. Once connected, you can send and receive messages!

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Check server status |
| `/qr` | GET | Get QR code for authentication |
| `/logout` | POST | Logout from WhatsApp |
| `/send` | POST | Send text message |
| `/send-media` | POST | Send media (image/video/audio/document) |
| `/check-number` | GET | Check if number is on WhatsApp |
| `/groups` | GET | Get all groups |
| `/group/create` | POST | Create new group |
| `/group/info` | GET | Get group information |
| `/group/add-participant` | POST | Add participant to group |
| `/group/remove-participant` | POST | Remove participant from group |
| `/group/leave` | POST | Leave a group |
| `/group/rename` | POST | Rename a group |
| `/group/settings` | POST | Update group settings |
| `/contacts` | GET | Get all contacts |
| `/chats` | GET | Get all chats |

## Troubleshooting

### QR Code not showing
- Make sure Chrome/Chromium is installed
- Check server logs for errors
- Try deleting the `.wwebjs_auth` folder and restarting

### Messages not sending
- Check if WhatsApp is connected (scan QR code)
- Verify the phone number format (include country code)
- Check Odoo logs for error messages

### Connection lost
- The server will automatically try to reconnect
- If problems persist, restart the server and scan QR again

### Chrome crashes
If running on a server with limited resources:
```bash
# Increase swap space
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

## Running as a Service (systemd)

Create `/etc/systemd/system/whatsapp-bot.service`:

```ini
[Unit]
Description=WhatsApp Bot Server
After=network.target

[Service]
Type=simple
User=odoo
WorkingDirectory=/opt/tr22/addons/whatsappbot/bot_server
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable whatsapp-bot
sudo systemctl start whatsapp-bot
```

## Security Notes

1. **API Key**: Always set a strong API key in production
2. **Webhook Secret**: Use HMAC signature verification for webhooks
3. **Firewall**: Only allow connections from your Odoo server
4. **HTTPS**: Use a reverse proxy (nginx) with SSL for production

## Support

For issues with:
- **This bot server**: Check the console logs
- **Odoo addon**: Check Odoo server logs
- **WhatsApp Web**: See whatsapp-web.js documentation
