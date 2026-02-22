/**
 * WhatsApp Bot Server for Odoo Integration
 * Uses whatsapp-web.js for WhatsApp Web API
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();

// Configuration
const PORT = process.env.PORT || 3002;
const API_KEY = process.env.API_KEY || 'your-api-key-here';
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:8069/whatsapp/webhook';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// State
let qrCodeData = null;
let isReady = false;
let isInitializing = true;

// Create WhatsApp client with local auth (persists session)
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// API Key middleware
const authenticateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (API_KEY && apiKey !== API_KEY) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    next();
};

// Helper: Send webhook notification to Odoo
async function sendWebhook(event, data) {
    if (!WEBHOOK_URL) return;

    const payload = { event, data };

    try {
        const headers = { 'Content-Type': 'application/json' };

        // Add HMAC signature if secret is configured
        if (WEBHOOK_SECRET) {
            const crypto = require('crypto');
            const signature = crypto
                .createHmac('sha256', WEBHOOK_SECRET)
                .update(JSON.stringify(payload))
                .digest('hex');
            headers['X-Webhook-Signature'] = signature;
        }

        await axios.post(WEBHOOK_URL, payload, { headers, timeout: 10000 });
        console.log(`Webhook sent: ${event}`);
    } catch (error) {
        console.error(`Webhook failed: ${error.message}`);
    }
}

// Helper: Normalize phone number
function normalizePhone(phone, countryCode = '91') {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) {
        cleaned = countryCode + cleaned;
    }
    return cleaned;
}

// Helper: Format chat ID
function formatChatId(phone, isGroup = false) {
    if (isGroup) {
        return phone.includes('@g.us') ? phone : `${phone}@g.us`;
    }
    return phone.includes('@c.us') ? phone : `${phone}@c.us`;
}

// ==================== WhatsApp Client Events ====================

client.on('qr', async (qr) => {
    console.log('QR Code received');
    try {
        qrCodeData = await QRCode.toDataURL(qr);
        isInitializing = false;
    } catch (err) {
        console.error('QR generation error:', err);
    }
});

client.on('ready', () => {
    console.log('WhatsApp client is ready!');
    isReady = true;
    isInitializing = false;
    qrCodeData = null;
});

client.on('authenticated', () => {
    console.log('WhatsApp authenticated');
});

client.on('auth_failure', (msg) => {
    console.error('Authentication failed:', msg);
    isReady = false;
    isInitializing = false;
});

client.on('disconnected', (reason) => {
    console.log('WhatsApp disconnected:', reason);
    isReady = false;
    // Try to reconnect
    setTimeout(() => {
        console.log('Attempting to reconnect...');
        client.initialize();
    }, 5000);
});

// Handle incoming messages
client.on('message', async (msg) => {
    console.log(`Message from ${msg.from}: ${msg.body}`);

    const chat = await msg.getChat();
    const contact = await msg.getContact();

    const messageData = {
        messageId: msg.id._serialized,
        from: msg.from,
        to: msg.to,
        body: msg.body,
        timestamp: msg.timestamp,
        isGroup: chat.isGroup,
        hasMedia: msg.hasMedia,
        type: msg.type
    };

    // Add group info if applicable
    if (chat.isGroup) {
        messageData.groupId = chat.id._serialized;
        messageData.groupName = chat.name;
        messageData.author = msg.author;
        messageData.authorName = contact.pushname || contact.name || msg.author;
    } else {
        messageData.contactName = contact.pushname || contact.name || msg.from;
    }

    // Handle quoted/reply messages
    if (msg.hasQuotedMsg) {
        try {
            const quotedMsg = await msg.getQuotedMessage();
            if (quotedMsg) {
                messageData.quotedMsg = {
                    id: quotedMsg.id._serialized,
                    body: quotedMsg.body,
                    type: quotedMsg.type,
                    from: quotedMsg.from,
                    author: quotedMsg.author
                };
            }
        } catch (err) {
            console.error('Error getting quoted message:', err);
        }
    }

    // Handle media
    if (msg.hasMedia) {
        try {
            const media = await msg.downloadMedia();
            if (media) {
                messageData.mediaData = media.data;
                messageData.mediaMimetype = media.mimetype;
                messageData.mediaFilename = media.filename || `file.${media.mimetype.split('/')[1]}`;
            }
        } catch (err) {
            console.error('Media download error:', err);
        }
    }

    // Send to Odoo webhook
    await sendWebhook('message_received', messageData);
});

// Handle message acknowledgement (sent, delivered, read)
client.on('message_ack', async (msg, ack) => {
    const ackMap = {
        '-1': 'error',
        '0': 'pending',
        '1': 'sent',
        '2': 'delivered',
        '3': 'read',
        '4': 'played'
    };

    await sendWebhook('message_ack', {
        messageId: msg.id._serialized,
        status: ackMap[ack.toString()] || 'unknown',
        ack: ack
    });
});

// Handle group participant changes
client.on('group_join', async (notification) => {
    await sendWebhook('group_join', {
        group_id: notification.chatId,
        participant: notification.recipientIds[0]
    });
});

client.on('group_leave', async (notification) => {
    await sendWebhook('group_leave', {
        group_id: notification.chatId,
        participant: notification.recipientIds[0]
    });
});

client.on('group_update', async (notification) => {
    const chat = await client.getChatById(notification.chatId);
    await sendWebhook('group_update', {
        group_id: notification.chatId,
        groupName: chat.name,
        type: notification.type
    });
});

// Handle typing/presence changes
client.on('chat', async (chat) => {
    // This event fires when chat state changes
    // We can check if someone is typing
});

// Note: whatsapp-web.js doesn't have a direct typing event
// Typing indicators work as: we send our typing state, others see it
// But we don't receive real-time typing events from others via this library

// ==================== API Endpoints ====================

// Health check
app.get('/health', async (req, res) => {
    let phoneNumber = null;

    // Get the logged-in phone number if connected
    if (isReady && client.info) {
        try {
            phoneNumber = client.info.wid ? client.info.wid.user : null;
        } catch (err) {
            console.log('Could not get phone number:', err.message);
        }
    }

    res.json({
        ok: true,
        ready: isReady,
        initializing: isInitializing,
        hasQr: !!qrCodeData,
        phone: phoneNumber
    });
});

// Get QR code for authentication
app.get('/qr', authenticateApiKey, (req, res) => {
    if (isReady) {
        let phoneNumber = null;
        if (client.info && client.info.wid) {
            phoneNumber = client.info.wid.user;
        }
        return res.json({ ok: true, connected: true, phone: phoneNumber, message: 'Already connected' });
    }

    if (!qrCodeData) {
        return res.json({
            ok: false,
            error: isInitializing ? 'Initializing, please wait...' : 'No QR code available'
        });
    }

    res.json({ ok: true, qr: qrCodeData });
});

// Get current account info
app.get('/me', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        let phoneNumber = null;
        let pushname = null;

        if (client.info) {
            if (client.info.wid) {
                phoneNumber = client.info.wid.user;
            }
            pushname = client.info.pushname;
        }

        res.json({
            ok: true,
            phone: phoneNumber,
            pushname: pushname,
            connected: isReady
        });
    } catch (error) {
        res.json({ ok: false, error: error.message });
    }
});

// Logout
app.post('/logout', authenticateApiKey, async (req, res) => {
    try {
        await client.logout();
        isReady = false;
        qrCodeData = null;
        res.json({ ok: true, message: 'Logged out successfully' });
    } catch (error) {
        res.json({ ok: false, error: error.message });
    }
});

// Send text message
app.post('/send', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const { number, groupId, message, quotedMessageId } = req.body;

        if (!message) {
            return res.json({ ok: false, error: 'Message is required' });
        }

        let chatId;
        if (groupId) {
            chatId = formatChatId(groupId, true);
        } else if (number) {
            chatId = formatChatId(normalizePhone(number));
        } else {
            return res.json({ ok: false, error: 'Either number or groupId is required' });
        }

        console.log(`Sending message to ${chatId}: ${message.substring(0, 50)}...`);

        // Build send options
        const sendOptions = {};
        if (quotedMessageId) {
            sendOptions.quotedMessageId = quotedMessageId;
            console.log(`Replying to message: ${quotedMessageId}`);
        }

        const result = await client.sendMessage(chatId, message, sendOptions);

        res.json({
            ok: true,
            messageId: result.id._serialized,
            timestamp: result.timestamp
        });
    } catch (error) {
        console.error('Send error:', error);
        res.json({ ok: false, error: error.message });
    }
});

// Send media
app.post('/send-media', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const { number, groupId, mediaUrl, mediaBase64, caption, filename, mimetype } = req.body;

        let chatId;
        if (groupId) {
            chatId = formatChatId(groupId, true);
        } else if (number) {
            chatId = formatChatId(normalizePhone(number));
        } else {
            return res.json({ ok: false, error: 'Either number or groupId is required' });
        }

        let media;

        if (mediaBase64) {
            media = new MessageMedia(
                mimetype || 'application/octet-stream',
                mediaBase64,
                filename || 'file'
            );
        } else if (mediaUrl) {
            media = await MessageMedia.fromUrl(mediaUrl);
        } else {
            return res.json({ ok: false, error: 'Either mediaUrl or mediaBase64 is required' });
        }

        console.log(`Sending media to ${chatId}`);

        const result = await client.sendMessage(chatId, media, { caption: caption || '' });

        res.json({
            ok: true,
            messageId: result.id._serialized,
            timestamp: result.timestamp
        });
    } catch (error) {
        console.error('Send media error:', error);
        res.json({ ok: false, error: error.message });
    }
});

// React to a message
app.post('/react', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const { messageId, emoji } = req.body;

        if (!messageId) {
            return res.json({ ok: false, error: 'messageId is required' });
        }

        // Get the message by ID
        // Note: This requires the message to be in the chat history
        // For now, we'll use a workaround - the reaction will be sent if possible

        console.log(`Reacting to message ${messageId} with ${emoji || 'remove'}`);

        // Note: whatsapp-web.js reaction support may vary
        // This is a placeholder that attempts to react
        try {
            // Find the message and react to it
            const chats = await client.getChats();
            for (const chat of chats) {
                const messages = await chat.fetchMessages({ limit: 50 });
                const targetMsg = messages.find(m => m.id._serialized === messageId);
                if (targetMsg) {
                    await targetMsg.react(emoji || '');
                    return res.json({ ok: true, action: emoji ? 'added' : 'removed' });
                }
            }
            return res.json({ ok: false, error: 'Message not found in recent history' });
        } catch (reactError) {
            console.error('React error:', reactError);
            return res.json({ ok: false, error: reactError.message });
        }
    } catch (error) {
        console.error('React error:', error);
        res.json({ ok: false, error: error.message });
    }
});

// Send typing indicator
app.post('/typing', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const { number, groupId, typing } = req.body;

        let chatId;
        if (groupId) {
            chatId = formatChatId(groupId, true);
        } else if (number) {
            chatId = formatChatId(normalizePhone(number));
        } else {
            return res.json({ ok: false, error: 'Either number or groupId is required' });
        }

        const chat = await client.getChatById(chatId);
        if (chat) {
            if (typing) {
                await chat.sendStateTyping();
            } else {
                await chat.clearState();
            }
        }

        res.json({ ok: true });
    } catch (error) {
        console.error('Typing indicator error:', error);
        res.json({ ok: false, error: error.message });
    }
});

// Check if number is on WhatsApp
app.get('/check-number', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const { number } = req.query;
        if (!number) {
            return res.json({ ok: false, error: 'Number is required' });
        }

        const normalizedNumber = normalizePhone(number);
        const numberId = await client.getNumberId(normalizedNumber);

        res.json({
            ok: true,
            exists: !!numberId,
            number: normalizedNumber,
            whatsappId: numberId?._serialized || null
        });
    } catch (error) {
        res.json({ ok: false, error: error.message });
    }
});

// Get all groups
app.get('/groups', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const chats = await client.getChats();
        const groups = chats
            .filter(chat => chat.isGroup)
            .map(chat => ({
                id: chat.id._serialized,
                name: chat.name,
                participantCount: chat.participants?.length || 0
            }));

        res.json({ ok: true, groups });
    } catch (error) {
        res.json({ ok: false, error: error.message });
    }
});

// Create group
app.post('/group/create', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const { name, participants, adminOnly } = req.body;

        if (!name || !participants || !participants.length) {
            return res.json({ ok: false, error: 'Name and participants are required' });
        }

        // Format participant numbers
        const formattedParticipants = participants.map(p => formatChatId(normalizePhone(p)));

        console.log(`Creating group "${name}" with participants:`, formattedParticipants);

        const result = await client.createGroup(name, formattedParticipants);

        // Set group settings if adminOnly is specified
        if (adminOnly && result.gid) {
            try {
                const chat = await client.getChatById(result.gid._serialized);
                if (chat.setMessagesAdminsOnly) {
                    await chat.setMessagesAdminsOnly(true);
                }
            } catch (settingsError) {
                console.log('Could not set admin-only settings:', settingsError.message);
            }
        }

        res.json({
            ok: true,
            group: {
                id: result.gid._serialized,
                name: name
            },
            groupId: result.gid._serialized
        });
    } catch (error) {
        console.error('Create group error:', error);
        res.json({ ok: false, error: error.message });
    }
});

// Get group info
app.get('/group/info', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const { groupId } = req.query;
        if (!groupId) {
            return res.json({ ok: false, error: 'groupId is required' });
        }

        const chatId = formatChatId(groupId, true);
        const chat = await client.getChatById(chatId);

        if (!chat.isGroup) {
            return res.json({ ok: false, error: 'Not a group' });
        }

        const participants = chat.participants?.map(p => ({
            id: p.id._serialized,
            isAdmin: p.isAdmin || p.isSuperAdmin
        })) || [];

        res.json({
            ok: true,
            id: chat.id._serialized,
            name: chat.name,
            description: chat.description || '',
            participants: participants,
            participantCount: participants.length,
            owner: chat.owner?._serialized || null
        });
    } catch (error) {
        res.json({ ok: false, error: error.message });
    }
});

// Add participant to group
app.post('/group/add-participant', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const { groupId, participant } = req.body;

        if (!groupId || !participant) {
            return res.json({ ok: false, error: 'groupId and participant are required' });
        }

        const chatId = formatChatId(groupId, true);
        const chat = await client.getChatById(chatId);

        const participantId = formatChatId(normalizePhone(participant));
        await chat.addParticipants([participantId]);

        res.json({ ok: true, message: 'Participant added' });
    } catch (error) {
        res.json({ ok: false, error: error.message });
    }
});

// Remove participant from group
app.post('/group/remove-participant', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const { groupId, participant } = req.body;

        if (!groupId || !participant) {
            return res.json({ ok: false, error: 'groupId and participant are required' });
        }

        const chatId = formatChatId(groupId, true);
        const chat = await client.getChatById(chatId);

        const participantId = formatChatId(normalizePhone(participant));
        await chat.removeParticipants([participantId]);

        res.json({ ok: true, message: 'Participant removed' });
    } catch (error) {
        res.json({ ok: false, error: error.message });
    }
});

// Leave group
app.post('/group/leave', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const { groupId } = req.body;

        if (!groupId) {
            return res.json({ ok: false, error: 'groupId is required' });
        }

        const chatId = formatChatId(groupId, true);
        const chat = await client.getChatById(chatId);
        await chat.leave();

        res.json({ ok: true, message: 'Left the group' });
    } catch (error) {
        res.json({ ok: false, error: error.message });
    }
});

// Rename group
app.post('/group/rename', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const { groupId, name } = req.body;

        if (!groupId || !name) {
            return res.json({ ok: false, error: 'groupId and name are required' });
        }

        const chatId = formatChatId(groupId, true);
        const chat = await client.getChatById(chatId);
        await chat.setSubject(name);

        res.json({ ok: true, message: 'Group renamed', name });
    } catch (error) {
        res.json({ ok: false, error: error.message });
    }
});

// Update group settings (admin only messages)
app.post('/group/settings', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const { groupId, adminOnly } = req.body;

        if (!groupId || adminOnly === undefined) {
            return res.json({ ok: false, error: 'groupId and adminOnly are required' });
        }

        const chatId = formatChatId(groupId, true);
        const chat = await client.getChatById(chatId);

        if (chat.setMessagesAdminsOnly) {
            await chat.setMessagesAdminsOnly(adminOnly);
            res.json({ ok: true, message: `Messages ${adminOnly ? 'restricted to admins' : 'open to all'}` });
        } else {
            res.json({ ok: false, error: 'This feature is not supported' });
        }
    } catch (error) {
        res.json({ ok: false, error: error.message });
    }
});

// Get all contacts
app.get('/contacts', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const contacts = await client.getContacts();
        const formattedContacts = contacts
            .filter(c => c.isWAContact && !c.isGroup)
            .map(c => ({
                id: c.id._serialized,
                name: c.name || c.pushname || c.number,
                number: c.number,
                pushname: c.pushname
            }));

        res.json({ ok: true, contacts: formattedContacts });
    } catch (error) {
        res.json({ ok: false, error: error.message });
    }
});

// Get all chats
app.get('/chats', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const chats = await client.getChats();
        const formattedChats = chats.map(chat => ({
            id: chat.id._serialized,
            name: chat.name,
            isGroup: chat.isGroup,
            unreadCount: chat.unreadCount,
            lastMessage: chat.lastMessage ? {
                body: chat.lastMessage.body,
                timestamp: chat.lastMessage.timestamp
            } : null
        }));

        res.json({ ok: true, chats: formattedChats });
    } catch (error) {
        res.json({ ok: false, error: error.message });
    }
});

// Get profile picture
app.get('/profile-pic', authenticateApiKey, async (req, res) => {
    try {
        if (!isReady) {
            return res.json({ ok: false, error: 'WhatsApp not connected' });
        }

        const { number, groupId } = req.query;

        let chatId;
        if (groupId) {
            chatId = formatChatId(groupId, true);
        } else if (number) {
            chatId = formatChatId(normalizePhone(number));
        } else {
            return res.json({ ok: false, error: 'Either number or groupId is required' });
        }

        const url = await client.getProfilePicUrl(chatId);

        res.json({ ok: true, url: url || null });
    } catch (error) {
        res.json({ ok: false, error: error.message });
    }
});

// ==================== Start Server ====================

// Initialize WhatsApp client
console.log('Initializing WhatsApp client...');
client.initialize();

// Start Express server
app.listen(PORT, () => {
    console.log(`WhatsApp Bot Server running on port ${PORT}`);
    console.log(`Webhook URL: ${WEBHOOK_URL}`);
    console.log('Waiting for QR code...');
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await client.destroy();
    process.exit(0);
});
