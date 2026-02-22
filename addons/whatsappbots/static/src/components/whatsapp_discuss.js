/** @odoo-module **/

import { Component, useState, useRef, onWillStart, onMounted, onWillUnmount } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { rpc } from "@web/core/network/rpc";

class WhatsAppDiscuss extends Component {
    setup() {
        this.notification = useService("notification");
        this.orm = useService("orm");
        this.busService = useService("bus_service");
        this.refreshInterval = null;
        this.userId = null;
        this.busChannel = null;
        this.busNotificationHandler = null;

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
            newGroupName: "",
            newGroupParticipants: [],
            selectedContacts: [],
            newGroupAdminOnly: false,
            editingGroupName: false,
            editGroupNameValue: "",
            showAddMember: false,
            addMemberPhone: "",
            // Menu and Login states
            showMenu: false,
            showLoginPage: false,
            loadingQR: false,
            qrCode: null,
            qrError: null,
            isConnected: true,
            darkMode: false,
        });

        this.messageInputRef = useRef("messageInput");
        this.messagesContainerRef = useRef("messagesContainer");
        this.fileInputRef = useRef("fileInput");

        onWillStart(async () => {
            try {
                const userResult = await this._rpc("/whatsapp/current_user", {});
                if (userResult.ok) {
                    this.userId = userResult.user_id;
                    console.log("[WhatsApp] User ID loaded:", this.userId);
                }
            } catch (e) {
                console.warn("Could not get user ID:", e);
            }

            try {
                await this.loadConversations();
            } catch (e) {
                console.error("Failed to load conversations:", e);
                this.state.loading = false;
            }
        });

        onMounted(() => {
            this.subscribeToBus();
            this.refreshInterval = setInterval(() => {
                this.silentRefresh();
            }, 5000);
            setTimeout(() => this.silentRefresh(), 1000);
        });

        onWillUnmount(() => {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
            }
            if (this.busService && this.busNotificationHandler) {
                if (typeof this.busService.removeEventListener === "function") {
                    this.busService.removeEventListener("notification", this.busNotificationHandler);
                } else if (typeof this.busService.offNotification === "function") {
                    this.busService.offNotification(this.busNotificationHandler);
                }
            }
            if (this.busService && this.busChannel) {
                if (typeof this.busService.deleteChannel === "function") {
                    this.busService.deleteChannel(this.busChannel);
                } else if (typeof this.busService.removeChannel === "function") {
                    this.busService.removeChannel(this.busChannel);
                }
            }
        });
    }

    subscribeToBus() {
        try {
            if (!this.busService) {
                console.warn("[WhatsApp Bus] Bus service not available");
                return;
            }

            if (!this.userId) {
                console.warn("[WhatsApp Bus] User ID not available");
                return;
            }

            const channel = `whatsapp_conversation_${this.userId}`;
            this.busChannel = channel;
            console.log("[WhatsApp Bus] Subscribing to:", channel);

            // Odoo 17 bus subscription method
            if (typeof this.busService.addChannel === 'function') {
                this.busService.addChannel(channel);
                console.log("[WhatsApp Bus] Channel added:", channel);
            } else if (typeof this.busService.addChannels === "function") {
                this.busService.addChannels([channel]);
                console.log("[WhatsApp Bus] Channel added:", channel);
            }

            // Listen for notifications
            this.busNotificationHandler = (eventOrNotifications) => {
                this._handleBusNotification(eventOrNotifications);
            };

            if (typeof this.busService.addEventListener === "function") {
                this.busService.addEventListener("notification", this.busNotificationHandler);
                console.log("[WhatsApp Bus] Event listener added");
            } else if (typeof this.busService.onNotification === "function") {
                this.busService.onNotification(this.busNotificationHandler);
                console.log("[WhatsApp Bus] Event listener added");
            }

            if (typeof this.busService.start === "function") {
                this.busService.start();
            } else if (typeof this.busService.startPolling === "function") {
                this.busService.startPolling();
            }

        } catch (error) {
            console.error("[WhatsApp Bus] Subscription failed:", error);
        }
    }

    _handleBusNotification(eventOrNotifications) {
        const notifications = this._normalizeBusNotifications(eventOrNotifications);
        if (!notifications.length) return;

        for (const notification of notifications) {
            const { channel, payload } = this._extractBusNotification(notification);
            if (!channel) continue;

            // Check if this is a WhatsApp notification
            if (typeof channel === "string" && channel.includes("whatsapp_conversation")) {
                console.log("[WhatsApp Bus] Processing notification:", payload);
                this.onBusNotification(payload);
            }
        }
    }

    _normalizeBusNotifications(eventOrNotifications) {
        if (!eventOrNotifications) return [];
        const raw = eventOrNotifications.detail || eventOrNotifications;
        if (!Array.isArray(raw)) {
            return [raw];
        }
        if (!raw.length) {
            return [];
        }

        const first = raw[0];
        const second = raw[1];
        const firstIsArray = Array.isArray(first);
        const secondIsArray = Array.isArray(second);
        const looksLikeSingle = raw.length === 2 &&
            (typeof first === "string" || firstIsArray) &&
            !secondIsArray;

        if (looksLikeSingle) {
            return [raw];
        }

        return raw;
    }

    _extractBusNotification(notification) {
        if (!notification) {
            return { channel: null, payload: null };
        }
        if (Array.isArray(notification) && notification.length >= 2) {
            return { channel: notification[0], payload: notification[1] };
        }
        if (typeof notification === "object") {
            if ("channel" in notification) {
                return { channel: notification.channel, payload: notification.payload };
            }
            if ("payload" in notification &&
                Array.isArray(notification.payload) &&
                notification.payload.length >= 2) {
                return {
                    channel: notification.payload[0],
                    payload: notification.payload[1],
                };
            }
        }
        return { channel: null, payload: null };
    }

    onBusNotification(payload) {
        console.log("[WhatsApp Bus] Notification:", payload);

        let data = payload;
        if (payload && payload.payload) {
            data = payload.payload;
        }

        // Status update
        if (data.status && (data.message_id || data.whatsapp_message_id)) {
            this.updateMessageStatus(data.message_id, data.status);
            return;
        }

        // New message
        if (data.message && data.conversation) {
            this.updateConversationFromBus(data.conversation);

            if (this.state.activeConversation &&
                this.state.activeConversation.id === data.conversation_id) {
                const exists = this.state.messages.find(m => m.id === data.message.id);
                if (!exists) {
                    this.state.messages.push(data.message);
                    this.scrollToBottom();
                }
            }

            if (data.message.direction === "incoming") {
                const isActive = this.state.activeConversation &&
                                this.state.activeConversation.id === data.conversation_id;
                if (!isActive) {
                    this.notification.add(
                        `${data.conversation.display_name}: ${data.message.body || "New message"}`,
                        { type: "info" }
                    );
                }
            }
        } else if (data.conversation) {
            this.updateConversationFromBus(data.conversation);
        } else {
            this.silentRefresh();
        }
    }

    updateMessageStatus(messageId, status) {
        const message = this.state.messages.find(m => m.id === messageId);
        if (message) {
            message.state = status;
        }
    }

    updateConversationFromBus(conversation) {
        const existingIndex = this.state.conversations.findIndex(c => c.id === conversation.id);
        if (existingIndex >= 0) {
            const existing = this.state.conversations[existingIndex];
            Object.assign(existing, conversation);
            if (existingIndex > 0) {
                this.state.conversations.splice(existingIndex, 1);
                this.state.conversations.unshift(existing);
            }
        } else {
            this.state.conversations.unshift(conversation);
        }

        if (this.state.activeConversation && this.state.activeConversation.id === conversation.id) {
            Object.assign(this.state.activeConversation, conversation);
        }
    }

    async silentRefresh() {
        try {
            const result = await this._rpc("/whatsapp/conversations", { _ts: Date.now() });

            if (result.ok && result.conversations) {
                const oldConvs = [...this.state.conversations];
                const newConvs = result.conversations;

                for (const newConv of newConvs) {
                    const oldConv = oldConvs.find(c => c.id === newConv.id);

                    if (oldConv) {
                        const hasNewMessage = newConv.last_message !== oldConv.last_message ||
                                            newConv.message_count !== oldConv.message_count ||
                                            newConv.last_message_id !== oldConv.last_message_id;

                        if (hasNewMessage && newConv.last_message_direction === 'incoming' && 
                            newConv.unread_count > oldConv.unread_count) {
                            this.notification.add(
                                `${newConv.display_name}: ${newConv.last_message || "New message"}`,
                                { type: "info" }
                            );
                        }
                    } else {
                        if (newConv.last_message_direction === 'incoming' && newConv.unread_count > 0) {
                            this.notification.add(
                                `${newConv.display_name}: ${newConv.last_message || "New message"}`,
                                { type: "info" }
                            );
                        }
                    }
                }

                this.state.conversations.splice(0, this.state.conversations.length, ...newConvs);

                if (this.state.activeConversation) {
                    const updatedActive = newConvs.find(c => c.id === this.state.activeConversation.id);
                    if (updatedActive) {
                        Object.assign(this.state.activeConversation, updatedActive);
                    }
                }
            }

            if (this.state.activeConversation) {
                const msgResult = await this._rpc(
                    `/whatsapp/conversation/${this.state.activeConversation.id}/messages`, 
                    { _ts: Date.now() }
                );
                if (msgResult.ok && msgResult.messages) {
                    const oldMsgIds = new Set(this.state.messages.map(m => m.id));
                    const newMessages = msgResult.messages.filter(m => !oldMsgIds.has(m.id));

                    if (newMessages.length > 0 || msgResult.messages.length !== this.state.messages.length) {
                        this.state.messages.splice(0, this.state.messages.length, ...msgResult.messages);
                        if (newMessages.length > 0) {
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
        try {
            this.state.loading = true;
            const result = await this._rpc("/whatsapp/conversations", { _ts: Date.now() });

            if (result.ok) {
                this.state.conversations = result.conversations || [];
            } else {
                this.notification.add(result.error || "Failed to load conversations", { type: "danger" });
            }
        } catch (error) {
            console.error("Error loading conversations:", error);
            this.notification.add("Failed to load conversations", { type: "danger" });
        } finally {
            this.state.loading = false;
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

        if (conversation.unread_count > 0) {
            await this._rpc(`/whatsapp/conversation/${conversation.id}/read`, {});
            conversation.unread_count = 0;
        }
    }

    async loadMessages(conversationId) {
        try {
            this.state.loadingMessages = true;
            const result = await this._rpc(
                `/whatsapp/conversation/${conversationId}/messages`, 
                { _ts: Date.now() }
            );
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
                result = await this._rpc(`/whatsapp/send_media`, {
                    conversation_id: this.state.activeConversation.id,
                    media_base64: this.state.fileBase64,
                    caption: message || null,
                    filename: this.state.selectedFile.name,
                    mimetype: this.state.selectedFile.type
                });
                this.removeSelectedFile();
            } else {
                result = await this._rpc(
                    `/whatsapp/conversation/${this.state.activeConversation.id}/send`,
                    { message: message }
                );
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

    triggerFileInput() {
        this.fileInputRef.el.click();
    }

    onFileSelected(ev) {
        const file = ev.target.files[0];
        if (!file) return;

        if (file.size > 16 * 1024 * 1024) {
            this.notification.add("File too large. Maximum size is 16MB.", { type: "warning" });
            return;
        }

        this.state.selectedFile = {
            name: file.name,
            size: file.size,
            type: file.type
        };

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
            this.state.conversations = [
                conv,
                ...this.state.conversations.filter(c => c.id !== conv.id)
            ];
        }
    }

    async toggleNewConversation() {
        this.state.showNewConversation = !this.state.showNewConversation;
        this.state.searchQuery = "";
        this.state.newPhoneNumber = "";

        if (this.state.showNewConversation) {
            await this.loadInitialContacts();
        } else {
            this.state.contactResults = [];
        }
    }

    async loadInitialContacts() {
        try {
            this.state.loadingContacts = true;
            this.state.contactResults = [];
            const result = await this._rpc("/whatsapp/search_contacts", { query: "", limit: 50 });
            if (result.ok) {
                this.state.contactResults = result.contacts || [];
            } else {
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
            if (result.ok) {
                this.state.contactResults = result.contacts || [];
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
                const exists = this.state.conversations.find(c => c.id === result.conversation.id);
                if (!exists) {
                    this.state.conversations.unshift(result.conversation);
                }
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

    async toggleNewGroup() {
        this.state.showNewGroup = !this.state.showNewGroup;
        this.state.showNewConversation = false;
        this.state.newGroupName = "";
        this.state.selectedContacts = [];
        this.state.searchQuery = "";
        this.state.newGroupAdminOnly = false;

        if (this.state.showNewGroup) {
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
                this.state.conversations.unshift(result.group);
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
            const result = await this._rpc(
                `/whatsapp/group/${this.state.activeConversation.id}/settings`,
                { admin_only: adminOnly }
            );

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
            const result = await this._rpc(
                `/whatsapp/group/${this.state.activeConversation.id}/info`, 
                {}
            );
            if (result.ok) {
                Object.assign(this.state.activeConversation, result.group);
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
            const result = await this._rpc(
                `/whatsapp/group/${this.state.activeConversation.id}/leave`, 
                {}
            );
            if (result.ok) {
                this.notification.add("Left group successfully", { type: "success" });
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
                this.state.activeConversation.partner_id = result.partner_id;
                this.state.activeConversation.display_name = name.trim();
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
        if (!phone) return "Unknown";
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
            const result = await this._rpc(
                `/whatsapp/group/${this.state.activeConversation.id}/rename`,
                { name: newName }
            );

            if (result.ok) {
                this.notification.add("Group renamed successfully", { type: "success" });
                this.state.activeConversation.display_name = newName;
                this.state.activeConversation.group_name = newName;
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
            const result = await this._rpc(
                `/whatsapp/group/${this.state.activeConversation.id}/set_admin`, 
                {}
            );

            if (result.ok) {
                this.notification.add(result.message || "You are now the admin", { type: "success" });
                if (result.group) {
                    Object.assign(this.state.activeConversation, result.group);
                } else {
                    this.state.activeConversation.is_admin = true;
                    this.state.activeConversation.created_by_uid = true;
                }
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
            const result = await this._rpc(
                `/whatsapp/group/${this.state.activeConversation.id}/remove_participant`,
                { phone: phone }
            );

            if (result.ok) {
                this.notification.add("Participant removed successfully", { type: "success" });
                const participants = this.state.activeConversation.participants || [];
                const newParticipants = participants.filter(p => p !== phone);
                this.state.activeConversation.participants = newParticipants;
                this.state.activeConversation.participant_count = newParticipants.length;

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

        const cleanPhone = phone.replace(/\D/g, '');
        if (!cleanPhone) {
            this.notification.add("Please enter a valid phone number", { type: "warning" });
            return;
        }

        const participants = this.state.activeConversation.participants || [];
        if (participants.some(p => p.includes(cleanPhone) || cleanPhone.includes(p))) {
            this.notification.add("This person is already in the group", { type: "warning" });
            return;
        }

        try {
            const result = await this._rpc(
                `/whatsapp/group/${this.state.activeConversation.id}/add_participant`,
                { phone: cleanPhone }
            );

            if (result.ok) {
                this.notification.add("Participant added successfully", { type: "success" });
                const newParticipants = [...participants, cleanPhone];
                this.state.activeConversation.participants = newParticipants;
                this.state.activeConversation.participant_count = newParticipants.length;

                const conv = this.state.conversations.find(c => c.id === this.state.activeConversation.id);
                if (conv) {
                    conv.participants = newParticipants;
                    conv.participant_count = newParticipants.length;
                }

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

    // ==================== Menu and Logout Functions ====================

    toggleMenu(ev) {
        if (ev) {
            ev.preventDefault();
            ev.stopPropagation();
        }
        this.state.showMenu = !this.state.showMenu;

        // Close menu when clicking outside
        if (this.state.showMenu) {
            const closeMenu = (e) => {
                if (!e.target.closest('.dropdown')) {
                    this.state.showMenu = false;
                    document.removeEventListener('click', closeMenu);
                }
            };
            setTimeout(() => document.addEventListener('click', closeMenu), 0);
        }
    }

    openSettings(ev) {
        if (ev) {
            ev.preventDefault();
        }
        this.state.showMenu = false;
        // Navigate to WhatsApp settings
        window.location.href = '/web#action=whatsappbot_new.whatsapp_config_action';
    }

    toggleDarkMode(ev) {
        if (ev) {
            ev.preventDefault();
        }
        this.state.showMenu = false;
        this.state.darkMode = !this.state.darkMode;

        // Toggle dark mode class on the main container
        const container = document.querySelector('.o_whatsapp_discuss');
        if (container) {
            container.classList.toggle('dark-mode', this.state.darkMode);
        }

        this.notification.add(
            this.state.darkMode ? "Dark mode enabled" : "Dark mode disabled",
            { type: "info" }
        );
    }

    async logoutWhatsApp(ev) {
        if (ev) {
            ev.preventDefault();
        }
        this.state.showMenu = false;

        // Confirm logout
        if (!confirm("Are you sure you want to logout from WhatsApp? You will need to scan QR code again to reconnect.")) {
            return;
        }

        try {
            this.notification.add("Logging out...", { type: "info" });

            const result = await this._rpc("/whatsapp/logout", {});

            if (result.ok) {
                this.notification.add(result.message || "Successfully logged out from WhatsApp", { type: "success" });

                // Clear conversations and show login page
                this.state.conversations = [];
                this.state.activeConversation = null;
                this.state.messages = [];
                this.state.isConnected = false;

                // Show login page with QR code
                this.showLoginPageWithQR();
            } else {
                this.notification.add(result.error || "Failed to logout", { type: "danger" });
            }
        } catch (error) {
            console.error("Error logging out:", error);
            this.notification.add("Failed to logout from WhatsApp", { type: "danger" });
        }
    }

    async showLoginPageWithQR() {
        this.state.showLoginPage = true;
        this.state.loadingQR = true;
        this.state.qrCode = null;
        this.state.qrError = null;
        this.state.isConnected = false;

        await this.refreshQRCode();
    }

    async refreshQRCode(ev) {
        if (ev) {
            ev.preventDefault();
        }

        this.state.loadingQR = true;
        this.state.qrCode = null;
        this.state.qrError = null;

        try {
            const result = await this._rpc("/whatsapp/qr", {});

            if (result.ok) {
                if (result.connected) {
                    // Already connected
                    this.state.isConnected = true;
                    this.state.loadingQR = false;
                    this.notification.add("WhatsApp is already connected!", { type: "success" });
                } else if (result.qr) {
                    this.state.qrCode = result.qr;
                    this.state.loadingQR = false;

                    // Start polling to check if connected
                    this.startConnectionPolling();
                } else {
                    this.state.qrError = "QR code not available. Please try again.";
                    this.state.loadingQR = false;
                }
            } else {
                this.state.qrError = result.error || "Failed to get QR code";
                this.state.loadingQR = false;
            }
        } catch (error) {
            console.error("Error getting QR code:", error);
            this.state.qrError = "Failed to get QR code. Please try again.";
            this.state.loadingQR = false;
        }
    }

    startConnectionPolling() {
        // Poll every 3 seconds to check if connected
        if (this.qrPollingInterval) {
            clearInterval(this.qrPollingInterval);
        }

        this.qrPollingInterval = setInterval(async () => {
            if (!this.state.showLoginPage) {
                clearInterval(this.qrPollingInterval);
                return;
            }

            try {
                const result = await this._rpc("/whatsapp/status", {});

                if (result.ok && result.connected) {
                    // Connected! Stop polling and update UI
                    clearInterval(this.qrPollingInterval);
                    this.state.isConnected = true;
                    this.state.qrCode = null;
                    this.notification.add("WhatsApp connected successfully!", { type: "success" });

                    // Reload conversations
                    await this.loadConversations();
                }
            } catch (error) {
                console.error("Error checking connection status:", error);
            }
        }, 3000);
    }

    closeLoginPage(ev) {
        if (ev) {
            ev.preventDefault();
        }

        if (this.qrPollingInterval) {
            clearInterval(this.qrPollingInterval);
        }

        this.state.showLoginPage = false;
        this.state.qrCode = null;
        this.state.qrError = null;
        this.state.loadingQR = false;

        // If connected, reload conversations
        if (this.state.isConnected) {
            this.loadConversations();
        }
    }
}

WhatsAppDiscuss.template = "whatsappbot_new.WhatsAppDiscuss";
WhatsAppDiscuss.components = {};

registry.category("actions").add("whatsapp_discuss", WhatsAppDiscuss);

export default WhatsAppDiscuss;