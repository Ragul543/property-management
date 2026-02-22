/** @odoo-module **/

import { Component, useState, useRef, onWillStart, onMounted, onWillUnmount } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { jsonrpc } from "@web/core/network/rpc_service";

class WhatsAppDiscuss extends Component {
    static template = "whatsappbot.WhatsAppDiscuss";
    static props = {};

    setup() {
        this.notification = useService("notification");
        this.orm = useService("orm");
        // Skip bus_service - rely on polling for real-time updates
        // bus_service has compatibility issues across Odoo versions
        this.busService = null;
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
            // Settings menu
            showSettingsMenu: false,
            showMuteOptions: false,
            // Contact Info Panel (for individual chats)
            showContactInfo: false,
            // Confirmation dialogs
            showBlockConfirmDialog: false,
            showDeleteConfirmDialog: false,
            showClearConfirmDialog: false,
            // Emoji picker
            showEmojiPicker: false,
            emojiCategory: 'smileys',
            // Sidebar settings
            showSidebarSettings: false,
            // Selection mode
            selectionMode: false,
            selectedConversations: [],
            // Reply to message
            replyingTo: null,
            // Message context menu
            showMessageContextMenu: false,
            contextMenuMessage: null,
            contextMenuPosition: { x: 0, y: 0 },
            // Message search
            showSearch: false,
            searchMessagesQuery: "",
            searchResults: [],
            searchingMessages: false,
            // Forward message
            showForwardDialog: false,
            forwardingMessage: null,
            forwardSelectedConversations: [],
            // Edit message
            editingMessage: null,
            editMessageValue: "",
            // Dark mode
            darkMode: localStorage.getItem('whatsapp_dark_mode') === 'true',
            // Drag and drop
            isDragging: false,
            // Voice recording
            isRecording: false,
            recordingDuration: 0,
            audioBlob: null,
            // Typing indicators
            typingUsers: {}, // { conversationId: { phone: timestamp } }
            isTyping: false,
            // QR Code Modal
            showQRModal: false,
            qrCode: null,
            qrLoading: false,
            qrError: null,
            qrConnected: false,
            // Connection status
            isConnected: true,
        });

        // Voice recording refs
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recordingTimer = null;
        this.typingTimeout = null;
        this.qrPollInterval = null;

        // Emoji data organized by category
        this.emojis = {
            smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖'],
            gestures: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄'],
            people: ['👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', '👩', '🧓', '👴', '👵', '🙍', '🙎', '🙅', '🙆', '💁', '🙋', '🧏', '🙇', '🤦', '🤷', '👮', '🕵️', '💂', '🥷', '👷', '🤴', '👸', '👳', '👲', '🧕', '🤵', '👰', '🤰', '🤱', '👼', '🎅', '🤶', '🦸', '🦹', '🧙', '🧚', '🧛', '🧜', '🧝', '🧞', '🧟', '💆', '💇', '🚶', '🧍', '🧎', '🏃', '💃', '🕺', '🕴️', '👯', '🧖', '🧗', '🤸', '🏌️', '🏇', '⛷️', '🏂', '🏋️', '🤼', '🤽', '🤾', '🤺', '⛹️', '🏊', '🚣', '🧘', '🛀', '🛌'],
            animals: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐓', '🦃', '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦫', '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔'],
            food: ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🦴', '🌭', '🍔', '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '☕', '🫖', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊'],
            activities: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾', '🏌️', '🏇', '⛑️', '🎖️', '🏆', '🥇', '🥈', '🥉', '🎪', '🤹', '🎭', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩'],
            travel: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🦯', '🦽', '🦼', '🛴', '🚲', '🛵', '🏍️', '🛺', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🛩️', '💺', '🛰️', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '⚓', '🪝', '⛽', '🚧', '🚦', '🚥', '🚏', '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡', '🎢', '🎠', '⛲', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', '🗻', '🏕️', '⛺', '🛖', '🏠', '🏡', '🏘️', '🏚️', '🏗️', '🏭', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒', '🏛️', '⛪', '🕌', '🕍', '🛕', '🕋', '⛩️', '🛤️', '🛣️', '🗾', '🎑', '🏞️', '🌅', '🌄', '🌠', '🎇', '🎆', '🌇', '🌆', '🏙️', '🌃', '🌌', '🌉', '🌁'],
            objects: ['⌚', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '🗜️', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰', '🪛', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🪚', '🔩', '⚙️', '🪤', '🧱', '⛓️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🪠', '🧺', '🧻', '🚽', '🚰', '🚿', '🛁', '🛀', '🧼', '🪥', '🪒', '🧽', '🪣', '🧴', '🛎️', '🔑', '🗝️', '🚪', '🪑', '🛋️', '🛏️', '🛌', '🧸', '🪆', '🖼️', '🪞', '🪟', '🛍️', '🛒', '🎁', '🎈', '🎏', '🎀', '🪄', '🎊', '🎉', '🎎', '🏮', '🎐', '🧧', '✉️', '📩', '📨', '📧', '💌', '📥', '📤', '📦', '🏷️', '🪧', '📪', '📫', '📬', '📭', '📮', '📯', '📜', '📃', '📄', '📑', '🧾', '📊', '📈', '📉', '🗒️', '🗓️', '📆', '📅', '🗑️', '📇', '🗃️', '🗳️', '🗄️', '📋', '📁', '📂', '🗂️', '🗞️', '📰', '📓', '📔', '📒', '📕', '📗', '📘', '📙', '📚', '📖', '🔖', '🧷', '🔗', '📎', '🖇️', '📐', '📏', '🧮', '📌', '📍', '✂️', '🖊️', '🖋️', '✒️', '🖌️', '🖍️', '📝', '✏️', '🔍', '🔎', '🔏', '🔐', '🔒', '🔓'],
            symbols: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🛗', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '⚧️', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '♾️', '💲', '💱', '™️', '©️', '®️', '〰️', '➰', '➿', '🔚', '🔙', '🔛', '🔝', '🔜', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾', '◽', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '👁‍🗨', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦', '🕧'],
            flags: ['🏳️', '🏴', '🏁', '🚩', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '🇦🇫', '🇦🇽', '🇦🇱', '🇩🇿', '🇦🇸', '🇦🇩', '🇦🇴', '🇦🇮', '🇦🇶', '🇦🇬', '🇦🇷', '🇦🇲', '🇦🇼', '🇦🇺', '🇦🇹', '🇦🇿', '🇧🇸', '🇧🇭', '🇧🇩', '🇧🇧', '🇧🇾', '🇧🇪', '🇧🇿', '🇧🇯', '🇧🇲', '🇧🇹', '🇧🇴', '🇧🇦', '🇧🇼', '🇧🇷', '🇮🇴', '🇻🇬', '🇧🇳', '🇧🇬', '🇧🇫', '🇧🇮', '🇰🇭', '🇨🇲', '🇨🇦', '🇮🇨', '🇨🇻', '🇧🇶', '🇰🇾', '🇨🇫', '🇹🇩', '🇨🇱', '🇨🇳', '🇨🇽', '🇨🇨', '🇨🇴', '🇰🇲', '🇨🇬', '🇨🇩', '🇨🇰', '🇨🇷', '🇨🇮', '🇭🇷', '🇨🇺', '🇨🇼', '🇨🇾', '🇨🇿', '🇩🇰', '🇩🇯', '🇩🇲', '🇩🇴', '🇪🇨', '🇪🇬', '🇸🇻', '🇬🇶', '🇪🇷', '🇪🇪', '🇸🇿', '🇪🇹', '🇪🇺', '🇫🇰', '🇫🇴', '🇫🇯', '🇫🇮', '🇫🇷', '🇬🇫', '🇵🇫', '🇹🇫', '🇬🇦', '🇬🇲', '🇬🇪', '🇩🇪', '🇬🇭', '🇬🇮', '🇬🇷', '🇬🇱', '🇬🇩', '🇬🇵', '🇬🇺', '🇬🇹', '🇬🇬', '🇬🇳', '🇬🇼', '🇬🇾', '🇭🇹', '🇭🇳', '🇭🇰', '🇭🇺', '🇮🇸', '🇮🇳', '🇮🇩', '🇮🇷', '🇮🇶', '🇮🇪', '🇮🇲', '🇮🇱', '🇮🇹', '🇯🇲', '🇯🇵', '🎌', '🇯🇪', '🇯🇴', '🇰🇿', '🇰🇪', '🇰🇮', '🇽🇰', '🇰🇼', '🇰🇬', '🇱🇦', '🇱🇻', '🇱🇧', '🇱🇸', '🇱🇷', '🇱🇾', '🇱🇮', '🇱🇹', '🇱🇺', '🇲🇴', '🇲🇬', '🇲🇼', '🇲🇾', '🇲🇻', '🇲🇱', '🇲🇹', '🇲🇭', '🇲🇶', '🇲🇷', '🇲🇺', '🇾🇹', '🇲🇽', '🇫🇲', '🇲🇩', '🇲🇨', '🇲🇳', '🇲🇪', '🇲🇸', '🇲🇦', '🇲🇿', '🇲🇲', '🇳🇦', '🇳🇷', '🇳🇵', '🇳🇱', '🇳🇨', '🇳🇿', '🇳🇮', '🇳🇪', '🇳🇬', '🇳🇺', '🇳🇫', '🇰🇵', '🇲🇰', '🇲🇵', '🇳🇴', '🇴🇲', '🇵🇰', '🇵🇼', '🇵🇸', '🇵🇦', '🇵🇬', '🇵🇾', '🇵🇪', '🇵🇭', '🇵🇳', '🇵🇱', '🇵🇹', '🇵🇷', '🇶🇦', '🇷🇪', '🇷🇴', '🇷🇺', '🇷🇼', '🇼🇸', '🇸🇲', '🇸🇹', '🇸🇦', '🇸🇳', '🇷🇸', '🇸🇨', '🇸🇱', '🇸🇬', '🇸🇽', '🇸🇰', '🇸🇮', '🇬🇸', '🇸🇧', '🇸🇴', '🇿🇦', '🇰🇷', '🇸🇸', '🇪🇸', '🇱🇰', '🇧🇱', '🇸🇭', '🇰🇳', '🇱🇨', '🇵🇲', '🇻🇨', '🇸🇩', '🇸🇷', '🇸🇪', '🇨🇭', '🇸🇾', '🇹🇼', '🇹🇯', '🇹🇿', '🇹🇭', '🇹🇱', '🇹🇬', '🇹🇰', '🇹🇴', '🇹🇹', '🇹🇳', '🇹🇷', '🇹🇲', '🇹🇨', '🇹🇻', '🇻🇮', '🇺🇬', '🇺🇦', '🇦🇪', '🇬🇧', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '🏴󠁧󠁢󠁷󠁬󠁳󠁿', '🇺🇳', '🇺🇸', '🇺🇾', '🇺🇿', '🇻🇺', '🇻🇦', '🇻🇪', '🇻🇳', '🇼🇫', '🇪🇭', '🇾🇪', '🇿🇲', '🇿🇼']
        };

        this.emojiCategories = [
            { id: 'smileys', icon: '😀', label: 'Smileys' },
            { id: 'gestures', icon: '👋', label: 'Gestures' },
            { id: 'people', icon: '👨', label: 'People' },
            { id: 'animals', icon: '🐶', label: 'Animals' },
            { id: 'food', icon: '🍔', label: 'Food' },
            { id: 'activities', icon: '⚽', label: 'Activities' },
            { id: 'travel', icon: '🚗', label: 'Travel' },
            { id: 'objects', icon: '💡', label: 'Objects' },
            { id: 'symbols', icon: '❤️', label: 'Symbols' },
            { id: 'flags', icon: '🏳️', label: 'Flags' },
        ];

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

            // Check WhatsApp status
            try {
                const statusResult = await this._rpc("/whatsapp/status", {});
                console.log("[WhatsApp] Status:", statusResult);
                if (!statusResult.ok) {
                    this.state.isConnected = false;
                    this.state.conversations = [];
                    this.notification.add(statusResult.error || "WhatsApp not configured", {
                        type: "warning",
                        sticky: true
                    });
                } else if (!statusResult.connected) {
                    this.state.isConnected = false;
                    this.state.conversations = [];
                    if (statusResult.needs_qr) {
                        this.notification.add(
                            "WhatsApp not connected. Please scan QR code to login.",
                            { type: "warning", sticky: true }
                        );
                    } else {
                        this.notification.add(
                            statusResult.error || "WhatsApp bot server not running. Please start the bot server.",
                            { type: "warning", sticky: true }
                        );
                    }
                } else {
                    this.state.isConnected = true;
                }
            } catch (e) {
                console.warn("Could not check WhatsApp status:", e);
                this.state.isConnected = false;
                this.state.conversations = [];
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

            // Add global keyboard shortcut listener
            this._boundKeyDownHandler = this.onGlobalKeyDown.bind(this);
            document.addEventListener('keydown', this._boundKeyDownHandler);

            // Close context menu and settings menu on click outside
            this._boundClickHandler = (ev) => {
                if (this.state.showMessageContextMenu) {
                    this.closeMessageContextMenu();
                }
                // Close settings menu when clicking outside
                if (this.state.showSettingsMenu) {
                    const settingsDropdown = document.querySelector('.o_settings_dropdown');
                    if (settingsDropdown && !settingsDropdown.contains(ev.target)) {
                        this.closeSettingsMenu();
                    }
                }
                // Close sidebar settings menu when clicking outside
                if (this.state.showSidebarSettings) {
                    const sidebarDropdown = document.querySelector('.o_sidebar_settings_dropdown');
                    if (sidebarDropdown && !sidebarDropdown.contains(ev.target)) {
                        this.closeSidebarSettings();
                    }
                }
            };
            document.addEventListener('click', this._boundClickHandler);
        });

        onWillUnmount(() => {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
            }
            // Remove global event listeners
            if (this._boundKeyDownHandler) {
                document.removeEventListener('keydown', this._boundKeyDownHandler);
            }
            if (this._boundClickHandler) {
                document.removeEventListener('click', this._boundClickHandler);
            }
        });
    }

    subscribeToBus() {
        // Subscribe to user-specific WhatsApp channel for Odoo 17
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

            // Try multiple subscription methods for Odoo 17 compatibility
            let subscribed = false;

            // Method 1: addEventListener for 'notification' events (Odoo 17)
            if (typeof this.busService.addEventListener === 'function') {
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

            // Method 2: Direct subscribe (fallback)
            if (!subscribed && typeof this.busService.subscribe === 'function') {
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
            } else if (notif.type === 'typing') {
                // Handle typing indicator
                this.handleTypingNotification(notif.payload || notif);
            } else if (notif.payload && (notif.payload.message || notif.payload.conversation)) {
                this.onBusNotification(notif.payload);
            }
        }
    }

    onBusNotification(payload) {
        // Handle incoming message notification from bus
        console.log("[WhatsApp Bus] Processing notification:", payload);

        // Handle multiple payload formats (Odoo 17 vs legacy)
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
        // Skip refresh if not connected
        if (!this.state.isConnected) {
            return;
        }

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

                // Force reactivity by clearing and reassigning, with proper sorting (pinned first)
                const sortedConvs = this.sortConversations(newConvs);
                this.state.conversations.splice(0, this.state.conversations.length, ...sortedConvs);

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
        // Odoo 17 compatible RPC call
        return await jsonrpc(route, params);
    }

    async loadConversations() {
        // Skip loading if not connected
        if (!this.state.isConnected) {
            this.state.loading = false;
            this.state.conversations = [];
            return;
        }

        console.log("[WhatsApp] Loading conversations...");
        try {
            this.state.loading = true;
            const result = await this._rpc("/whatsapp/conversations", { _ts: Date.now() });
            console.log("[WhatsApp] Conversations API result:", result);

            if (result.ok) {
                this.state.conversations = this.sortConversations(result.conversations || []);
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
        // Handle keyboard events - only proceed on Enter (without Shift)
        if (ev && ev.key) {
            if (ev.key !== "Enter") return;
            if (ev.shiftKey) return; // Allow Shift+Enter for new lines
            ev.preventDefault(); // Prevent default Enter behavior
        }

        const input = this.messageInputRef.el;
        if (!input) {
            console.error("[WhatsApp] Message input not found");
            return;
        }

        const message = input.value.trim();

        if (!this.state.activeConversation) {
            this.notification.add("Please select a conversation first", { type: "warning" });
            return;
        }

        if (!message && !this.state.selectedFile) {
            return; // Nothing to send
        }

        // Check if file is still loading
        if (this.state.selectedFile && !this.state.fileBase64) {
            this.notification.add("File is still loading, please wait...", { type: "info" });
            return;
        }

        // Show sending indicator
        const originalPlaceholder = input.placeholder;
        input.placeholder = "Sending...";
        input.disabled = true;

        try {
            // Clear input immediately for better UX
            const messageToSend = message;
            input.value = "";

            let result;

            if (this.state.selectedFile) {
                // Send media
                console.log("[WhatsApp] Sending media...");
                result = await this._rpc(`/whatsapp/send_media`, {
                    conversation_id: this.state.activeConversation.id,
                    media_base64: this.state.fileBase64,
                    caption: messageToSend || null,
                    filename: this.state.selectedFile.name,
                    mimetype: this.state.selectedFile.type
                });
                this.removeSelectedFile();
            } else {
                // Send text message
                console.log("[WhatsApp] Sending message:", messageToSend.substring(0, 50));
                const sendParams = {
                    message: messageToSend
                };
                // Include reply_to_id if replying to a message
                if (this.state.replyingTo) {
                    sendParams.reply_to_id = this.state.replyingTo.id;
                    console.log("[WhatsApp] Replying to message:", this.state.replyingTo.id);
                }
                result = await this._rpc(`/whatsapp/conversation/${this.state.activeConversation.id}/send`, sendParams);
            }

            console.log("[WhatsApp] Send result:", result);

            if (result.ok) {
                // Add message to UI
                this.state.messages.push(result.message);
                this.updateConversationLastMessage(result.message);
                this.scrollToBottom();
                // Clear reply state after successful send
                this.state.replyingTo = null;
            } else {
                // Show error and restore message
                const errorMsg = result.error || "Failed to send message";
                console.error("[WhatsApp] Send failed:", errorMsg);
                this.notification.add(errorMsg, { type: "danger", sticky: true });
                // Restore the message so user doesn't lose it
                input.value = messageToSend;
            }
        } catch (error) {
            console.error("[WhatsApp] Error sending message:", error);
            const errorMsg = error.message || error.data?.message || "Failed to send message. Please check WhatsApp configuration.";
            this.notification.add(errorMsg, { type: "danger", sticky: true });
            // Restore the message
            input.value = message;
        } finally {
            // Restore input state
            input.disabled = false;
            input.placeholder = originalPlaceholder || "Type a message...";
            input.focus();
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
            // Focus message input after file is ready so Enter key works
            if (this.messageInputRef.el) {
                this.messageInputRef.el.focus();
            }
        };
        reader.readAsDataURL(file);

        // Focus message input immediately for caption entry
        if (this.messageInputRef.el) {
            this.messageInputRef.el.focus();
        }
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

    // Sort conversations with pinned chats at top, then by last message date
    sortConversations(conversations) {
        return [...conversations].sort((a, b) => {
            // Pinned chats come first
            if (a.is_pinned && !b.is_pinned) return -1;
            if (!a.is_pinned && b.is_pinned) return 1;
            // Then sort by last message date (newest first)
            const dateA = a.last_message_date ? new Date(a.last_message_date) : new Date(0);
            const dateB = b.last_message_date ? new Date(b.last_message_date) : new Date(0);
            return dateB - dateA;
        });
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

    // ==================== Chat Settings Methods (WhatsApp-like) ====================

    toggleSettingsMenu() {
        this.state.showSettingsMenu = !this.state.showSettingsMenu;
        this.state.showMuteOptions = false;
    }

    closeSettingsMenu() {
        this.state.showSettingsMenu = false;
        this.state.showMuteOptions = false;
    }

    toggleMuteOptions() {
        this.state.showMuteOptions = !this.state.showMuteOptions;
    }

    async pinChat() {
        if (!this.state.activeConversation) return;
        this.closeSettingsMenu();

        try {
            const result = await this._rpc(`/whatsapp/conversation/${this.state.activeConversation.id}/pin`, {});
            if (result.ok) {
                this.state.activeConversation.is_pinned = result.is_pinned;
                // Update in conversations list
                const conv = this.state.conversations.find(c => c.id === this.state.activeConversation.id);
                if (conv) conv.is_pinned = result.is_pinned;
                // Re-sort conversations to move pinned chat to top
                this.state.conversations = this.sortConversations(this.state.conversations);
                this.notification.add(result.message, { type: "success" });
            } else {
                this.notification.add(result.error || "Failed to pin chat", { type: "danger" });
            }
        } catch (error) {
            console.error("Error pinning chat:", error);
            this.notification.add("Failed to pin chat", { type: "danger" });
        }
    }

    async muteChat(duration) {
        if (!this.state.activeConversation) return;
        this.closeSettingsMenu();

        try {
            const result = await this._rpc(`/whatsapp/conversation/${this.state.activeConversation.id}/mute`, {
                duration: duration
            });
            if (result.ok) {
                this.state.activeConversation.is_muted = result.is_muted;
                this.state.activeConversation.mute_until = result.mute_until;
                // Update in conversations list
                const conv = this.state.conversations.find(c => c.id === this.state.activeConversation.id);
                if (conv) {
                    conv.is_muted = result.is_muted;
                    conv.mute_until = result.mute_until;
                }
                this.notification.add(result.message, { type: "success" });
            } else {
                this.notification.add(result.error || "Failed to mute chat", { type: "danger" });
            }
        } catch (error) {
            console.error("Error muting chat:", error);
            this.notification.add("Failed to mute chat", { type: "danger" });
        }
    }

    // Show block confirmation dialog
    showBlockDialog() {
        if (!this.state.activeConversation || this.state.activeConversation.is_group) return;
        this.closeSettingsMenu();
        this.state.showBlockConfirmDialog = true;
    }

    // Cancel block dialog
    cancelBlockDialog() {
        this.state.showBlockConfirmDialog = false;
    }

    // Confirm block action
    async confirmBlockContact() {
        if (!this.state.activeConversation || this.state.activeConversation.is_group) return;
        this.state.showBlockConfirmDialog = false;

        try {
            const result = await this._rpc(`/whatsapp/conversation/${this.state.activeConversation.id}/block`, {});
            if (result.ok) {
                this.state.activeConversation.is_blocked = result.is_blocked;
                // Update in conversations list
                const conv = this.state.conversations.find(c => c.id === this.state.activeConversation.id);
                if (conv) conv.is_blocked = result.is_blocked;
                this.notification.add(result.message, { type: "success" });
            } else {
                this.notification.add(result.error || "Failed to block contact", { type: "danger" });
            }
        } catch (error) {
            console.error("Error blocking contact:", error);
            this.notification.add("Failed to block contact", { type: "danger" });
        }
    }

    // Legacy method for backwards compatibility
    async blockContact() {
        this.showBlockDialog();
    }

    async archiveChat() {
        if (!this.state.activeConversation) return;
        this.closeSettingsMenu();

        try {
            const result = await this._rpc(`/whatsapp/conversation/${this.state.activeConversation.id}/archive`, {});
            if (result.ok) {
                this.state.activeConversation.is_archived = result.is_archived;
                // Update in conversations list
                const conv = this.state.conversations.find(c => c.id === this.state.activeConversation.id);
                if (conv) conv.is_archived = result.is_archived;
                this.notification.add(result.message, { type: "success" });

                // If archived, clear active conversation
                if (result.is_archived) {
                    // Remove from list and clear active
                    this.state.conversations = this.state.conversations.filter(c => c.id !== this.state.activeConversation.id);
                    this.state.activeConversation = null;
                    this.state.messages = [];
                }
            } else {
                this.notification.add(result.error || "Failed to archive chat", { type: "danger" });
            }
        } catch (error) {
            console.error("Error archiving chat:", error);
            this.notification.add("Failed to archive chat", { type: "danger" });
        }
    }

    // Show clear chat confirmation dialog
    showClearDialog() {
        if (!this.state.activeConversation) return;
        this.closeSettingsMenu();
        this.state.showClearConfirmDialog = true;
    }

    // Cancel clear dialog
    cancelClearDialog() {
        this.state.showClearConfirmDialog = false;
    }

    // Confirm clear chat action
    async confirmClearChat() {
        if (!this.state.activeConversation) return;
        this.state.showClearConfirmDialog = false;

        try {
            const result = await this._rpc(`/whatsapp/conversation/${this.state.activeConversation.id}/clear`, {});
            if (result.ok) {
                // Clear messages in UI
                this.state.messages = [];
                // Update conversation
                if (result.conversation) {
                    Object.assign(this.state.activeConversation, result.conversation);
                    const conv = this.state.conversations.find(c => c.id === this.state.activeConversation.id);
                    if (conv) Object.assign(conv, result.conversation);
                }
                this.notification.add(result.message, { type: "success" });
            } else {
                this.notification.add(result.error || "Failed to clear chat", { type: "danger" });
            }
        } catch (error) {
            console.error("Error clearing chat:", error);
            this.notification.add("Failed to clear chat", { type: "danger" });
        }
    }

    // Legacy method for backwards compatibility
    async clearChat() {
        this.showClearDialog();
    }

    // Show delete chat confirmation dialog
    showDeleteDialog() {
        if (!this.state.activeConversation) return;
        this.closeSettingsMenu();
        this.state.showDeleteConfirmDialog = true;
    }

    // Cancel delete dialog
    cancelDeleteDialog() {
        this.state.showDeleteConfirmDialog = false;
    }

    // Confirm delete chat action
    async confirmDeleteChat() {
        if (!this.state.activeConversation) return;
        this.state.showDeleteConfirmDialog = false;

        try {
            const convId = this.state.activeConversation.id;
            const result = await this._rpc(`/whatsapp/conversation/${convId}/delete`, {});
            if (result.ok) {
                // Remove from conversations list
                this.state.conversations = this.state.conversations.filter(c => c.id !== convId);
                // Clear active conversation
                this.state.activeConversation = null;
                this.state.messages = [];
                this.notification.add(result.message, { type: "success" });
            } else {
                this.notification.add(result.error || "Failed to delete chat", { type: "danger" });
            }
        } catch (error) {
            console.error("Error deleting chat:", error);
            this.notification.add("Failed to delete chat", { type: "danger" });
        }
    }

    // Legacy method for backwards compatibility
    async deleteChat() {
        this.showDeleteDialog();
    }

    // Toggle contact info panel
    toggleContactInfo() {
        this.state.showContactInfo = !this.state.showContactInfo;
    }

    // View contact info - show inline panel like WhatsApp
    viewContactInfo() {
        this.closeSettingsMenu();
        if (this.state.activeConversation) {
            this.state.showContactInfo = true;
        }
    }

    // Open contact in Odoo form (advanced view)
    openContactForm() {
        if (this.state.activeConversation && this.state.activeConversation.partner_id) {
            window.open(`/web#id=${this.state.activeConversation.partner_id}&model=res.partner&view_type=form`, '_blank');
        } else {
            this.notification.add("Contact not linked to any partner", { type: "info" });
        }
    }

    // ==================== Emoji Picker Methods ====================

    toggleEmojiPicker() {
        this.state.showEmojiPicker = !this.state.showEmojiPicker;
    }

    closeEmojiPicker() {
        this.state.showEmojiPicker = false;
    }

    selectEmojiCategory(categoryId) {
        this.state.emojiCategory = categoryId;
    }

    insertEmoji(emoji) {
        const input = this.messageInputRef.el;
        if (!input) return;

        // Get cursor position
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const text = input.value;

        // Insert emoji at cursor position
        input.value = text.substring(0, start) + emoji + text.substring(end);

        // Move cursor after emoji
        const newPos = start + emoji.length;
        input.setSelectionRange(newPos, newPos);

        // Close emoji picker after selection
        this.state.showEmojiPicker = false;

        // Focus input
        input.focus();
    }

    get currentEmojis() {
        return this.emojis[this.state.emojiCategory] || [];
    }

    // ==================== Reply Methods ====================

    startReply(message) {
        this.state.replyingTo = message;
        this.closeMessageContextMenu();
        // Focus the input
        if (this.messageInputRef.el) {
            this.messageInputRef.el.focus();
        }
    }

    cancelReply() {
        this.state.replyingTo = null;
    }

    scrollToMessage(messageId) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageEl) {
            messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            messageEl.classList.add('o_highlight_message');
            setTimeout(() => messageEl.classList.remove('o_highlight_message'), 2000);
        }
    }

    // ==================== Message Context Menu Methods ====================

    showContextMenu(ev, message) {
        ev.preventDefault();
        this.state.contextMenuMessage = message;
        this.state.contextMenuPosition = { x: ev.clientX, y: ev.clientY };
        this.state.showMessageContextMenu = true;
    }

    closeMessageContextMenu() {
        this.state.showMessageContextMenu = false;
        this.state.contextMenuMessage = null;
    }

    // ==================== Star Message Methods ====================

    async starMessage(message) {
        this.closeMessageContextMenu();
        try {
            const result = await this._rpc(`/whatsapp/message/${message.id}/star`, {});
            if (result.ok) {
                // Update message in list
                const idx = this.state.messages.findIndex(m => m.id === message.id);
                if (idx >= 0) {
                    this.state.messages[idx].is_starred = result.is_starred;
                }
                this.notification.add(result.message, { type: "info" });
            }
        } catch (error) {
            this.notification.add("Failed to star message", { type: "danger" });
        }
    }

    // ==================== Delete Message Methods ====================

    async deleteMessage(message, deleteFor = 'me') {
        this.closeMessageContextMenu();
        try {
            const result = await this._rpc(`/whatsapp/message/${message.id}/delete`, {
                delete_for: deleteFor
            });
            if (result.ok) {
                // Update message in list
                const idx = this.state.messages.findIndex(m => m.id === message.id);
                if (idx >= 0) {
                    this.state.messages[idx] = result.message;
                }
                this.notification.add("Message deleted", { type: "info" });
            }
        } catch (error) {
            this.notification.add("Failed to delete message", { type: "danger" });
        }
    }

    // ==================== Edit Message Methods ====================

    startEditMessage(message) {
        this.closeMessageContextMenu();
        if (message.direction !== 'outgoing') {
            this.notification.add("Can only edit your own messages", { type: "warning" });
            return;
        }
        this.state.editingMessage = message;
        this.state.editMessageValue = message.body;
    }

    cancelEditMessage() {
        this.state.editingMessage = null;
        this.state.editMessageValue = "";
    }

    async saveEditMessage() {
        if (!this.state.editingMessage || !this.state.editMessageValue.trim()) {
            return;
        }
        try {
            const result = await this._rpc(`/whatsapp/message/${this.state.editingMessage.id}/edit`, {
                new_body: this.state.editMessageValue.trim()
            });
            if (result.ok) {
                // Update message in list
                const idx = this.state.messages.findIndex(m => m.id === this.state.editingMessage.id);
                if (idx >= 0) {
                    this.state.messages[idx] = result.message;
                }
                this.cancelEditMessage();
                this.notification.add("Message edited", { type: "info" });
            }
        } catch (error) {
            this.notification.add("Failed to edit message", { type: "danger" });
        }
    }

    // ==================== Forward Message Methods ====================

    showForwardDialog(message) {
        this.closeMessageContextMenu();
        this.state.forwardingMessage = message;
        this.state.forwardSelectedConversations = [];
        this.state.showForwardDialog = true;
    }

    closeForwardDialog() {
        this.state.showForwardDialog = false;
        this.state.forwardingMessage = null;
        this.state.forwardSelectedConversations = [];
    }

    toggleForwardConversation(convId) {
        const idx = this.state.forwardSelectedConversations.indexOf(convId);
        if (idx >= 0) {
            this.state.forwardSelectedConversations.splice(idx, 1);
        } else {
            this.state.forwardSelectedConversations.push(convId);
        }
    }

    async forwardMessage() {
        if (!this.state.forwardingMessage || this.state.forwardSelectedConversations.length === 0) {
            return;
        }
        try {
            const result = await this._rpc(`/whatsapp/message/forward`, {
                message_id: this.state.forwardingMessage.id,
                conversation_ids: this.state.forwardSelectedConversations
            });
            if (result.ok) {
                this.notification.add(`Forwarded to ${result.forwarded_count} conversation(s)`, { type: "success" });
                this.closeForwardDialog();
            }
        } catch (error) {
            this.notification.add("Failed to forward message", { type: "danger" });
        }
    }

    // ==================== React to Message Methods ====================

    async reactToMessage(message, emoji) {
        this.closeMessageContextMenu();
        try {
            const result = await this._rpc(`/whatsapp/message/${message.id}/react`, { emoji });
            if (result.ok) {
                // Update message reactions
                const idx = this.state.messages.findIndex(m => m.id === message.id);
                if (idx >= 0) {
                    this.state.messages[idx].reactions = result.reactions;
                }
            }
        } catch (error) {
            this.notification.add("Failed to react to message", { type: "danger" });
        }
    }

    // ==================== Search Methods ====================

    toggleSearch() {
        this.state.showSearch = !this.state.showSearch;
        if (!this.state.showSearch) {
            this.state.searchMessagesQuery = "";
            this.state.searchResults = [];
        }
    }

    async searchMessages() {
        const query = this.state.searchMessagesQuery.trim();
        if (query.length < 2) {
            this.state.searchResults = [];
            return;
        }

        this.state.searchingMessages = true;
        try {
            const params = { query };
            if (this.state.activeConversation) {
                params.conversation_id = this.state.activeConversation.id;
            }
            const result = await this._rpc(`/whatsapp/search`, params);
            if (result.ok) {
                this.state.searchResults = result.results;
            }
        } catch (error) {
            console.error("Search error:", error);
        } finally {
            this.state.searchingMessages = false;
        }
    }

    goToSearchResult(result) {
        // If in a different conversation, switch to it
        if (this.state.activeConversation?.id !== result.conversation_id) {
            const conv = this.state.conversations.find(c => c.id === result.conversation_id);
            if (conv) {
                this.selectConversation(conv);
                // Wait for messages to load, then scroll
                setTimeout(() => this.scrollToMessage(result.id), 500);
            }
        } else {
            this.scrollToMessage(result.id);
        }
        this.toggleSearch();
    }

    // ==================== Dark Mode Methods ====================

    toggleDarkMode() {
        this.closeSidebarSettings();
        this.state.darkMode = !this.state.darkMode;
        localStorage.setItem('whatsapp_dark_mode', this.state.darkMode);
    }

    // ==================== Drag and Drop Methods ====================

    onDragOver(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        this.state.isDragging = true;
    }

    onDragLeave(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        this.state.isDragging = false;
    }

    onDrop(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        this.state.isDragging = false;

        const files = ev.dataTransfer?.files;
        if (files && files.length > 0) {
            this.handleDroppedFile(files[0]);
        }
    }

    handleDroppedFile(file) {
        if (!this.state.activeConversation) {
            this.notification.add("Please select a conversation first", { type: "warning" });
            return;
        }

        // Check file size (max 16MB)
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
            if (this.messageInputRef.el) {
                this.messageInputRef.el.focus();
            }
        };
        reader.readAsDataURL(file);
    }

    // ==================== Clipboard Paste Methods ====================

    onPaste(ev) {
        const items = ev.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                ev.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    this.handleDroppedFile(file);
                }
                break;
            }
        }
    }

    // ==================== Keyboard Shortcuts ====================

    onGlobalKeyDown(ev) {
        // Escape - close dialogs
        if (ev.key === 'Escape') {
            if (this.state.showSearch) {
                this.toggleSearch();
            } else if (this.state.showForwardDialog) {
                this.closeForwardDialog();
            } else if (this.state.showMessageContextMenu) {
                this.closeMessageContextMenu();
            } else if (this.state.replyingTo) {
                this.cancelReply();
            } else if (this.state.editingMessage) {
                this.cancelEditMessage();
            }
            return;
        }

        // Ctrl/Cmd + F - Search
        if ((ev.ctrlKey || ev.metaKey) && ev.key === 'f') {
            ev.preventDefault();
            this.toggleSearch();
            return;
        }

        // Ctrl/Cmd + N - New chat
        if ((ev.ctrlKey || ev.metaKey) && ev.key === 'n' && !ev.shiftKey) {
            ev.preventDefault();
            this.toggleNewConversation();
            return;
        }

        // Ctrl/Cmd + Shift + N - New group
        if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key === 'N') {
            ev.preventDefault();
            this.toggleNewGroup();
            return;
        }
    }

    // ==================== Voice Recording Methods ====================

    async startRecording() {
        if (!this.state.activeConversation) {
            this.notification.add("Please select a conversation first", { type: "warning" });
            return;
        }

        // Check if mediaDevices is available (requires HTTPS or localhost)
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.notification.add("Voice recording requires HTTPS connection or localhost.", { type: "danger" });
            return;
        }

        try {
            // Request microphone permission
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100
                }
            });

            // Find supported mimeType
            const mimeTypes = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/ogg;codecs=opus',
                'audio/mp4',
                'audio/mpeg',
                ''  // Let browser choose default
            ];

            let selectedMimeType = '';
            for (const mimeType of mimeTypes) {
                if (mimeType === '' || MediaRecorder.isTypeSupported(mimeType)) {
                    selectedMimeType = mimeType;
                    break;
                }
            }

            const recorderOptions = {};
            if (selectedMimeType) {
                recorderOptions.mimeType = selectedMimeType;
            }

            this.mediaRecorder = new MediaRecorder(stream, recorderOptions);
            this._recordingStream = stream; // Store stream reference for cleanup
            this._recordingMimeType = this.mediaRecorder.mimeType || 'audio/webm';

            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: this._recordingMimeType });
                this.state.audioBlob = audioBlob;

                // Stop all tracks
                if (this._recordingStream) {
                    this._recordingStream.getTracks().forEach(track => track.stop());
                    this._recordingStream = null;
                }
            };

            this.mediaRecorder.onerror = (event) => {
                console.error("MediaRecorder error:", event.error);
                this.cancelRecording();
                this.notification.add("Recording error occurred.", { type: "danger" });
            };

            this.mediaRecorder.start(100); // Collect data every 100ms
            this.state.isRecording = true;
            this.state.recordingDuration = 0;

            // Start duration timer
            this.recordingTimer = setInterval(() => {
                this.state.recordingDuration++;
            }, 1000);

            console.log("[Voice] Recording started with mimeType:", this._recordingMimeType);

        } catch (error) {
            console.error("Error starting recording:", error);

            // Provide specific error messages
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                this.notification.add("Microphone access denied. Please allow microphone permission in your browser settings.", { type: "danger", sticky: true });
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                this.notification.add("No microphone found. Please connect a microphone and try again.", { type: "danger" });
            } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
                this.notification.add("Microphone is being used by another application.", { type: "danger" });
            } else if (error.name === 'OverconstrainedError') {
                this.notification.add("Microphone does not meet the required constraints.", { type: "danger" });
            } else if (error.name === 'SecurityError') {
                this.notification.add("Voice recording requires a secure connection (HTTPS).", { type: "danger" });
            } else {
                this.notification.add(`Could not access microphone: ${error.message || error.name || 'Unknown error'}`, { type: "danger" });
            }
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.state.isRecording) {
            this.mediaRecorder.stop();
            this.state.isRecording = false;

            if (this.recordingTimer) {
                clearInterval(this.recordingTimer);
                this.recordingTimer = null;
            }
        }
    }

    cancelRecording() {
        if (this.mediaRecorder && this.state.isRecording) {
            this.mediaRecorder.stop();
        }

        // Stop all tracks if stream is still active
        if (this._recordingStream) {
            this._recordingStream.getTracks().forEach(track => track.stop());
            this._recordingStream = null;
        }

        this.state.isRecording = false;
        this.state.recordingDuration = 0;
        this.state.audioBlob = null;
        this.audioChunks = [];
        this.mediaRecorder = null;

        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
    }

    async sendVoiceMessage() {
        if (!this.state.audioBlob || !this.state.activeConversation) {
            return;
        }

        const audioBlob = this.state.audioBlob;
        const mimeType = this._recordingMimeType || audioBlob.type || 'audio/webm';

        // Determine file extension based on mimeType
        let extension = 'webm';
        if (mimeType.includes('ogg')) extension = 'ogg';
        else if (mimeType.includes('mp4')) extension = 'm4a';
        else if (mimeType.includes('mpeg') || mimeType.includes('mp3')) extension = 'mp3';
        else if (mimeType.includes('wav')) extension = 'wav';

        try {
            // Convert blob to base64
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const result = reader.result.split(',')[1];
                    resolve(result);
                };
                reader.onerror = reject;
                reader.readAsDataURL(audioBlob);
            });

            const result = await this._rpc(`/whatsapp/send_media`, {
                conversation_id: this.state.activeConversation.id,
                media_base64: base64,
                caption: null,
                filename: `voice_${Date.now()}.${extension}`,
                mimetype: mimeType
            });

            if (result.ok) {
                this.state.messages.push(result.message);
                this.updateConversationLastMessage(result.message);
                this.scrollToBottom();
                this.notification.add("Voice message sent", { type: "success" });
            } else {
                this.notification.add(result.error || "Failed to send voice message", { type: "danger" });
            }
        } catch (error) {
            console.error("Error sending voice message:", error);
            this.notification.add("Failed to send voice message", { type: "danger" });
        } finally {
            // Clear recording state
            this.state.audioBlob = null;
            this.state.recordingDuration = 0;
            this.audioChunks = [];
            this._recordingMimeType = null;
        }
    }

    formatRecordingDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // ==================== Typing Indicator Methods ====================

    onMessageInput(ev) {
        // Send typing indicator
        if (!this.state.isTyping && this.state.activeConversation) {
            this.sendTypingIndicator(true);
        }

        // Reset typing timeout
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
        }

        // Stop typing after 3 seconds of inactivity
        this.typingTimeout = setTimeout(() => {
            if (this.state.isTyping) {
                this.sendTypingIndicator(false);
            }
        }, 3000);
    }

    async sendTypingIndicator(isTyping) {
        if (!this.state.activeConversation) return;

        this.state.isTyping = isTyping;

        try {
            await this._rpc(`/whatsapp/conversation/${this.state.activeConversation.id}/typing`, {
                typing: isTyping
            });
        } catch (error) {
            // Silently fail - typing indicators are not critical
            console.debug("Could not send typing indicator:", error);
        }
    }

    getTypingIndicatorText() {
        if (!this.state.activeConversation) return '';

        const typingInfo = this.state.typingUsers[this.state.activeConversation.id];
        if (!typingInfo) return '';

        const typingPhones = Object.keys(typingInfo);
        if (typingPhones.length === 0) return '';

        // Clean up old typing indicators (older than 5 seconds)
        const now = Date.now();
        const activeTypers = typingPhones.filter(phone => {
            return (now - typingInfo[phone]) < 5000;
        });

        if (activeTypers.length === 0) return '';
        if (activeTypers.length === 1) return 'typing...';
        if (activeTypers.length === 2) return `${activeTypers.length} people typing...`;
        return 'several people typing...';
    }

    handleTypingNotification(data) {
        const { conversation_id, phone, typing } = data;

        if (!this.state.typingUsers[conversation_id]) {
            this.state.typingUsers[conversation_id] = {};
        }

        if (typing) {
            this.state.typingUsers[conversation_id][phone] = Date.now();
        } else {
            delete this.state.typingUsers[conversation_id][phone];
        }
    }

    // ==================== Sidebar Settings Methods ====================

    toggleSidebarSettings() {
        this.state.showSidebarSettings = !this.state.showSidebarSettings;
    }

    closeSidebarSettings() {
        this.state.showSidebarSettings = false;
    }

    openWhatsAppConfig() {
        this.closeSidebarSettings();
        // Close QR modal if open
        if (this.state.showQRModal) {
            this.state.showQRModal = false;
        }
        // Open WhatsApp Configuration in new tab
        window.open('/web#action=whatsappbot.whatsapp_config_action', '_blank');
    }

    openArchivedChats() {
        this.closeSidebarSettings();
        this.notification.add("Archived chats coming soon", { type: "info" });
    }

    openStarredMessages() {
        this.closeSidebarSettings();
        this.notification.add("Starred messages coming soon", { type: "info" });
    }

    openWhatsAppHelp() {
        this.closeSidebarSettings();
        // Open help/documentation
        window.open('https://www.whatsapp.com/features', '_blank');
    }

    // ==================== WhatsApp Session Management ====================

    async logoutWhatsApp() {
        this.closeSidebarSettings();

        // Confirm logout
        if (!confirm("Are you sure you want to logout from WhatsApp? You will need to scan QR code again to reconnect.")) {
            return;
        }

        try {
            this.notification.add("Logging out from WhatsApp...", { type: "info" });

            const result = await this._rpc("/whatsapp/logout", {});

            if (result.ok) {
                // Clear conversations and set disconnected state
                this.state.isConnected = false;
                this.state.conversations = [];
                this.state.activeConversation = null;
                this.state.messages = [];
                this.notification.add("Successfully logged out from WhatsApp", { type: "success" });
                // Show QR modal for re-login
                this.showQRModal();
            } else {
                this.notification.add(result.error || "Failed to logout", { type: "danger" });
            }
        } catch (error) {
            console.error("Logout error:", error);
            this.notification.add("Error logging out: " + error.message, { type: "danger" });
        }
    }

    showQRModal() {
        this.state.showQRModal = true;
        this.state.qrCode = null;
        this.state.qrLoading = false;
        this.state.qrError = null;
        this.state.qrConnected = false;
        // Auto-fetch QR code
        this.refreshQRCode();
    }

    closeQRModal() {
        this.state.showQRModal = false;
        this.state.qrCode = null;
        this.state.qrLoading = false;
        this.state.qrError = null;
        this.state.qrConnected = false;
        // Clear polling interval if exists
        if (this.qrPollInterval) {
            clearInterval(this.qrPollInterval);
            this.qrPollInterval = null;
        }
        // Refresh conversations if connected
        this.loadConversations();
    }

    async refreshQRCode() {
        this.state.qrLoading = true;
        this.state.qrError = null;
        this.state.qrCode = null;
        this.state.qrConnected = false;

        try {
            console.log("[WhatsApp] Fetching QR code...");
            const result = await this._rpc("/whatsapp/qr", {});
            console.log("[WhatsApp] QR API response:", result);

            if (result.ok) {
                if (result.connected) {
                    this.state.qrConnected = true;
                    this.state.isConnected = true;
                    this.state.qrLoading = false;
                    this.notification.add("WhatsApp is connected!", { type: "success" });
                    // Clear polling
                    if (this.qrPollInterval) {
                        clearInterval(this.qrPollInterval);
                        this.qrPollInterval = null;
                    }
                    // Load conversations after successful connection
                    this.loadConversations();
                } else if (result.qr) {
                    this.state.qrCode = result.qr;
                    this.state.qrLoading = false;
                    console.log("[WhatsApp] QR code received successfully");
                    // Start polling to check connection
                    this.startConnectionPolling();
                } else {
                    this.state.qrError = "No QR code received. The bot server may not be ready. Please try again.";
                    this.state.qrLoading = false;
                }
            } else {
                // Provide more specific error messages
                let errorMsg = result.error || "Failed to get QR code";
                if (errorMsg.includes("No WhatsApp configuration")) {
                    errorMsg = "WhatsApp is not configured. Please set up the WhatsApp configuration in Settings first.";
                } else if (errorMsg.includes("connect") || errorMsg.includes("ECONNREFUSED")) {
                    errorMsg = "Cannot connect to WhatsApp bot server. Please make sure the server is running.";
                }
                this.state.qrError = errorMsg;
                this.state.qrLoading = false;
            }
        } catch (error) {
            console.error("[WhatsApp] QR code error:", error);
            let errorMsg = "Error getting QR code";
            if (error.message) {
                if (error.message.includes("network") || error.message.includes("fetch")) {
                    errorMsg = "Network error. Please check your connection and try again.";
                } else {
                    errorMsg = error.message;
                }
            }
            this.state.qrError = errorMsg;
            this.state.qrLoading = false;
        }
    }

    startConnectionPolling() {
        // Clear existing interval if any
        if (this.qrPollInterval) {
            clearInterval(this.qrPollInterval);
        }

        // Poll every 3 seconds to check if connected
        this.qrPollInterval = setInterval(async () => {
            try {
                const result = await this._rpc("/whatsapp/check_connection", {});
                if (result.ok && result.connected) {
                    this.state.qrConnected = true;
                    this.state.isConnected = true;
                    this.state.qrCode = null;
                    this.notification.add("WhatsApp connected successfully!", { type: "success" });
                    clearInterval(this.qrPollInterval);
                    this.qrPollInterval = null;
                    // Load conversations after successful connection
                    this.loadConversations();
                }
            } catch (error) {
                console.warn("Connection check failed:", error);
            }
        }, 3000);

        // Stop polling after 2 minutes (QR codes expire)
        setTimeout(() => {
            if (this.qrPollInterval) {
                clearInterval(this.qrPollInterval);
                this.qrPollInterval = null;
                if (!this.state.qrConnected && this.state.showQRModal) {
                    this.state.qrError = "QR code expired. Please refresh to get a new one.";
                    this.state.qrCode = null;
                }
            }
        }, 120000);
    }

    // ==================== Selection Mode Methods ====================

    toggleSelectionMode() {
        this.closeSidebarSettings();
        this.state.selectionMode = !this.state.selectionMode;
        if (!this.state.selectionMode) {
            this.state.selectedConversations = [];
        }
    }

    exitSelectionMode() {
        this.state.selectionMode = false;
        this.state.selectedConversations = [];
    }

    toggleConversationSelection(convId) {
        const index = this.state.selectedConversations.indexOf(convId);
        if (index > -1) {
            this.state.selectedConversations.splice(index, 1);
        } else {
            this.state.selectedConversations.push(convId);
        }
    }

    isConversationSelected(convId) {
        return this.state.selectedConversations.includes(convId);
    }

    selectAllConversations() {
        if (this.state.selectedConversations.length === this.state.conversations.length) {
            // Deselect all
            this.state.selectedConversations = [];
        } else {
            // Select all
            this.state.selectedConversations = this.state.conversations.map(c => c.id);
        }
    }

    get allSelected() {
        return this.state.conversations.length > 0 &&
               this.state.selectedConversations.length === this.state.conversations.length;
    }

    get hasSelection() {
        return this.state.selectedConversations.length > 0;
    }

    // Bulk Delete
    async bulkDeleteChats() {
        if (!this.hasSelection) return;

        const count = this.state.selectedConversations.length;
        if (!confirm(`Are you sure you want to delete ${count} chat(s)? This cannot be undone.`)) {
            return;
        }

        try {
            for (const convId of this.state.selectedConversations) {
                await this._rpc(`/whatsapp/conversation/${convId}/delete`, {});
            }

            // Remove from list
            this.state.conversations = this.state.conversations.filter(
                c => !this.state.selectedConversations.includes(c.id)
            );

            // Clear selection
            if (this.state.activeConversation && this.state.selectedConversations.includes(this.state.activeConversation.id)) {
                this.state.activeConversation = null;
                this.state.messages = [];
            }

            this.exitSelectionMode();
            this.notification.add(`${count} chat(s) deleted`, { type: "success" });
        } catch (error) {
            console.error("Error deleting chats:", error);
            this.notification.add("Failed to delete some chats", { type: "danger" });
        }
    }

    // Bulk Archive
    async bulkArchiveChats() {
        if (!this.hasSelection) return;

        const count = this.state.selectedConversations.length;

        try {
            for (const convId of this.state.selectedConversations) {
                await this._rpc(`/whatsapp/conversation/${convId}/archive`, {});
            }

            // Remove from list (archived chats are hidden)
            this.state.conversations = this.state.conversations.filter(
                c => !this.state.selectedConversations.includes(c.id)
            );

            // Clear active if archived
            if (this.state.activeConversation && this.state.selectedConversations.includes(this.state.activeConversation.id)) {
                this.state.activeConversation = null;
                this.state.messages = [];
            }

            this.exitSelectionMode();
            this.notification.add(`${count} chat(s) archived`, { type: "success" });
        } catch (error) {
            console.error("Error archiving chats:", error);
            this.notification.add("Failed to archive some chats", { type: "danger" });
        }
    }

    // Bulk Pin/Star
    async bulkPinChats() {
        if (!this.hasSelection) return;

        const count = this.state.selectedConversations.length;

        try {
            for (const convId of this.state.selectedConversations) {
                await this._rpc(`/whatsapp/conversation/${convId}/pin`, {});
            }

            // Update local state
            for (const conv of this.state.conversations) {
                if (this.state.selectedConversations.includes(conv.id)) {
                    conv.is_pinned = !conv.is_pinned;
                }
            }

            this.exitSelectionMode();
            this.notification.add(`${count} chat(s) updated`, { type: "success" });
        } catch (error) {
            console.error("Error pinning chats:", error);
            this.notification.add("Failed to pin some chats", { type: "danger" });
        }
    }

    // Bulk Mute
    async bulkMuteChats() {
        if (!this.hasSelection) return;

        const count = this.state.selectedConversations.length;

        try {
            for (const convId of this.state.selectedConversations) {
                await this._rpc(`/whatsapp/conversation/${convId}/mute`, { duration: 'forever' });
            }

            // Update local state
            for (const conv of this.state.conversations) {
                if (this.state.selectedConversations.includes(conv.id)) {
                    conv.is_muted = true;
                }
            }

            this.exitSelectionMode();
            this.notification.add(`${count} chat(s) muted`, { type: "success" });
        } catch (error) {
            console.error("Error muting chats:", error);
            this.notification.add("Failed to mute some chats", { type: "danger" });
        }
    }

    // Mark as Read
    async bulkMarkAsRead() {
        if (!this.hasSelection) return;

        const count = this.state.selectedConversations.length;

        try {
            for (const convId of this.state.selectedConversations) {
                await this._rpc(`/whatsapp/conversation/${convId}/read`, {});
            }

            // Update local state
            for (const conv of this.state.conversations) {
                if (this.state.selectedConversations.includes(conv.id)) {
                    conv.unread_count = 0;
                }
            }

            this.exitSelectionMode();
            this.notification.add(`${count} chat(s) marked as read`, { type: "success" });
        } catch (error) {
            console.error("Error marking as read:", error);
            this.notification.add("Failed to mark some chats as read", { type: "danger" });
        }
    }

    // Voice Call
    startVoiceCall() {
        if (!this.state.activeConversation) return;
        const phone = this.state.activeConversation.phone;
        const name = this.state.activeConversation.display_name;

        if (this.state.activeConversation.is_group) {
            this.notification.add("Voice calls are not available for groups", { type: "warning" });
            return;
        }

        this.notification.add(`Opening WhatsApp to call ${name}...`, { type: "info" });
        window.open(`https://wa.me/${phone}`, '_blank');
    }

    // Video Call
    startVideoCall() {
        if (!this.state.activeConversation) return;
        const phone = this.state.activeConversation.phone;
        const name = this.state.activeConversation.display_name;

        if (this.state.activeConversation.is_group) {
            this.notification.add("Video calls are not available for groups", { type: "warning" });
            return;
        }

        this.notification.add(`Opening WhatsApp to video call ${name}...`, { type: "info" });
        window.open(`https://wa.me/${phone}`, '_blank');
    }
}

registry.category("actions").add("whatsapp_discuss", WhatsAppDiscuss);

export default WhatsAppDiscuss;