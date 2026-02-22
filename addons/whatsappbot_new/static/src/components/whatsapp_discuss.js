/** @odoo-module **/

import { Component, useState, useRef, onWillStart, onMounted, onWillUnmount } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { rpc } from "@web/core/network/rpc";

class WhatsAppDiscuss extends Component {
    static template = "whatsappbot_new.WhatsAppDiscuss";
    static props = {};

    setup() {
        this.notification = useService("notification");
        this.orm = useService("orm");
        this.busService = useService("bus_service");
        this.refreshInterval = null;
        this.userId = null;

        this.state = useState({
            conversations: [],
            activeConversation: null,
            messages: [],
            loading: true,
            loadingMessages: false,
            loadingContacts: false,
            showNewConversation: false,
            showNewGroup: false,
            showGroupInfo: false,
            searchQuery: "",
            contactResults: [],
            newPhoneNumber: "",
            selectedFile: null,
            fileBase64: null,
            // Group creation
            newGroupName: "",
            newGroupParticipants: [],
            selectedContacts: [],
            newGroupAdminOnly: false,  // Message permission: true = only admin can send
            // Group editing
            editingGroupName: false,
            editGroupNameValue: "",
            // Add member to group
            showAddMember: false,
            addMemberPhone: "",
        });

        this.messageInputRef = useRef("messageInput");
        this.messagesContainerRef = useRef("messagesContainer");
        this.fileInputRef = useRef("fileInput");

        onWillStart(async () => {
            // Get current user ID from server via our endpoint
            try {
                const userResult = await this._rpc("/whatsapp/current_user", {});
                if (userResult.ok) {
                    this.userId = userResult.user_id;
                    console.log("[WhatsApp] User ID loaded:", this.userId);
                }
            } catch (e) {
                console.warn("Could not get user ID:", e);
            }

            // Load conversations - ensure loading is set to false even on error
            try {
                await this.loadConversations();
            } catch (e) {
                console.error("Failed to load conversations in onWillStart:", e);
                this.state.loading = false;
            }
        });

        onMounted(() => {
            // Subscribe to WhatsApp bus channel for real-time updates
            this.subscribeToBus();

            // Fallback: refresh every 5 seconds for new messages (polling)
            this.refreshInterval = setInterval(() => {
                this.silentRefresh();
            }, 5000);

            // Do an initial silent refresh after a short delay
            setTimeout(() => this.silentRefresh(), 1000);
        });

        onWillUnmount(() => {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
            }
        });
    }

    subscribeToBus() {
        // Subscribe to user-specific WhatsApp channel for Odoo 19
        try {
            // Check if bus service is available
            if (!this.busService) {
                console.warn("[WhatsApp Bus] Bus service not available, using polling only.");
                return;
            }

            // Use cached user ID
            if (!this.userId) {
                console.warn("[WhatsApp Bus] User ID not available, bus subscription skipped. Using polling only.");
                return;
            }
            const channel = `whatsapp_conversation_${this.userId}`;
            console.log("[WhatsApp Bus] Subscribing to channel:", channel);

            // Try multiple subscription methods for Odoo 19 compatibility
            let subscribed = false;

            // Method 1: Direct subscribe (Odoo 19+)
            if (typeof this.busService.subscribe === 'function') {
                try {
                    this.busService.subscribe(channel, (payload, info) => {
                        console.log("[WhatsApp Bus] Notification received:", payload);
                        this.onBusNotification(payload);
                    });
                    subscribed = true;
                    console.log("[WhatsApp Bus] Subscribed using busService.subscribe()");
                } catch (e) {
                    console.warn("[WhatsApp Bus] subscribe() failed:", e);
                }
            }

            // Method 2: addEventListener for 'notification' events (alternative)
            if (!subscribed && typeof this.busService.addEventListener === 'function') {
                try {
                    this.busService.addEventListener('notification', ({ detail }) => {
                        console.log("[WhatsApp Bus] Event received:", detail);
                        this._processNotifications(detail);
                    });
                    // Also try to add channel if available
                    if (typeof this.busService.addChannel === 'function') {
                        this.busService.addChannel(channel);
                    }
                    subscribed = true;
                    console.log("[WhatsApp Bus] Subscribed using addEventListener()");
                } catch (e) {
                    console.warn("[WhatsApp Bus] addEventListener() failed:", e);
                }
            }

            // Method 3: Check for bus.bus model polling (fallback)
            if (!subscribed) {
                console.warn("[WhatsApp Bus] No subscription method worked, relying on polling only");
            }

        } catch (error) {
            console.error("[WhatsApp Bus] Failed to subscribe:", error);
        }
    }

    _processNotifications(detail) {
        // Process notifications from bus
        if (!detail) return;

        const notifications = Array.isArray(detail) ? detail : [detail];
        for (const notif of notifications) {
            // Check for WhatsApp-related notifications
            if (notif.type === 'whatsapp_notification' ||
                notif.type === 'new_message' ||
                notif.type === 'message_status') {
                this.onBusNotification(notif.payload || notif);
            } else if (notif.payload && (notif.payload.message || notif.payload.conversation)) {
                this.onBusNotification(notif.payload);
            }
        }
    }

    onBusNotification(payload) {
        // Handle incoming message notification from bus
        console.log("[WhatsApp Bus] Processing notification:", payload);

        // Handle multiple payload formats (Odoo 19 vs legacy)
        let data = payload;

        // Unwrap if wrapped in type/payload structure
        if (payload && payload.type && payload.payload) {
            console.log("[WhatsApp Bus] Unwrapping typed payload:", payload.type);
            data = payload.payload;
        } else if (payload && payload.payload) {
            data = payload.payload;
        }

        // Handle message status updates
        if (data.status && (data.message_id || data.whatsapp_message_id)) {
            console.log("[WhatsApp Bus] Status update:", data.message_id, data.status);
            this.updateMessageStatus(data.message_id, data.status);
            return;
        }

        // Handle new message
        if (data.message && data.conversation) {
            console.log("[WhatsApp Bus] New message:", data.message.id, "conv:", data.conversation_id);

            // Update conversation in list with reactivity
            this.updateConversationFromBus(data.conversation);

            // If this conversation is active, add the message
            if (this.state.activeConversation &&
                this.state.activeConversation.id === data.conversation_id) {
                // Check if message already exists
                const exists = this.state.messages.find(m => m.id === data.message.id);
                if (!exists) {
                    console.log("[WhatsApp Bus] Adding message to active conversation");
                    // Use push for reactivity
                    this.state.messages.push(data.message);
                    this.scrollToBottom();
                }
            }

            // Show notification for incoming messages (not in active conversation)
            if (data.message.direction === "incoming") {
                const isActive = this.state.activeConversation &&
                                this.state.activeConversation.id === data.conversation_id;
                if (!isActive) {
                    this.notification.add(
                        `${data.conversation.display_name}: ${data.message.body || "New message"}`,
                        { type: "info", sticky: false }
                    );
                }
            }
        } else if (data.conversation) {
            // Just conversation update (no message)
            console.log("[WhatsApp Bus] Conversation update:", data.conversation.id);
            this.updateConversationFromBus(data.conversation);
        } else {
            console.log("[WhatsApp Bus] Unknown notification format:", data);
            // Trigger a refresh as fallback
            this.silentRefresh();
        }
    }

    updateMessageStatus(messageId, status) {
        // Update message status in the current conversation
        const message = this.state.messages.find(m => m.id === messageId);
        if (message) {
            message.state = status;
            console.log(`Updated message ${messageId} status to ${status}`);
        }
    }

    updateConversationFromBus(conversation) {
        // Find and update existing conversation or add new one
        const existingIndex = this.state.conversations.findIndex(c => c.id === conversation.id);
        if (existingIndex >= 0) {
            // Update existing conversation properties for reactivity
            const existing = this.state.conversations[existingIndex];
            Object.assign(existing, conversation);
            // Move to top if not already there
            if (existingIndex > 0) {
                this.state.conversations.splice(existingIndex, 1);
                this.state.conversations.unshift(existing);
            }
        } else {
            // Add new conversation to top of list
            this.state.conversations.unshift(conversation);
        }

        // Also update active conversation if it's the same
        if (this.state.activeConversation && this.state.activeConversation.id === conversation.id) {
            Object.assign(this.state.activeConversation, conversation);
        }
    }

    async silentRefresh() {
        // Fallback refresh without showing loading spinner
        try {
            const result = await this._rpc("/whatsapp/conversations", { _ts: Date.now() });

            if (result.ok && result.conversations) {
                const oldConvs = [...this.state.conversations];
                const newConvs = result.conversations;

                // Check for new messages and unread changes
                for (const newConv of newConvs) {
                    const oldConv = oldConvs.find(c => c.id === newConv.id);

                    if (oldConv) {
                        // Detect changes
                        const msgChanged = newConv.last_message !== oldConv.last_message;
                        const countChanged = newConv.message_count !== oldConv.message_count;
                        const unreadChanged = newConv.unread_count !== oldConv.unread_count;
                        const lastMsgIdChanged = newConv.last_message_id !== oldConv.last_message_id;

                        const hasNewMessage = msgChanged || countChanged || lastMsgIdChanged;

                        if (hasNewMessage || unreadChanged) {
                            console.log(`[WhatsApp Polling] Changes in ${newConv.display_name}: msg_count=${oldConv.message_count}->${newConv.message_count}, unread=${oldConv.unread_count}->${newConv.unread_count}`);
                        }

                        // Show notification for new incoming messages
                        if (hasNewMessage && newConv.last_message_direction === 'incoming' && newConv.unread_count > oldConv.unread_count) {
                            this.notification.add(
                                `${newConv.display_name}: ${newConv.last_message || "New message"}`,
                                { type: "info", sticky: false }
                            );
                        }
                    } else {
                        // New conversation
                        console.log(`[WhatsApp Polling] New conversation: ${newConv.display_name}`);
                        if (newConv.last_message_direction === 'incoming' && newConv.unread_count > 0) {
                            this.notification.add(
                                `${newConv.display_name}: ${newConv.last_message || "New message"}`,
                                { type: "info", sticky: false }
                            );
                        }
                    }
                }

                // Force reactivity by clearing and reassigning
                this.state.conversations.splice(0, this.state.conversations.length, ...newConvs);

                // Update active conversation reference if it exists
                if (this.state.activeConversation) {
                    const updatedActive = newConvs.find(c => c.id === this.state.activeConversation.id);
                    if (updatedActive) {
                        // Update properties individually to trigger reactivity
                        Object.assign(this.state.activeConversation, updatedActive);
                    }
                }
            }

            // Refresh messages if conversation is active
            if (this.state.activeConversation) {
                const msgResult = await this._rpc(`/whatsapp/conversation/${this.state.activeConversation.id}/messages`, { _ts: Date.now() });
                if (msgResult.ok && msgResult.messages) {
                    const oldMsgIds = new Set(this.state.messages.map(m => m.id));
                    const newMessages = msgResult.messages.filter(m => !oldMsgIds.has(m.id));

                    if (newMessages.length > 0 || msgResult.messages.length !== this.state.messages.length) {
                        // Force reactivity by using splice
                        this.state.messages.splice(0, this.state.messages.length, ...msgResult.messages);
                        if (newMessages.length > 0) {
                            console.log(`[WhatsApp Polling] ${newMessages.length} new message(s) in active conversation`);
                            this.scrollToBottom();
                        }
                    }
                }
            }
        } catch (error) {
            console.error("[WhatsApp Polling] Error:", error);
        }
    }

    async _rpc(route, params = {}) {
        return await rpc(route, params);
    }

    async loadConversations() {
        console.log("[WhatsApp] Loading conversations...");
        try {
            this.state.loading = true;
            const result = await this._rpc("/whatsapp/conversations", { _ts: Date.now() });
            console.log("[WhatsApp] Conversations API result:", result);

            if (result.ok) {
                this.state.conversations = result.conversations || [];
                console.log("[WhatsApp] Loaded", this.state.conversations.length, "conversations");
            } else {
                console.error("[WhatsApp] API returned error:", result.error);
                this.notification.add(result.error || "Failed to load conversations", { type: "danger" });
            }
        } catch (error) {
            console.error("[WhatsApp] Error loading conversations:", error);
            this.notification.add("Failed to load conversations: " + (error.message || error), { type: "danger" });
        } finally {
            this.state.loading = false;
            console.log("[WhatsApp] Loading state set to false");
        }
    }

    onConversationClick(ev) {
        const convId = parseInt(ev.currentTarget.dataset.id);
        const conversation = this.state.conversations.find(c => c.id === convId);
        if (conversation) {
            this.selectConversation(conversation);
        }
    }

    onContactClick(ev) {
        const phone = ev.currentTarget.dataset.phone;
        const partnerId = parseInt(ev.currentTarget.dataset.partner) || false;
        this.startConversation(phone, partnerId);
    }

    async selectConversation(conversation) {
        this.state.activeConversation = conversation;
        this.state.messages = [];
        await this.loadMessages(conversation.id);

        // Mark as read
        if (conversation.unread_count > 0) {
            await this._rpc(`/whatsapp/conversation/${conversation.id}/read`, {});
            conversation.unread_count = 0;
        }
    }

    async loadMessages(conversationId) {
        try {
            this.state.loadingMessages = true;
            const result = await this._rpc(`/whatsapp/conversation/${conversationId}/messages`, { _ts: Date.now() });
            if (result.ok) {
                this.state.messages = result.messages;
                this.scrollToBottom();
            }
        } catch (error) {
            console.error("Error loading messages:", error);
        } finally {
            this.state.loadingMessages = false;
        }
    }

    scrollToBottom() {
        setTimeout(() => {
            const container = this.messagesContainerRef.el;
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }, 100);
    }

    async sendMessage(ev) {
        if (ev.key && ev.key !== "Enter") return;
        if (ev.key === "Enter" && ev.shiftKey) return;

        const input = this.messageInputRef.el;
        const message = input.value.trim();

        if (!this.state.activeConversation) return;
        if (!message && !this.state.selectedFile) return;

        try {
            input.value = "";
            let result;

            if (this.state.selectedFile) {
                // Send media
                result = await this._rpc(`/whatsapp/send_media`, {
                    conversation_id: this.state.activeConversation.id,
                    media_base64: this.state.fileBase64,
                    caption: message || null,
                    filename: this.state.selectedFile.name,
                    mimetype: this.state.selectedFile.type
                });
                this.removeSelectedFile();
            } else {
                // Send text
                result = await this._rpc(`/whatsapp/conversation/${this.state.activeConversation.id}/send`, {
                    message: message
                });
            }

            if (result.ok) {
                this.state.messages.push(result.message);
                this.updateConversationLastMessage(result.message);
                this.scrollToBottom();
            } else {
                this.notification.add(result.error || "Failed to send message", { type: "danger" });
            }
        } catch (error) {
            console.error("Error sending message:", error);
            this.notification.add("Failed to send message", { type: "danger" });
        }
    }

    // File handling methods
    triggerFileInput() {
        this.fileInputRef.el.click();
    }

    onFileSelected(ev) {
        const file = ev.target.files[0];
        if (!file) return;

        // Check file size (max 16MB for WhatsApp)
        if (file.size > 16 * 1024 * 1024) {
            this.notification.add("File too large. Maximum size is 16MB.", { type: "warning" });
            return;
        }

        this.state.selectedFile = {
            name: file.name,
            size: file.size,
            type: file.type
        };

        // Convert to base64
        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result.split(',')[1];
            this.state.fileBase64 = base64;
        };
        reader.readAsDataURL(file);
    }

    removeSelectedFile() {
        this.state.selectedFile = null;
        this.state.fileBase64 = null;
        if (this.fileInputRef.el) {
            this.fileInputRef.el.value = "";
        }
    }

    getFileIcon(mimeType) {
        if (!mimeType) return "fa-file";
        if (mimeType.startsWith("image/")) return "fa-file-image-o";
        if (mimeType.startsWith("video/")) return "fa-file-video-o";
        if (mimeType.startsWith("audio/")) return "fa-file-audio-o";
        if (mimeType.includes("pdf")) return "fa-file-pdf-o";
        if (mimeType.includes("word") || mimeType.includes("document")) return "fa-file-word-o";
        if (mimeType.includes("excel") || mimeType.includes("sheet")) return "fa-file-excel-o";
        return "fa-file-o";
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    updateConversationLastMessage(message) {
        const conv = this.state.conversations.find(c => c.id === message.conversation_id);
        if (conv) {
            conv.last_message = message.body;
            conv.last_message_date = message.timestamp;
            conv.last_message_direction = message.direction;
            // Move to top
            this.state.conversations = [
                conv,
                ...this.state.conversations.filter(c => c.id !== conv.id)
            ];
        }
    }

    // New conversation methods
    async toggleNewConversation() {
        this.state.showNewConversation = !this.state.showNewConversation;
        this.state.searchQuery = "";
        this.state.newPhoneNumber = "";

        if (this.state.showNewConversation) {
            // Load initial contacts when panel opens
            await this.loadInitialContacts();
        } else {
            this.state.contactResults = [];
        }
    }

    async loadInitialContacts() {
        try {
            this.state.loadingContacts = true;
            this.state.contactResults = [];
            console.log("Loading initial contacts...");
            const result = await this._rpc("/whatsapp/search_contacts", { query: "", limit: 50 });
            console.log("Contact search result:", result);
            if (result.ok) {
                this.state.contactResults = result.contacts || [];
                console.log(`Loaded ${this.state.contactResults.length} contacts`);
            } else {
                console.error("Contact search failed:", result.error);
                this.notification.add(result.error || "Failed to load contacts", { type: "warning" });
            }
        } catch (error) {
            console.error("Error loading contacts:", error);
            this.notification.add("Error loading contacts", { type: "danger" });
        } finally {
            this.state.loadingContacts = false;
        }
    }

    async searchContacts(ev) {
        const query = ev.target.value;
        this.state.searchQuery = query;

        try {
            const result = await this._rpc("/whatsapp/search_contacts", { query, limit: 50 });
            console.log("Search result for", query, ":", result);
            if (result.ok) {
                this.state.contactResults = result.contacts || [];
            } else {
                console.error("Search failed:", result.error);
            }
        } catch (error) {
            console.error("Error searching contacts:", error);
        }
    }

    async startConversation(phone, partnerId = false) {
        try {
            const result = await this._rpc("/whatsapp/new_conversation", {
                phone: phone,
                partner_id: partnerId
            });

            if (result.ok) {
                // Add to conversations if not exists
                const exists = this.state.conversations.find(c => c.id === result.conversation.id);
                if (!exists) {
                    this.state.conversations.unshift(result.conversation);
                }
                // Select the conversation
                await this.selectConversation(result.conversation);
                this.toggleNewConversation();
            }
        } catch (error) {
            console.error("Error starting conversation:", error);
            this.notification.add("Failed to start conversation", { type: "danger" });
        }
    }

    startConversationFromContact(contact) {
        this.startConversation(contact.phone, contact.id);
    }

    startConversationFromPhone() {
        const phone = this.state.newPhoneNumber.trim();
        if (phone) {
            this.startConversation(phone);
        }
    }

    async refreshConversations() {
        // Force refresh with cache-busting
        try {
            this.state.loading = true;
            const result = await this._rpc("/whatsapp/conversations", { _ts: Date.now() });
            if (result.ok) {
                this.state.conversations = result.conversations;
                this.notification.add("Conversations refreshed", { type: "success" });
            }
        } catch (error) {
            console.error("Error refreshing conversations:", error);
        } finally {
            this.state.loading = false;
        }

        if (this.state.activeConversation) {
            await this.loadMessages(this.state.activeConversation.id);
        }
    }

    formatTime(dateString) {
        if (!dateString) return "";
        const date = new Date(dateString);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();

        if (isToday) {
            return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        }

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return "Yesterday";
        }

        return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }

    formatMessageTime(dateString) {
        if (!dateString) return "";
        const date = new Date(dateString);
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    getStatusIcon(state) {
        switch (state) {
            case "sent": return "fa-check";
            case "delivered": return "fa-check-double";
            case "read": return "fa-check-double text-primary";
            case "failed": return "fa-exclamation-circle text-danger";
            default: return "fa-clock-o";
        }
    }

    shouldShowDateSeparator(index) {
        if (index === 0) return true;
        const current = new Date(this.state.messages[index].timestamp);
        const previous = new Date(this.state.messages[index - 1].timestamp);
        return current.toDateString() !== previous.toDateString();
    }

    formatDateSeparator(dateString) {
        if (!dateString) return "";
        const date = new Date(dateString);
        const now = new Date();

        if (date.toDateString() === now.toDateString()) {
            return "Today";
        }

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return "Yesterday";
        }

        return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    }

    // ==================== Group Methods ====================

    async toggleNewGroup() {
        this.state.showNewGroup = !this.state.showNewGroup;
        this.state.showNewConversation = false;
        this.state.newGroupName = "";
        this.state.selectedContacts = [];
        this.state.searchQuery = "";
        this.state.newGroupAdminOnly = false;

        if (this.state.showNewGroup) {
            // Load initial contacts when panel opens
            await this.loadInitialContacts();
        } else {
            this.state.contactResults = [];
        }
    }

    toggleGroupInfo() {
        this.state.showGroupInfo = !this.state.showGroupInfo;
    }

    onContactSelectForGroup(ev) {
        const contactId = parseInt(ev.currentTarget.dataset.id);
        const contact = this.state.contactResults.find(c => c.id === contactId);

        if (contact) {
            // Check if already selected
            const exists = this.state.selectedContacts.find(c => c.id === contactId);
            if (!exists) {
                this.state.selectedContacts = [...this.state.selectedContacts, contact];
            }
        }
    }

    removeContactFromGroup(ev) {
        const contactId = parseInt(ev.currentTarget.dataset.id);
        this.state.selectedContacts = this.state.selectedContacts.filter(c => c.id !== contactId);
    }

    async createGroup() {
        const name = this.state.newGroupName.trim();
        if (!name) {
            this.notification.add("Please enter a group name", { type: "warning" });
            return;
        }

        if (this.state.selectedContacts.length < 1) {
            this.notification.add("Please select at least one participant", { type: "warning" });
            return;
        }

        try {
            const participants = this.state.selectedContacts.map(c => c.phone);
            const result = await this._rpc("/whatsapp/group/create", {
                name: name,
                participants: participants,
                admin_only: this.state.newGroupAdminOnly
            });

            if (result.ok) {
                const settingText = this.state.newGroupAdminOnly
                    ? "Only admins can send messages"
                    : "All members can send messages";
                this.notification.add(`Group created! ${settingText}`, { type: "success" });
                // Add to conversations
                this.state.conversations.unshift(result.group);
                // Select the new group
                await this.selectConversation(result.group);
                this.toggleNewGroup();
            } else {
                this.notification.add(result.error || "Failed to create group", { type: "danger" });
            }
        } catch (error) {
            console.error("Error creating group:", error);
            this.notification.add("Failed to create group", { type: "danger" });
        }
    }

    toggleAdminOnly() {
        this.state.newGroupAdminOnly = !this.state.newGroupAdminOnly;
    }

    async updateGroupSettings(adminOnly) {
        if (!this.state.activeConversation || !this.state.activeConversation.is_group) {
            return;
        }

        try {
            const result = await this._rpc(`/whatsapp/group/${this.state.activeConversation.id}/settings`, {
                admin_only: adminOnly
            });

            if (result.ok) {
                const settingText = adminOnly
                    ? "Only admins can send messages now"
                    : "All members can send messages now";
                this.notification.add(settingText, { type: "success" });
            } else {
                this.notification.add(result.error || "Failed to update settings", { type: "danger" });
            }
        } catch (error) {
            console.error("Error updating group settings:", error);
            this.notification.add("Failed to update settings", { type: "danger" });
        }
    }

    async refreshGroupInfo() {
        if (!this.state.activeConversation || !this.state.activeConversation.is_group) {
            return;
        }

        try {
            const result = await this._rpc(`/whatsapp/group/${this.state.activeConversation.id}/info`, {});
            if (result.ok) {
                // Update active conversation with new info
                Object.assign(this.state.activeConversation, result.group);
                // Also update in conversations list
                const conv = this.state.conversations.find(c => c.id === result.group.id);
                if (conv) {
                    Object.assign(conv, result.group);
                }
            }
        } catch (error) {
            console.error("Error refreshing group info:", error);
        }
    }

    async leaveGroup() {
        if (!this.state.activeConversation || !this.state.activeConversation.is_group) {
            return;
        }

        if (!confirm("Are you sure you want to leave this group?")) {
            return;
        }

        try {
            const result = await this._rpc(`/whatsapp/group/${this.state.activeConversation.id}/leave`, {});
            if (result.ok) {
                this.notification.add("Left group successfully", { type: "success" });
                // Remove from conversations
                this.state.conversations = this.state.conversations.filter(
                    c => c.id !== this.state.activeConversation.id
                );
                this.state.activeConversation = null;
                this.state.messages = [];
                this.state.showGroupInfo = false;
            } else {
                this.notification.add(result.error || "Failed to leave group", { type: "danger" });
            }
        } catch (error) {
            console.error("Error leaving group:", error);
            this.notification.add("Failed to leave group", { type: "danger" });
        }
    }

    async addToContacts() {
        if (!this.state.activeConversation || this.state.activeConversation.is_group) {
            return;
        }

        const phone = this.state.activeConversation.phone;
        const defaultName = this.state.activeConversation.display_name || phone;

        // Prompt for contact name
        const name = prompt("Enter contact name:", defaultName);
        if (!name || !name.trim()) {
            return;
        }

        try {
            const result = await this._rpc("/whatsapp/contact/create", {
                name: name.trim(),
                phone: phone,
                conversation_id: this.state.activeConversation.id
            });

            if (result.ok) {
                this.notification.add(`Contact "${name.trim()}" added successfully`, { type: "success" });
                // Update active conversation with new partner info
                this.state.activeConversation.partner_id = result.partner_id;
                this.state.activeConversation.display_name = name.trim();
                // Update in conversations list
                const idx = this.state.conversations.findIndex(c => c.id === this.state.activeConversation.id);
                if (idx !== -1) {
                    this.state.conversations[idx].partner_id = result.partner_id;
                    this.state.conversations[idx].display_name = name.trim();
                }
            } else {
                this.notification.add(result.error || "Failed to add contact", { type: "danger" });
            }
        } catch (error) {
            console.error("Error adding contact:", error);
            this.notification.add("Failed to add contact", { type: "danger" });
        }
    }

    getParticipantDisplay(phone) {
        // Try to find a nice display name for a participant
        if (!phone) return "Unknown";

        // Format phone nicely
        if (phone.length > 10) {
            return `+${phone.slice(0, 2)} ${phone.slice(2)}`;
        }
        return phone;
    }

    startEditGroupName() {
        if (!this.state.activeConversation || !this.state.activeConversation.is_group) {
            return;
        }
        this.state.editingGroupName = true;
        this.state.editGroupNameValue = this.state.activeConversation.display_name || "";
    }

    cancelEditGroupName() {
        this.state.editingGroupName = false;
        this.state.editGroupNameValue = "";
    }

    async saveGroupName() {
        if (!this.state.activeConversation || !this.state.activeConversation.is_group) {
            return;
        }

        const newName = this.state.editGroupNameValue.trim();
        if (!newName) {
            this.notification.add("Please enter a group name", { type: "warning" });
            return;
        }

        try {
            const result = await this._rpc(`/whatsapp/group/${this.state.activeConversation.id}/rename`, {
                name: newName
            });

            if (result.ok) {
                this.notification.add("Group renamed successfully", { type: "success" });
                // Update active conversation
                this.state.activeConversation.display_name = newName;
                this.state.activeConversation.group_name = newName;
                // Update in conversations list
                const conv = this.state.conversations.find(c => c.id === this.state.activeConversation.id);
                if (conv) {
                    conv.display_name = newName;
                    conv.group_name = newName;
                }
                this.cancelEditGroupName();
            } else {
                this.notification.add(result.error || "Failed to rename group", { type: "danger" });
            }
        } catch (error) {
            console.error("Error renaming group:", error);
            this.notification.add("Failed to rename group", { type: "danger" });
        }
    }

    async becomeAdmin() {
        if (!this.state.activeConversation || !this.state.activeConversation.is_group) {
            return;
        }

        try {
            const result = await this._rpc(`/whatsapp/group/${this.state.activeConversation.id}/set_admin`, {});

            if (result.ok) {
                this.notification.add(result.message || "You are now the admin", { type: "success" });
                // Update active conversation
                if (result.group) {
                    Object.assign(this.state.activeConversation, result.group);
                } else {
                    this.state.activeConversation.is_admin = true;
                    this.state.activeConversation.created_by_uid = true;
                }
                // Also update in conversations list
                const conv = this.state.conversations.find(c => c.id === this.state.activeConversation.id);
                if (conv) {
                    conv.is_admin = true;
                    conv.created_by_uid = true;
                }
            } else {
                this.notification.add(result.error || "Failed to become admin", { type: "danger" });
            }
        } catch (error) {
            console.error("Error becoming admin:", error);
            this.notification.add("Failed to become admin", { type: "danger" });
        }
    }

    async removeParticipant(ev) {
        if (!this.state.activeConversation || !this.state.activeConversation.is_group) {
            return;
        }

        if (!this.state.activeConversation.is_admin) {
            this.notification.add("Only group admin can remove participants", { type: "warning" });
            return;
        }

        const phone = ev.currentTarget.dataset.phone;
        if (!phone) return;

        if (!confirm(`Are you sure you want to remove ${this.getParticipantDisplay(phone)} from this group?`)) {
            return;
        }

        try {
            const result = await this._rpc(`/whatsapp/group/${this.state.activeConversation.id}/remove_participant`, {
                phone: phone
            });

            if (result.ok) {
                this.notification.add("Participant removed successfully", { type: "success" });
                // Update local participants list
                const participants = this.state.activeConversation.participants || [];
                const newParticipants = participants.filter(p => p !== phone);
                this.state.activeConversation.participants = newParticipants;
                this.state.activeConversation.participant_count = newParticipants.length;

                // Also update in conversations list
                const conv = this.state.conversations.find(c => c.id === this.state.activeConversation.id);
                if (conv) {
                    conv.participants = newParticipants;
                    conv.participant_count = newParticipants.length;
                }
            } else {
                this.notification.add(result.error || "Failed to remove participant", { type: "danger" });
            }
        } catch (error) {
            console.error("Error removing participant:", error);
            this.notification.add("Failed to remove participant", { type: "danger" });
        }
    }

    async toggleAddMember() {
        this.state.showAddMember = !this.state.showAddMember;
        this.state.addMemberPhone = "";
        this.state.searchQuery = "";

        if (this.state.showAddMember) {
            // Load contacts when panel opens
            await this.loadInitialContacts();
        } else {
            this.state.contactResults = [];
        }
    }

    async addMemberFromContact(ev) {
        const phone = ev.currentTarget.dataset.phone;
        if (phone) {
            await this.addMemberToGroup(phone);
        }
    }

    async addMemberFromPhone() {
        const phone = this.state.addMemberPhone.trim();
        if (phone) {
            await this.addMemberToGroup(phone);
        }
    }

    async addMemberToGroup(phone) {
        if (!this.state.activeConversation || !this.state.activeConversation.is_group) {
            return;
        }

        if (!this.state.activeConversation.is_admin) {
            this.notification.add("Only group admin can add participants", { type: "warning" });
            return;
        }

        // Clean phone number
        const cleanPhone = phone.replace(/\D/g, '');
        if (!cleanPhone) {
            this.notification.add("Please enter a valid phone number", { type: "warning" });
            return;
        }

        // Check if already a participant
        const participants = this.state.activeConversation.participants || [];
        if (participants.some(p => p.includes(cleanPhone) || cleanPhone.includes(p))) {
            this.notification.add("This person is already in the group", { type: "warning" });
            return;
        }

        try {
            const result = await this._rpc(`/whatsapp/group/${this.state.activeConversation.id}/add_participant`, {
                phone: cleanPhone
            });

            if (result.ok) {
                this.notification.add("Participant added successfully", { type: "success" });
                // Update local participants list
                const newParticipants = [...participants, cleanPhone];
                this.state.activeConversation.participants = newParticipants;
                this.state.activeConversation.participant_count = newParticipants.length;

                // Also update in conversations list
                const conv = this.state.conversations.find(c => c.id === this.state.activeConversation.id);
                if (conv) {
                    conv.participants = newParticipants;
                    conv.participant_count = newParticipants.length;
                }

                // Clear input and close panel
                this.state.addMemberPhone = "";
                this.state.showAddMember = false;
                this.state.contactResults = [];
            } else {
                this.notification.add(result.error || "Failed to add participant", { type: "danger" });
            }
        } catch (error) {
            console.error("Error adding participant:", error);
            this.notification.add("Failed to add participant", { type: "danger" });
        }
    }
}

registry.category("actions").add("whatsapp_discuss", WhatsAppDiscuss);

export default WhatsAppDiscuss;
