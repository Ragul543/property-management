/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, useState, onWillStart, useRef, markup } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

export class MailBotClientAction extends Component {
    static template = "mail_bot_management.MailBotClientAction";

    // Text colors for color picker
    textColors = [
        { name: "Black", color: "#000000" },
        { name: "Dark Gray", color: "#444444" },
        { name: "Gray", color: "#888888" },
        { name: "Light Gray", color: "#cccccc" },
        { name: "Red", color: "#ff0000" },
        { name: "Dark Red", color: "#990000" },
        { name: "Orange", color: "#ff6600" },
        { name: "Yellow", color: "#ffcc00" },
        { name: "Green", color: "#00cc00" },
        { name: "Dark Green", color: "#006600" },
        { name: "Cyan", color: "#00cccc" },
        { name: "Blue", color: "#0066ff" },
        { name: "Dark Blue", color: "#000099" },
        { name: "Purple", color: "#9900cc" },
        { name: "Pink", color: "#ff66cc" },
        { name: "Brown", color: "#996633" },
    ];

    // Common emojis list
    emojis = [
        "😀", "😃", "😄", "😁", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘",
        "😗", "😙", "😚", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐",
        "😑", "😶", "😏", "😒", "🙄", "😬", "🤥", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢",
        "🤮", "🤧", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "😎", "🤓", "🧐", "😕", "😟", "🙁", "☹️",
        "😮", "😯", "😲", "😳", "🥺", "😦", "😧", "😨", "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞",
        "😓", "😩", "😫", "🥱", "😤", "😡", "😠", "🤬", "👍", "👎", "👏", "🙌", "👐", "🤲", "🤝", "🙏",
        "✍️", "💪", "🦾", "🦿", "🦵", "🦶", "👂", "🦻", "👃", "🧠", "🦷", "🦴", "👀", "👁️", "👅", "👄",
        "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖",
        "💘", "💝", "💟", "☮️", "✝️", "☪️", "🕉️", "☸️", "✡️", "🔯", "🕎", "☯️", "☦️", "🛐", "⛎", "♈",
        "🔥", "💧", "🌊", "🎉", "🎊", "✨", "⭐", "🌟", "💫", "🎯", "🏆", "🥇", "🥈", "🥉", "⚽", "🏀"
    ];

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.notification = useService("notification");

        // Refs for file inputs
        this.fileInputRef = useRef("fileInput");
        this.imageInputRef = useRef("imageInput");
        this.composeEditorRef = useRef("composeEditor");

        this.state = useState({
            activeFolder: "inbox",
            loading: false,
            searchQuery: "",
            selectedMessage: null,
            selectedIds: [],
            messages: [],
            currentPage: 1,
            pageSize: 20,
            counts: {
                inbox: 0,
                starred: 0,
                snoozed: 0,
                important: 0,
                sent: 0,
                draft: 0,
                allmail: 0,
                spam: 0,
                trash: 0,
            },
            // Compose dialog state
            showCompose: false,
            composeExpanded: false,
            composeMinimized: false,
            composeData: {
                to: "",
                cc: "",
                bcc: "",
                subject: "",
                body: "",
                attachments: [],
            },
            showCc: false,
            showBcc: false,
            // Compose toolbar state
            showFormatToolbar: false,
            showEmojiPicker: false,
            showLinkDialog: false,
            showColorPicker: false,
            showMoreOptionsMenu: false,
            emojiSearchQuery: "",
            linkData: {
                text: "",
                url: "",
            },
            // Menu state
            showMessagesMenu: false,
            showConfigMenu: false,
            selectedAttachments: [],
            loadingAttachments: false,
            // Filter state
            showFilters: false,
            filters: {
                from: "",
                to: "",
                date: "",
                hasAttachment: false,
                isUnread: false,
                isStarred: false,
            },
            // Gmail features state
            showKeyboardShortcuts: false,
            showScheduleSend: false,
            scheduledDate: null,
            scheduledTime: null,
            undoSendTimer: null,
            undoSendSeconds: 5,
            showUndoSend: false,
            pendingSendData: null,
            showContextMenu: false,
            contextMenuX: 0,
            contextMenuY: 0,
            contextMenuMessage: null,
        });

        onWillStart(async () => {
            await this.loadAllCounts();
            await this.loadFolderData("inbox");
            // Setup keyboard shortcuts
            this.setupKeyboardShortcuts();
        });
    }

    // ==========================================
    // KEYBOARD SHORTCUTS
    // ==========================================

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => this.handleKeyboardShortcut(e));
    }

    handleKeyboardShortcut(e) {
        // Don't trigger shortcuts when typing in input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            // Allow Escape to close compose
            if (e.key === 'Escape' && this.state.showCompose) {
                this.onCloseCompose();
            }
            return;
        }

        // Global shortcuts
        switch(e.key.toLowerCase()) {
            case 'c':
                // C - Compose new message
                e.preventDefault();
                this.onCompose();
                break;
            case '/':
                // / - Focus search
                e.preventDefault();
                const searchInput = document.querySelector('.search-box input');
                if (searchInput) searchInput.focus();
                break;
            case 'j':
                // J - Move to next message
                e.preventDefault();
                this.navigateToNextMessage();
                break;
            case 'k':
                // K - Move to previous message
                e.preventDefault();
                this.navigateToPreviousMessage();
                break;
            case 'o':
            case 'enter':
                // O or Enter - Open selected message
                if (this.state.selectedIds.length === 1 && !this.state.selectedMessage) {
                    e.preventDefault();
                    const msg = this.state.messages.find(m => m.id === this.state.selectedIds[0]);
                    if (msg) this.onOpenMessage(msg);
                }
                break;
            case 'u':
                // U - Back to list
                if (this.state.selectedMessage) {
                    e.preventDefault();
                    this.onBackToList();
                }
                break;
            case 'r':
                // R - Reply
                if (this.state.selectedMessage) {
                    e.preventDefault();
                    this.onReply();
                }
                break;
            case 'a':
                // A - Reply all
                if (this.state.selectedMessage) {
                    e.preventDefault();
                    this.onReplyAll();
                }
                break;
            case 'f':
                // F - Forward
                if (this.state.selectedMessage) {
                    e.preventDefault();
                    this.onForward();
                }
                break;
            case 's':
                // S - Star/Unstar
                if (this.state.selectedMessage) {
                    e.preventDefault();
                    this.onToggleStar(this.state.selectedMessage);
                }
                break;
            case 'e':
                // E - Archive
                if (this.state.selectedMessage) {
                    e.preventDefault();
                    this.onArchiveSelected();
                }
                break;
            case '#':
            case 'delete':
                // # or Delete - Delete
                if (this.state.selectedMessage || this.state.selectedIds.length > 0) {
                    e.preventDefault();
                    if (this.state.selectedMessage) {
                        this.onDeleteSelected();
                    } else {
                        this.onBulkDelete();
                    }
                }
                break;
            case '!':
                // ! - Report spam
                if (this.state.selectedMessage) {
                    e.preventDefault();
                    this.onMarkSpamSelected();
                }
                break;
            case '?':
                // ? - Show keyboard shortcuts
                e.preventDefault();
                this.state.showKeyboardShortcuts = !this.state.showKeyboardShortcuts;
                break;
            case 'escape':
                // Escape - Close dialogs
                this.closeAllDialogs();
                break;
            case 'g':
                // G + key combinations for navigation
                this.waitingForSecondKey = true;
                setTimeout(() => { this.waitingForSecondKey = false; }, 1000);
                break;
        }

        // G + key combinations
        if (this.waitingForSecondKey) {
            switch(e.key.toLowerCase()) {
                case 'i':
                    e.preventDefault();
                    this.loadFolderData('inbox');
                    this.waitingForSecondKey = false;
                    break;
                case 's':
                    e.preventDefault();
                    this.loadFolderData('starred');
                    this.waitingForSecondKey = false;
                    break;
                case 't':
                    e.preventDefault();
                    this.loadFolderData('sent');
                    this.waitingForSecondKey = false;
                    break;
                case 'd':
                    e.preventDefault();
                    this.loadFolderData('draft');
                    this.waitingForSecondKey = false;
                    break;
            }
        }
    }

    navigateToNextMessage() {
        const messages = this.paginatedMessages;
        if (!messages.length) return;

        if (this.state.selectedMessage) {
            // In detail view - go to next message
            const currentIndex = messages.findIndex(m => m.id === this.state.selectedMessage.id);
            if (currentIndex < messages.length - 1) {
                this.onOpenMessage(messages[currentIndex + 1]);
            }
        } else if (this.state.selectedIds.length > 0) {
            // In list view - move selection down
            const lastSelected = this.state.selectedIds[this.state.selectedIds.length - 1];
            const currentIndex = messages.findIndex(m => m.id === lastSelected);
            if (currentIndex < messages.length - 1) {
                this.state.selectedIds = [messages[currentIndex + 1].id];
            }
        } else {
            // Nothing selected - select first
            this.state.selectedIds = [messages[0].id];
        }
    }

    navigateToPreviousMessage() {
        const messages = this.paginatedMessages;
        if (!messages.length) return;

        if (this.state.selectedMessage) {
            // In detail view - go to previous message
            const currentIndex = messages.findIndex(m => m.id === this.state.selectedMessage.id);
            if (currentIndex > 0) {
                this.onOpenMessage(messages[currentIndex - 1]);
            }
        } else if (this.state.selectedIds.length > 0) {
            // In list view - move selection up
            const firstSelected = this.state.selectedIds[0];
            const currentIndex = messages.findIndex(m => m.id === firstSelected);
            if (currentIndex > 0) {
                this.state.selectedIds = [messages[currentIndex - 1].id];
            }
        } else {
            // Nothing selected - select last
            this.state.selectedIds = [messages[messages.length - 1].id];
        }
    }

    closeAllDialogs() {
        this.state.showKeyboardShortcuts = false;
        this.state.showScheduleSend = false;
        this.state.showContextMenu = false;
        this.state.showEmojiPicker = false;
        this.state.showColorPicker = false;
        this.state.showMoreOptionsMenu = false;
        this.state.showLinkDialog = false;
    }

    onShowKeyboardShortcuts() {
        this.state.showKeyboardShortcuts = true;
    }

    onCloseKeyboardShortcuts() {
        this.state.showKeyboardShortcuts = false;
    }

    get filteredMessages() {
        let messages = this.state.messages;

        // Apply search query filter
        if (this.state.searchQuery) {
            const q = this.state.searchQuery.toLowerCase();
            messages = messages.filter(m =>
                (m.subject || "").toLowerCase().includes(q) ||
                (m.display_name || "").toLowerCase().includes(q) ||
                (m.display_email || "").toLowerCase().includes(q)
            );
        }

        // Apply advanced filters
        const filters = this.state.filters;

        // From filter
        if (filters.from) {
            const fromQuery = filters.from.toLowerCase();
            messages = messages.filter(m =>
                (m.display_name || "").toLowerCase().includes(fromQuery) ||
                (m.display_email || "").toLowerCase().includes(fromQuery) ||
                (m.sender_email || "").toLowerCase().includes(fromQuery) ||
                (m.sender_name || "").toLowerCase().includes(fromQuery)
            );
        }

        // To filter
        if (filters.to) {
            const toQuery = filters.to.toLowerCase();
            messages = messages.filter(m =>
                (m.recipient_email || "").toLowerCase().includes(toQuery)
            );
        }

        // Date filter
        if (filters.date) {
            const now = new Date();
            let startDate;

            switch (filters.date) {
                case 'today':
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    break;
                case 'yesterday':
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
                    break;
                case 'week':
                    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case 'month':
                    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    break;
                case 'year':
                    startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                    break;
            }

            if (startDate) {
                messages = messages.filter(m => {
                    const msgDate = new Date(m.display_date || m.received_date || m.sent_date);
                    return msgDate >= startDate;
                });
            }
        }

        // Has attachment filter
        if (filters.hasAttachment) {
            messages = messages.filter(m => m.has_attachments || (m.attachment_ids && m.attachment_ids.length > 0));
        }

        // Is unread filter
        if (filters.isUnread) {
            messages = messages.filter(m => m.state === 'unread');
        }

        // Is starred filter
        if (filters.isStarred) {
            messages = messages.filter(m => m.is_starred);
        }

        return messages;
    }

    get hasActiveFilters() {
        const f = this.state.filters;
        return f.from || f.to || f.date || f.hasAttachment || f.isUnread || f.isStarred;
    }

    get totalPages() {
        return Math.max(1, Math.ceil(this.filteredMessages.length / this.state.pageSize));
    }

    get paginatedMessages() {
        const start = (this.state.currentPage - 1) * this.state.pageSize;
        const end = start + this.state.pageSize;
        return this.filteredMessages.slice(start, end);
    }

    get currentMessageIndex() {
        if (!this.state.selectedMessage) return -1;
        return this.filteredMessages.findIndex(m => m.id === this.state.selectedMessage.id);
    }

    get isAllSelected() {
        if (this.paginatedMessages.length === 0) return false;
        return this.paginatedMessages.every(m => this.state.selectedIds.includes(m.id));
    }

    async loadAllCounts() {
        try {
            const modelMap = {
                inbox: "mail.bot.inbox",
                sent: "mail.bot.sent",
                draft: "mail.bot.draft",
                spam: "mail.bot.spam",
                trash: "mail.bot.trash",
            };

            const countPromises = Object.entries(modelMap).map(async ([key, model]) => {
                const count = await this.orm.searchCount(model, []);
                return [key, count];
            });

            const counts = await Promise.all(countPromises);
            counts.forEach(([key, count]) => {
                this.state.counts[key] = count;
            });

            // Starred count
            const starredCount = await this.orm.searchCount("mail.bot.inbox", [["is_starred", "=", true]]);
            this.state.counts.starred = starredCount;

            // Snoozed count
            const snoozedCount = await this.orm.searchCount("mail.bot.inbox", [["state", "=", "snoozed"]]);
            this.state.counts.snoozed = snoozedCount;

            // Important count
            const importantCount = await this.orm.searchCount("mail.bot.inbox", [["is_important", "=", true]]);
            this.state.counts.important = importantCount;

            // All mail count (inbox + sent)
            this.state.counts.allmail = this.state.counts.inbox + this.state.counts.sent;

        } catch (error) {
            console.error("Error loading counts:", error);
        }
    }

    async loadFolderData(folder) {
        this.state.loading = true;
        this.state.activeFolder = folder;
        this.state.selectedMessage = null;
        this.state.selectedIds = [];
        this.state.currentPage = 1;
        this.state.selectedAttachments = [];
        this.state.loadingAttachments = false;

        try {
            let model, domain;

            // Handle special folders
            if (folder === "starred") {
                model = "mail.bot.inbox";
                domain = [["is_starred", "=", true]];
            } else if (folder === "snoozed") {
                model = "mail.bot.inbox";
                domain = [["state", "=", "snoozed"]];
            } else if (folder === "important") {
                model = "mail.bot.inbox";
                domain = [["is_important", "=", true]];
            } else if (folder === "allmail") {
                // For all mail, we'll load both inbox and sent with their respective fields
                const inboxFields = [
                    "id", "display_name", "display_email", "subject", "body", "state", "display_date",
                    "is_starred", "is_important", "recipient_email", "sender_email", "sender_name",
                    "has_attachments", "cc_emails", "bcc_emails", "received_date", "message_id"
                ];
                const sentFields = [
                    "id", "display_name", "display_email", "subject", "body", "state", "display_date",
                    "is_starred", "recipient_email", "has_attachments", "cc_emails", "bcc_emails", "sent_date",
                    "message_id", "in_reply_to"
                ];
                const inboxRecords = await this.orm.searchRead(
                    "mail.bot.inbox",
                    [],
                    inboxFields,
                    { order: "received_date desc", limit: 100 }
                );
                const sentRecords = await this.orm.searchRead(
                    "mail.bot.sent",
                    [],
                    sentFields,
                    { order: "sent_date desc", limit: 100 }
                );

                // Mark records with their source for proper handling
                inboxRecords.forEach(r => { r._source = "inbox"; });
                sentRecords.forEach(r => { r._source = "sent"; });

                // Combine and sort by date
                let allRecords = [...inboxRecords, ...sentRecords];
                allRecords.sort((a, b) => new Date(b.display_date) - new Date(a.display_date));

                allRecords.forEach(record => {
                    if (record.body) {
                        const tempDiv = document.createElement("div");
                        tempDiv.innerHTML = record.body;
                        const text = tempDiv.textContent || tempDiv.innerText || "";
                        record.preview = text.substring(0, 100).trim();
                    } else {
                        record.preview = "";
                    }
                });

                this.state.messages = allRecords;
                this.state.loading = false;
                return;
            } else {
                const modelMap = {
                    inbox: "mail.bot.inbox",
                    sent: "mail.bot.sent",
                    draft: "mail.bot.draft",
                    spam: "mail.bot.spam",
                    trash: "mail.bot.trash",
                };
                model = modelMap[folder];
                domain = [];
            }

            // Define fields and order based on model type - only request fields that exist in each model
            let fields;
            let orderField;

            if (model === "mail.bot.inbox") {
                fields = [
                    "id", "subject", "body", "state", "is_starred", "is_important",
                    "sender_name", "sender_email", "recipient_email", "cc_emails", "bcc_emails",
                    "has_attachments", "received_date", "display_name", "display_email", "display_date",
                    "message_id"
                ];
                orderField = "received_date desc";
            } else if (model === "mail.bot.sent") {
                fields = [
                    "id", "subject", "body", "state", "is_starred",
                    "recipient_email", "cc_emails", "bcc_emails",
                    "has_attachments", "sent_date", "display_name", "display_email", "display_date",
                    "message_id", "in_reply_to"
                ];
                orderField = "sent_date desc";
            } else if (model === "mail.bot.draft") {
                fields = [
                    "id", "subject", "body", "state", "is_starred",
                    "recipient_email", "cc_emails", "bcc_emails", "write_date",
                    "display_name", "display_email", "display_date", "in_reply_to"
                ];
                orderField = "write_date desc";
            } else if (model === "mail.bot.spam") {
                fields = [
                    "id", "subject", "body", "state", "is_starred",
                    "sender_name", "sender_email", "recipient_email", "received_date",
                    "display_name", "display_email", "display_date", "message_id"
                ];
                orderField = "received_date desc";
            } else if (model === "mail.bot.trash") {
                fields = [
                    "id", "subject", "body", "state", "is_starred",
                    "sender_name", "sender_email", "recipient_email",
                    "deleted_date", "original_folder", "display_name", "display_email", "display_date",
                    "message_id"
                ];
                orderField = "deleted_date desc";
            } else {
                // Default fields
                fields = ["id", "subject", "body", "state", "is_starred"];
                orderField = "id desc";
            }

            const records = await this.orm.searchRead(
                model,
                domain,
                fields,
                { order: orderField, limit: 200 }
            );

            records.forEach(record => {
                if (record.body) {
                    const tempDiv = document.createElement("div");
                    tempDiv.innerHTML = record.body;
                    const text = tempDiv.textContent || tempDiv.innerText || "";
                    record.preview = text.substring(0, 100).trim();
                } else {
                    record.preview = "";
                }
            });

            this.state.messages = records;

            if (!["starred", "snoozed", "important"].includes(folder)) {
                this.state.counts[folder] = records.length;
            }

        } catch (error) {
            console.error("Error loading folder data:", error);
            this.notification.add("Failed to load messages", { type: "danger" });
        } finally {
            this.state.loading = false;
        }
    }

    onClickInbox() {
        this.loadFolderData("inbox");
    }

    onClickStarred() {
        this.loadFolderData("starred");
    }

    onClickSnoozed() {
        this.loadFolderData("snoozed");
    }

    onClickImportant() {
        this.loadFolderData("important");
    }

    onClickSent() {
        this.loadFolderData("sent");
    }

    onClickDraft() {
        this.loadFolderData("draft");
    }

    onClickAllMail() {
        this.loadFolderData("allmail");
    }

    onClickSpam() {
        this.loadFolderData("spam");
    }

    onClickTrash() {
        this.loadFolderData("trash");
    }

    onRefresh() {
        this.loadAllCounts();
        this.loadFolderData(this.state.activeFolder);
    }

    onSearchInput(ev) {
        this.state.searchQuery = ev.target.value || "";
        this.state.currentPage = 1;
    }

    onSearchFocus() {
        // Show filters when search is focused
        this.state.showFilters = true;
    }

    onToggleAdvancedSearch() {
        this.state.showFilters = !this.state.showFilters;
    }

    onFilterChange(filterName, value) {
        this.state.filters[filterName] = value;
        this.state.currentPage = 1;
    }

    onClearFilter(filterName) {
        if (filterName === 'hasAttachment' || filterName === 'isUnread' || filterName === 'isStarred') {
            this.state.filters[filterName] = false;
        } else {
            this.state.filters[filterName] = "";
        }
        this.state.currentPage = 1;
    }

    onClearAllFilters() {
        this.state.filters = {
            from: "",
            to: "",
            date: "",
            hasAttachment: false,
            isUnread: false,
            isStarred: false,
        };
        this.state.currentPage = 1;
    }

    getDateFilterLabel() {
        const labels = {
            'today': 'Today',
            'yesterday': 'Yesterday',
            'week': 'Last 7 days',
            'month': 'Last 30 days',
            'year': 'Last year',
        };
        return labels[this.state.filters.date] || 'Any time';
    }

    onPrevPage() {
        if (this.state.currentPage > 1) {
            this.state.currentPage--;
        }
    }

    onNextPage() {
        if (this.state.currentPage < this.totalPages) {
            this.state.currentPage++;
        }
    }

    getRowClass(message) {
        let classes = "mail-row";
        if (this.state.selectedMessage && this.state.selectedMessage.id === message.id) {
            classes += " selected";
        }
        if (message.state === "unread") {
            classes += " unread";
        }
        return classes;
    }

    getFolderClass(folder) {
        let classes = "nav-link d-flex align-items-center";
        if (this.state.activeFolder === folder) {
            classes += " active";
        }
        return classes;
    }

    getStarClass(message) {
        return message.is_starred ? "fa fa-star text-warning" : "fa fa-star-o text-muted";
    }

    getBoldClass(message) {
        return message.state === "unread" ? "fw-bold" : "";
    }

    onMessageItemClick(ev) {
        const messageId = parseInt(ev.currentTarget.dataset.messageId);
        const message = this.state.messages.find(m => m.id === messageId);
        if (message) {
            this.state.selectedMessage = message;
            this.loadSelectedMessageAttachments(message);
            if (message.state === "unread") {
                this.markAsRead(message);
            }
        }
    }

    async loadSelectedMessageAttachments(message) {
        if (!message) {
            this.state.selectedAttachments = [];
            return;
        }

        const activeFolder = this.state.activeFolder;
        let model;
        if (activeFolder === "allmail") {
            model = message._source === "sent" ? "mail.bot.sent" : "mail.bot.inbox";
        } else {
            model = this.getModelForFolder(activeFolder);
        }

        const modelsWithAttachments = new Set([
            "mail.bot.inbox",
            "mail.bot.sent",
            "mail.bot.draft",
            "mail.bot.spam",
        ]);

        if (!modelsWithAttachments.has(model)) {
            this.state.selectedAttachments = [];
            return;
        }

        this.state.loadingAttachments = true;
        this.state.selectedAttachments = [];

        try {
            const records = await this.orm.searchRead(
                model,
                [["id", "=", message.id]],
                ["attachment_ids"]
            );
            const attachmentIds = (records[0] && records[0].attachment_ids) || [];

            if (!attachmentIds.length) {
                this.state.selectedAttachments = [];
                return;
            }

            const attachments = await this.orm.searchRead(
                "ir.attachment",
                [["id", "in", attachmentIds]],
                ["id", "name", "mimetype"]
            );
            this.state.selectedAttachments = attachments;
        } catch (error) {
            console.error("Error loading attachments:", error);
            this.state.selectedAttachments = [];
        } finally {
            this.state.loadingAttachments = false;
        }
    }

    async markAsRead(message) {
        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, [message.id], { state: "read" });
            message.state = "read";
        } catch (error) {
            console.error("Error marking as read:", error);
        }
    }

    onCheckboxClick(ev) {
        ev.stopPropagation();
        const messageId = parseInt(ev.currentTarget.dataset.messageId);
        const idx = this.state.selectedIds.indexOf(messageId);

        if (idx > -1) {
            this.state.selectedIds.splice(idx, 1);
        } else {
            this.state.selectedIds.push(messageId);
        }
    }

    onToggleStarClick(ev) {
        ev.stopPropagation();
        const messageId = parseInt(ev.currentTarget.dataset.messageId);
        const message = this.state.messages.find(m => m.id === messageId);

        if (message) {
            const newValue = !message.is_starred;
            message.is_starred = newValue;

            const model = this.getModelForFolder(this.state.activeFolder);
            this.orm.write(model, [messageId], { is_starred: newValue }).then(() => {
                if (newValue) {
                    this.state.counts.starred++;
                } else {
                    this.state.counts.starred = Math.max(0, this.state.counts.starred - 1);
                    if (this.state.activeFolder === "starred") {
                        this.state.messages = this.state.messages.filter(m => m.id !== messageId);
                        if (this.state.selectedMessage && this.state.selectedMessage.id === messageId) {
                            this.state.selectedMessage = null;
                        }
                    }
                }
            }).catch(() => {
                message.is_starred = !newValue;
                this.notification.add("Failed to update star", { type: "danger" });
            });
        }
    }

    onCompose() {
        this.state.composeData = {
            to: "",
            cc: "",
            bcc: "",
            subject: "",
            body: "",
            attachments: [],
        };
        this.state.showCc = false;
        this.state.showBcc = false;
        this.state.showFormatToolbar = false;
        this.state.showEmojiPicker = false;
        this.state.showLinkDialog = false;
        this.state.showColorPicker = false;
        this.state.showMoreOptionsMenu = false;
        // Reset minimize/expand state - always open in normal mode
        this.state.composeMinimized = false;
        this.state.composeExpanded = false;
        this.state.showCompose = true;
    }

    onReply() {
        if (!this.state.selectedMessage) return;

        this.state.composeData = {
            to: this.state.selectedMessage.display_email || "",
            cc: "",
            bcc: "",
            subject: "Re: " + (this.state.selectedMessage.subject || ""),
            body: "",
            attachments: [],
            inReplyTo: this.state.selectedMessage.message_id || "", // Track which message this is replying to
        };
        this.state.showCc = false;
        this.state.showBcc = false;
        this.state.showFormatToolbar = false;
        this.state.showEmojiPicker = false;
        this.state.showLinkDialog = false;
        this.state.showColorPicker = false;
        this.state.showMoreOptionsMenu = false;
        // Reset minimize/expand state - always open in normal mode
        this.state.composeMinimized = false;
        this.state.composeExpanded = false;
        this.state.showCompose = true;
    }

    onCloseCompose() {
        this.state.showCompose = false;
        // Reset minimize/expand state when closing
        this.state.composeMinimized = false;
        this.state.composeExpanded = false;
    }

    // Edit an existing draft - opens compose dialog with draft content
    onEditDraft() {
        if (!this.state.selectedMessage) return;
        if (this.state.activeFolder !== "draft") return;

        const draft = this.state.selectedMessage;
        this.state.composeData = {
            to: draft.recipient_email || "",
            cc: draft.cc_emails || "",
            bcc: draft.bcc_emails || "",
            subject: draft.subject || "",
            body: draft.body || "",
            attachments: [],
            draftId: draft.id, // Store draft ID for updating
        };
        this.state.showCc = !!draft.cc_emails;
        this.state.showBcc = !!draft.bcc_emails;
        this.state.showFormatToolbar = false;
        this.state.showEmojiPicker = false;
        this.state.showLinkDialog = false;
        this.state.showColorPicker = false;
        this.state.showMoreOptionsMenu = false;
        // Reset minimize/expand state - always open in normal mode
        this.state.composeMinimized = false;
        this.state.composeExpanded = false;
        this.state.showCompose = true;
    }

    // Send an existing draft directly
    async onSendDraft() {
        if (!this.state.selectedMessage) return;
        if (this.state.activeFolder !== "draft") return;

        const draftId = this.state.selectedMessage.id;

        try {
            await this.orm.call("mail.bot.draft", "action_send", [draftId]);

            // Remove from draft list
            this.state.messages = this.state.messages.filter(m => m.id !== draftId);
            this.state.counts.draft = Math.max(0, this.state.counts.draft - 1);
            this.state.counts.sent++;
            this.state.selectedMessage = null;

            this.notification.add("Message sent successfully", { type: "success" });
            this.loadAllCounts();
        } catch (error) {
            console.error("Error sending draft:", error);
            this.notification.add("Failed to send message. Please check your SMTP configuration.", { type: "danger" });
        }
    }

    onToggleCc() {
        this.state.showCc = !this.state.showCc;
    }

    onToggleBcc() {
        this.state.showBcc = !this.state.showBcc;
    }

    onComposeInputChange(ev) {
        const field = ev.target.dataset.field;
        if (field) {
            this.state.composeData[field] = ev.target.value;
        }
    }

    async persistComposeAttachments(draftId) {
        const attachments = this.state.composeData.attachments || [];
        const payloads = attachments
            .filter(attachment => attachment && attachment.data)
            .map(attachment => ({
                name: attachment.name || "Attachment",
                datas: attachment.data,
                mimetype: attachment.type || false,
            }));

        if (!payloads.length) {
            return [];
        }

        const created = await this.orm.call(
            "mail.bot.draft",
            "action_add_attachments",
            [draftId],
            { attachments: payloads }
        );
        const attachmentIds = Array.isArray(created) ? created : [created];
        return attachmentIds.filter(Boolean);
    }

    async onSendCompose() {
        const { to, cc, bcc, subject, body, draftId: existingDraftId, inReplyTo } = this.state.composeData;

        if (!to) {
            this.notification.add("Please enter a recipient email", { type: "warning" });
            return;
        }

        try {
            let draftId;

            // If editing an existing draft, update it first
            if (existingDraftId) {
                await this.orm.write("mail.bot.draft", [existingDraftId], {
                    recipient_email: to,
                    cc_emails: cc || false,
                    bcc_emails: bcc || false,
                    subject: subject || false,
                    body: body || false,
                    in_reply_to: inReplyTo || false,
                });
                draftId = existingDraftId;

                // Remove from draft list if we're in draft folder
                if (this.state.activeFolder === "draft") {
                    this.state.messages = this.state.messages.filter(m => m.id !== draftId);
                    this.state.selectedMessage = null;
                }
            } else {
                // Create new draft
                const createdIds = await this.orm.create("mail.bot.draft", [{
                    recipient_email: to,
                    cc_emails: cc || false,
                    bcc_emails: bcc || false,
                    subject: subject || false,
                    body: body || false,
                    in_reply_to: inReplyTo || false,
                }]);
                // orm.create returns an array of IDs, extract the first one
                draftId = Array.isArray(createdIds) ? createdIds[0] : createdIds;

                await this.persistComposeAttachments(draftId);
            }

            // Store pending send data for undo feature
            this.state.pendingSendData = { draftId };
            this.state.showCompose = false;
            this.state.showUndoSend = true;
            this.state.undoSendSeconds = 5;

            // Start countdown timer
            this.undoSendInterval = setInterval(() => {
                this.state.undoSendSeconds--;
                if (this.state.undoSendSeconds <= 0) {
                    this.executeSend();
                }
            }, 1000);

        } catch (error) {
            console.error("Error preparing message:", error);
            const errorMsg = error.message || error.data?.message || "Failed to prepare message";
            this.notification.add(errorMsg, { type: "danger" });
        }
    }

    async executeSend() {
        // Clear interval
        if (this.undoSendInterval) {
            clearInterval(this.undoSendInterval);
            this.undoSendInterval = null;
        }

        if (!this.state.pendingSendData) return;

        let { draftId } = this.state.pendingSendData;

        // Ensure draftId is a number, not an array
        if (Array.isArray(draftId)) {
            draftId = draftId[0];
        }

        if (!draftId) {
            this.notification.add("No draft to send", { type: "warning" });
            this.state.showUndoSend = false;
            this.state.pendingSendData = null;
            return;
        }

        try {
            await this.orm.call("mail.bot.draft", "action_send", [draftId]);

            this.notification.add("Message sent successfully", { type: "success" });

            // Always reload counts and sent folder data
            this.loadAllCounts();

            // Reload current folder if it's sent or draft
            if (this.state.activeFolder === "sent") {
                this.loadFolderData("sent");
            } else if (this.state.activeFolder === "draft") {
                this.loadFolderData("draft");
            }

            // Also update sent count in background
            this.state.counts.sent = (this.state.counts.sent || 0) + 1;
        } catch (error) {
            console.error("Error sending message:", error);
            const errorMsg = error.message || error.data?.message || "Failed to send message";
            this.notification.add(errorMsg, { type: "danger" });
        }

        this.state.showUndoSend = false;
        this.state.pendingSendData = null;
    }

    onUndoSend() {
        // Clear interval
        if (this.undoSendInterval) {
            clearInterval(this.undoSendInterval);
            this.undoSendInterval = null;
        }

        // Restore compose with the draft data
        if (this.state.pendingSendData) {
            this.notification.add("Send cancelled - message saved as draft", { type: "info" });
            // Reopen compose with the draft
            this.loadFolderData("draft");
        }

        this.state.showUndoSend = false;
        this.state.pendingSendData = null;
    }

    // Schedule Send Feature
    onShowScheduleSend() {
        this.state.showScheduleSend = true;
        // Set default to tomorrow 9 AM
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        this.state.scheduledDate = tomorrow.toISOString().split('T')[0];
        this.state.scheduledTime = '09:00';
    }

    onCloseScheduleSend() {
        this.state.showScheduleSend = false;
    }

    onScheduleDateChange(ev) {
        this.state.scheduledDate = ev.target.value;
    }

    onScheduleTimeChange(ev) {
        this.state.scheduledTime = ev.target.value;
    }

    async onConfirmScheduleSend() {
        if (!this.state.scheduledDate || !this.state.scheduledTime) {
            this.notification.add("Please select date and time", { type: "warning" });
            return;
        }

        const { to, cc, bcc, subject, body, inReplyTo } = this.state.composeData;

        if (!to) {
            this.notification.add("Please enter a recipient email", { type: "warning" });
            return;
        }

        try {
            // Create draft with scheduled time
            const scheduledDatetime = `${this.state.scheduledDate} ${this.state.scheduledTime}:00`;

            const createdIds = await this.orm.create("mail.bot.draft", [{
                recipient_email: to,
                cc_emails: cc || false,
                bcc_emails: bcc || false,
                subject: subject || false,
                body: body || false,
                in_reply_to: inReplyTo || false,
                scheduled_date: scheduledDatetime,
            }]);
            // orm.create returns an array of IDs, extract the first one
            const draftId = Array.isArray(createdIds) ? createdIds[0] : createdIds;

            await this.persistComposeAttachments(draftId);

            this.state.showScheduleSend = false;
            this.state.showCompose = false;

            const formattedDate = new Date(scheduledDatetime).toLocaleString();
            this.notification.add(`Message scheduled for ${formattedDate}`, { type: "success" });

            this.loadAllCounts();
            if (this.state.activeFolder === "draft") {
                this.loadFolderData("draft");
            }
        } catch (error) {
            console.error("Error scheduling message:", error);
            this.notification.add("Failed to schedule message", { type: "danger" });
        }
    }

    // Quick Schedule Options
    onScheduleLaterToday() {
        const now = new Date();
        now.setHours(now.getHours() + 4);
        this.state.scheduledDate = now.toISOString().split('T')[0];
        this.state.scheduledTime = `${String(now.getHours()).padStart(2, '0')}:00`;
    }

    onScheduleTomorrow() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(8, 0, 0, 0);
        this.state.scheduledDate = tomorrow.toISOString().split('T')[0];
        this.state.scheduledTime = '08:00';
    }

    onScheduleNextWeek() {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        nextWeek.setHours(8, 0, 0, 0);
        this.state.scheduledDate = nextWeek.toISOString().split('T')[0];
        this.state.scheduledTime = '08:00';
    }

    // Right-click Context Menu
    onMessageContextMenu(ev, message) {
        ev.preventDefault();
        this.state.showContextMenu = true;
        this.state.contextMenuX = ev.clientX;
        this.state.contextMenuY = ev.clientY;
        this.state.contextMenuMessage = message;
    }

    onCloseContextMenu() {
        this.state.showContextMenu = false;
        this.state.contextMenuMessage = null;
    }

    onContextMenuAction(action) {
        const message = this.state.contextMenuMessage;
        if (!message) return;

        // Temporarily set as selected for actions
        const previousSelected = this.state.selectedMessage;
        this.state.selectedMessage = message;

        switch(action) {
            case 'open':
                this.onOpenMessage(message);
                break;
            case 'reply':
                this.onReply();
                break;
            case 'replyAll':
                this.onReplyAll();
                break;
            case 'forward':
                this.onForward();
                break;
            case 'star':
                this.onToggleStar(message);
                break;
            case 'archive':
                this.onArchiveSelected();
                break;
            case 'spam':
                this.onMarkSpamSelected();
                break;
            case 'delete':
                this.onDeleteSelected();
                break;
            case 'markRead':
                this.onToggleReadStatus();
                break;
            case 'markUnread':
                this.onToggleReadStatus();
                break;
        }

        // Restore previous selection if we didn't navigate away
        if (action !== 'open') {
            this.state.selectedMessage = previousSelected;
        }

        this.onCloseContextMenu();
    }

    async onSaveDraft() {
        const { to, cc, bcc, subject, body, draftId: existingDraftId } = this.state.composeData;

        try {
            let draftId;

            // If editing an existing draft, update it
            if (existingDraftId) {
                await this.orm.write("mail.bot.draft", [existingDraftId], {
                    recipient_email: to || false,
                    cc_emails: cc || false,
                    bcc_emails: bcc || false,
                    subject: subject || false,
                    body: body || false,
                });
                draftId = existingDraftId;
                this.notification.add("Draft updated", { type: "success" });
            } else {
                // Create new draft
                const createdIds = await this.orm.create("mail.bot.draft", [{
                    recipient_email: to || false,
                    cc_emails: cc || false,
                    bcc_emails: bcc || false,
                    subject: subject || false,
                    body: body || false,
                }]);
                // orm.create returns an array of IDs, extract the first one
                draftId = Array.isArray(createdIds) ? createdIds[0] : createdIds;

                await this.persistComposeAttachments(draftId);
                this.notification.add("Draft saved", { type: "success" });
            }

            this.state.showCompose = false;
            this.loadAllCounts();

            if (this.state.activeFolder === "draft") {
                this.loadFolderData("draft");
            }
        } catch (error) {
            console.error("Error saving draft:", error);
            this.notification.add("Failed to save draft", { type: "danger" });
        }
    }

    // ==========================================
    // COMPOSE TOOLBAR HANDLERS
    // ==========================================

    onMinimizeCompose() {
        this.state.composeMinimized = !this.state.composeMinimized;
        // When minimizing, reset expanded state
        if (this.state.composeMinimized) {
            this.state.composeExpanded = false;
        }
    }

    onExpandCompose() {
        this.state.composeExpanded = !this.state.composeExpanded;
        // When expanding, reset minimized state
        if (this.state.composeExpanded) {
            this.state.composeMinimized = false;
        }
    }

    onToggleFormatToolbar() {
        this.state.showFormatToolbar = !this.state.showFormatToolbar;
        this.state.showEmojiPicker = false;
    }

    onFormatText(command) {
        const editor = this.composeEditorRef.el;
        if (!editor) return;

        editor.focus();

        switch (command) {
            case 'bold':
                document.execCommand('bold', false, null);
                break;
            case 'italic':
                document.execCommand('italic', false, null);
                break;
            case 'underline':
                document.execCommand('underline', false, null);
                break;
            case 'strikethrough':
                document.execCommand('strikeThrough', false, null);
                break;
            case 'ul':
                document.execCommand('insertUnorderedList', false, null);
                break;
            case 'ol':
                document.execCommand('insertOrderedList', false, null);
                break;
            case 'indent':
                document.execCommand('indent', false, null);
                break;
            case 'outdent':
                document.execCommand('outdent', false, null);
                break;
            case 'quote':
                document.execCommand('formatBlock', false, 'blockquote');
                break;
        }
    }

    onRemoveFormatting() {
        const editor = this.composeEditorRef.el;
        if (!editor) return;
        editor.focus();
        document.execCommand('removeFormat', false, null);
    }

    onTextColor() {
        this.state.showColorPicker = !this.state.showColorPicker;
        this.state.showEmojiPicker = false;
        this.state.showFormatToolbar = false;
        this.state.showMoreOptionsMenu = false;
    }

    onApplyTextColor(color) {
        const editor = this.composeEditorRef.el;
        if (editor) {
            editor.focus();
            document.execCommand('foreColor', false, color);
        }
        this.state.showColorPicker = false;
    }

    onAttachFile() {
        if (this.fileInputRef.el) {
            this.fileInputRef.el.click();
        }
    }

    onFileSelected(ev) {
        const files = ev.target.files;
        if (!files || files.length === 0) return;

        const attachments = this.state.composeData.attachments;
        const fileCount = files.length;

        for (const file of files) {
            const reader = new FileReader();
            const fileName = file.name;
            const fileSize = file.size;
            const fileType = file.type;

            reader.onload = (e) => {
                attachments.push({
                    name: fileName,
                    size: fileSize,
                    type: fileType,
                    data: e.target.result.split(',')[1], // base64 data
                });
            };
            reader.readAsDataURL(file);
        }

        // Reset input
        ev.target.value = '';
        this.notification.add(`${fileCount} file(s) attached`, { type: "success" });
    }

    onRemoveAttachment(attachment) {
        this.state.composeData.attachments = this.state.composeData.attachments.filter(
            a => a.name !== attachment.name
        );
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    onShowLinkDialog() {
        this.state.showLinkDialog = true;
        this.state.linkData = { text: '', url: '' };
    }

    onCloseLinkDialog() {
        this.state.showLinkDialog = false;
    }

    onInsertLink() {
        const { text, url } = this.state.linkData;
        if (!url) {
            this.notification.add("Please enter a URL", { type: "warning" });
            return;
        }

        const editor = this.composeEditorRef.el;
        if (editor) {
            editor.focus();
            const linkText = text || url;
            const linkHtml = `<a href="${url}" target="_blank">${linkText}</a>`;
            document.execCommand('insertHTML', false, linkHtml);
        }

        this.state.showLinkDialog = false;
    }

    onToggleEmojiPicker() {
        this.state.showEmojiPicker = !this.state.showEmojiPicker;
        this.state.showFormatToolbar = false;
        this.state.emojiSearchQuery = "";
    }

    onEmojiSearch(ev) {
        this.state.emojiSearchQuery = ev.target.value.toLowerCase();
    }

    getFilteredEmojis() {
        if (!this.state.emojiSearchQuery) {
            return this.emojis;
        }
        // For simplicity, just return all emojis (real implementation would filter by name)
        return this.emojis;
    }

    onInsertEmoji(emoji) {
        const editor = this.composeEditorRef.el;
        if (editor) {
            editor.focus();
            document.execCommand('insertText', false, emoji);
        }
        this.state.showEmojiPicker = false;
    }

    onInsertFromDrive() {
        this.notification.add("Google Drive integration coming soon", { type: "info" });
    }

    onInsertPhoto() {
        if (this.imageInputRef.el) {
            this.imageInputRef.el.click();
        }
    }

    onImageSelected(ev) {
        const files = ev.target.files;
        if (!files || files.length === 0) return;

        const file = files[0];
        const reader = new FileReader();
        reader.onload = (e) => {
            const editor = this.composeEditorRef.el;
            if (editor) {
                editor.focus();
                const imgHtml = `<img src="${e.target.result}" style="max-width: 100%; height: auto;" />`;
                document.execCommand('insertHTML', false, imgHtml);
            }
        };
        reader.readAsDataURL(file);

        // Reset input
        ev.target.value = '';
    }

    onConfidentialMode() {
        this.notification.add("Confidential mode coming soon", { type: "info" });
    }

    onInsertSignature() {
        const editor = this.composeEditorRef.el;
        if (editor) {
            editor.focus();
            const signature = `<br><br>--<br>Best regards,<br>${this.env.user?.name || 'User'}`;
            document.execCommand('insertHTML', false, signature);
        }
    }

    onMoreOptions() {
        this.state.showMoreOptionsMenu = !this.state.showMoreOptionsMenu;
        this.state.showColorPicker = false;
        this.state.showEmojiPicker = false;
        this.state.showFormatToolbar = false;
    }

    onCloseMoreOptions() {
        this.state.showMoreOptionsMenu = false;
    }

    onLabelAsImportant() {
        this.notification.add("Email will be marked as important when sent", { type: "info" });
        this.state.showMoreOptionsMenu = false;
    }

    onRequestReadReceipt() {
        this.notification.add("Read receipt will be requested", { type: "info" });
        this.state.showMoreOptionsMenu = false;
    }

    onPlainTextMode() {
        const editor = this.composeEditorRef.el;
        if (editor) {
            const plainText = editor.innerText;
            editor.innerHTML = plainText;
        }
        this.notification.add("Switched to plain text", { type: "info" });
        this.state.showMoreOptionsMenu = false;
    }

    onCheckSpelling() {
        this.notification.add("Spell check is handled by your browser", { type: "info" });
        this.state.showMoreOptionsMenu = false;
    }

    onToggleSendOptions() {
        this.onShowScheduleSend();
    }

    onDiscardDraft() {
        if (this.state.composeData.body || this.state.composeData.subject || this.state.composeData.to) {
            // Has content, ask for confirmation
            const confirmed = window.confirm(
                "Are you sure you want to discard this draft?\n\nYour message will not be saved."
            );

            if (!confirmed) return;

            this.state.showCompose = false;
            this.state.composeMinimized = false;
            this.state.composeExpanded = false;
            this.state.composeData = {
                to: "",
                cc: "",
                bcc: "",
                subject: "",
                body: "",
                attachments: [],
            };
            this.notification.add("Draft discarded", { type: "info" });
        } else {
            this.state.showCompose = false;
            this.state.composeMinimized = false;
            this.state.composeExpanded = false;
        }
    }

    onEditorInput(ev) {
        this.state.composeData.body = ev.target.innerHTML;
    }

    // ==========================================
    // END COMPOSE TOOLBAR HANDLERS
    // ==========================================

    async onDeleteSelected() {
        if (!this.state.selectedMessage) return;

        const messageId = this.state.selectedMessage.id;

        // Determine the correct model - special handling for allmail folder
        let model;
        if (this.state.activeFolder === "allmail") {
            // Use the _source property to determine the model
            model = this.state.selectedMessage._source === "sent" ? "mail.bot.sent" : "mail.bot.inbox";
        } else {
            model = this.getModelForFolder(this.state.activeFolder);
        }

        // If already in trash, permanently delete with confirmation
        if (this.state.activeFolder === "trash") {
            const confirmed = window.confirm(
                "Are you sure you want to permanently delete this message?\n\nThis action cannot be undone."
            );

            if (!confirmed) return;

            try {
                await this.orm.call(model, "unlink", [[messageId]]);

                // Remove from current list
                this.state.messages = this.state.messages.filter(m => m.id !== messageId);

                // Update folder count
                this.state.counts.trash = Math.max(0, this.state.counts.trash - 1);

                this.state.selectedMessage = null;
                this.notification.add("Message permanently deleted", { type: "success" });
            } catch (error) {
                console.error("Error permanently deleting message:", error);
                this.notification.add("Unable to delete message", { type: "danger" });
            }
            return;
        }

        // Confirm before moving to trash
        const confirmed = window.confirm(
            "Are you sure you want to delete this message?\n\nThe message will be moved to Trash."
        );

        if (!confirmed) return;

        // Move to trash
        try {
            await this.orm.call(model, "action_move_to_trash", [[messageId]]);

            // Remove from current list
            this.state.messages = this.state.messages.filter(m => m.id !== messageId);

            // Update folder count
            if (this.state.activeFolder !== "starred" && this.state.activeFolder !== "allmail") {
                this.state.counts[this.state.activeFolder] = Math.max(
                    0,
                    this.state.counts[this.state.activeFolder] - 1
                );
            }

            // Update trash count
            this.state.counts.trash++;

            this.state.selectedMessage = null;
            this.notification.add("Message moved to trash", { type: "success" });

            // Reload counts for allmail
            if (this.state.activeFolder === "allmail") {
                this.loadAllCounts();
            }
        } catch (error) {
            console.error("Error moving message to trash:", error);
            this.notification.add("Unable to delete message", { type: "danger" });
        }
    }

    onCloseDetail() {
        this.state.selectedMessage = null;
        this.state.selectedAttachments = [];
    }

    onBackToList() {
        this.state.selectedMessage = null;
        this.state.selectedAttachments = [];
    }

    onPrevMessage() {
        const index = this.currentMessageIndex;
        if (index > 0) {
            const prevMessage = this.filteredMessages[index - 1];
            this.state.selectedMessage = prevMessage;
            this.loadSelectedMessageAttachments(prevMessage);
            if (prevMessage.state === "unread") {
                this.markAsRead(prevMessage);
            }
        }
    }

    onNextMessage() {
        const index = this.currentMessageIndex;
        if (index < this.filteredMessages.length - 1) {
            const nextMessage = this.filteredMessages[index + 1];
            this.state.selectedMessage = nextMessage;
            this.loadSelectedMessageAttachments(nextMessage);
            if (nextMessage.state === "unread") {
                this.markAsRead(nextMessage);
            }
        }
    }

    onForward() {
        if (!this.state.selectedMessage) return;

        this.state.composeData = {
            to: "",
            cc: "",
            bcc: "",
            subject: "Fwd: " + (this.state.selectedMessage.subject || ""),
            body: `<br><br>---------- Forwarded message ---------<br>
                   From: ${this.state.selectedMessage.display_name || ''}<br>
                   Date: ${this.formatDate(this.state.selectedMessage.display_date)}<br>
                   Subject: ${this.state.selectedMessage.subject || ''}<br><br>
                   ${this.state.selectedMessage.body || ''}`,
            attachments: [],
        };
        this.state.showCc = false;
        this.state.showBcc = false;
        this.state.showFormatToolbar = false;
        this.state.showEmojiPicker = false;
        this.state.showLinkDialog = false;
        this.state.showColorPicker = false;
        this.state.showMoreOptionsMenu = false;
        // Reset minimize/expand state - always open in normal mode
        this.state.composeMinimized = false;
        this.state.composeExpanded = false;
        this.state.showCompose = true;
    }

    async onToggleReadStatus() {
        if (!this.state.selectedMessage) return;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            const newState = this.state.selectedMessage.state === "unread" ? "read" : "unread";
            await this.orm.write(model, [this.state.selectedMessage.id], { state: newState });
            this.state.selectedMessage.state = newState;

            // Update in messages array too
            const msg = this.state.messages.find(m => m.id === this.state.selectedMessage.id);
            if (msg) {
                msg.state = newState;
            }

            this.notification.add(newState === "unread" ? "Marked as unread" : "Marked as read", { type: "success" });
        } catch (error) {
            console.error("Error toggling read status:", error);
            this.notification.add("Failed to update status", { type: "danger" });
        }
    }

    async onToggleStarSelected() {
        if (!this.state.selectedMessage) return;

        const newValue = !this.state.selectedMessage.is_starred;
        this.state.selectedMessage.is_starred = newValue;

        // Update in messages array too
        const msg = this.state.messages.find(m => m.id === this.state.selectedMessage.id);
        if (msg) {
            msg.is_starred = newValue;
        }

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, [this.state.selectedMessage.id], { is_starred: newValue });

            if (newValue) {
                this.state.counts.starred++;
            } else {
                this.state.counts.starred = Math.max(0, this.state.counts.starred - 1);
            }
        } catch (error) {
            // Revert on error
            this.state.selectedMessage.is_starred = !newValue;
            if (msg) {
                msg.is_starred = !newValue;
            }
            this.notification.add("Failed to update star", { type: "danger" });
        }
    }

    // ==========================================
    // BULK ACTION METHODS
    // ==========================================

    onSelectAllChange(ev) {
        if (ev.target.checked) {
            // Select all messages (all pages, not just current page)
            const allIds = this.state.messages.map(m => m.id);
            this.state.selectedIds = [...new Set(allIds)];
        } else {
            // Deselect all messages
            this.state.selectedIds = [];
        }
    }

    onSelectAllCurrentPage() {
        // Select only messages on current page
        const pageIds = this.paginatedMessages.map(m => m.id);
        this.state.selectedIds = [...new Set([...this.state.selectedIds, ...pageIds])];
    }

    onDeselectAll() {
        this.state.selectedIds = [];
    }

    async onBulkDelete() {
        if (this.state.selectedIds.length === 0) return;

        // If in trash folder, permanently delete with confirmation
        if (this.state.activeFolder === "trash") {
            return this.onBulkDeletePermanent();
        }

        // Confirm before moving to trash
        const count = this.state.selectedIds.length;
        const confirmed = window.confirm(
            `Are you sure you want to delete ${count} message(s)?\n\nThe messages will be moved to Trash.`
        );

        if (!confirmed) return;

        try {
            const idsToDelete = [...this.state.selectedIds];

            // Special handling for "allmail" folder - messages come from different models
            if (this.state.activeFolder === "allmail") {
                // Group messages by their source model
                const inboxIds = [];
                const sentIds = [];

                for (const id of idsToDelete) {
                    const msg = this.state.messages.find(m => m.id === id);
                    if (msg) {
                        if (msg._source === "sent") {
                            sentIds.push(id);
                        } else {
                            inboxIds.push(id);
                        }
                    }
                }

                // Delete from each model separately
                if (inboxIds.length > 0) {
                    await this.orm.call("mail.bot.inbox", "action_move_to_trash", [inboxIds]);
                }
                if (sentIds.length > 0) {
                    await this.orm.call("mail.bot.sent", "action_move_to_trash", [sentIds]);
                }
            } else {
                const model = this.getModelForFolder(this.state.activeFolder);
                // Move to trash
                await this.orm.call(model, "action_move_to_trash", [idsToDelete]);
            }

            // Remove from current list
            this.state.messages = this.state.messages.filter(m => !idsToDelete.includes(m.id));

            // Update counts
            const deletedCount = idsToDelete.length;
            if (this.state.activeFolder !== "starred" && this.state.activeFolder !== "allmail") {
                this.state.counts[this.state.activeFolder] = Math.max(0, this.state.counts[this.state.activeFolder] - deletedCount);
            }
            this.state.counts.trash += deletedCount;

            // Clear selection
            this.state.selectedIds = [];

            this.notification.add(`${deletedCount} message(s) moved to trash`, { type: "success" });

            // Reload counts for allmail
            if (this.state.activeFolder === "allmail") {
                this.loadAllCounts();
            }
        } catch (error) {
            console.error("Error bulk deleting:", error);
            this.notification.add("Failed to delete messages", { type: "danger" });
        }
    }

    async onBulkDeletePermanent() {
        if (this.state.selectedIds.length === 0) return;

        const count = this.state.selectedIds.length;

        // Show confirmation dialog
        const confirmed = window.confirm(
            `Are you sure you want to permanently delete ${count} message(s)?\n\nThis action cannot be undone.`
        );

        if (!confirmed) return;

        try {
            const idsToDelete = [...this.state.selectedIds];

            // Permanently delete from trash using call method
            await this.orm.call("mail.bot.trash", "unlink", [idsToDelete]);

            // Remove from current list
            this.state.messages = this.state.messages.filter(m => !idsToDelete.includes(m.id));

            // Update counts
            this.state.counts.trash = Math.max(0, this.state.counts.trash - idsToDelete.length);

            // Clear selection
            this.state.selectedIds = [];

            this.notification.add(`${count} message(s) permanently deleted`, { type: "success" });
        } catch (error) {
            console.error("Error permanently deleting:", error);
            this.notification.add("Failed to delete messages. Please try again.", { type: "danger" });
        }
    }

    async onBulkRestore() {
        if (this.state.selectedIds.length === 0) return;

        try {
            const idsToRestore = [...this.state.selectedIds];

            // Restore from trash
            await this.orm.call("mail.bot.trash", "action_restore", [idsToRestore]);

            // Remove from current list
            this.state.messages = this.state.messages.filter(m => !idsToRestore.includes(m.id));

            // Update counts
            this.state.counts.trash = Math.max(0, this.state.counts.trash - idsToRestore.length);

            // Clear selection
            this.state.selectedIds = [];

            this.notification.add(`${idsToRestore.length} message(s) restored`, { type: "success" });

            // Reload counts to update other folders
            this.loadAllCounts();
        } catch (error) {
            console.error("Error restoring:", error);
            this.notification.add("Failed to restore messages", { type: "danger" });
        }
    }

    async onBulkMarkSpam() {
        if (this.state.selectedIds.length === 0) return;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            const idsToMarkSpam = [...this.state.selectedIds];

            // Mark as spam
            await this.orm.call(model, "action_mark_as_spam", [idsToMarkSpam]);

            // Remove from current list
            this.state.messages = this.state.messages.filter(m => !idsToMarkSpam.includes(m.id));

            // Update counts
            const count = idsToMarkSpam.length;
            if (this.state.activeFolder !== "starred") {
                this.state.counts[this.state.activeFolder] = Math.max(0, this.state.counts[this.state.activeFolder] - count);
            }
            this.state.counts.spam += count;

            // Clear selection
            this.state.selectedIds = [];

            this.notification.add(`${count} message(s) marked as spam`, { type: "success" });
        } catch (error) {
            console.error("Error marking as spam:", error);
            this.notification.add("Failed to mark as spam", { type: "danger" });
        }
    }

    async onBulkNotSpam() {
        if (this.state.selectedIds.length === 0) return;

        try {
            const idsToUnspam = [...this.state.selectedIds];

            // Mark as not spam
            await this.orm.call("mail.bot.spam", "action_not_spam", [idsToUnspam]);

            // Remove from current list
            this.state.messages = this.state.messages.filter(m => !idsToUnspam.includes(m.id));

            // Update counts
            this.state.counts.spam = Math.max(0, this.state.counts.spam - idsToUnspam.length);
            this.state.counts.inbox += idsToUnspam.length;

            // Clear selection
            this.state.selectedIds = [];

            this.notification.add(`${idsToUnspam.length} message(s) moved to inbox`, { type: "success" });
        } catch (error) {
            console.error("Error unmarking spam:", error);
            this.notification.add("Failed to move to inbox", { type: "danger" });
        }
    }

    // ==========================================
    // GMAIL FEATURES - Select Options
    // ==========================================

    onSelectAllPage() {
        const allIds = this.paginatedMessages.map(m => m.id);
        this.state.selectedIds = [...new Set([...this.state.selectedIds, ...allIds])];
    }

    onSelectNone() {
        this.state.selectedIds = [];
    }

    onSelectRead() {
        const readIds = this.paginatedMessages.filter(m => m.state === 'read').map(m => m.id);
        this.state.selectedIds = readIds;
    }

    onSelectUnread() {
        const unreadIds = this.paginatedMessages.filter(m => m.state === 'unread').map(m => m.id);
        this.state.selectedIds = unreadIds;
    }

    onSelectStarred() {
        const starredIds = this.paginatedMessages.filter(m => m.is_starred).map(m => m.id);
        this.state.selectedIds = starredIds;
    }

    onSelectUnstarred() {
        const unstarredIds = this.paginatedMessages.filter(m => !m.is_starred).map(m => m.id);
        this.state.selectedIds = unstarredIds;
    }

    // ==========================================
    // GMAIL FEATURES - Bulk Mark Read/Unread
    // ==========================================

    async onBulkMarkRead() {
        if (this.state.selectedIds.length === 0) return;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, this.state.selectedIds, { state: 'read' });

            // Update local state
            this.state.messages.forEach(m => {
                if (this.state.selectedIds.includes(m.id)) {
                    m.state = 'read';
                }
            });

            this.notification.add("Marked as read", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to mark as read", { type: "danger" });
        }
    }

    async onBulkMarkUnread() {
        if (this.state.selectedIds.length === 0) return;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, this.state.selectedIds, { state: 'unread' });

            // Update local state
            this.state.messages.forEach(m => {
                if (this.state.selectedIds.includes(m.id)) {
                    m.state = 'unread';
                }
            });

            this.notification.add("Marked as unread", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to mark as unread", { type: "danger" });
        }
    }

    async onMarkAllAsRead() {
        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            const unreadIds = this.state.messages.filter(m => m.state === 'unread').map(m => m.id);

            if (unreadIds.length === 0) {
                this.notification.add("No unread messages", { type: "info" });
                return;
            }

            await this.orm.write(model, unreadIds, { state: 'read' });

            // Update local state
            this.state.messages.forEach(m => {
                if (m.state === 'unread') {
                    m.state = 'read';
                }
            });

            this.notification.add("All messages marked as read", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to mark as read", { type: "danger" });
        }
    }

    // ==========================================
    // GMAIL FEATURES - Star/Important
    // ==========================================

    async onBulkStar() {
        if (this.state.selectedIds.length === 0) return;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, this.state.selectedIds, { is_starred: true });

            // Update local state
            this.state.messages.forEach(m => {
                if (this.state.selectedIds.includes(m.id)) {
                    m.is_starred = true;
                }
            });

            this.loadAllCounts();
            this.notification.add("Starred", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to star", { type: "danger" });
        }
    }

    async onBulkUnstar() {
        if (this.state.selectedIds.length === 0) return;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, this.state.selectedIds, { is_starred: false });

            // Update local state
            this.state.messages.forEach(m => {
                if (this.state.selectedIds.includes(m.id)) {
                    m.is_starred = false;
                }
            });

            this.loadAllCounts();
            this.notification.add("Removed star", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to remove star", { type: "danger" });
        }
    }

    async onBulkMarkImportant() {
        if (this.state.selectedIds.length === 0) return;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, this.state.selectedIds, { is_important: true });

            // Update local state
            this.state.messages.forEach(m => {
                if (this.state.selectedIds.includes(m.id)) {
                    m.is_important = true;
                }
            });

            this.loadAllCounts();
            this.notification.add("Marked as important", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to mark as important", { type: "danger" });
        }
    }

    async onBulkUnmarkImportant() {
        if (this.state.selectedIds.length === 0) return;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, this.state.selectedIds, { is_important: false });

            // Update local state
            this.state.messages.forEach(m => {
                if (this.state.selectedIds.includes(m.id)) {
                    m.is_important = false;
                }
            });

            this.loadAllCounts();
            this.notification.add("Removed importance", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to remove importance", { type: "danger" });
        }
    }

    // ==========================================
    // GMAIL FEATURES - Archive
    // ==========================================

    async onBulkArchive() {
        if (this.state.selectedIds.length === 0) return;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, this.state.selectedIds, { state: 'archived' });

            // Remove from inbox view (archived messages go to All Mail)
            this.state.messages = this.state.messages.filter(m => !this.state.selectedIds.includes(m.id));

            const count = this.state.selectedIds.length;
            this.state.selectedIds = [];

            this.loadAllCounts();
            this.notification.add(`${count} conversation(s) archived`, { type: "success" });
        } catch (error) {
            this.notification.add("Failed to archive", { type: "danger" });
        }
    }

    async onArchiveSelected() {
        if (!this.state.selectedMessage) return;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, [this.state.selectedMessage.id], { state: 'archived' });

            // Remove from list and go back
            this.state.messages = this.state.messages.filter(m => m.id !== this.state.selectedMessage.id);
            this.state.selectedMessage = null;

            this.loadAllCounts();
            this.notification.add("Conversation archived", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to archive", { type: "danger" });
        }
    }

    // ==========================================
    // UNARCHIVE FEATURES
    // ==========================================

    async onBulkUnarchive() {
        if (this.state.selectedIds.length === 0) return;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, this.state.selectedIds, { state: 'read' });

            // Update local state
            this.state.messages.forEach(m => {
                if (this.state.selectedIds.includes(m.id)) {
                    m.state = 'read';
                }
            });

            const count = this.state.selectedIds.length;
            this.state.selectedIds = [];

            this.loadAllCounts();
            this.notification.add(`${count} conversation(s) moved to Inbox`, { type: "success" });
        } catch (error) {
            this.notification.add("Failed to move to Inbox", { type: "danger" });
        }
    }

    async onUnarchiveSelected() {
        if (!this.state.selectedMessage) return;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, [this.state.selectedMessage.id], { state: 'read' });

            // Update local state
            this.state.selectedMessage.state = 'read';
            const msg = this.state.messages.find(m => m.id === this.state.selectedMessage.id);
            if (msg) msg.state = 'read';

            // Go back to list
            this.state.selectedMessage = null;

            this.loadAllCounts();
            this.notification.add("Conversation moved to Inbox", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to move to Inbox", { type: "danger" });
        }
    }

    // ==========================================
    // GMAIL FEATURES - Snooze
    // ==========================================

    async onBulkSnooze(when) {
        if (this.state.selectedIds.length === 0) return;

        const snoozeDate = this.calculateSnoozeDate(when);

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, this.state.selectedIds, {
                state: 'snoozed',
                snooze_date: snoozeDate.toISOString()
            });

            // Remove from current view
            this.state.messages = this.state.messages.filter(m => !this.state.selectedIds.includes(m.id));

            const count = this.state.selectedIds.length;
            this.state.selectedIds = [];

            this.loadAllCounts();
            this.notification.add(`${count} conversation(s) snoozed`, { type: "success" });
        } catch (error) {
            this.notification.add("Failed to snooze", { type: "danger" });
        }
    }

    async onSnoozeSelected(when) {
        if (!this.state.selectedMessage) return;

        const snoozeDate = this.calculateSnoozeDate(when);

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, [this.state.selectedMessage.id], {
                state: 'snoozed',
                snooze_date: snoozeDate.toISOString()
            });

            // Remove from list and go back
            this.state.messages = this.state.messages.filter(m => m.id !== this.state.selectedMessage.id);
            this.state.selectedMessage = null;

            this.loadAllCounts();
            this.notification.add("Conversation snoozed", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to snooze", { type: "danger" });
        }
    }

    calculateSnoozeDate(when) {
        const now = new Date();
        switch(when) {
            case 'later_today':
                // Snooze for 3 hours
                return new Date(now.getTime() + 3 * 60 * 60 * 1000);
            case 'tomorrow':
                // Tomorrow at 8 AM
                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(8, 0, 0, 0);
                return tomorrow;
            case 'next_week':
                // Next Monday at 8 AM
                const nextWeek = new Date(now);
                nextWeek.setDate(nextWeek.getDate() + ((8 - nextWeek.getDay()) % 7 || 7));
                nextWeek.setHours(8, 0, 0, 0);
                return nextWeek;
            default:
                return new Date(now.getTime() + 24 * 60 * 60 * 1000);
        }
    }

    // ==========================================
    // GMAIL FEATURES - Move To
    // ==========================================

    async onBulkMoveTo(folder) {
        // Currently just moves to inbox by restoring archived state
        if (this.state.selectedIds.length === 0) return;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, this.state.selectedIds, { state: 'read' });

            if (this.state.activeFolder !== 'inbox') {
                // Reload to show moved messages
                this.loadFolderData(this.state.activeFolder);
            }

            this.state.selectedIds = [];
            this.loadAllCounts();
            this.notification.add("Moved to inbox", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to move", { type: "danger" });
        }
    }

    async onMoveSelected(folder) {
        if (!this.state.selectedMessage) return;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, [this.state.selectedMessage.id], { state: 'read' });

            this.state.messages = this.state.messages.filter(m => m.id !== this.state.selectedMessage.id);
            this.state.selectedMessage = null;

            this.loadAllCounts();
            this.notification.add("Moved to inbox", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to move", { type: "danger" });
        }
    }

    // ==========================================
    // GMAIL FEATURES - Single Message Actions
    // ==========================================

    async onMarkSpamSelected() {
        if (!this.state.selectedMessage) return;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.call(model, "action_mark_as_spam", [[this.state.selectedMessage.id]]);

            this.state.messages = this.state.messages.filter(m => m.id !== this.state.selectedMessage.id);
            this.state.selectedMessage = null;

            this.loadAllCounts();
            this.notification.add("Reported as spam", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to report spam", { type: "danger" });
        }
    }

    async onNotSpamSelected() {
        if (!this.state.selectedMessage) return;

        try {
            await this.orm.call("mail.bot.spam", "action_not_spam", [[this.state.selectedMessage.id]]);

            this.state.messages = this.state.messages.filter(m => m.id !== this.state.selectedMessage.id);
            this.state.selectedMessage = null;

            this.loadAllCounts();
            this.notification.add("Moved to inbox", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to move to inbox", { type: "danger" });
        }
    }

    async onDeletePermanent() {
        if (!this.state.selectedMessage) return;

        // Show confirmation dialog
        const confirmed = window.confirm(
            "Are you sure you want to permanently delete this message?\n\nThis action cannot be undone."
        );

        if (!confirmed) return;

        try {
            await this.orm.call("mail.bot.trash", "unlink", [[this.state.selectedMessage.id]]);

            this.state.messages = this.state.messages.filter(m => m.id !== this.state.selectedMessage.id);
            this.state.selectedMessage = null;

            this.state.counts.trash = Math.max(0, this.state.counts.trash - 1);
            this.notification.add("Deleted forever", { type: "success" });
        } catch (error) {
            console.error("Error deleting message:", error);
            this.notification.add("Failed to delete", { type: "danger" });
        }
    }

    async onToggleImportantSelected() {
        if (!this.state.selectedMessage) return;

        const newValue = !this.state.selectedMessage.is_important;

        try {
            const model = this.getModelForFolder(this.state.activeFolder);
            await this.orm.write(model, [this.state.selectedMessage.id], { is_important: newValue });

            this.state.selectedMessage.is_important = newValue;
            const msg = this.state.messages.find(m => m.id === this.state.selectedMessage.id);
            if (msg) msg.is_important = newValue;

            this.loadAllCounts();
            this.notification.add(newValue ? "Marked as important" : "Removed importance", { type: "success" });
        } catch (error) {
            this.notification.add("Failed to update", { type: "danger" });
        }
    }

    // ==========================================
    // GMAIL FEATURES - Reply All
    // ==========================================

    onReplyAll() {
        if (!this.state.selectedMessage) return;

        // Get all recipients (original To, CC) for reply all
        const originalTo = this.state.selectedMessage.recipient_email || '';
        const originalCc = this.state.selectedMessage.cc_emails || '';

        this.state.composeData = {
            to: this.state.selectedMessage.display_email || '',
            cc: [originalTo, originalCc].filter(e => e).join(', '),
            bcc: "",
            subject: "Re: " + (this.state.selectedMessage.subject || ""),
            body: `<br><br>On ${this.formatDate(this.state.selectedMessage.display_date)}, ${this.state.selectedMessage.display_name || ''} wrote:<br><blockquote style="border-left: 2px solid #ccc; padding-left: 10px; margin-left: 0;">${this.state.selectedMessage.body || ''}</blockquote>`,
            attachments: [],
            inReplyTo: this.state.selectedMessage.message_id || "", // Track which message this is replying to
        };
        this.state.showCc = true;
        this.state.showBcc = false;
        this.state.showFormatToolbar = false;
        this.state.showEmojiPicker = false;
        this.state.showLinkDialog = false;
        this.state.showColorPicker = false;
        this.state.showMoreOptionsMenu = false;
        // Reset minimize/expand state - always open in normal mode
        this.state.composeMinimized = false;
        this.state.composeExpanded = false;
        this.state.showCompose = true;
    }

    // ==========================================
    // GMAIL FEATURES - Print & Download
    // ==========================================

    onPrintMessage() {
        if (!this.state.selectedMessage) return;

        const printContent = `
            <html>
            <head>
                <title>${this.state.selectedMessage.subject || 'Message'}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    .header { border-bottom: 1px solid #ccc; padding-bottom: 10px; margin-bottom: 20px; }
                    .subject { font-size: 20px; font-weight: bold; margin-bottom: 10px; }
                    .meta { color: #666; font-size: 14px; }
                    .body { line-height: 1.6; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="subject">${this.state.selectedMessage.subject || '(No Subject)'}</div>
                    <div class="meta">
                        <strong>From:</strong> ${this.state.selectedMessage.display_name || ''} &lt;${this.state.selectedMessage.display_email || ''}&gt;<br>
                        <strong>To:</strong> ${this.state.selectedMessage.recipient_email || ''}<br>
                        <strong>Date:</strong> ${this.formatDate(this.state.selectedMessage.display_date)}
                    </div>
                </div>
                <div class="body">${this.state.selectedMessage.body || ''}</div>
            </body>
            </html>
        `;

        const printWindow = window.open('', '_blank');
        printWindow.document.write(printContent);
        printWindow.document.close();
        printWindow.print();
    }

    onDownloadMessage() {
        if (!this.state.selectedMessage) return;

        const emlContent = `From: ${this.state.selectedMessage.display_name || ''} <${this.state.selectedMessage.display_email || ''}>
To: ${this.state.selectedMessage.recipient_email || ''}
Subject: ${this.state.selectedMessage.subject || ''}
Date: ${this.state.selectedMessage.display_date || ''}
Content-Type: text/html; charset="UTF-8"

${this.state.selectedMessage.body || ''}`;

        const blob = new Blob([emlContent], { type: 'message/rfc822' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.state.selectedMessage.subject || 'message'}.eml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.notification.add("Message downloaded", { type: "success" });
    }

    async onRestoreSelected() {
        if (!this.state.selectedMessage) return;

        try {
            const messageId = this.state.selectedMessage.id;

            // Call the restore method on the trash model
            await this.orm.call("mail.bot.trash", "action_restore", [[messageId]]);

            // Remove from current list
            this.state.messages = this.state.messages.filter(
                m => m.id !== messageId
            );

            // Update trash count
            this.state.counts.trash = Math.max(0, this.state.counts.trash - 1);

            // Clear selection
            this.state.selectedMessage = null;

            this.notification.add("Message restored successfully", { type: "success" });

            // Reload counts to reflect the restored message in its original folder
            this.loadAllCounts();

        } catch (error) {
            console.error("Error restoring message:", error);
            this.notification.add("Unable to restore message", { type: "danger" });
        }
    }

    getModelForFolder(folder) {
        // Special folders that use inbox model
        if (["starred", "snoozed", "important"].includes(folder)) {
            return "mail.bot.inbox";
        }
        // All mail needs special handling - return inbox as default
        if (folder === "allmail") {
            return "mail.bot.inbox";
        }
        const modelMap = {
            inbox: "mail.bot.inbox",
            sent: "mail.bot.sent",
            draft: "mail.bot.draft",
            spam: "mail.bot.spam",
            trash: "mail.bot.trash",
        };
        return modelMap[folder];
    }

    formatDate(dateStr) {
        if (!dateStr) return "";

        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        } else if (diffDays < 7) {
            return date.toLocaleDateString([], { weekday: "short" });
        } else if (date.getFullYear() === now.getFullYear()) {
            return date.toLocaleDateString([], { month: "short", day: "numeric" });
        } else {
            return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
        }
    }

    getAttachmentDownloadUrl(attachment) {
        if (!attachment || !attachment.id) return "#";
        return `/web/content/${attachment.id}?download=true`;
    }

    getAvatarLetter() {
        if (this.state.selectedMessage && this.state.selectedMessage.display_name) {
            return this.state.selectedMessage.display_name[0].toUpperCase();
        }
        return "?";
    }

    getMessageBody() {
        if (!this.state.selectedMessage || !this.state.selectedMessage.body) {
            return "";
        }
        return markup(this.state.selectedMessage.body);
    }

    isChecked(messageId) {
        return this.state.selectedIds.includes(messageId);
    }

    // Menu toggle methods
    onToggleMessagesMenu() {
        this.state.showMessagesMenu = !this.state.showMessagesMenu;
        this.state.showConfigMenu = false;
    }

    onToggleConfigMenu() {
        this.state.showConfigMenu = !this.state.showConfigMenu;
        this.state.showMessagesMenu = false;
    }

    closeAllMenus() {
        this.state.showMessagesMenu = false;
        this.state.showConfigMenu = false;
    }

    // Messages menu handlers
    onMenuClickInbox() {
        this.closeAllMenus();
        this.loadFolderData("inbox");
    }

    onMenuClickStarred() {
        this.closeAllMenus();
        this.loadFolderData("starred");
    }

    onMenuClickSnoozed() {
        this.closeAllMenus();
        this.notification.add("Snoozed feature coming soon", { type: "info" });
    }

    onMenuClickDone() {
        this.closeAllMenus();
        this.notification.add("Done feature coming soon", { type: "info" });
    }

    onMenuClickSent() {
        this.closeAllMenus();
        this.loadFolderData("sent");
    }

    onMenuClickDraft() {
        this.closeAllMenus();
        this.loadFolderData("draft");
    }

    onMenuClickTrash() {
        this.closeAllMenus();
        this.loadFolderData("trash");
    }

    onMenuClickAll() {
        this.closeAllMenus();
        this.loadFolderData("inbox");
    }

    // Configuration menu handlers
    onConfigIncomingServers() {
        this.closeAllMenus();
        this.action.doAction({
            type: "ir.actions.act_window",
            name: "Incoming Mail Servers",
            res_model: "mail.bot.server",
            view_mode: "tree,form",
            views: [[false, "list"], [false, "form"]],
            target: "current",
        });
    }

    onConfigFolders() {
        this.closeAllMenus();
        this.notification.add("Folders configuration coming soon", { type: "info" });
    }

    onConfigTags() {
        this.closeAllMenus();
        this.notification.add("Tags configuration coming soon", { type: "info" });
    }

    onConfigLabels() {
        this.closeAllMenus();
        this.notification.add("Labels configuration coming soon", { type: "info" });
    }

    onConfigThemes() {
        this.closeAllMenus();
        this.notification.add("Themes configuration coming soon", { type: "info" });
    }
}

registry.category("actions").add("mail_bot_client_action", MailBotClientAction);
