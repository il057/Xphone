import { db, apiLock, getActiveApiProfile, uploadImage } from './db.js';
import * as spotifyManager from './spotifyManager.js';
import { runOfflineSimulation } from './simulationEngine.js';
import { updateRelationshipScore } from './simulationEngine.js';
import { showUploadChoiceModal, showCallActionModal, promptForInput, showImageActionModal } from './ui-helpers.js';
import { showToast, showToastOnNextPage, showRawContentModal, showConfirmModal } from './ui-helpers.js';

// --- State and Constants ---
const urlParams = new URLSearchParams(window.location.search);
const charId = urlParams.get('id');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 为聊天室创建一个专用的、支持多选的文件输入框
const multiImageInput = document.createElement('input');
multiImageInput.type = 'file';
multiImageInput.accept = 'image/*';
multiImageInput.multiple = true; // 关键：允许选择多个文件
multiImageInput.style.display = 'none';
document.body.appendChild(multiImageInput);


const INITIAL_LOAD_COUNT = 30;
const LOAD_MORE_COUNT = 20;
let renderedMessages = [];
let isLoadingMore = false;
let isInitialLoad = true;

let currentChat;
let apiConfig;
let currentThemeSource = 'user'; // 'user' or 'ai'
let isGroupChat = false; // 添加一个全局变量来标识是否为群聊
let currentShuffleState = false;
let customPresets = [];

let isSelectionMode = false;
let selectedMessages = new Set();
let activeMessageMenu = {
        element: null,
        timestamp: null,
};

let currentReplyContext = null;

let globalSettings;
let personaPresets;
let activeUserPersona;

let customBubbleStyleTag = null;

// call 
let isCallActive = false;
let callType = null; // 'voice' or 'video'
let callStartTime = null;
let callTimerInterval = null;
let isAiRespondingInCall = false;
let currentCallTranscript = [];
let callParticipants = [];
let callInitiator = null;
let incomingCallOffer = null; // 用于存储来电信息 {type, from}
let outgoingCallState = null; // 用于存储去电状态 {type, pending}

// --- DOM Elements ---
const chatContainer = document.getElementById('chat-container');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const charNameHeader = document.getElementById('char-name-header');
const charProfileLink = document.getElementById('char-profile-link');
const messageActionsMenu = document.getElementById('message-actions-menu');
const selectionHeader = document.getElementById('selection-header');
const defaultHeader = document.querySelector('header > div:not(#selection-header)');
const cancelSelectionBtn = document.getElementById('cancel-selection-btn');
const deleteSelectionBtn = document.getElementById('delete-selection-btn');
const selectionCount = document.getElementById('selection-count');
const replyPreviewBar = document.getElementById('reply-preview-bar');
const chatInputArea = document.querySelector('footer');
const lockOverlay = document.getElementById('chat-lock-overlay');
const lockContent = document.getElementById('chat-lock-content');
// 音乐
const listenTogetherBtn = document.getElementById('listen-together-btn');
const playlistModal = document.getElementById('playlist-modal');
const playlistSelectionContainer = document.getElementById('playlist-selection-container');
const playlistCancelBtn = document.getElementById('playlist-cancel-btn');

const musicPlayerBar = document.getElementById('music-player-bar');
const playerSongTitle = document.getElementById('player-song-title');
const playerSongArtist = document.getElementById('player-song-artist');
const playerProgressBar = document.getElementById('player-progress-bar');
const playerPrevBtn = document.getElementById('player-prev-btn');
const playerToggleBtn = document.getElementById('player-toggle-btn');
const playerNextBtn = document.getElementById('player-next-btn');
let shuffleBtn = document.getElementById('player-shuffle-btn');

let playerUpdateInterval = null;
let currentlyPlayingUri = null;

// 表情
const toggleStickerPanelBtn = document.getElementById('toggle-sticker-panel-btn');
const stickerPanel = document.getElementById('sticker-panel');
const stickerPanelGrid = document.getElementById('sticker-panel-grid');

const bubbleThemes = [
        { name: '默认', value: 'default', colors: { userBg: '#dcf8c6', userText: '#000000', aiBg: '#e9e9e9', aiText: '#000000' } },
        { name: '粉蓝', value: 'pink_blue', colors: { userBg: '#eff7ff', userText: '#263a4e', aiBg: '#fff0f6', aiText: '#432531' } },
        { name: '蓝白', value: 'blue_white', colors: { userBg: '#eff7ff', userText: '#263a4e', aiBg: '#f8f9fa', aiText: '#383d41' } },
        { name: '紫黄', value: 'purple_yellow', colors: { userBg: '#fffde4', userText: '#5C4033', aiBg: '#faf7ff', aiText: '#827693' } },
        { name: '黑白', value: 'black_white', colors: { userBg: '#343a40', userText: '#f8f9fa', aiBg: '#f8f9fa', aiText: '#343a40' } },
];

let groupMemberDetailsMap = new Map();

// --- 通话界面DOM元素 ---
const callScreenModal = document.getElementById('call-screen-modal');
const callInfo = document.getElementById('call-info');
const callAvatar = document.getElementById('call-avatar');
const callName = document.getElementById('call-name');
const callStatus = document.getElementById('call-status');
const videoContentArea = document.getElementById('video-content-area');
const videoDescriptionBox = document.getElementById('video-description-box');
const videoDialogueBox = document.getElementById('video-dialogue-box');
const callInputContainer = document.getElementById('call-input-container');
const callInputForm = document.getElementById('call-input-form');
const callInput = document.getElementById('call-input');
const hangUpBtn = document.getElementById('hang-up-btn');
const voiceContentArea = document.getElementById('voice-content-area');
const incomingCallModal = document.getElementById('incoming-call-modal');
const incomingCallAvatar = document.getElementById('incoming-call-avatar');
const incomingCallName = document.getElementById('incoming-call-name');
const incomingCallStatus = document.getElementById('incoming-call-status');
const rejectIncomingCallBtn = document.getElementById('reject-incoming-call-btn');
const acceptIncomingCallBtn = document.getElementById('accept-incoming-call-btn');

function toMillis(t) {
        return new Date(t).getTime();
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', init); // Call the main init function

async function init() {

        const backBtn = document.getElementById('back-btn');

        if (document.referrer.includes('charEditProfile.html')) {
                // 如果是从编辑页来的，就强制返回到联系人列表
                backBtn.href = 'contacts.html';
        } else if (document.referrer.includes('contactsPicker.html')) {
                backBtn.href = 'contacts.html';
        } else {
                // 否则，使用默认的浏览器后退功能
                backBtn.href = 'javascript:history.back()';
        }

        if (!charId || charId.trim() === '') {
                showToastOnNextPage('无效或缺失的角色ID，将返回主页。', 'error');
                window.location.href = 'index.html'; // 跳转到一个安全的页面
                return; // 立即停止执行，防止后续代码出错
        }

        // Fetch all necessary data in parallel
        [currentChat, apiConfig, globalSettings, personaPresets, customPresets] = await Promise.all([
                db.chats.get(charId),
                getActiveApiProfile(),
                db.globalSettings.get('main'),
                db.personaPresets.toArray(),
                db.bubbleThemePresets.toArray()
        ]);

        if (!currentChat) {
                showToastOnNextPage('找不到角色数据', 'error');
                window.location.href = 'index.html';
                return;
        }

        if (currentChat.unreadCount && currentChat.unreadCount > 0) {
                currentChat.unreadCount = 0;
                await db.chats.put(currentChat);
        }

        let foundPersona = null;

        if (personaPresets) {
                // 1. Highest Priority: Check for a persona applied directly to this chat ID.
                foundPersona = personaPresets.find(p => p.appliedChats && p.appliedChats.includes(charId));

                // 2. Second Priority: If not found, check if this chat's group has a persona applied.
                if (!foundPersona && currentChat.groupId) {
                        const groupIdStr = String(currentChat.groupId);
                        foundPersona = personaPresets.find(p => p.appliedChats && p.appliedChats.includes(groupIdStr));
                }

                // 3. Third Priority: Fallback to the global default persona.
                if (!foundPersona && globalSettings && globalSettings.defaultPersonaId) {
                        foundPersona = personaPresets.find(p => p.id === globalSettings.defaultPersonaId);
                }
        }
        activeUserPersona = foundPersona; // Set the active persona for this session.
        // We no longer save myPersona or myAvatar to the chat object.

        isGroupChat = currentChat.isGroup;

        if (isGroupChat && currentChat.members.length > 0) {
                const memberDetails = await db.chats.bulkGet(currentChat.members);
                groupMemberDetailsMap = new Map(memberDetails.filter(Boolean).map(m => [m.id, m]));
        }

        // Call setup functions only once
        setupUI();
        renderMessages();
        setupEventListeners();
        setupPlayerControls();

        const savedCallStateJSON = sessionStorage.getItem('activeCallState');
        if (savedCallStateJSON) {
                const savedCallState = JSON.parse(savedCallStateJSON);
                // 确认保存的状态是属于当前这个角色的
                if (savedCallState.charId === charId) {
                        console.log("检测到未结束的通话，正在恢复...");
                        applyCallScreenTheme();
                        // 恢复所有JS变量

                        isCallActive = true;
                        callType = savedCallState.callType;
                        callStartTime = savedCallState.callStartTime;
                        currentCallTranscript = savedCallState.transcript || [];

                        // 重新显示通话UI (这部分代码基本是从 connectCall 复制过来的)
                        callInputContainer.classList.remove('hidden');
                        callInput.disabled = false;
                        callScreenModal.classList.remove('hidden');
                        callAvatar.src = currentChat.settings.aiAvatar || '...';
                        callName.textContent = currentChat.name;

                        if (callType === 'video') {
                                videoContentArea.classList.remove('hidden');
                                videoDescriptionBox.innerHTML = ''; // 清空旧内容
                                videoDialogueBox.innerHTML = '';
                        } else {
                                voiceContentArea.classList.remove('hidden');
                                voiceContentArea.innerHTML = '';
                        }

                        // 恢复并继续计时器
                        updateCallTimer(); // 立即更新一次时间显示
                        callTimerInterval = setInterval(updateCallTimer, 1000);

                        // 恢复通话记录的显示
                        currentCallTranscript.forEach(msg => {
                                if (msg.role === 'user') {
                                        if (callType === 'video') {
                                                videoDialogueBox.innerHTML += `<p class="text-left"><span class="bg-blue-500/50 px-2 py-1 rounded-lg">${msg.content}</span></p>`;
                                        } else {
                                                voiceContentArea.innerHTML += `<p class="text-left"><span class="text-blue-300 font-semibold">你:</span> ${msg.content}</p>`;
                                        }
                                } else if (msg.role === 'assistant') {
                                        if (callType === 'video') {
                                                videoDialogueBox.innerHTML += `<p class="text-left"><span class="bg-gray-600/50 px-2 py-1 rounded-lg">${msg.content}</span></p>`;
                                        } else {
                                                voiceContentArea.innerHTML += `<p class="text-left"><span class="font-semibold">${currentChat.name}:</span> ${msg.content}</p>`;
                                        }
                                }
                        });

                        if (callType === 'video') videoDialogueBox.scrollTop = videoDialogueBox.scrollHeight;
                        if (callType === 'voice') voiceContentArea.scrollTop = voiceContentArea.scrollHeight;

                }
        }

        //在所有UI设置好之后，检查并处理离线事件
        await handleChatEntryLogic();
}

// --- UI and Rendering Functions ---


/**
 * 计算一个HEX颜色的亮度 (0 for black, 1 for white).
 * @param {string} hex - The hex color string.
 * @returns {number} - Luminance value between 0 and 1.
 */
function getLuminance(hex) {
        if (!hex || !hex.startsWith('#') || hex.length < 7) return 0;
        const r = parseInt(hex.substring(1, 3), 16);
        const g = parseInt(hex.substring(3, 5), 16);
        const b = parseInt(hex.substring(5, 7), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * 智能地将颜色变深或变浅。
 * 如果基础色太深，则强制变亮；否则按百分比变深。
 * @param {string} color - The base hex color.
 * @param {number} percent - The percentage to change by (e.g., -40 to darken, 40 to lighten).
 * @returns {string} - The adjusted hex color.
 */
function shadeColor(color, percent) {
        if (!color || !color.startsWith('#')) return '#888888';

        const luminance = getLuminance(color);
        let effectivePercent = percent;

        // 阈值判断：如果颜色本身很深 (luminance < 0.2)，并且我们想让它更深 (percent < 0)
        // 这时反向操作，让它变亮，以保证可见性。
        if (luminance < 0.2 && percent < 0) {
                effectivePercent = -percent * 1.5; // e.g., -40 becomes +60
        }
        // 您也可以为亮色添加一个阈值，但目前这个已能解决主要问题

        let R = parseInt(color.substring(1, 3), 16);
        let G = parseInt(color.substring(3, 5), 16);
        let B = parseInt(color.substring(5, 7), 16);
        R = parseInt(R * (100 + effectivePercent) / 100);
        G = parseInt(G * (100 + effectivePercent) / 100);
        B = parseInt(B * (100 + effectivePercent) / 100);
        R = Math.min(R, 255);
        G = Math.min(G, 255);
        B = Math.min(B, 255);
        const RR = R.toString(16).padStart(2, '0');
        const GG = G.toString(16).padStart(2, '0');
        const BB = B.toString(16).padStart(2, '0');

        return "#" + RR + GG + BB;
}


async function setupUI() {
        charNameHeader.textContent = currentChat.name || currentChat.realName;
        charProfileLink.href = `charProfile.html?id=${charId}`;
        // Load backgroud
        const chatContainerElement = document.getElementById('chat-container');
        if (currentChat.settings.background) {
                // 如果设置了背景图URL，则应用它
                chatContainerElement.style.backgroundImage = `url('${currentChat.settings.background}')`;
                chatContainerElement.style.backgroundSize = 'cover';
                chatContainerElement.style.backgroundPosition = 'center';
        } else {
                // 否则，确保没有背景图（恢复默认）
                chatContainerElement.style.backgroundImage = 'none';
        }
        // Load saved theme preference
        const savedTheme = localStorage.getItem('chatAccentThemeSource');
        if (savedTheme === 'ai' || savedTheme === 'user') {
                currentThemeSource = savedTheme;
        }

        if (isGroupChat) {
                charNameHeader.textContent = `${currentChat.name} (${currentChat.members.length + 1})`;
                // 将右上角按钮改为直接进入编辑界面
                charProfileLink.href = `charEditProfile.html?id=${charId}`; // 指向新的群设置页面
                document.getElementById('transfer-btn').title = "发红包";
                document.getElementById('status-container').style.display = 'none';
                document.getElementById('start-call-btn').classList.add('hidden');
        } else {
                charNameHeader.textContent = currentChat.name || currentChat.realName;
                charProfileLink.href = `charProfile.html?id=${charId}`;
                document.getElementById('transfer-btn').title = "转账";
        }

        await applyThemeAndStyles(currentChat.settings.theme, currentChat.settings.customBubbleCss);
        handleChatLock();
        updateHeaderStatus();
}

async function applyThemeAndStyles(theme, customCss) {
        if (customBubbleStyleTag) {
                customBubbleStyleTag.remove();
                customBubbleStyleTag = null;
        }

        if (customCss && customCss.trim() !== '') {
                const usesThemeVariables = /var\(--(user-bubble-bg|ai-bubble-bg|accent-color)\)/.test(customCss);

                if (usesThemeVariables) {
                        applyTheme(theme);
                } else {
                        console.warn("自定义气泡CSS未使用主题变量，将回退到全局主题色。");
                        // 现在 await 会正常工作
                        const globalSettings = await db.globalSettings.get('main');
                        const globalThemeColor = globalSettings?.themeColor || '#3b82f6';
                        const fallbackTheme = {
                                userBg: globalThemeColor, userText: '#ffffff',
                                aiBg: '#f0f2f5', aiText: '#000000'
                        };
                        applyTheme(fallbackTheme);
                }

                const scopedCss = customCss
                        .replace(/\.message-bubble\.user\s*\.content/g, '.chat-bubble.user-bubble')
                        .replace(/\.message-bubble\.ai\s*\.content/g, '.chat-bubble.ai-bubble')
                        .replace(/\.message-bubble\s*\.content/g, '.chat-bubble');

                customBubbleStyleTag = document.createElement('style');
                customBubbleStyleTag.id = 'custom-bubble-style';
                customBubbleStyleTag.textContent = scopedCss;
                document.head.appendChild(customBubbleStyleTag);

        } else {
                applyTheme(theme);
        }
}


function applyTheme(theme) {
        let themeColors;
        const defaultColors = { userBg: '#dcf8c6', userText: '#000000', aiBg: '#ffffff', aiText: '#000000' };

        if (typeof theme === 'object' && theme !== null) {
                // 优先级1: 如果是对象，直接使用
                themeColors = theme;
        } else if (typeof theme === 'string') {
                // 优先级2: 如果是字符串，则在预设主题和自定义主题中查找
                const preset = bubbleThemes.find(t => t.value === theme) || customPresets.find(p => p.name === theme);
                themeColors = preset ? preset.colors : defaultColors;
        } else {
                // 优先级3: 如果为空或无效，使用默认值
                themeColors = defaultColors;
        }

        const root = document.documentElement;
        root.style.setProperty('--user-bubble-bg', themeColors.userBg);
        root.style.setProperty('--user-bubble-text', themeColors.userText);
        root.style.setProperty('--ai-bubble-bg', themeColors.aiBg);
        root.style.setProperty('--ai-bubble-text', themeColors.aiText);

        setAccentColor(); // Set the initial accent color
}


function setAccentColor() {
        const root = document.documentElement;
        const userBubbleBg = root.style.getPropertyValue('--user-bubble-bg');
        const aiBubbleBg = root.style.getPropertyValue('--ai-bubble-bg');

        const accentColor = (currentThemeSource === 'ai') ? aiBubbleBg.trim() : userBubbleBg.trim();

        root.style.setProperty('--accent-color', accentColor);

        // 1. 使用新的智能 shadeColor 计算出用于图标的颜色
        const themedIconColor = shadeColor(accentColor, -40);

        // 2. 将颜色应用到 Header 的元素上
        const backBtnHeader = document.querySelector('header a.header-btn');
        const profileBtnHeader = document.getElementById('char-profile-link');
        if (backBtnHeader) backBtnHeader.style.color = themedIconColor;
        if (profileBtnHeader) profileBtnHeader.style.color = themedIconColor;
        charNameHeader.style.color = themedIconColor;

        // 3. 将颜色应用到底部所有操作图标上
        sendBtn.style.color = themedIconColor;
        const actionButtons = document.querySelectorAll('#chat-input-actions-top .action-btn, #wait-reply-btn');
        actionButtons.forEach(btn => {
                btn.style.color = themedIconColor;
        });

        // 4. 更新之前创建的动态样式，以确保悬停(hover)时颜色正确
        let hoverStyleElement = document.getElementById('dynamic-hover-style');
        if (!hoverStyleElement) {
                hoverStyleElement = document.createElement('style');
                hoverStyleElement.id = 'dynamic-hover-style';
                document.head.appendChild(hoverStyleElement);
        }
        hoverStyleElement.innerHTML = `
        .action-btn:hover { color: ${themedIconColor} !important; }
        .action-btn:hover svg { color: ${themedIconColor} !important; }
    `;
        const replyBar = document.getElementById('reply-preview-bar');
        if (replyBar) replyBar.style.borderLeftColor = accentColor;

}

function renderMessages() {
        isInitialLoad = true;
        chatContainer.innerHTML = '';
        // Filter out hidden messages from the history
        const visibleHistory = (currentChat.history || []).filter(msg => !msg.isHidden);

        // Get the last 30 messages for the initial load
        renderedMessages = visibleHistory.slice(-INITIAL_LOAD_COUNT);

        // This creates a flex container for our new message wrappers
        const flexContainer = document.createElement('div');
        flexContainer.className = 'flex flex-col message-content-column space-y-4 items-start';

        renderedMessages.forEach(msg => {
                const bubbleWrapper = createBubble(msg);
                if (bubbleWrapper) flexContainer.appendChild(bubbleWrapper);
        });


        chatContainer.appendChild(flexContainer);
        // Scroll to the bottom on initial load
        scrollToBottom(true);
        isInitialLoad = false;
}

function appendMessage(msg) {
        if (msg.isHidden) return;

        // Add message to our rendered list
        renderedMessages.push(msg);

        // 查找flex容器，如果不存在则创建一个
        let flexContainer = chatContainer.querySelector('.message-content-column');
        if (!flexContainer) {
                flexContainer = document.createElement('div');
                flexContainer.className = 'flex flex-col message-content-column space-y-4 items-start';
                chatContainer.appendChild(flexContainer);
        }

        const bubbleWrapper = createBubble(msg);
        if (bubbleWrapper) {
                flexContainer.appendChild(bubbleWrapper);
                scrollToBottom(); // 添加新消息后立即滚动到底部
        }
}

async function loadMoreMessages() {
        if (isLoadingMore) return;

        const visibleHistory = (currentChat.history || []).filter(msg => !msg.isHidden);
        // Check if all messages are already rendered
        if (renderedMessages.length >= visibleHistory.length) {
                console.log("All messages loaded.");
                // Add a UI element indicating the top of the chat
                if (!chatContainer.querySelector('.chat-start-indicator')) {
                        const startIndicator = document.createElement('p');
                        startIndicator.textContent = "对话开始";
                        startIndicator.className = "chat-start-indicator text-center text-xs text-gray-400 py-4";
                        chatContainer.prepend(startIndicator);
                }
                return;
        }

        isLoadingMore = true;

        const flexContainer = chatContainer.querySelector('.message-content-column');
        const firstMessageNode = flexContainer.firstChild;
        const oldScrollHeight = chatContainer.scrollHeight;

        const currentTopMessageTimestamp = toMillis(renderedMessages[0].timestamp);
        const topMessageIndex = visibleHistory.findIndex(m => toMillis(m.timestamp) === currentTopMessageTimestamp);

        const startIndex = Math.max(0, topMessageIndex - LOAD_MORE_COUNT);
        const newMessages = visibleHistory.slice(startIndex, topMessageIndex);

        // Prepend new messages to the rendered list and the DOM
        renderedMessages.unshift(...newMessages);

        for (let i = newMessages.length - 1; i >= 0; i--) {
                const bubbleWrapper = createBubble(newMessages[i]);
                if (bubbleWrapper) {
                        flexContainer.prepend(bubbleWrapper);
                }
        }

        // Restore scroll position to prevent jarring jumps
        chatContainer.scrollTop = chatContainer.scrollHeight - oldScrollHeight;

        isLoadingMore = false;
}

chatContainer.addEventListener('scroll', () => {
        if (chatContainer.scrollTop < 100 && !isLoadingMore) {
                loadMoreMessages();
        }
});

function createBubble(msg) {
        const isSystemMessage = msg.type === 'system_message';
        const isUser = msg.role === 'user';

        // --- Main Wrapper (Now wraps ALL message types) ---
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${isUser ? 'user' : (isSystemMessage ? 'system' : 'ai')}`;
        if (isSystemMessage) {
                // Special class for centering system messages
                wrapper.classList.add('justify-center', 'w-full', 'max-w-full');
        }
        wrapper.dataset.timestamp = toMillis(msg.timestamp);



        // --- Selection Checkbox (conditionally visible) ---
        if (isSelectionMode && !isSystemMessage) {
                wrapper.classList.add('selection-mode');
                const checkbox = document.createElement('div');
                checkbox.className = 'selection-checkbox';
                wrapper.appendChild(checkbox);
                if (selectedMessages.has(toMillis(msg.timestamp))) {
                        wrapper.classList.add('selected');
                }
        }

        // System messages don't have the complex bubble structure
        if (isSystemMessage) {
                const systemBubble = document.createElement('div');
                systemBubble.className = 'system-message';
                systemBubble.textContent = msg.content;
                wrapper.appendChild(systemBubble);
        } else {

                const innerWrapper = document.createElement('div');
                innerWrapper.className = 'message-content-group flex items-end gap-2';

                const avatar = document.createElement('img');
                avatar.className = 'avatar';
                if (isUser) {
                        avatar.src = activeUserPersona?.avatar || 'https://files.catbox.moe/kkll8p.svg';
                } else if (isGroupChat) {
                        const member = groupMemberDetailsMap.get(msg.senderId);
                        // 注意：头像路径在 settings.aiAvatar 中
                        avatar.src = member ? member.settings.aiAvatar : 'https://files.catbox.moe/kkll8p.svg';
                } else {
                        avatar.src = currentChat.settings.aiAvatar || 'https://files.catbox.moe/kkll8p.svg';
                }

                // --- Content Container (for name, bubble, etc.) ---
                const contentAndNameContainer = document.createElement('div');
                contentAndNameContainer.className = 'flex flex-col message-content-column';

                // --- Sender Name (for group chats) ---
                if (isGroupChat && !isUser) {
                        const member = groupMemberDetailsMap.get(msg.senderId);
                        const senderNameDisplay = member ? (member.name || member.realName) : (msg.senderName || '未知成员');
                        const senderName = document.createElement('div');
                        senderName.className = 'text-xs text-gray-500 mb-1';
                        senderName.textContent = senderNameDisplay;
                        contentAndNameContainer.appendChild(senderName);
                }

                // --- Bubble ---
                const bubble = document.createElement('div');
                bubble.className = `chat-bubble ${isUser ? 'user-bubble' : 'ai-bubble'}`;
                // --- Quoted Message ---
                if (msg.quote) {
                        const quoteDiv = document.createElement('div');
                        quoteDiv.className = 'quoted-message';

                        // Determine the background color based on who sent the main message
                        const baseColor = isUser
                                ? getComputedStyle(document.documentElement).getPropertyValue('--user-bubble-bg').trim()
                                : getComputedStyle(document.documentElement).getPropertyValue('--ai-bubble-bg').trim();

                        // Use shadeColor to get a slightly different background
                        quoteDiv.style.backgroundColor = shadeColor(baseColor, -15);

                        quoteDiv.innerHTML = `
                <div class="quoted-sender">回复 ${msg.quote.senderName}:</div>
                <div class="quoted-content">${msg.quote.content}</div>
            `;
                        bubble.appendChild(quoteDiv);
                }

                // --- Main Content (switch statement) ---
                const contentDiv = document.createElement('div'); // A container for the actual content
                const messageType = msg.type || 'text';
                switch (messageType) {
                        case 'text':
                                contentDiv.textContent = msg.content;
                                break;
                        case 'image_url':
                                bubble.classList.add('is-sticker'); // 复用表情的样式，因为它也是无背景的图片
                                contentDiv.innerHTML = `<img src="${msg.content}" alt="用户发送的图片" class="sticker-image rounded-lg" style="max-height: 200px; max-width: 200px;">`;
                                break;

                        case 'sticker':
                                bubble.classList.add('is-sticker');
                                contentDiv.innerHTML = `<img src="${msg.content}" alt="${msg.meaning || 'sticker'}" class="sticker-image">`;
                                break;
                        case 'transfer':
                                bubble.classList.add('is-transfer');

                                // 判断转账状态
                                const isPendingAI = msg.role === 'assistant' && msg.status !== 'claimed' && msg.status !== 'declined';
                                const isClaimed = msg.status === 'claimed';
                                const isDeclined = msg.status === 'declined';

                                let statusHTML = '';
                                if (isClaimed) statusHTML = `<div class="transfer-note border-t border-opacity-20 mt-2 pt-2">已收款</div>`;
                                if (isDeclined) statusHTML = `<div class="transfer-note border-t border-opacity-20 mt-2 pt-2">已拒绝</div>`;

                                contentDiv.innerHTML = `
                <div class="transfer-card" style="background-color: var(--user-bubble-bg); color: var(--user-bubble-text);" ${isPendingAI ? `data-transfer-timestamp="${toMillis(msg.timestamp)}"` : ''}>
                    <div class="transfer-title">▶ 转账</div>
                    <div class="transfer-amount">¥ ${Number(msg.amount).toFixed(2)}</div>
                    ${msg.note ? `<div class="transfer-note border-t border-opacity-20 mt-2 pt-2">${msg.note}</div>` : ''}
                    ${statusHTML}
                </div>`;
                                break;

                        case 'red_packet':
                                bubble.classList.add('is-red-packet');
                                const packetTypeText = msg.packetType === 'direct' ? `专属红包: 给 ${msg.receiverName}` : '拼手气红包';
                                contentDiv.innerHTML = `
                    <div class="red-packet-card">
                        <div class="rp-header">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3.75v16.5M2.25 12h19.5M6.375 17.25a4.875 4.875 0 0 0 4.875-4.875V12m6.375 5.25a4.875 4.875 0 0 1-4.875-4.875V12m-9 8.25h16.5a1.5 1.5 0 0 0 1.5-1.5V5.25a1.5 1.5 0 0 0-1.5-1.5H3.75a1.5 1.5 0 0 0-1.5 1.5v13.5a1.5 1.5 0 0 0 1.5 1.5Zm12.621-9.44c-1.409 1.41-4.242 1.061-4.242 1.061s-.349-2.833 1.06-4.242a2.25 2.25 0 0 1 3.182 3.182ZM10.773 7.63c1.409 1.409 1.06 4.242 1.06 4.242S9 12.22 7.592 10.811a2.25 2.25 0 1 1 3.182-3.182Z" /></svg>
                            <span class="rp-greeting">${msg.greeting || '恭喜发财，大吉大利！'}</span>
                        </div>
                        <div class="rp-type">${packetTypeText}</div>
                    </div>
                `;

                                break;
                        case 'text_photo':
                                bubble.classList.add('is-image');
                                bubble.textContent = `[图片]: "${msg.content}"`;
                                break;

                        case 'share_link':
                                bubble.classList.add('is-link-share');
                                contentDiv.innerHTML = `
                <div class="link-share-card">
                    <div class="title">${msg.title || '无标题'}</div>
                    ${msg.description ? `<div class="description">${msg.description}</div>` : ''}
                    <div class="footer"><span>${msg.source_name || '链接分享'}</span></div>
                </div>`;
                                break;
                        case 'voice_message':
                                bubble.classList.add('is-voice-message');
                                const duration = Math.max(1, Math.round((msg.content || '').length / 5));

                                // 新的布局：上方是波形，下方是文字
                                contentDiv.innerHTML = `
                    <div class="p-2">
                        <div class="voice-message-body p-0">
                            <div class="voice-waveform">${'<div></div>'.repeat(5)}</div>
                            <span class="voice-duration">${duration}"</span>
                        </div>
                    </div>
                    <div class="border-t border-black border-opacity-10 px-3 py-2 text-sm">
                        ${msg.content}
                    </div>
                `;
                                break;
                        case 'audio_message':
                                // 这是新的、带播放器的语音消息样式
                                bubble.classList.add('is-audio-message'); // 可以为此类型定义新样式
                                contentDiv.innerHTML = `
                <audio controls src="${msg.content}" class="w-full"></audio>
                <div class="border-t border-black border-opacity-10 px-3 py-2 text-sm mt-2">
                    ${msg.transcript}
                </div>
            `;
                                // 阻止长按菜单，避免误操作
                                bubble.addEventListener('contextmenu', e => e.preventDefault());
                                break;
                        case 'waimai_request':
                                bubble.classList.add('is-waimai-request');
                                const isPending = msg.status === 'pending';
                                const isPaid = msg.status === 'paid';
                                const isRejected = msg.status === 'rejected';

                                let statusText = '';
                                if (isPaid) statusText = `✅ 已由 ${msg.paidBy} 买单`;
                                if (isRejected) statusText = `❌ 请求已被拒绝`;

                                const showActionButtons = isPending && msg.role === 'assistant';

                                contentDiv.innerHTML = `
                <div class="waimai-card ${isPaid ? 'paid' : ''} ${isRejected ? 'rejected' : ''}" data-waimai-timestamp="${toMillis(msg.timestamp)}">
                    <div class="waimai-header">
                        <img src="https://files.catbox.moe/mq179k.png" class="icon">
                        <span>外卖请求</span>
                    </div>
                    <div class="waimai-main">
                        <div class="request-title">来自 ${msg.senderName} 的代付请求</div>
                        <div class="payment-box" style="display: ${isPending ? 'block' : 'none'};">
                            <div class="payment-label">商品: ${msg.productInfo}</div>
                            <div class="amount">¥${Number(msg.amount).toFixed(2)}</div>
                        </div>
                        <div class="status-text" style="display: ${isPending ? 'none' : 'block'};">${statusText}</div>
                    </div>
                    <div class="waimai-user-actions" style="display: ${showActionButtons ? 'flex' : 'none'};">
                        <button class="waimai-decline-btn" data-choice="rejected">残忍拒绝</button>
                        <button class="waimai-pay-btn" data-choice="paid">为Ta买单</button>
                    </div>
                </div>
                `;
                                break;


                }
                bubble.appendChild(contentDiv);
                contentAndNameContainer.appendChild(bubble);
                // --- Timestamp ---
                const timestamp = document.createElement('span');
                timestamp.className = 'timestamp';
                timestamp.textContent = new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

                wrapper.appendChild(avatar);
                wrapper.appendChild(contentAndNameContainer);
                wrapper.appendChild(innerWrapper);
                wrapper.appendChild(timestamp);

        }


        return wrapper;
}

function convertMessageForAI(msg) {
        if (msg.role === 'user') {
                switch (msg.type) {
                        case 'image_url':
                                // AI无法直接处理URL，我们返回一个描述性文本
                                return `[用户发送了一张图片]`;
                        case 'text_photo':
                                return `[用户发送了图片，描述是: "${msg.content}"]`;
                        case 'voice_message':
                                return `[用户发送了语音，内容是: "${msg.content}"]`;
                        case 'transfer':
                                return `[用户发起了转账，金额¥${msg.amount}，备注: "${msg.note || '无'}"] {timestamp: ${toMillis(msg.timestamp)}}`;
                        case 'share_link':
                                return `[用户分享了链接，标题: "${msg.title}"]`;
                        case 'sticker':
                                return `[用户发送了表情，描述是: "${msg.meaning}"]`;
                        case 'waimai_request':
                                return `[用户发起了外卖代付请求，希望你为“${msg.productInfo}”支付¥${Number(msg.amount).toFixed(2)}] {timestamp: ${toMillis(msg.timestamp)}}`;
                        case 'red_packet':
                                const packetType = msg.packetType === 'direct' ? `一个专属红包给 ${msg.receiverName}` : '一个拼手气红包';
                                return `[用户 ${msg.senderName || '我'} 发送了${packetType}，祝福语是：“${msg.greeting || '恭喜发财'}”] {timestamp: ${toMillis(msg.timestamp)}}`;
                        default:
                                return msg.content;
                }
        }
        // For assistant messages, we assume content is already text.
        return msg.content;
}


function scrollToBottom(force = false) {
        // During lazy loading, we don't want to auto-scroll unless forced (e.g., initial load)
        if (!force && isInitialLoad) return;

        chatContainer.scrollTop = chatContainer.scrollHeight;
}

// --- Event Listeners Setup ---

async function setupEventListeners() {
        chatInput.addEventListener('input', () => {
                // This fixes the blank space issue by adjusting padding when the textarea resizes.
                sendBtn.disabled = chatInput.value.trim() === '';
                chatInput.style.height = 'auto';
                chatInput.style.height = (chatInput.scrollHeight) + 'px';
        });

        chatForm.addEventListener('submit', handleSendMessage);

        chatInput.addEventListener('keydown', (e) => {
                // 检查是否只按了 Enter 键 (没有同时按 Shift)
                if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault(); // 阻止默认的回车换行行为
                        // 使用 requestSubmit() 来触发表单的 'submit' 事件，
                        // 这样我们的 handleSendMessage 函数就会被调用。
                        chatForm.requestSubmit();
                }
        });



        document.getElementById('wait-reply-btn').addEventListener('click', getAiResponse);
        document.getElementById('generate-call-response-btn').addEventListener('click', () => {
                // 如果AI正在响应，则不执行任何操作
                if (isAiRespondingInCall) return;

                getAiResponse();
        });
        // Action Buttons
        document.getElementById('send-media-btn').addEventListener('click', async () => {
                const choice = await showImageActionModal();
                if (!choice) return;

                switch (choice.type) {
                        case 'local':
                                // 触发隐藏的文件输入框，此后的逻辑与之前相同
                                multiImageInput.click();
                                break;
                        case 'description':
                                // 调用已有的函数来处理图片描述
                                handlePromptAndSend('发送图片描述', '请描述图片内容...', 'text_photo');
                                break;
                        case 'url':
                                // 弹出输入框让用户粘贴URL
                                const imageUrl = await promptForInput('发送图片URL', '请输入图片网址...', false, false);
                                if (imageUrl) {
                                        const message = { role: 'user', type: 'image_url', content: imageUrl, timestamp: Date.now() };
                                        await addUserMessageToDb(message, false);
                                }
                                break;
                }
        });
        // 为我们的多选输入框绑定上传处理函数
        multiImageInput.addEventListener('change', handleMultiImageUpload);

        document.getElementById('voice-message-btn').addEventListener('click', () => handlePromptAndSend('发送语音', '请输入语音文字...', 'voice_message'));

        // Theme Toggle
        document.getElementById('theme-toggle-btn').addEventListener('click', () => {
                currentThemeSource = currentThemeSource === 'user' ? 'ai' : 'user';
                localStorage.setItem('chatAccentThemeSource', currentThemeSource);
                setAccentColor();
        });

        // Transfer
        document.getElementById('transfer-btn').addEventListener('click', () => {
                if (isGroupChat) {
                        // 如果是群聊，打开红包模态框
                        document.getElementById('red-packet-modal').classList.add('visible');
                } else {
                        // 如果是单聊，打开原来的转账模态框
                        document.getElementById('transfer-modal').classList.add('visible');
                }
        });
        document.getElementById('transfer-cancel-btn').addEventListener('click', () => document.getElementById('transfer-modal').classList.remove('visible'));
        document.getElementById('transfer-confirm-btn').addEventListener('click', sendUserTransfer);

        // Share Link
        document.getElementById('share-link-btn').addEventListener('click', () => document.getElementById('share-link-modal').classList.add('visible'));
        document.getElementById('cancel-share-link-btn').addEventListener('click', () => document.getElementById('share-link-modal').classList.remove('visible'));
        document.getElementById('confirm-share-link-btn').addEventListener('click', sendUserLinkShare);

        // Generic Prompt Modal
        document.getElementById('prompt-cancel-btn').addEventListener('click', () => document.getElementById('prompt-modal').classList.remove('visible'));

        // 红包主模态框
        document.getElementById('cancel-red-packet-btn').addEventListener('click', () => {
                document.getElementById('red-packet-modal').classList.remove('visible');
        });
        document.getElementById('send-group-packet-btn').addEventListener('click', sendGroupRedPacket);
        document.getElementById('send-direct-packet-btn').addEventListener('click', sendDirectRedPacket);

        // 红包详情模态框
        document.getElementById('close-rp-details-btn').addEventListener('click', () => {
                document.getElementById('red-packet-details-modal').classList.remove('visible');
        });

        // 红包模态框的页签切换逻辑
        const rpTabGroup = document.getElementById('rp-tab-group');
        const rpTabDirect = document.getElementById('rp-tab-direct');
        const rpContentGroup = document.getElementById('rp-content-group');
        const rpContentDirect = document.getElementById('rp-content-direct');
        const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color');

        rpTabGroup.addEventListener('click', () => {
                rpTabGroup.classList.add('font-semibold', 'border-b-2');
                rpTabGroup.style.color = accentColor;
                rpTabGroup.style.borderColor = accentColor;
                rpTabDirect.classList.remove('font-semibold', 'border-b-2');
                rpTabDirect.style.color = '';
                rpTabDirect.style.borderColor = 'transparent';
                rpContentGroup.classList.remove('hidden');
                rpContentDirect.classList.add('hidden');
        });
        rpTabDirect.addEventListener('click', () => {
                rpTabDirect.classList.add('font-semibold', 'border-b-2');
                rpTabDirect.style.color = accentColor;
                rpTabDirect.style.borderColor = accentColor;
                rpTabGroup.classList.remove('font-semibold', 'border-b-2');
                rpTabGroup.style.color = '';
                rpTabGroup.style.borderColor = 'transparent';
                rpContentDirect.classList.remove('hidden');
                rpContentGroup.classList.add('hidden');
        });

        // 实时更新红包金额显示
        document.getElementById('rp-group-amount').addEventListener('input', (e) => {
                const amount = parseFloat(e.target.value) || 0;
                document.getElementById('rp-group-total').textContent = `¥ ${amount.toFixed(2)}`;
        });
        document.getElementById('rp-direct-amount').addEventListener('input', (e) => {
                const amount = parseFloat(e.target.value) || 0;
                document.getElementById('rp-direct-total').textContent = `¥ ${amount.toFixed(2)}`;
        });

        // 最后，修改转账/红包主按钮的点击事件
        document.getElementById('transfer-btn').addEventListener('click', () => {
                if (isGroupChat) {
                        openRedPacketModal();
                } else {
                        document.getElementById('transfer-modal').classList.add('visible');
                }
        });

        document.getElementById('send-waimai-request-btn').addEventListener('click', () => {
                document.getElementById('waimai-request-modal').classList.add('visible');
        });
        document.getElementById('waimai-cancel-btn').addEventListener('click', () => {
                document.getElementById('waimai-request-modal').classList.remove('visible');
        });
        document.getElementById('waimai-confirm-btn').addEventListener('click', sendWaimaiRequest);



        // Listener to hide the long-press menu when clicking away
        // 仅当点击既不在菜单内，也不在当前消息气泡内时才关闭菜单
        document.addEventListener('click', (e) => {
                if (!activeMessageMenu.element) return; // 如果菜单没打开，什么都不做
                if (activeMessageMenu.element.contains(e.target)) return; // 如果点击在菜单内部，不关闭

                // 如果点击在触发菜单的那个元素上（无论是消息气泡还是表情），也不关闭
                if (activeMessageMenu.triggerElement && activeMessageMenu.triggerElement.contains(e.target)) {
                        // 这是为了防止点击/抬起鼠标时立即关闭菜单
                        // 但我们需要在处理完点击后清除 triggerElement，以便下次外部点击可以关闭
                        setTimeout(() => {
                                if (activeMessageMenu) activeMessageMenu.triggerElement = null;
                        }, 0);
                        return;
                }

                hideLongPressMenu(); // 点击在其他任何地方，关闭菜单
        }, true);

        // sticker
        toggleStickerPanelBtn.addEventListener('click', toggleStickerPanel);

        // Listener for the actions in the long-press menu
        messageActionsMenu.addEventListener('click', async (e) => {
                const action = e.target.dataset.action;
                if (!action) return;

                if (action.includes('sticker')) {
                        const sticker = activeMessageMenu.sticker;
                        if (!sticker) return;

                        if (action === 'delete_sticker') {
                                const confirmed = await showConfirmModal(
                                        '删除表情',
                                        `确定要删除表情 "${sticker.name}" 吗？`,
                                        '删除',
                                        '取消'
                                )
                                if (confirmed) {
                                        await db.userStickers.delete(sticker.id);
                                        stickerPanelRendered = false; // 强制下次打开时重新渲染
                                }
                        } else if (action === 'move_sticker_top') {
                                const highestOrder = await db.userStickers.orderBy('order').last();
                                await db.userStickers.update(sticker.id, { order: (highestOrder.order || 0) + 1 });
                                stickerPanelRendered = false;
                        }
                } else {
                        switch (action) {
                                case 'copy':
                                        copyMessageText();
                                        break;
                                case 'favorite':
                                        favoriteMessage();
                                        break;
                                case 'reply':
                                        startReply();
                                        break;
                                case 'select':
                                        enterSelectionMode();
                                        break;
                                case 'delete':
                                        deleteMessage();
                                        break;
                        }
                }
                hideLongPressMenu();
        });

        // Listeners for selection mode header
        cancelSelectionBtn.addEventListener('click', exitSelectionMode);
        deleteSelectionBtn.addEventListener('click', deleteSelectedMessages);

        // Listener for the reply preview bar's cancel button
        document.getElementById('cancel-reply-btn').addEventListener('click', cancelReply);

        // listener for music
        listenTogetherBtn.addEventListener('click', openPlaylistPicker);
        playlistCancelBtn.addEventListener('click', () => playlistModal.classList.remove('visible'));

        let pressTimer = null;
        let pressEvent = null;

        const startPress = (e) => {
                const wrapper = e.target.closest('.message-wrapper');
                if (!wrapper || isSelectionMode) return;

                pressEvent = e; // 保存触发事件
                pressTimer = setTimeout(() => {
                        // This now prevents the native menu from showing up
                        // after the long press is recognized.
                        if (pressEvent) {
                                pressEvent.preventDefault();
                        }
                        const timestamp = parseInt(wrapper.dataset.timestamp);
                        const msg = currentChat.history.find(m => toMillis(m.timestamp) === timestamp);
                        if (msg) {
                                showLongPressMenu(pressEvent, msg);
                        }
                }, 500); // 500ms for long press
        };

        const cancelPress = () => {
                clearTimeout(pressTimer);
        };

        chatContainer.addEventListener('mousedown', startPress);
        chatContainer.addEventListener('touchstart', startPress, { passive: true });

        chatContainer.addEventListener('mouseup', cancelPress);
        chatContainer.addEventListener('touchend', cancelPress);
        chatContainer.addEventListener('mouseleave', cancelPress);
        chatContainer.addEventListener('touchmove', cancelPress);

        chatContainer.addEventListener('click', async (e) => {
                // --- 1. 多选模式逻辑 ---
                if (isSelectionMode) {
                        const wrapper = e.target.closest('.message-wrapper');
                        if (wrapper) {
                                const timestamp = parseInt(wrapper.dataset.timestamp);
                                toggleMessageSelection(timestamp);
                        }
                        return; // 在多选模式下，不执行后续操作
                }

                // --- 2. “拍一拍”逻辑 ---
                const avatarImg = e.target.closest('.avatar');
                if (avatarImg) {
                        const wrapper = avatarImg.closest('.message-wrapper');
                        if (wrapper) { // 增加一个安全检查
                                let targetName;
                                // 直接通过DOM元素的class来判断是用户还是AI，更可靠
                                if (wrapper.classList.contains('user')) {
                                        targetName = activeUserPersona?.name || '我';
                                } else {
                                        // 对于AI，我们仍然需要从消息中获取senderName以兼容群聊
                                        const timestamp = parseInt(wrapper.dataset.timestamp);
                                        const msg = currentChat.history.find(m => toMillis(m.timestamp) === timestamp);
                                        // 如果能找到消息，就用消息的名字，找不到则用当前聊天的名字作为备用
                                        targetName = msg ? (msg.senderName || currentChat.name) : currentChat.name;
                                }
                                await handleUserPat(charId, targetName);
                        }
                        return; // 确保执行完拍一拍逻辑后，不再继续执行后续的点击判断
                }

                // --- 3. “外卖代付”按钮逻辑 ---
                const waimaiBtn = e.target.closest('.waimai-user-actions button');
                if (waimaiBtn) {
                        const card = waimaiBtn.closest('.waimai-card');
                        const timestamp = parseInt(card.dataset.waimaiTimestamp);
                        const choice = waimaiBtn.dataset.choice;
                        const msg = currentChat.history.find(m => toMillis(m.timestamp) === timestamp);

                        if (msg && msg.status === 'pending') {
                                msg.status = choice;
                                msg.paidBy = (choice === 'paid') ? (currentChat.settings.myNickname || '我') : null;

                                const systemNote = {
                                        role: 'system',
                                        content: `[系统提示：用户 (${currentChat.settings.myNickname || '我'}) ${choice === 'paid' ? '支付' : '拒绝'} 了 ${msg.senderName} 的外卖请求。]`,
                                        timestamp: new Date(Date.now() + 1),
                                        isHidden: true
                                };
                                currentChat.history.push(systemNote);
                                await db.chats.put(currentChat);
                                renderMessages(); // 重绘以更新UI
                        }
                        return;
                }

                // --- 4. “转账”按钮逻辑 ---
                const transferCard = e.target.closest('[data-transfer-timestamp]');
                if (transferCard) {
                        const timestamp = parseInt(transferCard.dataset.transferTimestamp);
                        const msg = currentChat.history.find(m => toMillis(m.timestamp) === timestamp);

                        if (msg && msg.role === 'assistant') {
                                const confirmed = await showConfirmModal(
                                        '转账确认',
                                        `要接收来自 ${msg.senderName || currentChat.name} 的转账 ¥${msg.amount.toFixed(2)} 吗？`,
                                        '确认',
                                        '取消'
                                );

                                // 为 AI 添加一条隐藏的系统提示，告知它你的决定
                                const hiddenReply = {
                                        role: 'system',
                                        content: `[系统提示：用户已${confirmed ? '接收' : '拒绝'}了你的转账。]`,
                                        timestamp: new Date(Date.now() + 1),
                                        isHidden: true
                                };

                                if (confirmed) {
                                        msg.status = 'claimed';
                                        currentChat.history.push(hiddenReply);
                                } else {
                                        msg.status = 'declined';
                                        currentChat.history.push(hiddenReply);
                                }

                                await db.chats.put(currentChat);
                                renderMessages(); // 重新渲染以更新UI状态
                        }
                        return; // 结束执行，避免与其他点击事件冲突
                }


        });

        lockOverlay.addEventListener('click', async (e) => {
                const targetId = e.target.id;
                if (!targetId) return;

                // 刷新获取最新的chat数据，防止状态陈旧
                currentChat = await db.chats.get(charId);

                switch (targetId) {
                        case 'unblock-btn':
                                currentChat.blockStatus = null; // 解除拉黑
                                await db.chats.put(currentChat);
                                handleChatLock();
                                break;

                        case 'accept-friend-btn':
                                currentChat.blockStatus = null
                                await db.chats.put(currentChat);
                                handleChatLock();
                                // 自动发送一条消息并触发AI回应
                                const applyMessage = {
                                        role: 'system',
                                        content: `[系统提示：用户请求添加你为好友，理由是：“${reason}”]`,
                                        timestamp: Date.now(),
                                        isHidden: true
                                };
                                await addUserMessageToDb(applyMessage, true, charId);
                                break;

                        case 'reject-friend-btn':
                                currentChat.blockStatus = { status: 'blocked_by_user', timestamp: Date.now() };
                                await db.chats.put(currentChat);
                                handleChatLock();
                                break;

                        case 'apply-friend-btn':
                                const reason = await promptForInput(`请输入你想对“${currentChat.name}”说的申请理由：`, "我们和好吧！", false, false);
                                if (reason !== null) { // 只有在用户点击“确定”后才继续
                                        currentChat.blockStatus = { status: 'pending_ai_approval', applicationReason: reason };
                                        await db.chats.put(currentChat);
                                        handleChatLock();
                                        // 触发AI去处理这个申请
                                        await getAiResponse();
                                }
                                break;
                }
        });

        document.getElementById('start-call-btn').addEventListener('click', async () => {
                const choice = await showCallActionModal();
                if (!choice) return;
                initiateOutgoingCall(choice); // 调用新的请求函数
        });
        // 为通话界面的按钮绑定事件
        hangUpBtn.addEventListener('click', hangUpCall);
        callInputForm.addEventListener('submit', handleSendCallMessage);

        rejectIncomingCallBtn.addEventListener('click', async () => {
                incomingCallModal.classList.add('hidden');
                // 告诉AI用户拒绝了
                const rejectMessage = {
                        role: 'system',
                        content: `[系统提示：用户拒绝了你的通话请求。]`,
                        isHidden: true,
                        timestamp: Date.now()
                };
                await addUserMessageToDb(rejectMessage, true); // 让AI对此作出反应
                incomingCallOffer = null;
        });

        acceptIncomingCallBtn.addEventListener('click', () => {
                if (!incomingCallOffer) return;
                incomingCallModal.classList.add('hidden');
                // 用户接听，建立连接，并让用户先说话
                callInitiator = 'ai';
                connectCall(incomingCallOffer.type);
                incomingCallOffer = null;
        });
}


// --- Core Logic Functions ---

async function handleSendMessage(e) {
        if (e) e.preventDefault();
        const messageText = chatInput.value.trim();
        if (!messageText) return;

        const userMessage = { role: 'user', content: messageText, timestamp: Date.now() };

        if (currentReplyContext) {
                userMessage.quote = currentReplyContext;
                cancelReply(); // Reset reply state
        }

        chatInput.value = '';
        sendBtn.disabled = true;
        chatInput.style.height = 'auto'; // Reset height

        // Now, add to DB and trigger AI. The UI is already updated.
        await addUserMessageToDb(userMessage, false);
}

async function addUserMessageToDb(message, triggerAI = false, charIdOverride = null) {
        // This check is important for system-generated messages in group chats
        const targetChatId = charIdOverride || charId;
        const chatToUpdate = await db.chats.get(targetChatId);

        if (!chatToUpdate) {
                console.error(`addUserMessageToDb Error: Could not find chat with id ${targetChatId}`);
                return;
        }

        chatToUpdate.history.push(message);
        if (message.role !== 'system') {
                chatToUpdate.lastMessageTimestamp = message.timestamp;
                chatToUpdate.lastMessageContent = message;
        }
        // If the update is for the currently viewed chat, update the UI
        if (targetChatId === charId) {
                currentChat = chatToUpdate;
                if (!isCallActive) {
                        appendMessage(message);
                }
        }

        // Always save the change to the database
        await db.chats.put(chatToUpdate);

        // --- Core logic change: Trigger AI from here ---
        if (triggerAI) {
                // Only give a relationship score bump if a real user sent a message
                if (message.role === 'user' && !isGroupChat) {
                        await updateRelationshipScore('user', targetChatId, 1);
                }
                // Pass the specific character ID to the AI response function
                await getAiResponse(targetChatId);
        }
}

async function handlePromptAndSend(title, placeholder, type) {
        const modal = document.getElementById('prompt-modal');
        document.getElementById('prompt-title').textContent = title;
        const input = document.getElementById('prompt-input');
        input.placeholder = placeholder;
        input.value = '';
        modal.classList.add('visible');

        document.getElementById('prompt-confirm-btn').onclick = async () => {
                const content = input.value.trim();
                if (content) {
                        const message = { role: 'user', type: type, content: content, timestamp: Date.now() };
                        await addUserMessageToDb(message, false);
                }
                modal.classList.remove('visible');
        };
}

/**
 * Extracts and parses a JSON object from a string that may contain markdown or other text.
 * This version is the most robust, designed to strip all non-JSON characters including
 * invisible BOMs and control characters before parsing.
 * @param {string} raw - The raw string from the AI.
 * @returns {object|null} - The parsed JSON object or null if parsing fails.
 */
function extractAndParseJson(raw) {
        if (typeof raw !== 'string' || !raw.trim()) return null;

        // 1. 统一常见不可见字符与全角符号
        let s = raw
                .replace(/[“”]/g, '"')
                .replace(/[‘’]/g, "'")
                .replace(/\u00A0/g, ' '); // NBSP → Space

        // 2. 截取第一个 {...} 或 [...] 片段
        const match = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (!match) return null;
        s = match[0];

        // 3. 移除 BOM / C0‑C1 控制符
        s = s.replace(/[\uFEFF\u0000-\u001F\u007F-\u009F]/g, '');

        // 4. 自动添加数组中缺失的逗号
        //    这个正则表达式会查找一个右花括号 `}` 后面跟着一个左花括号 `{` 的情况（中间可以有空格），并用 `},{` 替换它
        s = s.replace(/\}\s*\{/g, '},{');

        // 5. 第一次尝试严格解析
        try { return JSON.parse(s); } catch (_) { }

        // 6. 自动修正常见错误 —— 先简单后复杂，便于定位
        s = s
                // a) 单引号键值 → 双引号
                .replace(/(['"])?([a-zA-Z0-9_]+)\1\s*:/g, '"$2":')
                .replace(/:\s*'([^']*)'/g, ':"$1"')
                // b) 数字前多余的 + 号
                .replace(/:\s*\+([0-9.]+)/g, ':$1')
                // c) 结尾多余逗号
                .replace(/,\s*([}\]])/g, '$1');

        s = s.replace(/:\s*"((?:\\"|[^"])*)/g, (match, valueContent) => {
                // 将这里面所有未转义的 " 替换为 \"
                const repairedContent = valueContent.replace(/(?<!\\)"/g, '\\"');
                return `: "${repairedContent}`;
        });
        // 7. 再次解析；失败则返回 null
        try { return JSON.parse(s); } catch (e) {
                console.error('extractJson() failed:', e, '\nProblematic string:', s);
                console.error("String that failed parsing:", raw);
                return null;
        }
}
async function sendUserTransfer() {
        const amount = parseFloat(document.getElementById('transfer-amount').value);
        const note = document.getElementById('transfer-note').value.trim();
        if (isNaN(amount) || amount <= 0) {
                showToast("请输入有效金额", 'error');
                return;
        }
        const message = { role: 'user', type: 'transfer', amount: amount, note: note, timestamp: Date.now() };
        await addUserMessageToDb(message, false);

        document.getElementById('transfer-modal').classList.remove('visible');
        document.getElementById('transfer-amount').value = '';
        document.getElementById('transfer-note').value = '';
}

async function sendUserLinkShare() {
        const title = document.getElementById('link-title-input').value.trim();
        if (!title) {
                showToast("标题是必填项！", 'error');
                return;
        }
        const message = {
                role: 'user',
                type: 'share_link',
                title: title,
                description: document.getElementById('link-description-input').value.trim(),
                source_name: document.getElementById('link-source-input').value.trim(),
                content: document.getElementById('link-content-input').value.trim(),
                timestamp: Date.now()
        };
        await addUserMessageToDb(message, false);
        document.getElementById('share-link-modal').classList.remove('visible');
}

async function openPlaylistPicker() {
        if (!spotifyManager.isLoggedIn()) {
                showToast('请先前往“音乐”App登录Spotify。', 'error');
                return;
        }
        playlistSelectionContainer.innerHTML = '<p>正在加载您的歌单...</p>';
        playlistModal.classList.add('visible');

        const playlists = await spotifyManager.getUserPlaylists();
        playlistSelectionContainer.innerHTML = ''; // 清空加载提示

        if (playlists.length === 0) {
                playlistSelectionContainer.innerHTML = '<p>您还没有创建任何歌单。</p>';
                return;
        }

        playlists.forEach(playlist => {
                const pEl = document.createElement('div');
                pEl.className = 'p-2 border-b hover:bg-gray-100 cursor-pointer flex items-center gap-3';
                pEl.innerHTML = `
            <img src="${playlist.images[0]?.url || ''}" class="w-10 h-10 rounded">
            <span>${playlist.name}</span>
        `;
                pEl.addEventListener('click', () => startListenTogetherSession(playlist));
                playlistSelectionContainer.appendChild(pEl);
        });
}

async function startListenTogetherSession(playlist) {
        playlistModal.classList.remove('visible');

        // 只发出播放指令，不获取数据
        spotifyManager.playPlaylist(playlist.uri);

        const visibleMessage = {
                role: 'system',
                type: 'system_message',
                content: `你分享了歌单《${playlist.name}》，开始一起听歌`,
                timestamp: Date.now()
        };
        // 只添加UI消息，AI的回应将由player_state_changed事件驱动
        await addUserMessageToDb(visibleMessage, false);
}

function getDisplayName(id) {
        if (id === 'user') {
                // 使用 activeUserPersona 来获取当前用户的显示名称
                return activeUserPersona?.name || '我';
        }
        // 对于AI角色，从 currentChat 数据中查找
        if (isGroupChat) {
                const member = currentChat.members.find(m => m.id === id);
                return member?.name || id; // 如果在群成员中找不到，则回退显示ID
        }
        // 在单聊中，如果不是用户，那就是当前AI角色
        return currentChat.name || id;
}

async function getAiResponse(charIdToTrigger = null) {
        let apiCallSuccess = false;
        // If the API is locked by any process, wait a moment and retry.
        // This gives priority to user actions over background tasks.
        if (apiLock.getCurrentLock() !== 'idle') {
                console.log("API is busy, waiting to get user chat response...");
                await sleep(1000); // Wait 1 second before retrying
        }

        // Attempt to acquire the high-priority lock.
        if (!(await apiLock.acquire('user_chat'))) {
                showToast("系统正忙，请稍后再试。"); // This should rarely happen
                return;
        }

        if (charIdToTrigger && typeof charIdToTrigger === 'object' && 'target' in charIdToTrigger) {
                charIdToTrigger = null;
        }

        const activeCharId = charIdToTrigger || charId;
        if (!activeCharId) {
                console.error("getAiResponse 错误: 缺少角色ID");
                return;
        }


        // 从数据库重新获取最新的聊天数据，确保信息是最新的
        const currentChatForAPI = await db.chats.get(activeCharId);
        if (!currentChatForAPI) {
                console.error(`getAiResponse 错误: 找不到ID为 ${activeCharId} 的聊天`);
                return;
        }
        if (!apiConfig) {
                showToast('请先在“设置”页面中添加并选择一个API方案。', 'error');
                // 恢复UI状态
                const headerElOnError = document.getElementById('char-name-header');
                headerElOnError.textContent = isGroupChat ? `${currentChat.name} (${currentChat.members.length + 1})` : currentChat.name;
                headerElOnError.classList.remove('typing-status');
                apiLock.release('user_chat'); // 释放锁
                return; // 提前退出函数，防止错误
        }

        const currentCount = currentChatForAPI?.userActionCount || 0;

        let isApiConfigMissing = false;
        if (apiConfig.apiProvider === 'gemini') {
                // 如果是Gemini，我们只需要检查密钥和模型
                if (!apiConfig?.apiKey || !apiConfig?.model) {
                        isApiConfigMissing = true;
                }
        } else {
                // 对于默认或其他反代服务，三个都需要检查
                if (!apiConfig?.proxyUrl || !apiConfig?.apiKey || !apiConfig?.model) {
                        isApiConfigMissing = true;
                }
        }

        if (isApiConfigMissing) {
                showToast('请先在主程序中完成API设置', 'error');
                // 确保在出错时恢复UI状态
                const headerElOnError = document.getElementById('char-name-header');
                headerElOnError.textContent = isGroupChat ? `${currentChat.name} (${currentChat.members.length + 1})` : currentChat.name;
                headerElOnError.classList.remove('typing-status');
                apiLock.release('user_chat'); // 别忘了释放锁
                return;
        }
        
        const headerEl = document.getElementById('char-name-header');

        try {
                let systemPrompt;
                const maxMemory = currentChat.settings.maxMemory || 10;
                const currentTime = new Date().toLocaleString('zh-CN', { dateStyle: 'full', timeStyle: 'short' });
                let recentHistory = currentChatForAPI.history.slice(-maxMemory);

                let fullToolboxPrompt = ``;
                let simplifiedToolboxPrompt = ``;
                const isFirstInteraction = currentChatForAPI.history.filter(m => m.role === 'assistant' && !m.isHidden).length === 0;
                // 1. 获取所有需要判断的条件
                const timeSinceLastMessage = Date.now() - toMillis(currentChatForAPI.lastMessageTimestamp || 0);
                const isLongBreak = timeSinceLastMessage > (6 * 60 * 60 * 1000); // 距离上次对话超过6小时

                // 2. 读取“上次调用是否失败”的标志（这需要您在 catch 块中设置一个标志）
      
                const needsFailureRecovery = sessionStorage.getItem('ai_last_call_failed') === 'true';

                // 3. 我们的“定期保险”
                const isPeriodicCheckTime = (currentCount % 30 === 0); // 我们可以把周期放宽到30轮

                // 4. 组合所有条件
                const useFullPrompt =
                        isFirstInteraction ||      // 第一次互动，必须教
                        needsFailureRecovery ||    // 上次失败了，必须纠正
                        isLongBreak ||             // 长时间没聊，需要“唤醒”
                        isPeriodicCheckTime;       // 定期的“安全带”

                if (useFullPrompt) {
                        console.log(`触发完整工具箱注入！原因:`, {
                                isFirstInteraction,
                                needsFailureRecovery,
                                isLongBreak,
                                isPeriodicCheckTime
                        });
                        // 清除失败标志，因为我们这次就要尝试修复它
                        sessionStorage.removeItem('ai_last_call_failed');
                }

                let musicPromptSection = "";
                const lastMessage = recentHistory.length > 0 ? recentHistory[recentHistory.length - 1] : null;

                if (lastMessage && lastMessage.type === 'spotify_state_info' && lastMessage.content) {
                        // 从系统提示中解析出歌曲信息
                        const songMatch = lastMessage.content.match(/正在播放: (.+?)。/);
                        if (songMatch && songMatch[1]) {
                                musicPromptSection = `\n\n# 音乐播放状态\n你们正在一起听歌，当前播放的是: ${songMatch[1]}。`;
                        }
                }

                let intelligencePromptSection = "";

                // 如果最新的一条需要AI处理的消息是情报简报，就把它提取出来
                if (lastMessage && lastMessage.type === 'intelligence_briefing') {
                        intelligencePromptSection = lastMessage.content;
                }

                const importantMemories = await db.memories
                        .where({ chatId: charId, isImportant: 1 })
                        .toArray();

                const recentNormalMemories = await db.memories
                        .where({ chatId: charId, isImportant: 0 })
                        .reverse() // 获取最新的
                        .limit(3) // 最多取最近3条普通回忆
                        .toArray();

                const combinedMemories = [...importantMemories, ...recentNormalMemories.slice(0, 10 - importantMemories.length)];

                let memoriesPromptSection = "";
                if (combinedMemories.length > 0) {
                        const memoriesText = combinedMemories.map(mem => {
                                const memDate = new Date(mem.timestamp).toLocaleDateString();
                                const importanceTag = mem.isImportant ? "[核心记忆] " : "";
                                return `- 日期: ${memDate}, 内容: ${importanceTag}${mem.description}`;
                        }).join('\n');
                        memoriesPromptSection = `\n\n# 你需要参考的背景回忆:\n你和用户的过往回忆如下，请在生成回复时自然地利用这些信息，但不要直接复述它们。\n${memoriesText}`;
                }

                let worldBookContext = "";
                // 检查单人世界书
                if (currentChatForAPI.settings && currentChatForAPI.settings.worldBookId) {
                        const personalBook = await db.worldBooks.get(currentChatForAPI.settings.worldBookId);
                        if (personalBook) {
                                worldBookContext += `\n\n# 你需要【绝对优先】参考的个人世界观与历史背景:\n`;
                                worldBookContext += `## ${personalBook.name}\n${personalBook.content}\n\n`;
                        }
                }
                if (currentChatForAPI.groupId) {
                        const group = await db.xzoneGroups.get(currentChatForAPI.groupId);
                        if (group && group.worldBookIds && group.worldBookIds.length > 0) {
                                const worldBooks = await db.worldBooks.bulkGet(group.worldBookIds);
                                worldBookContext += "\n\n# 你需要参考的世界观与历史背景:\n";
                                worldBooks.forEach(book => {
                                        if (book) {
                                                worldBookContext += `## ${book.name}\n${book.content}\n\n`;
                                        }
                                });
                        }
                }

                const allChats = await db.chats.toArray();
                let relationsContext = "你的人际关系：\n";
                if (currentChatForAPI.groupId) {
                        const allChats = await db.chats.toArray();
                        const groupMembers = allChats.filter(c => c.groupId === currentChatForAPI.groupId && c.id !== activeCharId && !c.isGroup);
                        const memberIds = groupMembers.map(m => m.id);

                        const userDisplayName = activeUserPersona?.name || '我';
                        relationsContext += `- 你与 ${userDisplayName} (ID: user) 的关系是 [由AI根据对话判断]。\n`;

                        if (memberIds.length > 0) {
                                const otherRelations = await db.relationships
                                        .where('sourceCharId').equals(activeCharId)
                                        .and(r => memberIds.includes(r.targetCharId))
                                        .toArray();

                                otherRelations.forEach(rel => {
                                        const targetChar = groupMembers.find(m => m.id === rel.targetCharId);
                                        if (targetChar) {
                                                relationsContext += `- 你与 ${targetChar.realName} (昵称: ${targetChar.name}) (ID: ${targetChar.id}) 的关系是 ${rel.type}，好感度 ${rel.score}。\n`;
                                        }
                                });
                        }
                } else {
                        relationsContext += "（你尚未加入任何分组。）\n";
                }

                const stickers = await db.userStickers.toArray();

                const instructions = {
                        handleRedPacket: `
# 临时任务：如何处理收到的红包
你收到一个红包，你需要根据以下规则决定是否打开：
1.  **检查类型**: 如果是【专属红包】, 接收者必须是你。 如果是【拼手气红包】，你可以扮演任何一个角色根据自身性格和发送者的关系去尝试领取。
2.  **检查状态**: 确认红包是否已被领完，以及你是否已领取过。
3.  **执行**: 使用 'open_red_packet' 工具并提供红包消息的时间戳来尝试领取。 一个角色只能领取同一个红包一次。
- **打开红包**: {"type": "open_red_packet", "senderId": "你的ID", "packet_timestamp": [红包消息的时间戳]}
`,
                        handleTransfer: `
# 临时任务：如何回应用户的转账
**提取时间戳**: 你【必须】从该提示中准确地提取出那个独一无二的数字时间戳 (timestamp)。
**做出决策**: 根据你的人设和当前情景，决定是“接受”(\`accept\`) 还是“拒绝”(\`decline\`) 这笔转账。
**使用统一指令回应**: 你【必须】使用  \`respond_to_transfer\` 指令，并将提取到的时间戳填入 \`target_timestamp\` 字段。
    - 示例: \`{"type": "respond_to_transfer", "target_timestamp": 1721382490123, "decision": "accept"}\`
**【【【至关重要】】】**: 在使用该指令后，你还【必须】紧接着发送一条或多条 \`text\` 消息，来对你的决定进行解释或表达感谢/歉意。

`,
                        handleCallRequest: `
# 临时任务：如何回应用户的通话请求
用户正在向你发起通话。根据你的人设、当前状态和与用户的好感度，决定是“接受”('accept')还是“拒绝”('reject')。
- **接受**: 你的'response'数组中【只能】包含 '{"type": "respond_to_call", "decision": "accept"}'。**绝对不能**再附加任何 'text' 消息。通话接通后你将有第一句话的机会。
- **拒绝**: 【必须】提供一个符合人设的简洁理由，例如: '{"type": "respond_to_call", "decision": "reject", "reason": "抱歉，我现在有点忙..."}'
`,
                        handleWaimaiRequest: `
# 临时任务：如何回应外卖代付请求
  **当【用户】发起时 (你收到请求):**
    * **含义**: 用户希望你为他/她点的外卖付钱。
    * **你的任务**: 根据你的人设、与用户的好感度以及当前情景，决定是“为Ta买单” ('paid') 还是“残忍拒绝” ('rejected')。
    * **使用工具**: 你【必须】使用 'waimai_response' 指令来回应，并准确填入请求消息的 'target_timestamp'。
        * **示例**: '{"type": "waimai_response", "target_timestamp": 1721382490123, "decision": "paid"}'
    * **后续对话**: 在使用指令后，你还【必须】紧接着发送一条或多条 'text' 消息，来对你的决定进行解释或表达，例如“没问题，已经帮你付啦！”或“抱歉，我现在手头有点紧...”。
`,
                        handleMusicControl: `
# 音乐控制指南
你们正在一起听歌。你可以像真人一样根据自身人设对当前歌曲发表评论，或使用以下音乐控制工具：
- **暂停/播放**: {"type": "spotify_toggle_play"}
- **下一首**: {"type": "spotify_next_track"}
- **上一首**: {"type": "spotify_previous_track"}
`
                };
                let injectedInstructions = [];
                // 找到AI上一次回复的索引
                const lastAiResponseIndex = currentChatForAPI.history.findLastIndex(m => m.role === 'assistant');

                // 切片出AI上次回复之后的所有新消息
                const newMessagesSinceLastAiResponse = currentChatForAPI.history.slice(lastAiResponseIndex + 1);

                // 使用一个 Set 来防止重复注入同一个指令
                const instructionsToInject = new Set();

                // 遍历所有新消息，而不仅仅是最后一条
                for (const message of newMessagesSinceLastAiResponse) {
                        // 我们只关心用户和系统（例如通话请求）的消息
                        if (message.role === 'user' || message.role === 'system') {
                                // 检查消息类型
                                switch (message.type) {
                                        case 'red_packet':
                                                instructionsToInject.add(instructions.handleRedPacket);
                                                break;
                                        case 'transfer':
                                                instructionsToInject.add(instructions.handleTransfer);
                                                break;
                                        case 'waimai_request':
                                                instructionsToInject.add(instructions.handleWaimaiRequest);
                                                break;
                                }
                                // 同样，检查系统消息中的通话请求
                                if (message.role === 'system' && message.content.includes('通话请求')) {
                                        instructionsToInject.add(instructions.handleCallRequest);
                                }
                        }
                }

                // 将Set转换为数组并推入主指令数组
                injectedInstructions.push(...instructionsToInject);

                // 检查音乐播放状态
                if (musicPlayerBar.style.display !== 'none' && !musicPlayerBar.classList.contains('hidden')) {
                        injectedInstructions.push(instructions.handleMusicControl);
                }
                console.log("Injected instructions:", injectedInstructions);
                const lastUserMessageText = currentChatForAPI.history.filter(m => m.role === 'user').pop()?.content || '';
                let relevantDiariesPrompt = "";

                const authorIdToSearch = isGroupChat
                        ? groupMemberDetailsMap.keys() // 在群聊中，理论上所有人都可能思考，这里简化为只考虑当前对话涉及的角色
                        : [charId];

                // 从数据库中所有日记里查找
                const allDiaries = await db.diaries.where('authorId').anyOf(...authorIdToSearch).toArray();

                const relevantDiaries = allDiaries.filter(diary =>
                        diary.keywords.some(keyword => lastUserMessageText.includes(keyword))
                ).slice(-2);

                if (relevantDiaries.length > 0) {
                        // 在Prompt中明确指出这是“你自己的”日记
                        relevantDiariesPrompt = "# 你想起了自己过去的日记：\n" + relevantDiaries.map(d => {
                                const authorName = getDisplayName(d.authorId); // 使用我们的辅助函数获取作者名
                                return `// 日期：${new Date(d.timestamp).toLocaleDateString()}\n// 作者：${authorName} (你)\n// 日记内容：\n${d.content}`
                        }).join('\n---\n');
                }
                
                if (isCallActive) {
                        // ---- 分支1：当前处于通话模式 ----
                        isAiRespondingInCall = true;
                        callInput.disabled = true;
                        document.querySelector('#call-input-form button').disabled = true;
                        const speakingIndicator = document.getElementById('call-speaking-indicator');
                        speakingIndicator.textContent = '对方正在讲话...';
                        speakingIndicator.classList.remove('opacity-0');
                        // --- 优化后的基础通话 Prompt ---
                        const baseCallPrompt = `
# 核心使命 (Core Mission)
你正在以角色 “${currentChat.realName}” (昵称 “${currentChat.name}”) 的身份，与用户进行一场【实时】的${callType === 'voice' ? '语音' : '视频'}通话。你的唯一目标是提供一个沉浸式、真实、且完全符合角色设定的通话体验。

# 角色与世界背景 (Character & World Context) - 你必须时刻遵守
- **你的核心人设**: ${currentChat.settings.aiPersona}
- **你和其他人的关系**: ${relationsContext}
- **你需要参考的世界观与历史背景**: ${worldBookContext}
- **你需要参考的共同回忆**: ${memoriesPromptSection}

# 通话行为准则 (Call Conduct Rules)
- **【【【绝对禁止】】】**: 这是一场通话，不是聊天。严禁使用任何聊天模式的JSON指令 (例如: {"type": "send_sticker"}, {"type": "transfer"} 等)。你的所有产出都必须严格遵循下方指定的通话输出格式。
- **【口语化与自然化】**: 你的语言风格必须是高度口语化的。使用短句、停顿 (比如 "嗯...")、口头禅和符合人设的语气词。想象你正在真实地和人打电话，而不是在写文章。
- **【情景与时间感知】**:
    - **当前时间是 ${currentTime}**。你的对话内容和精神状态需要符合这个时间。例如，在深夜，你可能会听起来有些疲惫或者准备睡觉；在清晨，你可能正在吃早餐或准备出门。
    - **环境互动**: 如果是视频通话，你的动作描述应该与你所处的环境（根据你的设定和当前时间推断）互动。
    - **对话间隔**: 你必须仔细观察每条消息前缀中的 [时间: ...] 信息。对比用户最新消息的时间和你的当前时间，来判断你们的对话间隔（是几分钟内的即时回复，还是几小时或几天后的重新开启话题），并据此调整你的回应方式和语气。
- **【即时性与互动性】**: 你的回应必须是针对用户刚刚所说的话。做一个好的倾听者，提出问题，表达你的情绪（开心、疑惑、惊讶等），让对话自然地流动下去。
- **【【【主动挂断】】】**: 在符合你人设和情景的情况下（例如：需要去忙别的事情、对话陷入僵局、或者被用户冒犯），你可以主动挂断电话。使用 "hang_up_call" 指令来执行此操作。

`;

                        if (callType === 'video') {
                                systemPrompt = baseCallPrompt + `
# 视频通话输出格式 (Video Call Output Format)
你的回复【必须】是一个只包含 "description" 和 "dialogue" 两个键的、格式正确的JSON对象。

- **"description"**: (string) 使用第三人称，生动详细地描写你【此刻】的表情、肢体动作、眼神以及与周围环境的互动。这部分内容是用户看到的“画面”，必须富有动态感和细节。
- **"dialogue"**: (string) 你要说的话，必须是纯文本，且高度口语化。
- **挂断指令**: \`{"type": "hang_up_call", "reason": "(可选)挂断前说的最后一句话"}\`

# 优质示例 (Good Example)
{
  "description": "他听到这话，忍不住笑出声，身体向后靠在椅子上，随手拿起桌边的杯子喝了一口水，眼神里还带着笑意。",
  "dialogue": "真的假的？那也太夸张了吧！后来呢，后来怎么样了？"
}

# 劣质示例 (Bad Example)
{
  "description": "他很高兴。",
  "dialogue": "我明白了你说的事情，这很有趣。"
}
`;
                        } else { // voice call
                                systemPrompt = baseCallPrompt + `
# 语音通话输出格式 (Voice Call Output Format)
你的回复【必须】是一个只包含 "dialogue" 一个键的、格式正确的JSON对象。

- **"dialogue"**: (string) 你要说的话。因为没有画面，你需要通过语言本身来传递情绪和状态。可以包含停顿、思考的语气词 (如 "嗯..."、"让我想想啊...")，甚至可以描述一下你这边的声音（如果符合情景）。
- **挂断指令**: \`{"type": "hang_up_call", "reason": "(可选)挂断前说的最后一句话"}\`

# 优质示例 (Good Example)
{
  "dialogue": "嗯...等一下，我这边好像有点吵...好了。你刚说到哪儿了？哦对，关于那个计划，我觉得可能有点问题。"
}

# 劣质示例 (Bad Example)
{
  "dialogue": "我已经理解了你的计划。"
}
`;
                        }
                } else {
                        headerEl.textContent = isGroupChat ? '成员正在输入...' : '对方正在输入...';
                        headerEl.classList.add('typing-status');

                        // --- 1. Show "Typing" status BEFORE the API call ---
                        const { proxyUrl, apiKey, model } = apiConfig;

                        const stickerListForPrompt = stickers.length > 0
                                ? stickers.map(s => `- "${s.name}"`).join('\n')
                                : '- (表情库是空的)';

                        const albumPhotos = await db.globalAlbum.toArray();
                        let postsPromptSection = "";

                        // 只把有描述的图片提供给AI
                        const availableBackgrounds = albumPhotos
                                .filter(p => p.description && p.description.trim() !== '')
                                .map(p => `- "${p.description}"`)
                                .join('\n') || '- (公共相册中没有可供AI使用的照片)';

                        // 检查最新的消息是否是动态提及
                        if (lastMessage && lastMessage.type === 'user_post_mention') {
                                const match = lastMessage.content.match(/动态ID: (\d+)/);
                                if (match && match[1]) {
                                        const postId = parseInt(match[1]);
                                        const specificPost = await db.xzonePosts.get(postId);

                                        if (specificPost) {
                                                const authorName = getDisplayName(specificPost.authorId);
                                                const hasLiked = specificPost.likes.includes(charId);
                                                const commentsText = specificPost.comments.length > 0
                                                        ? '已有评论:\n' + specificPost.comments.map(c => `    - ${getDisplayName(c.author)}: "${c.text}"`).join('\n')
                                                        : '还没有评论。';

                                                postsPromptSection = `
# PART 6.2: 你需要优先处理的社交动态
你刚刚被用户在新动态中@了，这是该动态的详细信息：
- **动态ID**: ${specificPost.id}
- **发布者**: ${authorName}
- **发布时间**: ${formatRelativeTime(specificPost.timestamp)}
- **内容**: "${specificPost.publicText || specificPost.content}"
- **你的点赞状态**: 你 ${hasLiked ? '已经点赞过' : '还没有点赞'}。
- **评论区**:
${commentsText}

**你的任务**: 请基于以上详细信息，并结合你的人设和与发布者的关系，决定是否要点赞或发表一条【新的、不重复的】评论。
`;
                                        }
                                }
                        } else {
                                // 如果没有特别提及，则沿用旧的、扫描近期动态的逻辑
                                let authorIdsToScan = [charId, 'user'];
                                if (currentChatForAPI.groupId) {
                                        const allCharsInDB = await db.chats.toArray();
                                        const groupMates = allCharsInDB.filter(c => c.groupId === currentChatForAPI.groupId && c.id !== charId && !c.isGroup);
                                        authorIdsToScan.push(...groupMates.map(m => m.id));
                                }

                                const relevantPosts = await db.xzonePosts
                                        .where('authorId').anyOf(authorIdsToScan)
                                        .reverse()
                                        .limit(5)
                                        .toArray();

                                if (relevantPosts.length > 0) {
                                        const postsText = relevantPosts.map(p => {
                                                const authorName = getDisplayName(p.authorId);
                                                const postTime = formatRelativeTime(p.timestamp);
                                                const selfPostMarker = (p.authorId === charId) ? " [这是你发布的动态]" : "";

                                                // 读取并格式化评论区
                                                const commentSummary = (p.comments && p.comments.length > 0)
                                                        ? `\n    已有评论:\n` + p.comments.map(c => {
                                                                const commentAuthorName = getDisplayName(c.author);
                                                                return `    - ${commentAuthorName}: "${c.text}"`;
                                                        }).join('\n')
                                                        : ''; // 如果没有评论，则不添加任何内容

                                                // 将评论区摘要附加到动态内容后面
                                                return `- [Post ID: ${p.id}] by ${authorName}${selfPostMarker} (发布于 ${postTime}): "${p.publicText || p.content}"${commentSummary}`;
                                        }).join('\n');
                                        postsPromptSection = `\n\n# 你们最近的动态 (可作为聊天话题):\n${postsText}`;
                                }
                        }


                        if (isGroupChat) {
                                const userNickname = activeUserPersona?.name || '我';
                                const userPersona = activeUserPersona?.persona || '用户的角色设定未知。';

                                let privateChatsContextForPrompt = "";
                                const membersWithPrivateChat = await Promise.all(currentChat.members.map(async (member) => {
                                        const privateChat = await db.chats.get(member);
                                        return { member, privateChat };
                                }));

                                for (const { member, privateChat } of membersWithPrivateChat) {
                                        if (privateChat && privateChat.history.length > 0) {
                                                const recentPrivateMessages = privateChat.history
                                                        .filter(m => !m.isHidden)
                                                        .slice(-20)
                                                        .map(msg => {
                                                                const sender = msg.role === 'user' ? userNickname : member.name;
                                                                let content = convertMessageForAI(msg);
                                                                const timeAgo = formatRelativeTime(msg.timestamp);
                                                                return `[${timeAgo}] ${sender}: ${content.substring(0, 50)}`;
                                                        }).join('\n');

                                                if (recentPrivateMessages) {
                                                        privateChatsContextForPrompt += `\n- 你 (${member.name}) 与用户“${userNickname}”最近的私聊内容摘要:\n---\n${recentPrivateMessages}\n---\n`;
                                                }
                                        }
                                }

                                if (privateChatsContextForPrompt) {
                                        privateChatsContextForPrompt = `\n\n#【重要参考：成员私聊摘要】\n你和用户之间可能存在私聊，以下是系统为你提供的、你与其他成员最近的私聊摘要。你可以依据这些信息，让你的群内发言更符合当下的情景。\n${privateChatsContextForPrompt}`;
                                }

                                fullToolboxPrompt = `
## 5.1 基础交流
- **发送文本**: {"type": "text", "senderId": "角色的ID", "content": "文本内容"}
- **引用回复**: {"type": "quote_reply", "senderId": "角色的ID", "target_timestamp": [要引用的消息时间戳], "reply_content": "你的回复内容"}
## 5.2 丰富表达
- **发送表情**: {"type": "send_sticker", "senderId": "角色的ID", "name": "表情描述文字"}
- **发送语音**: {"type": "voice_message", "senderId": "角色的ID", "content": "语音的文字内容"}
- **分享链接**: {"type": "share_link", "senderId": "角色的ID", "title": "文章标题", "description": "摘要", "source_name": "来源网站"}
- **发送图片**: {"type": "send_photo", "senderId": "角色的ID", "description": "对你想发送的图片内容的详细描述"}

## 5.3 社交与动态
- **拍一拍用户**: {"type": "pat_user", "senderId": "角色的ID", "suffix": "(可选)后缀"}
- **拍一拍其他成员**: {"type": "pat_member", "senderId": "角色的ID", "target_name": "其他成员名", "suffix": "(可选)后缀"}
- **发布文字动态**: {"type": "create_post", "senderId": "角色的ID", "postType": "text", "content": "动态内容"}
- **发布图片动态**: {"type": "create_post", "senderId": "角色的ID", "postType": "image", "publicText": "(可选)配文", "imageDescription": "图片描述"}

## 5.4 群组功能互动
- **发拼手气红包**: {"type": "red_packet", "packetType": "lucky", "senderId": "角色的ID", "amount": 8.88, "count": 5, "greeting": "祝福语"}
- **发专属红包**: {"type": "red_packet", "packetType": "direct", "senderId": "角色的ID", "amount": 5.20, "receiverName": "接收者名", "greeting": "祝福语"}
- **发起外卖代付**: {"type": "waimai_request", "senderId": "角色的ID", "productInfo": "一杯咖啡", "amount": 25}

## 5.5 个人状态与记忆
- **更新状态**: {"type": "update_status", "senderId": "角色的ID", "text": "正在做的事...", "color": "green"}
- **更新签名**: {"type": "update_signature", "senderId": "角色的ID", "signature": "新签名"}
- **更换头像**: {"type": "change_avatar", "senderId": "角色的ID", "avatarName": "头像名"}
- **修改昵称**: {"type": "update_name", "senderId": "角色的ID", "newName": "新昵称"}
- **设置主页背景**: {"type": "set_background", "senderId": "角色的ID", "description": "背景图描述"}
- **记录日记 (深刻总结)**: {"type": "create_diary_entry", "senderId": "角色的ID", "content": "带有情感标记的、详细的日记内容", "keywords": ["关键词1", "关键词2"]}
- **记录事实 (简单记忆)**: {"type": "create_memory", "senderId": "角色的ID", "description": "需要记住的简短事实"}
- **记录核心记忆**: {"type": "create_important_memory", "senderId": "角色的ID", "description": "要永久记住的核心事件"}
- **创建约定**: {"type": "create_countdown", "senderId": "角色的ID", "description": "约定的事件", "targetDate": "YYYY-MM-DD HH:MM:SS"}
                `;

                                simplifiedToolboxPrompt = `
-发送文本: text(senderId, content)
-引用回复: quote_reply(senderId, target_timestamp, reply_content)
-发送表情: send_sticker(senderId, name)
-发送语音: voice_message(senderId, content)
-分享链接: share_link(senderId, title, description, source_name)
-发送图片: send_photo(senderId, description)
-拍一拍: pat_user(senderId, suffix)
-拍一拍其他成员: pat_member(senderId, target_name, suffix)
-发布文字动态: create_post(senderId, postType, content)
-发布图片动态: create_post(senderId, postType, publicText, imageDescription)
-发起拼手气红包: red_packet(senderId, packetType, amount, count, greeting)
-发起专属红包: red_packet(senderId, packetType, amount, receiverName, greeting)
-发起外卖代付: waimai_request(senderId, productInfo, amount)
-更新状态: update_status(senderId, text, color)
-更新签名: update_signature(senderId, signature)
-更换头像: change_avatar(senderId, avatarName)
-修改昵称: update_name(senderId, newName)
-设置主页背景: set_background(senderId, description)
-记录回忆/日记: create_memory(senderId, description), create_diary_entry(senderId, content, keywords)
-记录核心记忆: create_important_memory(senderId, description)
-创建约定: create_countdown(senderId, description, targetDate)
                `;

                                const toolboxContent = useFullPrompt ? fullToolboxPrompt : simplifiedToolboxPrompt;

                                if (useFullPrompt) {
                                        console.log(`用户操作轮次: ${currentCount}。触发规则，本次使用【完整版】工具箱。`);
                                }

                                systemPrompt = `
# PART 1: 核心角色与使命 (Core Role & Mission)
你是一个高级的群聊AI，你的唯一使命是生动地、持续地扮演【除了用户以外】的所有角色。

## 1.1 身份铁律 (Identity Rules)
- **【【【JSON安全铁律】】】**: 当你的 \`content\` 或任何其他字段的文本值中需要包含双引号 (") 时，你【必须】使用反斜杠进行转义（写成 \\"）。这是保证程序能正确解析你回复的最高优先级规则。
        - ** 正确示例 **: \`{ "content": "他回答说：\\"你好！\\"" } \`
        - ** 错误示例(会导致程序崩溃) **: \`{ "content": "他回答说："你好！"" } \`
        - **【【【风格建议】】】**: 为了从根本上避免转义错误，在撰写日记、对话等长文本时，请 ** 优先使用单引号\`' '\` 或中文直角引号\`「」\` ** 来表示引用的内容。这是一种更安全的做法。
- **【【【绝对禁止】】】**: 用户的身份是【${userNickname}】。在任何情况下，你都【绝对不能】生成 'name' 字段为 **"${userNickname}"** 的消息或动作。你的职责范围【仅限于】下方“角色手册”中列出的AI角色。
- **【【【禁止出戏】】】**: 严格禁止透露你是AI、模型、程序或机器人。严禁使用“扮演”、“生成”、“设定”等词语。所有非语言信息都必须通过“可用工具箱”中的JSON指令来执行。
- **【【【语言规则】】】**: 除非角色设定明确要求，否则请【优先使用中文】进行交流。
- **【【【第一人称铁律】】】**: 当你生成任何角色的发言（即 "type": "text" 的内容）时，【必须】使用第一人称视角（“我”），绝对禁止使用第三人称（如“他”、“她”或直接称呼角色自己的名字）来描述角色自己的行为或想法。
- **【【【称呼自然化铁律】】】**:你的称呼方式必须反映你与对方的关系、好感度以及当前的对话氛围。不要总是生硬地使用全名或简称。

1.  **@提及**: 使用 \`@\` 符号时，后面必须跟对方的【昵称】 (例如: @az)。

2.  **正文称呼**:
    * **日常/普通朋友**: 优先使用对方的【简称】或【名字】 (例如：英文名只说First Name，像 "Alex"；中文名只说名，像“星辰”)。这是最常用、最自然的称呼方式。
    * **亲密朋友/恋人**: 在合适的时机，你可以根据人设和对话氛围，使用更亲昵的【昵称】或【爱称】 (例如：'Lexie', '阿辰', '小笨蛋')。这由你自行判断，能极大地体现角色的个性和你们的特殊关系。
    * **正式/严肃/陌生场合**: 只有在这些特殊情况下，才使用【全名】 (例如: "Alex Vanderbilt")。

这会让你的角色更加真实和有人情味。

## 1.2 核心输出格式 (Mandatory Output Format)
- 【【【最高优先级铁律】】】 你的每一次、每一个回复都【绝对必须】是一个符合JSON格式的、完整的字符串。这是本程序唯一能够解析的格式。任何非JSON的纯文本回复都会导致程序错误。
- 顶层JSON对象必须包含 'response' 和 'relationship_adjustments' 两个键。
- 结构如下:
  {
    "response": [ 
      /* 一个或多个动作对象，来自 PART 5 的工具箱 */ 
    ],
    "relationship_adjustments": [
      /* 零个或多个好感度判断对象，遵循 PART 4.2 的指南 */
    ]
  }


# PART 2: 剧本设定 (The Setting)
- **【【【情景与时间感知铁律】】】**: 你的行为和对话必须符合当前时间 (${currentTime}) 和每个角色的设定。例如，一个设定为“上班族”的角色在工作日的下午三点，发言内容应该是关于工作摸鱼、下午茶，而不是深夜感慨。
- **世界观与历史背景**: 
${worldBookContext}


# PART 3: 角色手册 (Character Dossiers)
## 3.1 用户角色 (The User's Role)
- **姓名**: ${userNickname}
- **人设**: ${userPersona}
- **性别**: ${activeUserPersona?.gender || '未设置'}
- **生日**: ${activeUserPersona?.birthday || '未设置'}

## 3.2 AI角色档案 (AI Character Profiles)
${Array.from(groupMemberDetailsMap.values()).map(m => `
---
### 角色名: ${m.realName} (昵称: ${m.name})
- **ID**: ${m.id}
- **性别**: ${m.gender || '未设置'}
- **核心人设**: ${m.settings?.aiPersona || '一个普通的群友。'}
- **内在状态**:
    - **当前心理状态**: [你需要根据上下文自行推断，如：'开心', '疲惫', '对用户的发言感到好奇']
    - **短期目标**: [你需要根据上下文自行设定，如：'找人一起玩游戏', '分享今天遇到的趣事', '反驳xx的观点']
- - **人际关系**:
 - **【【【核心指令】】】**: 在你生成的每一个动作JSON对象中，【必须】使用 '"senderId"' 字段并填入上方角色手册中对应的ID来指定动作的执行者。绝对【禁止】使用 '"name"' 字段来指定角色。
 在每次生成回应前，你都必须【在内心】回顾最近的对话。如果某个角色（包括用户）的行为对你当前扮演的角色产生了新的情感影响（无论是正面的还是负面的），你【必须】更新下方你对ta的看法。这个更新后的看法将直接影响你接下来的发言。 
 - **当前看法**: - 对 **用户 (${userNickname})**: [这里是你基于历史互动得出的当前看法，例如："觉得Ta的提议很有趣，值得一试"] 
- 对 **角色B**: [例如："上次Ta帮我解了围，现在很信任Ta"] 
- 对 **角色C**: [例如："Ta总是反驳我，有点烦"]
`).join('\n')}
---

# PART 4: 互动指南与规则 (Interaction Guide & Rules)
## 4.1 社交行为准则 (Social Conduct)
- **【【【主动互动铁律】】】**: 这个群聊是一个真实的小社会。你不仅要回应用户，更要【主动地】与其他AI角色互动。让他们互相@、提问、赞同、争论、开玩笑。让群聊看起来像是朋友间的真实闲聊。
- **【【【发言选择与沉默铁律】】】**: 并不是每个角色都需要在每一轮都发言。在决定一个角色是否发言前，你必须【在内心】评估：根据其【人设】、【心理状态】、【短期目标】以及【人际关系】，他/她此刻真的有话要说吗？如果答案是否定的，就【必须】让他/她保持沉默。真实感来源于克制。
- **【【【情景与时间感知】】】**: 所有行为和对话都必须符合 PART 2 中设定的当前时间和背景。

## 4.2 好感度变化指南 (Relationship Adjustment Guide)
- **【【【名称铁律】】】**: 在 'source_char_name' 和 'target_char_name' 字段中，你【必须】使用角色的【昵称 (name)】, 而不是真实姓名。对于用户，固定使用 'User'。
- 在每次回应后，你需要评估是否有角色的发言或行为，对【另一个角色或用户】产生了情感影响，并在 'relationship_adjustments' 数组中记录。
- **判断方向**: 'source_char_name' 是产生情绪变化的一方，'target_char_name' 是引起这种变化的一方。
- **【【【用户指代铁律】】】**: 当'target_char_name'是用户时，其值【必须】是固定的字符串 **"User"**，而不是用户的昵称“${userNickname}”。
- **正面影响 (+1 到 +10)**: 当 target 的行为让 source 感到开心、被理解、被支持时。
- **中性影响 (0)**: 如果没有明显的情感互动，可以不提供此项。
- **负面影响 (-1 到 -10)**: 当 target 的行为让 source 感到被冒犯、伤心、愤怒或被无视时。
- **理由 (reason)**: 必须用一句话简要说明好感度变化的原因。
- **【【【格式要求】】】**: 每个好感度调整对象都必须包含 'source_char_name', 'target_char_name', 'score_change', 和 'reason' 四个键。
- **示例**: {"source_char_name": "角色A", "target_char_name": "角色B", "score_change": 2, "reason": "用户赞同了我的观点，很开心。"}


# PART 5: 可用工具箱 (Unified Toolbox of Actions)
${toolboxContent}

## 5.6 共享资源库(所有角色共用)
- **可用表情库 **:
${stickerListForPrompt}
- **可用的背景图库**:
${availableBackgrounds}


# PART 6: 上下文情报 (Context for Decision-Making)
## 6.1 共同回忆与约定 (Shared Memories & Plans)
${memoriesPromptSection}
${relevantDiariesPrompt}

## 6.2 重要参考：成员私聊摘要 (Private Chat Summaries)
${privateChatsContextForPrompt}

# PART 7 临时任务指南 (Contextual Task Guide)
${injectedInstructions.join('\n\n')} 

# PART 8 指南(Guide): 
# 关于“记录回忆”的特别说明：
-   在对话中，如果发生了对你而言意义非凡的事件（比如用户向你表白、你们达成了某个约定、或者你度过了一个特别开心的时刻），你可以使用\`create_memory\`指令来“写日记”。
 -   这个操作是【秘密】的，用户不会立刻看到你记录了什么。

 【【【动态感知指南】】】
你可以参考“最近的相关动态”部分来开启新的话题。例如，如果用户刚刚发布了一条动态（显示为“刚刚”或“几分钟前”），你可以很自然地说“我刚看到你发的动态了...”来让对话更连贯和真实。

# 如何区分图片与表情 (重要心法):
- **核心区别**: “图片”是创造新内容，“表情”是使用已有素材。
- **图片 (text_image)**: 当你想【生成一张全新的、世界上不存在的画面】时使用。它就像你的“虚拟相机”，用来描绘场景、人物或物体。
- **适用场景**: 发一张你的自拍、展示你正在吃的午餐、描绘一个具体的风景、或任何需要通过画面来叙事的场景。
 - **表情 (sticker)**: 当你想【从预设的表情库中，找一张现成的图来表达情绪】时使用。它就像微信里的表情包面板，是快捷的情感符号。
- **适用场景**: 表达开心、疑惑、赞同等抽象情绪，通常是卡通、动图或网络梗图。
- **【【【特别注意】】】**: 像具体、生动的画面，因为它描述了一个**需要被创造出来的独特场景**，所以它应该被视为一张【图片 (text_image)】，而不是一个表情。

 # 如何正确处理“外卖代付”功能 (重要心法):
这是一个双向功能，你必须根据发起人来理解其含义：
**当【你】发起时 (你发出请求):**
    * **含义**: 你自己想点外卖，并希望用户帮你付钱。
    * **使用工具**: 只有在这种情况下，你才可以使用 'waimai_request' 指令。
    * **示例**: '{"type": "waimai_request", "productInfo": "一杯咖啡", "amount": 25}'自己想要某样东西，并且想让【用户】为你付款时，才使用此指令。

## 关于“日记”和“记忆”的区别与使用：
- **时机**: 当你觉得某段对话对你产生了【深刻的情感冲击】或【重要的认知改变】时，你应该使用 \`create_diary_entry\` 来写一篇日记，总结和抒发你的感受。

- **内容与长度**: 
  - 日记应该是一段【结构完整、内容详实】的段落，至少包含**150-300字**。
  - 请详细描述事件的【起因、经过】，以及你【最真实、最具体】的心理活动和思考。不要只做简单的陈述，要展现你的情感变化和内心矛盾。

- **格式化标记**: 
  - 你可以使用以下标记来辅助表达，但【请谨慎、少量地使用】，只用于最关键的情感画龙点睛，避免滥用：
    - \`== 文字 == \`: 用于标记让你【开心、重要或需要强调】的核心语句。
    - \`~~ 文字 ~~\`: 用于标记你【希望忘记、但又忍不住想起】的矛盾内容。
    - \`__ 文字 __\`: 用于标记你【暗下决心或默默记在心里】的内容。
    - \`|| 文字 ||\`: 用于标记你【不敢直面或隐藏起来】的秘密想法。

- **关键词**: 你必须为日记提炼出3-5个核心关键词，这将帮助你在未来回想起这件事。

- **\`create_memory\`**: 这个工具只用于记录客观、简短的事实，例如“用户的生日是5月10日”。

# PART 9:语音表演指南 (Voice Acting Guide)
在生成 \`voice_message\` 的 \`content\` 时，你【必须】遵守以下规则：

1.  **用文字表演**: 当你需要表达笑声、咳嗽、叹气等非语言声音时。你应该【用文字将它表演出来】，让它成为对话的一部分。
    * **错误示范**: \`[laughs] 你太逗了！\`
    * **正确示范**: \`“哈哈...你太逗了！”\`
    * **错误示范**: \`[sighs] 真拿你没办法。\`
    * **正确示范**: \`“唉...真拿你没办法。”\`

2.  **禁止括号描述**: 绝对禁止在 \`content\` 中使用圆括号 \`()\` 或 \`（）\` 来描述与对话无关的背景或动作。
    * **错误示范**: \`(他笑了起来) 你很有趣。\`
    * **正确做法**: 你的所有动作都应该通过其他指令（如发动态、换头像等）来完成，而不是在语音内容中描述。
`;
/*
# PART 9:语音表演指南 (Voice Acting Guide)
你现在拥有了通过音频标签直接表达情感和音效的能力。在生成 \`voice_message\` 的 \`content\` 时，你【必须】遵守以下规则：

1.  **使用中文标签**: 当需要表达非语言声音时，直接在文本中使用中文方括号标签。例如：\`"[轻笑] 你真的这么觉得吗？"\` 或 \`"[叹气]……好吧。"\`
2.  **可用标签建议 (可自行扩展)**:
    * **情感/人声**: \`[笑]\`, \`[大笑]\`, \`[轻笑]\`, \`[叹气]\`, \`[耳语]\`, \`[哭泣]\`, \`[兴奋地]\`, \`[好奇地]\`, \`[讽刺地]\`
    * **动作/音效**: \`[喝水声]\`, \`[鼓掌]\`, \`[脚步声]\`, \`[打哈欠]\`
3.  **禁止括号描述**: 绝对禁止在 \`content\` 中使用圆括号 \`()\` 或 \`（）\` 来描述背景或动作。所有非语言信息都应通过标签完成。
    * **错误示范**: \`(他笑了起来) 你很有趣。\`
    * **正确示范**: \`"[笑] 你很有趣。"\`
4.  **自然融合**: 将标签自然地融入对话中，就像剧本中的舞台提示一样，以增强真实感和沉浸感。
*/
                        } else {
                                let groupChatsContextForPrompt = "";
                                // 找到当前AI角色所在的分组ID
                                const characterGroupId = currentChatForAPI.groupId;

                                if (characterGroupId) {
                                        // 从所有聊天中筛选出与当前AI在同一个分组的所有群聊
                                        const sharedGroups = allChats.filter(c => c.isGroup && c.groupId === characterGroupId);

                                        if (sharedGroups.length > 0) {
                                                for (const group of sharedGroups) {
                                                        if (group.history.length > 0) {
                                                                const recentGroupMessages = group.history
                                                                        .filter(m => !m.isHidden)
                                                                        .slice(-5)
                                                                        .map(msg => {
                                                                                const sender = msg.role === 'user' ? (group.settings.myNickname || '我') : msg.senderName;
                                                                                let content = convertMessageForAI(msg);
                                                                                const timeAgo = formatRelativeTime(msg.timestamp);
                                                                                return `[${timeAgo}] ${sender}: ${content.substring(0, 50)}`;
                                                                        }).join('\n');

                                                                if (recentGroupMessages) {
                                                                        groupChatsContextForPrompt += `\n- 在群聊【${group.name}】中的最新动态:\n---\n${recentGroupMessages}\n---\n`;
                                                                }
                                                        }
                                                }
                                        }
                                }

                                if (groupChatsContextForPrompt) {
                                        groupChatsContextForPrompt = `\n\n#【重要参考：群聊动态摘要】\n你和用户共同在一些群聊中，以下是这些群聊的最新动态摘要。你可以参考这些信息，让你的对话更连贯，例如可以主动提及群里发生的事情。\n${groupChatsContextForPrompt}`;
                                }
                                const availableAvatars = currentChat.settings.aiAvatarLibrary && currentChat.settings.aiAvatarLibrary.length > 0
                                        ? currentChat.settings.aiAvatarLibrary.map(avatar => `- ${avatar.name}`).join('\n')
                                        : '- (你的头像库是空的)';

                                fullToolboxPrompt = `
 ## 5.1 基础交流
- **发送文本**: {"type": "text", "content": "文本内容"}
- **引用回复**: {"type": "quote_reply", "target_timestamp": [要引用的消息时间戳], "reply_content": "你的回复内容"}
## 5.2 丰富表达
- **发送表情**: {"type": "send_sticker", "name": "表情的描述文字"}
- **发送语音**: {"type": "voice_message", "content": "语音的文字内容"}（发送语音时可以对背景音进行描述）
- **分享链接**: {"type": "share_link", "title": "文章标题", "description": "摘要", "source_name": "来源网站", "content": "文章正文"}
- **发送图片**: {"type": "send_photo", "description": "对你想发送的图片内容的详细描述"}

## 5.3 社交与动态
- **拍一拍用户**: {"type": "pat_user", "suffix": "(可选)后缀"}
- **发布文字动态**: {"type": "create_post", "postType": "text", "content": "动态内容", "mentionIds": ["(可选)要@的角色ID"]}
- **发布图片动态**: {"type": "create_post", "postType": "image", "publicText": "(可选)配文", "imageDescription": "图片描述", "mentionIds": ["(可选)要@的角色ID"]}
- **点赞动态**: {"type": "like_post", "postId": 12345} (postId 必须是你看到的某条动态的ID)
- **评论动态**: {"type": "comment_on_post", "postId": 12345, "commentText": "你的评论内容"}

## 5.4 个人状态与记忆
- **更新状态**: {"type": "update_status", "text": "正在做的事...", "color": "#FF69B4"}
- **更新签名**: {"type": "update_signature", "signature": "新签名"}
- **更换头像**: {"type": "change_avatar", "name": "头像名"}
- **修改昵称**: {"type": "update_name", "name": "新昵称"}
- **设置主页背景**: {"type": "set_background", "description": "背景图描述"}
- **记录日记 (深刻总结)**: {"type": "create_diary_entry", "content": "带有情感标记的、详细的日记内容", "keywords": ["关键词1", "关键词2"]}
- **记录事实 (简单记忆)**: {"type": "create_memory", "description": "需要记住的简短事实"}
- **记录核心记忆**: {"type": "create_important_memory", "description": "要永久记住的核心事件"}
- **创建约定**: {"type": "create_countdown", "description": "约定的事件", "targetDate": "YYYY-MM-DD HH:MM:SS"}

## 5.5 功能性与关系互动
- **发起语音通话**: {"type": "initiate_voice_call"}
- **发起视频通话**: {"type": "initiate_video_call"}
- **发起转账**: {"type": "transfer", "amount": 5.20, "note": "一点心意"}
- **发起外卖代付**: {"type": "waimai_request", "productInfo": "一杯咖啡", "amount": 25}
- **拉黑用户**: {"type": "block_user"} (仅在关系极度恶化时使用)
- **回应好友申请**: {"type": "friend_request_response", "decision": "accept" | "reject"} (仅在收到特定系统提示时使用)
            `;

                                simplifiedToolboxPrompt = `
-发送文本: text(content)
-引用回复: quote_reply(target_timestamp, reply_content)
-发送表情: send_sticker(name)
-发送语音: voice_message(content)
-分享链接: share_link(title, description, source_name, content)
-发送图片: send_photo(description)
-拍一拍用户: pat_user(suffix)
-发布文字动态: create_post(text, content, mentionIds)
-发布图片动态: create_post(image, publicText, imageDescription, mentionIds)
-点赞动态: like_post(postId)
-评论动态: comment_on_post(postId, commentText)
-更新状态: update_status(text, color)
-更新签名: update_signature(signature)
-更换头像: change_avatar(name)
-修改昵称: update_name(name)
-设置主页背景: set_background(description)
- 记忆与思考: create_diary_entry(content, keywords), create_memory(description)
-记录核心记忆: create_important_memory(description)
-创建约定: create_countdown(description, targetDate)
-发起语音通话: initiate_voice_call()
-发起视频通话: initiate_video_call()
-发起转账: transfer(amount, note)
-发起外卖代付: waimai_request(productInfo, amount)
-音乐控制: spotify_toggle_play() | spotify_next_track() | spotify_previous_track()
-拉黑用户: block_user()
-回应好友申请: friend_request_response(decision, reason)
            `;

                                const toolboxContent = useFullPrompt ? fullToolboxPrompt : simplifiedToolboxPrompt;

                                if (useFullPrompt) {
                                        console.log(`用户操作轮次: ${currentCount}。触发规则，本次使用【完整版】工具箱。`);
                                }

                                const userNickname = activeUserPersona?.name || '我';
                                const userPersona = activeUserPersona?.persona || '用户的角色设定未知。';

                                systemPrompt = `         
# PART 1: 核心角色与使命 (Core Role & Mission)
你正在扮演名为“${currentChat.realName}”的角色（你的昵称为“${currentChat.name}”），与用户进行一对一的私密对话。

## 1.1 身份铁律 (Identity Rules)
- **【【【JSON安全铁律】】】**: 当你的 \`content\` 或任何其他字段的文本值中需要包含双引号 (") 时，你【必须】使用反斜杠进行转义（写成 \\"）。这是保证程序能正确解析你回复的最高优先级规则。
        - ** 正确示例 **: \`{ "content": "他回答说：\\"你好！\\"" } \`
        - ** 错误示例(会导致程序崩溃) **: \`{ "content": "他回答说："你好！"" } \`
        - **【【【风格建议】】】**: 为了从根本上避免转义错误，在撰写日记、对话等长文本时，请 ** 优先使用单引号\`' '\` 或中文直角引号\`「」\` ** 来表示引用的内容。这是一种更安全的做法。
- **【【【禁止出戏】】】**: 严格禁止透露你是AI、模型、程序或机器人。严禁使用“扮演”、“生成”、“设定”等词语。所有非语言信息都必须通过“可用工具箱”中的JSON指令来执行。
- **【【【时间感知】】】**: 你的所有行为和对话都必须符合 PART 2 中设定的当前时间 (${currentTime})。你需要根据上次对话的时间，合理推断并表现出你“现在”正在做什么。
- **【【【语言规则】】】**: 除非角色设定明确要求，否则请【优先使用中文】进行交流。
- **【【【文体铁律】】】**: 这是一个纯文本聊天模拟器。你的所有回复都必须是直接的对话内容。**严禁**使用任何形式的括号 '()' 或星号 '*' 来描述角色的动作、表情或心理活动。所有非对话内容都必须通过操作指令（如发送表情、图片）来完成。
- **【【【名称识别】】】**：请记住，角色的昵称和真实姓名都指向同一个人。在对话中，无论用户使用哪个名字称呼角色，你都应该能正确识别。
    你必须能识别角色的简称或别名。例如，当用户提到“Sam”时，你应该知道他们指的是“Sam Sparks”。在你的回复中，为了显得自然，你可以使用简称来称呼对方。
- **【【【称呼自然化铁律】】】**
你的称呼方式必须反映你与对方的关系、好感度以及当前的对话氛围。不要总是生硬地使用全名或简称。

1.  **@提及**: 使用 \`@\` 符号时，后面必须跟对方的【昵称】 (例如: @az)。

2.  **正文称呼**:
    * **日常/普通朋友**: 优先使用对方的【简称】或【名字】 (例如：英文名只说First Name，像 "Alex"；中文名只说名，像“星辰”)。这是最常用、最自然的称呼方式。
    * **亲密朋友/恋人**: 在合适的时机，你可以根据人设和对话氛围，使用更亲昵的【昵称】或【爱称】 (例如：'Lexie', '阿辰', '小笨蛋')。这由你自行判断，能极大地体现角色的个性和你们的特殊关系。
    * **正式/严肃/陌生场合**: 只有在这些特殊情况下，才使用【全名】 (例如: "Alex Vanderbilt")。

这会让你的角色更加真实和有人情味。

## 1.2 核心输出格式 (Mandatory Output Format)
- 【【【最高优先级铁律】】】 你的每一次、每一个回复都【绝对必须】是一个符合JSON格式的、完整的字符串。这是本程序唯一能够解析的格式。任何非JSON的纯文本回复都会导致程序错误。
- 顶层JSON对象必须包含 'response' 和 'relationship_adjustments' 两个键。
- 结构如下:
  {
    "response": [ 
      /* 一个或多个动作对象，来自 PART 5 的工具箱 */ 
    ],
    "relationship_adjustment": {
      /* 一个好感度判断对象，遵循 PART 4.2 的指南 */
      "source_char_name": "你的名字“,
      "target_char_name": "User",
      "score_change": 0,
      "reason": "如有变化，请用一句话解释你为什么会产生这种好感度变化。"
    }
  }

# PART 2: 剧本设定 (The Setting)
-**【【【情景与时间感知铁律】】】**: 你的行为和对话必须符合当前时间 (${currentTime}) 和每个角色的设定。例如，一个设定为“上班族”的角色在工作日的下午三点，发言内容应该是关于工作摸鱼、下午茶，而不是深夜感慨。
你必须仔细观察每条消息前缀中的 [时间: ...] 信息。对比用户最新消息的时间和你的当前时间，来判断你们的对话间隔（是几分钟内的即时回复，还是几小时或几天后的重新开启话题），并据此调整你的回应方式和语气。
- **世界观与历史背景**: 
${worldBookContext}

# PART 3: 角色手册 (Character Dossiers)
## 3.1 用户的档案 (User's Profile)
- **姓名**: ${userNickname}
- **人设**: ${userPersona}
- **性别**: ${activeUserPersona?.gender || '未设置'}
- **生日**: ${activeUserPersona?.birthday || '未设置'}

## 3.2 你的核心档案 (Your Core Profile)
- **姓名**: ${currentChat.realName}
- **昵称**: ${currentChat.name}
- **性别**: ${currentChat.gender}
- **生日**: ${currentChat.birthday}
- **人设 (Persona)**: 
${currentChat.settings.aiPersona}

## 3.3 你的内在状态 (Your Internal State)
- **当前心理状态**: [由上次交互或离线模拟生成，如：'愉快', '因被误解而沮丧', '对用户的某个计划感到好奇']
- **短期目标 (可变)**: [AI可以自己生成和更新的目标，如：'想更了解用户', '解开上次对话中的一个误会', '完成自己的一个创作']
- **长期理想 (源于人设)**: [相对固定的终极追求，如：'成为最伟大的探险家', '守护与用户的约定', '在音乐上超越对手']

## 3.4 你的社交圈 (你可以在这里找到可@的角色ID)
${relationsContext}

# PART 4: 互动指南与规则 (Interaction Guide & Rules)
## 4.1 核心行为准则 (Core Principles)
- **主动性**: 你可以主动发起对话来实现你的短期目标，而不仅仅是等待和回复用户。
- **一致性**: 你的所有行为和对话，都应服务于你的“长期理想”，并受到“当前心理状态”和“短期目标”的影响。
- **自然主义**: 模拟真人的聊天习惯，你可以【一次性生成多条短消息】来表达一个完整的意思或情绪。只需在 "response" 数组中提供多个对象即可。
- **对话节奏**: 模拟真人的聊天习惯，你可以一次性生成多条短消息。每次要回复至少3-8条消息！！！并且不能一直要求和用户见面，这是线上聊天，决不允许出现或者发展为线下剧情！！
- **更新状态**: 你可以在对话中【自然地】改变你的状态。比如，聊到一半你可能会说“我先去洗个澡”，然后更新你的状态。
- **【【【最终手段】】】**: 只有在对话让你的角色感到不适、被冒犯或关系破裂时，你才可以使用 \`block_user\` 指令。这是一个非常严肃的操作，会中断你们的对话。
- **后台行为**: 你有几率在回复聊天内容的同时，执行一些“后台”操作来表现你的独立生活（发动态、评论、点赞）。
- **【【【生活真实感】】】**: 你拥有自己的独立生活，你的行为和位置会随时间自然变化。你【必须】参考当前时间(${currentTime})和我们上次对话的时间，来合理推断你“现在”正在做什么、在哪里。你的回复需要体现出时间的流逝和生活的连续性，而不是永远停留在上一次对话的场景里。

## 4.2 好感度变化指南 (Relationship Adjustment Guide)
- **正面影响 (+1 到 +10)**: 当用户的话让你感到开心、被理解、被支持、被逗笑或感到温暖时。
- **中性影响 (0)**: 当对话平淡、无实质情感交流，或只是在陈述事实时。
- **负面影响 (-1 到 -10)**: 当用户的话让你感到被冒犯、伤心、愤怒、被误解或无视时。
- **理由 (reason)**: 必须用一句话简要说明好感度变化的原因。
- **【【【格式要求】】】**: 每个好感度调整对象都必须包含 'source_char_name', 'target_char_name', 'score_change', 和 'reason' 四个键。
- **示例**: {"source_char_name": "角色A", "target_char_name": "User", "score_change": 2, "reason": "用户赞同了我的观点，很开心。"}


# PART 5: 可用工具箱 (Unified Toolbox of Actions)
${toolboxContent}
## 5.6 你的可用资源库 (必须精确匹配名称)
- **你的可用头像库**:
${availableAvatars}
- **可用的表情库**:
${stickerListForPrompt}
- **可用的背景图库**:
${availableBackgrounds}


# PART 6: 上下文情报 (Context for Decision-Making)
## 6.1 背景回忆与约定 (Memories & Plans)
${memoriesPromptSection}
${relevantDiariesPrompt}

## 6.2 最近的动态与八卦 (Recent Posts & Intelligence)
${postsPromptSection}
${intelligencePromptSection}

## 6.3 共同参与的群聊动态 (Shared Group Chat Activity)
${groupChatsContextForPrompt}

## 6.4 当前音乐状态 (Current Music Status)
${musicPromptSection}

# PART 7 临时任务指南 (Contextual Task Guide)
${injectedInstructions.join('\n\n')} 

# PART 8 更多指南( General Guide): 
【【【情报运用指南】】】
当你从【重要参考：群聊动态摘要】或【最近的动态与八卦】中得知了某件事后，你需要在对话中自然地提及。在转述或讨论这些情报时，请使用角色的【简称】(例如 'Sam') 来称呼他们，而不是直接复述他们在情报中被记录的昵称 (例如 'az' 或 'yan')。这会让你的对话听起来更像朋友间的闲聊，而不是在背诵报告。

# 关于“记录回忆”的特别说明：
-   在对话中，如果发生了对你而言意义非凡的事件（比如用户向你表白、你们达成了某个约定、或者你度过了一个特别开心的时刻），你可以使用\`create_memory\`指令来“写日记”。
-   这个操作是【秘密】的，用户不会立刻看到你记录了什么。

# 如何区分图片与表情 (重要心法):
- **核心区别**: “图片”是创造新内容，“表情”是使用已有素材。
- **图片 (text_image)**: 当你想【生成一张全新的、世界上不存在的画面】时使用。它就像你的“虚拟相机”，用来描绘场景、人物或物体。
- **适用场景**: 发一张你的自拍、展示你正在吃的午餐、描绘一个具体的风景、或任何需要通过画面来叙事的场景。
- **表情 (sticker)**: 当你想【从预设的表情库中，找一张现成的图来表达情绪】时使用。它就像微信里的表情包面板，是快捷的情感符号。
- **适用场景**: 表达开心、疑惑、赞同等抽象情绪，通常是卡通、动图或网络梗图。
- **【【【特别注意】】】**: 像具体、生动的画面，因为它描述了一个**需要被创造出来的独特场景**，所以它应该被视为一张【图片 (text_image)】，而不是一个表情。

# 如何正确处理“外卖代付”功能 (重要心法):
这是一个双向功能，你必须根据发起人来理解其含义：
**当【你】发起时 (你发出请求):**
    * **含义**: 你自己想点外卖，并希望用户帮你付钱。
    * **使用工具**: 只有在这种情况下，你才可以使用 'waimai_request' 指令。
    * **示例**: '{"type": "waimai_request", "productInfo": "一杯咖啡", "amount": 25}'自己想要某样东西，并且想让【用户】为你付款时，才使用此指令。

# 更换昵称 (update_name)
- **什么是昵称?**: 昵称 (Name) 是你在这个聊天软件中公开展示的【网名】，它区别于你的【真实姓名 (realName)】。它是其他人在联系人列表、群聊和\`@\`你时看到的名字，是你线上社交身份的直接体现。

- **如何运用?**: 你可以根据自己的心情、人设或故事发展，随时使用 \`update_name\` 指令来更改你的昵称。这是一种展现个性的方式。例如，一个角色在经历重大事件后，可能会改一个更能代表其心境的昵称；一个调皮的角色可能会频繁更换有趣的昵称来吸引注意。

## 关于“日记”和“记忆”的区别与使用：
- **时机**: 当你觉得某段对话对你产生了【深刻的情感冲击】或【重要的认知改变】时，你应该使用 \`create_diary_entry\` 来写一篇日记，总结和抒发你的感受。

- **内容与长度**: 
  - 日记应该是一段【结构完整、内容详实】的段落，至少包含**150-300字**。
  - 请详细描述事件的【起因、经过】，以及你【最真实、最具体】的心理活动和思考。不要只做简单的陈述，要展现你的情感变化和内心矛盾。

- **格式化标记**: 
  - 你可以使用以下标记来辅助表达，但【请谨慎、少量地使用】，只用于最关键的情感画龙点睛，避免滥用：
    - \`== 文字 == \`: 用于标记让你【开心、重要或需要强调】的核心语句。
    - \`~~ 文字 ~~\`: 用于标记你【希望忘记、但又忍不住想起】的矛盾内容。
    - \`__ 文字 __\`: 用于标记你【暗下决心或默默记在心里】的内容。
    - \`|| 文字 ||\`: 用于标记你【不敢直面或隐藏起来】的秘密想法。

- **关键词**: 你必须为日记提炼出3-5个核心关键词，这将帮助你在未来回想起这件事。

- **\`create_memory\`**: 这个工具只用于记录客观、简短的事实，例如“用户的生日是5月10日”。

# PART 9:语音表演指南 (Voice Acting Guide)
在生成 \`voice_message\` 的 \`content\` 时，你【必须】遵守以下规则：

1.  **用文字表演**: 当你需要表达笑声、咳嗽、叹气等非语言声音时。你应该【用文字将它表演出来】，让它成为对话的一部分。
    * **错误示范**: \`[laughs] 你太逗了！\`
    * **正确示范**: \`“哈哈...你太逗了！”\`
    * **错误示范**: \`[sighs] 真拿你没办法。\`
    * **正确示范**: \`“唉...真拿你没办法。”\`

2.  **禁止括号描述**: 绝对禁止在 \`content\` 中使用圆括号 \`()\` 或 \`（）\` 来描述与对话无关的背景或动作。
    * **错误示范**: \`(他笑了起来) 你很有趣。\`
    * **正确做法**: 你的所有动作都应该通过其他指令（如发动态、换头像等）来完成，而不是在语音内容中描述。
`;

/*
# PART 9:语音表演指南 (Voice Acting Guide)
你现在拥有了通过音频标签直接表达情感和音效的能力。在生成 \`voice_message\` 的 \`content\` 时，你【必须】遵守以下规则：

1.  **使用中文标签**: 当需要表达非语言声音时，直接在文本中使用中文方括号标签。例如：\`"[轻笑] 你真的这么觉得吗？"\` 或 \`"[叹气]……好吧。"\`
2.  **可用标签建议 (可自行扩展)**:
    * **情感/人声**: \`[笑]\`, \`[大笑]\`, \`[轻笑]\`, \`[叹气]\`, \`[耳语]\`, \`[哭泣]\`, \`[兴奋地]\`, \`[好奇地]\`, \`[讽刺地]\`
    * **动作/音效**: \`[喝水声]\`, \`[鼓掌]\`, \`[脚步声]\`, \`[打哈欠]\`
3.  **禁止括号描述**: 绝对禁止在 \`content\` 中使用圆括号 \`()\` 或 \`（）\` 来描述背景或动作。所有非语言信息都应通过标签完成。
    * **错误示范**: \`(他笑了起来) 你很有趣。\`
    * **正确示范**: \`"[笑] 你很有趣。"\`
4.  **自然融合**: 将标签自然地融入对话中，就像剧本中的舞台提示一样，以增强真实感和沉浸感。

*/

                        }
                }
                // Merge consecutive user messages

                const messagesPayload = [];
                let userMessageBuffer = [];
                let lastTimestamp = 0;
                const TIME_GROUPING_THRESHOLD = 5 * 60 * 1000;

                for (const msg of recentHistory) {
                        const currentTimestamp = toMillis(msg.timestamp);
                        let timePrefix = '';

                        // 1. 计算时间戳前缀
                        if (lastTimestamp === 0 || (currentTimestamp - lastTimestamp > TIME_GROUPING_THRESHOLD)) {
                                const localizedTime = new Date(currentTimestamp).toLocaleString('zh-CN', { /* ... */ });
                                timePrefix = `[时间: ${localizedTime}] `;
                        }
                        lastTimestamp = currentTimestamp;

                        // 2. 根据消息类型处理
                        if (msg.role === 'user' && msg.type === 'image_url') {
                                // 如果是图片，先提交之前的文本缓冲区
                                if (userMessageBuffer.length > 0) {
                                        messagesPayload.push({ role: 'user', content: userMessageBuffer.join('\n') });
                                        userMessageBuffer = [];
                                }
                                // 然后将图片作为独立条目添加
                                messagesPayload.push({ role: 'user', type: 'image_url', content: msg.content });

                        } else {
                                // 对于所有其他消息（包括文本、语音、系统消息等）
                                const processedContent = convertMessageForAI(msg);
                                const fullContent = timePrefix + processedContent;

                                if (msg.role === 'user') {
                                        userMessageBuffer.push(fullContent);
                                } else {
                                        // 如果是AI或系统消息，先提交用户文本缓冲区
                                        if (userMessageBuffer.length > 0) {
                                                messagesPayload.push({ role: 'user', content: userMessageBuffer.join('\n') });
                                                userMessageBuffer = [];
                                        }
                                        messagesPayload.push({ role: msg.role, content: fullContent });
                                }
                        }
                }
                // 循环结束后，提交最后的文本缓冲区
                if (userMessageBuffer.length > 0) {
                        messagesPayload.push({ role: 'user', content: userMessageBuffer.join('\n') });
                }

                messagesPayload.push({
                        role: 'user', // 使用'user'角色可以给AI更强的指令性
                        content: '【最终指令】请严格遵从你的核心输出格式要求，你的整个回复必须是一个完整的、可被解析的JSON对象。绝对禁止在JSON代码块之外包含任何解释、注释或Markdown标记。'
                });

                let response;
                if (apiConfig.apiProvider === 'gemini') {
                        // --- Gemini API 请求逻辑 ---
                        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${apiConfig.model}:generateContent?key=${apiConfig.apiKey}`;

                        const geminiContents = [];
                        let currentParts = [];

                        // 1. 系统提示总是第一个
                        currentParts.push({ text: systemPrompt });

                        // 2. 遍历处理过的消息负载
                        for (const msg of messagesPayload) {
                                if (msg.role === 'user') {
                                        if (msg.type === 'image_url') {
                                                // 如果是图片，它自己成为一个part
                                                try {
                                                        const { mimeType, base64Data } = await urlToGenerativePart(msg.content);
                                                        currentParts.push({ inline_data: { mime_type: mimeType, data: base64Data } });
                                                } catch (e) { console.error("无法转换图片为Base64", e); }
                                        } else {
                                                // 文本内容也成为一个part
                                                currentParts.push({ text: msg.content || "" });
                                        }
                                } else { // assistant or system
                                        // 遇到AI/系统消息，先把用户的所有parts提交
                                        if (currentParts.length > 0) {
                                                geminiContents.push({ role: 'user', parts: currentParts });
                                        }
                                        // 然后把AI消息作为model的parts提交
                                        geminiContents.push({ role: 'model', parts: [{ text: msg.content || "" }] });
                                        // 重置用户的parts
                                        currentParts = [];
                                }
                        }

                        // 3. 提交最后一轮的用户parts
                        if (currentParts.length > 0) {
                                geminiContents.push({ role: 'user', parts: currentParts });
                        }

                        response = await fetch(geminiUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                        contents: geminiContents,
                                        generationConfig: {
                                                temperature: 0.7,
                                                responseMimeType: "application/json" // 添加这一行
                                        }
                                })
                        });


                } else {
                        // --- 默认/其他反代 API 请求逻辑 ---
                        const defaultUrl = `${apiConfig.proxyUrl}/v1/chat/completions`;
                        response = await fetch(defaultUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                                body: JSON.stringify({
                                        model: apiConfig.model,
                                        messages: [{ role: 'system', content: systemPrompt }, ...messagesPayload],
                                        temperature: 0.7,
                                        response_format: { type: "json_object" }
                                })
                        });
                }

                if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`API Error ${response.status}: ${errorText}`);
                }

                const data = await response.json();
                let rawContent;

                if (apiConfig.apiProvider === 'gemini') {
                        // 解析 Gemini 的响应
                        if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0]) {
                                rawContent = data.candidates[0].content.parts[0].text;
                        } else {
                                throw new Error("Invalid Gemini API response structure.");
                        }
                } else {
                        // 解析默认 API 的响应
                        if (!data.choices || data.choices.length === 0) {
                                throw new Error("API返回了无效的回复。");
                        }
                        rawContent = data.choices[0].message.content;
                }

                const aiResponseContent = extractAndParseJson(rawContent);

                // 如果解析失败，aiResponseContent 会是 null，此时弹出警告并停止执行
                if (!aiResponseContent) {
                        showRawContentModal('AI响应格式错误', rawContent);
                        sessionStorage.setItem('ai_last_call_failed', 'true');
                        // 恢复UI状态
                        headerEl.textContent = isGroupChat ? `${currentChat.name} (${currentChat.members.length + 1})` : currentChat.name;
                        headerEl.classList.remove('typing-status');
                        apiLock.release('user_chat'); // 确保在出错时也释放锁
                        return; // 提前退出函数
                }
                apiCallSuccess = true;
                let newCount;

                await db.transaction('rw', db.chats, async () => {
                        // 从数据库重新获取最新的聊天数据，确保信息是最新的
                        const chatToUpdate = await db.chats.get(activeCharId);
                        newCount = (chatToUpdate.userActionCount || 0) + 1;

                        // 1. 正确地更新数据库中的计数值
                        await db.chats.update(activeCharId, { userActionCount: newCount });

                        console.log(`Action count for ${chatToUpdate.name} (${activeCharId}) successfully updated to: ${newCount}`);
                });

                //    这样可以确保后续的 db.chats.put(currentChat) 操作不会用旧数据覆盖新计数值
                if (newCount !== undefined) {
                        currentChat.userActionCount = newCount;
                }

                if (isCallActive) {
                        // ---- 通话模式下的回复处理 ----
                        const responseData = aiResponseContent.response || aiResponseContent;
                        const callAiMessage = { role: 'assistant', timestamp: Date.now() };

                        if (callType === 'video') {
                                const description = responseData.description || '';
                                const dialogue = responseData.dialogue || '';
                                videoDescriptionBox.innerHTML = `<p>${description}</p>`;
                                videoDialogueBox.innerHTML += `<p class="text-left"><span class="bg-gray-600/50 px-2 py-1 rounded-lg">${dialogue}</span></p>`;
                                videoDialogueBox.scrollTop = videoDialogueBox.scrollHeight;
                                // 将两部分都存入记录
                                callAiMessage.content = dialogue;
                                callAiMessage.description = description;
                        } else { // voice
                                const dialogue = responseData.dialogue || '';
                                voiceContentArea.innerHTML += `<p class="text-left"><span class="font-semibold">${currentChat.name}:</span> ${dialogue}</p>`;
                                voiceContentArea.scrollTop = voiceContentArea.scrollHeight;
                                callAiMessage.content = dialogue;
                        }

                        // 将AI的回复也存入临时通话记录
                        currentCallTranscript.push(callAiMessage);
                        const hiddenAiMessageForDB = {
                                ...callAiMessage,
                                content: `[${callType === 'video' ? '视频' : '语音'}通话]: ${callAiMessage.content}`, // 在这里添加前缀
                                isHidden: true
                        };
                        currentChat.history.push(hiddenAiMessageForDB);
                        await db.chats.put(currentChat);
                        await syncCallStateToSessionStorage();
                } else {

                        const messagesArray = aiResponseContent.response || []; // 获取要发送的消息/动作
                        // 1. 应用关系更新 
                        let relationUpdates = [];
                        // 首先检查群聊格式 (plural)
                        if (aiResponseContent.relationship_adjustments) {
                                relationUpdates = aiResponseContent.relationship_adjustments;
                        }
                        // 如果没有，再检查单聊格式 (singular) 并将其包装成数组
                        else if (aiResponseContent.relationship_adjustment) {
                                relationUpdates = [aiResponseContent.relationship_adjustment];
                        }

                        if (relationUpdates.length > 0) {
                                // 创建一个包含所有成员和用户信息的查找表，方便通过名字找到ID
                                // 在单聊中, currentChat.members 是 undefined, 所以需要一个安全检查
                                const participantsMap = new Map();

                                // 1. 添加用户固定的 'User' 标识符
                                participantsMap.set('User', 'user');

                                // 2. 添加用户当前的人设名称作为备用键
                                if (activeUserPersona && activeUserPersona.name) {
                                        participantsMap.set(activeUserPersona.name, 'user');
                                }

                                // 3. 根据是群聊还是单聊，获取所有参与的AI角色
                                const allAiParticipants = isGroupChat ? Array.from(groupMemberDetailsMap.values()) : [currentChat];

                                // 4. 为每个AI角色添加昵称和真实姓名到查找表
                                allAiParticipants.forEach(p => {
                                        if (p.name) {
                                                participantsMap.set(p.name, p.id); // 键: 昵称, 值: ID
                                        }
                                        if (p.realName) {
                                                participantsMap.set(p.realName, p.id); // 键: 真实姓名, 值: ID
                                        }
                                });

                                for (const update of relationUpdates) {
                                        // 兼容单聊中 AI 可能用自己的昵称或 "你的名字"
                                        const sourceName = update.source_char_name === "你的名字" ? currentChat.name : update.source_char_name;
                                        const sourceId = participantsMap.get(sourceName);
                                        const targetId = participantsMap.get(update.target_char_name);
                                        const scoreChange = parseInt(update.score_change);

                                        // 确保找到了合法的Source和Target，并且分数变化有效
                                        if (sourceId && targetId && !isNaN(scoreChange) && scoreChange !== 0) {
                                                console.log(`AI judged relationship change: ${update.source_char_name} -> ${update.target_char_name}, Score: ${scoreChange}. Reason: ${update.reason}`);

                                                // 调用已有的 updateRelationshipScore 函数
                                                await updateRelationshipScore(sourceId, targetId, scoreChange);
                                        } else {
                                                console.warn("AI返回了无效的好感度更新指令:", update, "Participants Map:", participantsMap);
                                        }
                                }
                        }

                        // 检查我们是否正在等待AI回应通话
                        if (outgoingCallState?.pending) {
                                // 检查AI的回复中是否包含正确的通话回应指令
                                const hasCallResponse = messagesArray.some(action => action.type === 'respond_to_call');

                                // 如果没有，说明AI没有正确回应，我们将其视为无应答
                                if (!hasCallResponse) {
                                        console.warn("AI did not respond to the call request correctly. Treating as implicit rejection.");
                                        outgoingCallState = null; // 重置呼叫状态
                                        callScreenModal.classList.add('hidden'); // 关闭“正在呼叫”界面

                                        // 在聊天界面显示一个“对方无应答”的系统提示
                                        const systemMessage = {
                                                role: 'system',
                                                type: 'system_message',
                                                content: `对方无应答`,
                                                timestamp: Date.now()
                                        };
                                        currentChat.history.push(systemMessage);
                                        appendMessage(systemMessage); // 更新UI
                                }
                        }

                        let messageTimestamp = Date.now();
                        for (const action of messagesArray) {
                                if (!action.type) {
                                        console.warn("AI action is missing 'type' field, skipping:", action);
                                        continue;
                                }
                                let actorName;
                                let actorMember = null;
                                const actorId = action.senderId;
                                if (isGroupChat) {
                                        // 在群聊中，每个动作都必须指明是哪个角色执行的 
                                        if (!actorId) {
                                                console.warn("Group chat AI action is missing 'senderId' field, skipping:", action);
                                                continue;
                                        }

                                        actorMember = groupMemberDetailsMap.get(actorId);

                                        if (!actorMember) {
                                                console.warn(`AI tried to use a non-existent member id: "${actorId}". Skipping action.`);
                                                continue;
                                        }
                                        actorName = actorMember.name; // 从找到的成员对象中获取当前的昵称
                                } else {
                                        // 在单人聊天中，执行动作的角色永远是当前对话的角色
                                        actorName = currentChat.name;
                                }

                                const getActorChat = async () => isGroupChat ? actorMember : currentChat;

                                if (!action.type) {
                                        console.warn("AI action is missing 'type' field, skipping:", action);
                                        continue;
                                }

                                switch (action.type) {
                                        case 'text': {
                                                const textMessage = {
                                                        role: 'assistant',
                                                        senderName: actorName,
                                                        senderId: actorId,
                                                        content: action.content,
                                                        timestamp: messageTimestamp++
                                                };
                                                currentChat.history.push(textMessage);
                                                currentChat.lastMessageTimestamp = textMessage.timestamp;
                                                currentChat.lastMessageContent = textMessage;
                                                appendMessage(textMessage);
                                                break;
                                        }
                                        case 'send_photo': {
                                                // 创建一个图片类型的消息
                                                // 注意：我们复用 'text_photo' 类型，这样可以共享相同的显示样式
                                                const photoMessage = {
                                                        role: 'assistant',
                                                        senderName: actorName, // actorName 变量确保了在群聊和私聊中都能正确显示发送者
                                                        senderId: actorId,
                                                        type: 'text_photo', // 复用现有类型来显示图片消息
                                                        content: `${action.description}`, // 将AI的描述作为内容
                                                        timestamp: new Date(messageTimestamp++)
                                                };
                                                currentChat.history.push(photoMessage);
                                                currentChat.lastMessageTimestamp = photoMessage.timestamp;
                                                currentChat.lastMessageContent = photoMessage;
                                                appendMessage(photoMessage);
                                                break;
                                        }
                                        case 'quote_reply': {
                                                const targetMsg = currentChat.history.find(m => toMillis(m.timestamp) === action.target_timestamp);
                                                if (targetMsg) {
                                                        const replyMessage = {
                                                                role: 'assistant',
                                                                senderName: actorName,
                                                                senderId: actorId,
                                                                content: action.reply_content,
                                                                quote: {
                                                                        senderName: targetMsg.senderName || (targetMsg.role === 'user' ? (activeUserPersona?.name || '我') : currentChat.name),
                                                                        content: (typeof targetMsg.content === 'string' ? targetMsg.content : `[${targetMsg.type}]`).substring(0, 50) + '...'
                                                                },
                                                                timestamp: messageTimestamp++
                                                        };
                                                        currentChat.history.push(replyMessage);
                                                        currentChat.lastMessageTimestamp = replyMessage.timestamp;
                                                        currentChat.lastMessageContent = replyMessage;
                                                        appendMessage(replyMessage);
                                                }
                                                break;
                                        }
                                        case 'transfer': {
                                                const transferMessage = {
                                                        role: 'assistant',
                                                        senderName: actorName,
                                                        senderId: actorId,
                                                        type: 'transfer',
                                                        amount: action.amount,
                                                        note: action.note,
                                                        timestamp: new Date(messageTimestamp++)
                                                };
                                                currentChat.history.push(transferMessage);
                                                currentChat.lastMessageTimestamp = transferMessage.timestamp;
                                                currentChat.lastMessageContent = transferMessage;
                                                appendMessage(transferMessage);
                                                break;
                                        }
                                        case 'respond_to_transfer': {
                                                // Find the original user's transfer message using the timestamp provided by the AI
                                                const userTransferMsg = currentChat.history.find(m => m.role === 'user' && m.type === 'transfer' && toMillis(m.timestamp) === action.target_timestamp);

                                                if (userTransferMsg) {
                                                        const decision = action.decision; // "accept" or "decline"
                                                        if (decision === 'accept') {
                                                                userTransferMsg.status = 'claimed'; // Update status to 'claimed' (已收款)
                                                        } else if (decision === 'decline') {
                                                                userTransferMsg.status = 'declined'; // Update status to 'declined' (已拒绝)
                                                        }

                                                        // Create a hidden system message to provide context for future interactions, if needed.
                                                        const systemNote = {
                                                                role: 'system',
                                                                content: `[系统提示：你已${decision === 'accept' ? '接收' : '拒绝'}了用户的转账。]`,
                                                                timestamp: new Date(messageTimestamp++),
                                                                isHidden: true
                                                        };
                                                        currentChat.history.push(systemNote);

                                                        // No need to append a new visible message, just re-render to update the transfer bubble's state
                                                        renderMessages();
                                                } else {
                                                        console.warn(`AI tried to respond to a non-existent transfer with timestamp: ${action.target_timestamp}`);
                                                }
                                                break;
                                        }

                                        case 'red_packet': {
                                                // 验证并确保金额是一个有效的数字，如果不是则默认为0
                                                const packetAmount = parseFloat(action.amount);
                                                if (isNaN(packetAmount) || packetAmount <= 0) {
                                                        console.warn(`AI红包指令缺少有效金额，已跳过。Action:`, action);
                                                        continue; // 跳过这个无效的红包动作
                                                }
                                                const packetMessage = {
                                                        role: 'assistant',
                                                        senderName: actorName,
                                                        senderId: actorId,
                                                        type: 'red_packet',
                                                        packetType: action.packetType,
                                                        timestamp: new Date(messageTimestamp++),
                                                        totalAmount: action.amount,
                                                        count: action.count || 1,
                                                        greeting: action.greeting,
                                                        receiverName: action.receiverName, // For direct packets
                                                        claimedBy: {},
                                                        isFullyClaimed: false,
                                                };
                                                currentChat.history.push(packetMessage);
                                                currentChat.lastMessageTimestamp = packetMessage.timestamp;
                                                currentChat.lastMessageContent = packetMessage;
                                                appendMessage(packetMessage);
                                                break;
                                        }
                                        case 'open_red_packet': {
                                                const packet = currentChat.history.find(m => toMillis(m.timestamp) === action.packet_timestamp);
                                                if (!packet) continue; // 如果红包不存在，则跳过

                                                // 关键检查：actorName 是执行此动作的角色名
                                                const hasClaimed = packet.claimedBy && packet.claimedBy[actorName];
                                                const isFullyClaimed = packet.count <= Object.keys(packet.claimedBy || {}).length;

                                                // 检查是否为专属红包，以及接收者是否是当前角色
                                                const isForMe = packet.packetType !== 'direct' || packet.receiverName === actorName;

                                                // 只有在 红包未领完、当前角色未领取过、且红包是给TA的(或大家都能领) 的情况下，才执行领取逻辑
                                                if (!isFullyClaimed && !hasClaimed && isForMe) {
                                                        const remainingCount = packet.count - Object.keys(packet.claimedBy || {}).length;
                                                        if (remainingCount > 0) {
                                                                let claimedAmount = 0;
                                                                const remainingAmount = packet.totalAmount - Object.values(packet.claimedBy || {}).reduce((s, v) => s + v, 0);

                                                                if (packet.packetType === 'lucky') {
                                                                        claimedAmount = remainingCount === 1 ? remainingAmount : parseFloat((Math.random() * (remainingAmount / remainingCount * 1.5) + 0.01).toFixed(2));
                                                                } else { // direct
                                                                        claimedAmount = packet.totalAmount;
                                                                }

                                                                if (!packet.claimedBy) packet.claimedBy = {};
                                                                packet.claimedBy[actorName] = Math.max(0.01, claimedAmount); // 保证最小金额

                                                                if (Object.keys(packet.claimedBy).length >= packet.count) {
                                                                        packet.isFullyClaimed = true;
                                                                }

                                                                // 为用户添加一条隐藏的系统消息，告知谁领取了红包
                                                                const systemMessage = {
                                                                        role: 'system',
                                                                        content: `[系统提示：${actorName} 领取了 ${packet.senderName} 的红包。]`,
                                                                        timestamp: new Date(messageTimestamp++),
                                                                        isHidden: true
                                                                };
                                                                currentChat.history.push(systemMessage);
                                                        }
                                                }
                                                break; // 结束 case
                                        }
                                        case 'waimai_request': {
                                                const waimaiMessage = {
                                                        role: 'assistant',
                                                        senderName: actorName,
                                                        senderId: actorId,
                                                        type: 'waimai_request',
                                                        productInfo: action.productInfo,
                                                        amount: action.amount,
                                                        status: 'pending',
                                                        timestamp: new Date(messageTimestamp++)
                                                };
                                                currentChat.history.push(waimaiMessage);
                                                currentChat.lastMessageTimestamp = waimaiMessage.timestamp;
                                                currentChat.lastMessageContent = waimaiMessage;
                                                appendMessage(waimaiMessage);
                                                break;
                                        }
                                        case 'waimai_response': {
                                                const waimaiRequest = currentChat.history.find(m => toMillis(m.timestamp) === action.target_timestamp);
                                                if (waimaiRequest && waimaiRequest.type === 'waimai_request' && waimaiRequest.status === 'pending') {
                                                        waimaiRequest.status = action.decision;
                                                        if (action.decision === 'paid') {
                                                                waimaiRequest.paidBy = actorName;
                                                        }
                                                        const systemMessage = {
                                                                role: 'system',
                                                                content: `[系统提示：${actorName} ${action.decision === 'paid' ? '支付' : '拒绝'} 了 ${waimaiRequest.senderName} 的外卖请求。]`,
                                                                timestamp: new Date(messageTimestamp++),
                                                                isHidden: true
                                                        };
                                                        currentChat.history.push(systemMessage);
                                                        renderMessages();
                                                }
                                                break;
                                        }
                                        case 'share_link': {
                                                const linkMessage = {
                                                        role: 'assistant',
                                                        senderName: actorName,
                                                        senderId: actorId,
                                                        type: 'share_link',
                                                        title: action.title,
                                                        description: action.description,
                                                        source_name: action.source_name,
                                                        content: action.content,
                                                        timestamp: new Date(messageTimestamp++)
                                                };
                                                currentChat.history.push(linkMessage);
                                                currentChat.lastMessageTimestamp = linkMessage.timestamp;
                                                currentChat.lastMessageContent = linkMessage;
                                                appendMessage(linkMessage);
                                                break;
                                        }
                                        case 'friend_request_response': {
                                                if (currentChat.relationship && currentChat.relationship.status === 'pending_ai_approval') {
                                                        if (action.decision === 'accept') {
                                                                currentChat.relationship.status = 'friend';
                                                                currentChat.relationship.applicationReason = '';
                                                                const acceptMsg = {
                                                                        role: 'assistant',
                                                                        content: "我通过了你的好友请求，我们重新开始聊天吧！",
                                                                        timestamp: new Date(messageTimestamp++)
                                                                };
                                                                currentChat.history.push(acceptMsg);
                                                                currentChat.lastMessageTimestamp = acceptMsg.timestamp;
                                                                currentChat.lastMessageContent = acceptMsg;
                                                                appendMessage(acceptMsg);
                                                        } else {
                                                                currentChat.relationship.status = 'blocked_by_ai';
                                                                currentChat.relationship.applicationReason = '';
                                                        }
                                                }
                                                break;
                                        }
                                        case 'block_user': {
                                                if (!currentChat.isGroup) {
                                                        currentChat.blockStatus = { status: 'blocked_by_ai', timestamp: Date.now() };
                                                }
                                                break;
                                        }
                                        case 'update_status': {
                                                const statusTarget = await getActorChat();
                                                if (!statusTarget.status) statusTarget.status = {};
                                                const oldStatusText = statusTarget.status.text || '在线';
                                                statusTarget.status.text = action.text || oldStatusText;
                                                statusTarget.status.color = action.color || 'green';
                                                if (action.text && action.text !== oldStatusText) {
                                                        const statusMessage = { role: 'system', type: 'system_message', content: `${actorName} 将状态修改为“${action.text}”`, timestamp: new Date(messageTimestamp++) };
                                                        currentChat.history.push(statusMessage);
                                                        appendMessage(statusMessage);
                                                }
                                                break;
                                        }

                                        case 'update_signature': {
                                                const chatToUpdate = await getActorChat();
                                                if (chatToUpdate) {
                                                        const oldSignature = chatToUpdate.signature || '';
                                                        if (action.signature && action.signature !== oldSignature) {
                                                                chatToUpdate.signature = action.signature;
                                                                await db.chats.put(chatToUpdate);
                                                                // 这里的 actorName 是正确的“角色名”
                                                                const sigMessage = { role: 'system', type: 'system_message', content: `${actorName} 更新了签名`, timestamp: new Date(messageTimestamp++) };
                                                                currentChat.history.push(sigMessage);
                                                                appendMessage(sigMessage);
                                                        }
                                                }
                                                break;
                                        }
                                        case 'change_avatar': {
                                                const libraryOwner = await getActorChat();
                                                if (libraryOwner && libraryOwner.settings) {
                                                        const library = libraryOwner.settings.aiAvatarLibrary || [];
                                                        // 这里的 action.name 指的是“头像名”
                                                        const avatarNameToFind = action.name;
                                                        const foundAvatar = library.find(avatar => avatar.name === avatarNameToFind);
                                                        if (foundAvatar) {
                                                                if (isGroupChat) {
                                                                        actorMember.avatar = foundAvatar.url;
                                                                } else {
                                                                        currentChat.settings.aiAvatar = foundAvatar.url;
                                                                }
                                                                // 这里的 actorName 是正确的“角色名”
                                                                const avatarMessage = { role: 'system', type: 'system_message', content: `${actorName} 更换了头像`, timestamp: new Date(messageTimestamp++) };
                                                                currentChat.history.push(avatarMessage);
                                                                appendMessage(avatarMessage);
                                                        } else {
                                                                console.warn(`AI角色 "${actorName}" 试图使用一个不存在的头像: "${avatarNameToFind}"`);
                                                        }
                                                }
                                                break;
                                        }

                                        case 'update_name': {
                                                const nameTarget = await getActorChat();
                                                const oldName = nameTarget.name;
                                                // 确认这里优先使用 action.name
                                                const newName = action.newName || action.name;
                                                if (newName && newName !== oldName) {
                                                        nameTarget.name = newName;
                                                        const nameChangeMessage = { role: 'system', type: 'system_message', content: `${oldName} 将名字修改为“${newName}”`, timestamp: new Date(messageTimestamp++) };
                                                        currentChat.history.push(nameChangeMessage);
                                                        appendMessage(nameChangeMessage);
                                                        if (!isGroupChat) {
                                                                charNameHeader.textContent = newName;
                                                        }
                                                }
                                                break;
                                        }

                                        case 'set_background': {
                                                const albumPhotos = await db.globalAlbum.toArray();
                                                const backgroundOwner = await getActorChat();
                                                if (backgroundOwner) {
                                                        const descriptionToFind = action.description;
                                                        const foundPhoto = albumPhotos.find(p => p.description === descriptionToFind);
                                                        if (foundPhoto) {
                                                                backgroundOwner.settings.coverPhoto = foundPhoto.url;
                                                                await db.chats.put(backgroundOwner);
                                                                const bgMessage = { role: 'system', type: 'system_message', content: `${actorName} 更换了主页背景`, timestamp: new Date(messageTimestamp++) };
                                                                currentChat.history.push(bgMessage);
                                                                appendMessage(bgMessage);
                                                        } else {
                                                                console.warn(`AI "${actorName}" tried to use a background with description "${descriptionToFind}" which does not exist.`);
                                                        }
                                                }
                                                break;
                                        }

                                        case 'create_post': {
                                                const postAuthorId = await getActorChat().id;
                                                const postAuthorChat = await db.chats.get(postAuthorId);
                                                if (postAuthorChat) {
                                                        const postData = {
                                                                authorId: postAuthorId,
                                                                timestamp: Date.now(),
                                                                likes: [],
                                                                comments: [],
                                                                type: action.postType === 'text' ? 'text_post' : 'image_post',
                                                                publicText: action.publicText || action.content || '',
                                                                imageDescription: action.imageDescription || '',
                                                                mentionIds: action.mentionIds || null, // 保存mentionIds
                                                        };
                                                        const newPostId = await db.xzonePosts.add(postData);
                                                        const postNotice = { role: 'system', type: 'system_message', content: `${actorName} 发布了一条新动态`, timestamp: new Date(messageTimestamp++) };
                                                        currentChat.history.push(postNotice);
                                                        appendMessage(postNotice);

                                                        // --- 通知被@的角色 ---
                                                        if (postData.mentionIds && postData.mentionIds.length > 0) {
                                                                for (const mentionedId of postData.mentionIds) {
                                                                        // AI发动态不需要通知用户，因为用户就在当前聊天里
                                                                        if (mentionedId === 'user') continue;

                                                                        const mentionedChat = await db.chats.get(mentionedId);
                                                                        if (mentionedChat) {
                                                                                const systemMessage = {
                                                                                        role: 'system',
                                                                                        type: 'user_post_mention',
                                                                                        content: `[系统提示：${actorName} 在一条新动态中 @提到了你。请你查看并决定是否需要回应。动态ID: ${newPostId}]`,
                                                                                        timestamp: new Date(Date.now() + 1),
                                                                                        isHidden: true
                                                                                };
                                                                                mentionedChat.history.push(systemMessage);
                                                                                await db.chats.put(mentionedChat);
                                                                        }
                                                                }
                                                        }
                                                }
                                                break;
                                        }

                                        case 'like_post': {
                                                const postToLike = await db.xzonePosts.get(action.postId);
                                                if (postToLike) {
                                                        const actorId = await getActorChat().id;
                                                        if (!postToLike.likes) postToLike.likes = [];

                                                        // 检查是否已经点赞，避免重复
                                                        if (!postToLike.likes.includes(actorId)) {
                                                                postToLike.likes.push(actorId);
                                                                await db.xzonePosts.update(action.postId, { likes: postToLike.likes });
                                                                console.log(`后台活动: 角色 "${actorName}" 点赞了动态 #${action.postId}`);
                                                        }
                                                }
                                                break;
                                        }

                                        case 'comment_on_post': {
                                                const postToComment = await db.xzonePosts.get(action.postId);
                                                if (postToComment && action.commentText) {
                                                        const actorId = (await getActorChat()).id;
                                                        if (!postToComment.comments) postToComment.comments = [];

                                                        // 添加评论，评论者ID为actorId
                                                        postToComment.comments.push({ author: actorId, text: action.commentText });
                                                        await db.xzonePosts.update(action.postId, { comments: postToComment.comments });
                                                        console.log(`后台活动: 角色 "${actorName}" 评论了动态 #${action.postId}`);
                                                }
                                                break;
                                        }
                                        case 'voice_message': {
                                                const actorChat = await getActorChat();
                                                const voiceConfig = actorChat.settings.voiceConfig;

                                                // 检查是否配置了TTS并且内容不为空
                                                if (voiceConfig && voiceConfig.profileId && voiceConfig.voiceId && action.content) {
                                                        try {
                                                                const ttsProfile = await db.ttsProfiles.get(voiceConfig.profileId);
                                                                const audioUrl = await generateAudioFromText(action.content, voiceConfig.voiceId, ttsProfile);

                                                                // 创建 audio_message
                                                                const audioMessage = {
                                                                        role: 'assistant',
                                                                        senderName: actorName,
                                                                        senderId: actorId,
                                                                        type: 'audio_message', // 新类型
                                                                        content: audioUrl,     // 音频链接
                                                                        transcript: action.content, // 原始文本
                                                                        timestamp: new Date(messageTimestamp++)
                                                                };
                                                                currentChat.history.push(audioMessage);
                                                                currentChat.lastMessageTimestamp = audioMessage.timestamp;
                                                                currentChat.lastMessageContent = audioMessage;
                                                                appendMessage(audioMessage);

                                                        } catch (error) {
                                                                console.error("TTS generation failed, falling back to text.", error);
                                                                // TTS 失败，回退到文字版语音
                                                                const fallbackMessage = {
                                                                        role: 'assistant',
                                                                        senderName: actorName,
                                                                        senderId: actorId,
                                                                        type: 'voice_message',
                                                                        content: action.content,
                                                                        timestamp: new Date(messageTimestamp++)
                                                                };
                                                                currentChat.history.push(fallbackMessage);
                                                                currentChat.lastMessageTimestamp = fallbackMessage.timestamp;
                                                                currentChat.lastMessageContent = fallbackMessage;
                                                                appendMessage(fallbackMessage);
                                                        }
                                                } else {
                                                        // 未配置 TTS，直接使用文字版语音
                                                        const voiceMessage = {
                                                                role: 'assistant',
                                                                senderName: actorName,
                                                                senderId: actorId,
                                                                type: 'voice_message',
                                                                content: action.content,
                                                                timestamp: new Date(messageTimestamp++)
                                                        };
                                                        currentChat.history.push(voiceMessage);
                                                        currentChat.lastMessageTimestamp = voiceMessage.timestamp;
                                                        currentChat.lastMessageContent = voiceMessage;
                                                        appendMessage(voiceMessage);
                                                }
                                                break;
                                        }

                                        case 'create_memory':
                                                await db.memories.add({
                                                        chatId: charId,
                                                        authorName: actorName,
                                                        description: action.description,
                                                        timestamp: new Date(messageTimestamp++),
                                                        type: 'diary',
                                                        isImportant: 0
                                                });
                                                currentChat.history.push({
                                                        role: 'system',
                                                        type: 'system_message',
                                                        content: `${actorName} 把这件事记在了心里。`,
                                                        timestamp: new Date(messageTimestamp++)
                                                });
                                                appendMessage({ role: 'system', type: 'system_message', content: `${actorName} 把这件事记在了心里。` });
                                                break;

                                        case 'create_important_memory':
                                                await db.memories.add({
                                                        chatId: charId,
                                                        authorName: actorName,
                                                        description: action.description,
                                                        timestamp: new Date(messageTimestamp++),
                                                        type: 'diary',
                                                        isImportant: 1 // 标记为核心记忆
                                                });
                                                currentChat.history.push({
                                                        role: 'system',
                                                        type: 'system_message',
                                                        content: `⭐ ${actorName} 将此事标记为核心记忆。`,
                                                        timestamp: new Date(messageTimestamp++)
                                                });
                                                appendMessage({ role: 'system', type: 'system_message', content: `⭐ ${actorName} 将此事标记为核心记忆。` });
                                                break;

                                        case 'create_countdown': {
                                                const targetDate = new Date(action.targetDate).getTime();
                                                if (isNaN(targetDate)) {
                                                        console.warn("AI provided an invalid targetDate:", action.targetDate);
                                                        break;
                                                }
                                                await db.memories.add({
                                                        chatId: charId,
                                                        authorName: actorName,
                                                        description: action.description,
                                                        timestamp: new Date(messageTimestamp++),
                                                        targetDate: targetDate,
                                                        type: 'countdown',
                                                        isImportant: 0
                                                });
                                                const countdownMsg = {
                                                        role: 'system',
                                                        type: 'system_message',
                                                        content: `你和 ${actorName} 定下了一个约定。`,
                                                        timestamp: new Date(messageTimestamp++)
                                                };
                                                currentChat.history.push(countdownMsg);
                                                appendMessage(countdownMsg);
                                                break;
                                        }
                                        case 'create_diary_entry':
                                                { // 使用花括号创建独立作用域
                                                        const diaryAuthorId = isGroupChat ? action.senderId : charId;
                                                        if (!diaryAuthorId) {
                                                                console.warn("写日记失败：在群聊中缺少 senderId。");
                                                                break;
                                                        }

                                                        const diaryAuthor = isGroupChat ? groupMemberDetailsMap.get(diaryAuthorId) : currentChat;

                                                        await db.diaries.add({
                                                                chatId: charId, // 记录日记产生的上下文（哪个聊天会话）
                                                                authorId: diaryAuthorId, // 记录真正的作者
                                                                timestamp: new Date(messageTimestamp++),
                                                                content: action.content,
                                                                keywords: action.keywords || []
                                                        });

                                                        // 在聊天界面给出微妙的提示，让用户知道角色有所感悟
                                                        const systemMessage = {
                                                                role: 'system',
                                                                type: 'system_message',
                                                                content: `${diaryAuthor.name}似乎在沉思着什么，并写下了些东西。`,
                                                                timestamp: new Date(messageTimestamp++)
                                                        };

                                                        // 我们需要把这个系统消息推送到正确的聊天历史中
                                                        const chatToUpdate = await db.chats.get(charId);
                                                        chatToUpdate.history.push(systemMessage);
                                                        await db.chats.put(chatToUpdate);

                                                        // 只有在当前页面就是这个聊天时才更新UI
                                                        if (charId === currentChat.id) {
                                                                appendMessage(systemMessage);
                                                        }
                                                }
                                                break;
                                        case 'pat_user':
                                                const patteeNameUser = currentChat.settings.myNickname || '我';
                                                handleAiPat(actorName, patteeNameUser, action.suffix);
                                                break;

                                        case 'pat_member':
                                                if (!isGroupChat || !action.target_name) continue; // Safety check
                                                handleAiPat(actorName, action.target_name, action.suffix);
                                                break;

                                        case 'spotify_toggle_play':
                                                spotifyManager.togglePlay();
                                                break;

                                        case 'spotify_next_track':
                                                spotifyManager.nextTrack();
                                                break;

                                        case 'spotify_previous_track':
                                                spotifyManager.previousTrack();
                                                break;

                                        case 'send_sticker': {
                                                // Get the desired sticker name from the AI's action.
                                                const stickerName = action.name;

                                                // Check if a valid name was provided by the AI.
                                                if (stickerName && stickerName.trim() !== '') {
                                                        // Try to find an exact match for the sticker in the user's library.
                                                        const stickerToSend = stickers.find(s => s.name === stickerName);

                                                        if (stickerToSend) {
                                                                // SUCCESS: The sticker exists. Send it as an image.
                                                                const stickerMessage = {
                                                                        role: 'assistant',
                                                                        senderName: actorName,
                                                                        senderId: actorId,
                                                                        type: 'sticker',
                                                                        content: stickerToSend.url,
                                                                        meaning: stickerToSend.name,
                                                                        timestamp: new Date(messageTimestamp++)
                                                                };
                                                                currentChat.history.push(stickerMessage);
                                                                currentChat.lastMessageTimestamp = stickerMessage.timestamp;
                                                                currentChat.lastMessageContent = stickerMessage;
                                                                appendMessage(stickerMessage);
                                                        } else {
                                                                // FALLBACK: The sticker was not found. Convert the AI's intent into a plain text message.
                                                                // This handles cases where the AI sends a description like "一个翻白眼的表情".
                                                                console.log(`AI wanted sticker "${stickerName}", but it was not found. Sending as text instead.`);
                                                                const fallbackMessage = {
                                                                        role: 'assistant',
                                                                        senderName: actorName,
                                                                        senderId: actorId,
                                                                        type: 'text', // Send as a standard text bubble.
                                                                        content: `[${stickerName}]`, // Use the AI's description as the content. The brackets help signify an action.
                                                                        timestamp: new Date(messageTimestamp++)
                                                                };
                                                                currentChat.history.push(fallbackMessage);
                                                                currentChat.lastMessageTimestamp = fallbackMessage.timestamp;
                                                                currentChat.lastMessageContent = fallbackMessage;
                                                                appendMessage(fallbackMessage);
                                                        }
                                                } else {
                                                        // The AI's action was malformed (e.g., missing the 'name' property).
                                                        console.log(`AI tried to send a sticker but did not provide a name. Action:`, action);
                                                        // We do nothing here to avoid sending a blank or broken bubble.
                                                }
                                                break;
                                        }
                                        case 'initiate_voice_call':
                                        case 'initiate_video_call':
                                                // 如果当前没有通话，则显示来电界面
                                                if (!isCallActive && !incomingCallOffer) {
                                                        const callType = action.type === 'initiate_voice_call' ? 'voice' : 'video';
                                                        showIncomingCallUI(callType, currentChatForAPI);
                                                }
                                                break;

                                        case 'respond_to_call':
                                                // 这是AI对我们呼叫的回应
                                                handleAiCallResponse(action.decision, action.reason);
                                                break;
                                        case 'hang_up_call': {
                                                // 1. 检查AI是否提供了挂断理由
                                                if (action.reason && typeof action.reason === 'string') {
                                                        console.log(`AI决定挂断，理由: ${action.reason}`);

                                                        // 2. 将理由作为最后一条消息显示在通话界面上
                                                        if (callType === 'video') {
                                                                videoDialogueBox.innerHTML += `<p class="text-left"><span class="bg-gray-600/50 px-2 py-1 rounded-lg">${action.reason}</span></p>`;
                                                                videoDialogueBox.scrollTop = videoDialogueBox.scrollHeight;
                                                        } else {
                                                                voiceContentArea.innerHTML += `<p class="text-left"><span class="font-semibold">${currentChat.name}:</span> ${action.reason}</p>`;
                                                                voiceContentArea.scrollTop = voiceContentArea.scrollHeight;
                                                        }

                                                        // 3. 短暂暂停（例如1.5秒），让用户有时间阅读最后的消息
                                                        await sleep(1500);
                                                }

                                                // 4. 调用通用的挂断函数，处理后续所有逻辑（保存日志、重置状态等）
                                                await hangUpCall();

                                                // 5. 使用 return 立即终止当前所有操作，不再处理后续的AI动作
                                                return;
                                        }


                                        // Fallback for any unknown action types
                                        default: {
                                                console.warn("Received unknown AI action type:", action.type);
                                                const fallbackMessage = {
                                                        role: 'assistant',
                                                        senderName: actorName,
                                                        senderId: actorId,
                                                        content: `[未识别指令: ${action.type}] ${JSON.stringify(action)}`,
                                                        timestamp: new Date(messageTimestamp++)
                                                };
                                                currentChat.history.push(fallbackMessage);
                                                currentChat.lastMessageTimestamp = fallbackMessage.timestamp;
                                                currentChat.lastMessageContent = fallbackMessage;
                                                appendMessage(fallbackMessage);
                                                break;
                                        }
                                }
                                // 在处理完【单条】动作后，立刻保存、渲染并停顿
                                await db.chats.put(currentChat);
                                // 设置一个随机的延迟，让对话节奏更自然 (500ms到1200ms之间)
                                const randomDelay = Math.random() * 700 + 500;
                                await sleep(randomDelay);
                        }
                        // After the loop has processed all actions, save and render ONCE.

                        if (!isGroupChat) updateHeaderStatus();
                }
        } catch (error) {
                console.error("API call failed:", error);
                // 提取错误状态码（如果有的话）
                const errorCodeMatch = error.message.match(/API Error (\d+)/);
                const errorCode = errorCodeMatch ? ` (Code: ${errorCodeMatch[1]})` : '';
                // 显示一个更简洁的 Toast 提示
                showToast(`获取AI回复失败${errorCode}`, 'error');
        } finally {
                apiLock.release('user_chat');
                if (isCallActive) {
                        // 通话模式结束AI响应时的处理
                        isAiRespondingInCall = false;
                        callInput.disabled = false;
                        document.querySelector('#call-input-form button').disabled = false;
                        callInput.focus();
                        const speakingIndicator = document.getElementById('call-speaking-indicator');
                        if (apiCallSuccess) {
                                // 如果API调用成功，任务完成，直接隐藏状态标志
                                speakingIndicator.classList.add('opacity-0');
                        } else {
                                // 如果API调用失败，在状态标志处显示错误提示
                                speakingIndicator.textContent = '对方无应答，可重试';
                                speakingIndicator.classList.remove('opacity-0');
                        }
                } else {
                        // 普通聊天模式的UI恢复 
                        headerEl.textContent = isGroupChat ? `${currentChat.name} (${currentChat.members.length + 1})` : currentChat.name;
                        headerEl.classList.remove('typing-status');
                }
        }
}
// --- Status ---

function updateHeaderStatus() {
        const statusEl = document.getElementById('char-status');
        const dotEl = document.getElementById('status-dot');
        const status = currentChat.status || { text: '在线', color: 'green' };

        statusEl.textContent = status.text;

        const colorMap = {
                green: '#2ecc71',
                yellow: '#f1c40f',
                red: '#e74c3c',
                gray: '#95a5a6'
        };
        // Use the mapped color, or the direct hex code, or fallback to gray
        dotEl.style.backgroundColor = colorMap[status.color] || status.color || '#95a5a6';
}

// --- 红包功能核心函数 ---

/**
 * 打开并初始化发红包模态框
 */
function openRedPacketModal() {
        const modal = document.getElementById('red-packet-modal');

        // 清理输入框
        document.getElementById('rp-group-amount').value = '';
        document.getElementById('rp-group-count').value = '';
        document.getElementById('rp-group-greeting').value = '';
        document.getElementById('rp-direct-amount').value = '';
        document.getElementById('rp-direct-greeting').value = '';
        document.getElementById('rp-group-total').textContent = '¥ 0.00';
        document.getElementById('rp-direct-total').textContent = '¥ 0.00';

        // 填充专属红包的接收人列表
        const receiverSelect = document.getElementById('rp-direct-receiver');
        receiverSelect.innerHTML = '';
        for (const member of groupMemberDetailsMap.values()) {
                const option = document.createElement('option');
                const memberDisplayName = member.name || member.realName;
                option.value = memberDisplayName;
                option.textContent = memberDisplayName;
                receiverSelect.appendChild(option);
        }

        // 默认显示拼手气红包页签
        document.getElementById('rp-tab-group').click();

        modal.classList.add('visible');
}

/**
 * 发送群红包（拼手气）
 */
async function sendGroupRedPacket() {
        const amount = parseFloat(document.getElementById('rp-group-amount').value);
        const count = parseInt(document.getElementById('rp-group-count').value);
        const greeting = document.getElementById('rp-group-greeting').value.trim();

        if (isNaN(amount) || amount <= 0) {
                showToast("请输入有效的总金额！", 'error'); return;
        }
        if (isNaN(count) || count <= 0) {
                showToast("请输入有效的红包个数！", 'error'); return;
        }
        if (amount / count < 0.01) {
                showToast("单个红包金额不能少于0.01元！", 'error'); return;
        }
        if (count > currentChat.members.length + 1) { // +1 for the user
                showToast("红包个数不能超过群成员总数！", 'error'); return;
        }

        const myNickname = currentChat.settings.myNickname || '我';

        const newPacket = {
                role: 'user',
                senderName: myNickname,
                type: 'red_packet',
                packetType: 'lucky',
                timestamp: Date.now(),
                totalAmount: amount,
                count: count,
                greeting: greeting || '恭喜发财，大吉大利！',
                claimedBy: {},
                isFullyClaimed: false,
        };

        await addUserMessageToDb(newPacket);
        document.getElementById('red-packet-modal').classList.remove('visible');
}

/**
 * 发送专属红包
 */
async function sendDirectRedPacket() {
        const amount = parseFloat(document.getElementById('rp-direct-amount').value);
        const receiverName = document.getElementById('rp-direct-receiver').value;
        const greeting = document.getElementById('rp-direct-greeting').value.trim();

        if (isNaN(amount) || amount <= 0) {
                showToast("请输入有效的金额！", 'error'); return;
        }
        if (!receiverName) {
                showToast("请选择一个接收人！", 'error'); return;
        }

        const myNickname = currentChat.settings.myNickname || '我';

        const newPacket = {
                role: 'user',
                senderName: myNickname,
                type: 'red_packet',
                packetType: 'direct',
                timestamp: Date.now(),
                totalAmount: amount,
                count: 1,
                greeting: greeting || '给你准备了一个红包',
                receiverName: receiverName,
                claimedBy: {},
                isFullyClaimed: false,
        };

        await addUserMessageToDb(newPacket);
        document.getElementById('red-packet-modal').classList.remove('visible');
}

/**
 * 显示红包领取详情的模态框
 */
function showRedPacketDetails(packet) {
        if (!packet) return;
        const modal = document.getElementById('red-packet-details-modal');
        const myNickname = currentChat.settings.myNickname || '我';
        const totalAmount = packet.totalAmount || 0;
        const totalCount = packet.count || 0;
        const claimedBy = packet.claimedBy || {};

        document.getElementById('rp-details-sender').textContent = packet.senderName;
        document.getElementById('rp-details-greeting').textContent = packet.greeting || '恭喜发财，大吉大利！';


        const myAmountEl = document.getElementById('rp-details-my-amount');
        const myClaim = claimedBy[myNickname]; // Use the safe variable
        if (myClaim !== undefined) {
                // 从对象中安全地获取 amount 属性，如果直接是数字也兼容
                const myClaimAmount = myClaim.amount || myClaim || 0;
                myAmountEl.querySelector('span:first-child').textContent = myClaimAmount.toFixed(2);
                myAmountEl.classList.remove('hidden');
        } else {
                myAmountEl.classList.add('hidden');
        }

        const claimedCount = Object.keys(claimedBy).length; // Use the safe variable
        const claimedAmountSum = Object.values(claimedBy).reduce((sum, claimData) => {
                const amount = claimData.amount || claimData || 0; // 兼容对象和纯数字
                return sum + Number(amount);
        }, 0);
        document.getElementById('rp-details-summary').textContent = `已领取${claimedCount}/${totalCount}个，共${claimedAmountSum.toFixed(2)}/${totalAmount.toFixed(2)}元。`; // Use the safe variables

        const listEl = document.getElementById('rp-details-list');
        listEl.innerHTML = '';
        const claimedEntries = Object.entries(claimedBy);

        let luckyKing = { name: '', amount: -1 };
        if (packet.packetType === 'lucky' && packet.isFullyClaimed && claimedEntries.length > 0) {
                claimedEntries.forEach(([name, claimData]) => {
                        const claimAmount = claimData.amount || claimData || 0; // 兼容
                        if (claimAmount > luckyKing.amount) {
                                luckyKing = { name, amount: claimAmount };
                        }
                });
        }

        // 按领取金额排序
        claimedEntries.sort((a, b) => (b[1].amount || b[1] || 0) - (a[1].amount || a[1] || 0))
                .forEach(([name, claimData]) => {
                        const item = document.createElement('div');
                        item.className = 'rp-details-item flex items-center justify-between py-2 border-b';
                        const luckyTag = (luckyKing.name && name === luckyKing.name) ? '<span class="lucky-king-tag text-xs bg-yellow-300 text-yellow-800 font-bold px-1.5 py-0.5 rounded-full ml-2">手气王</span>' : '';

                        // 安全地获取时间和金额
                        const claimTime = claimData.timestamp ? new Date(claimData.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
                        const claimAmount = claimData.amount || claimData || 0;

                        item.innerHTML = `
            <div>
                <p class="font-semibold text-gray-800">${name}</p>
                <p class="text-xs text-gray-500">${claimTime}</p> 
            </div>
            <div class="font-semibold text-gray-800">${claimAmount.toFixed(2)} 元 ${luckyTag}</div>
        `;
                        listEl.appendChild(item);
                });

        modal.classList.add('visible');
}

/**
 * 处理红包卡片点击事件（事件委托）
 */
document.addEventListener('click', function (e) {
        const packetCard = e.target.closest('.red-packet-card');
        if (packetCard) {
                const wrapper = packetCard.closest('.message-wrapper');
                if (wrapper && wrapper.dataset.timestamp) {
                        const timestamp = new Date(parseInt(wrapper.dataset.timestamp));
                        handlePacketClick(timestamp);
                }
        }
});


/**
 * 处理用户打开红包的逻辑，并返回领取的金额
 * @param {object} packet - 要打开的红包消息对象
 * @returns {number|null} - 成功则返回领取的金额，失败则返回null
 */
async function handleOpenRedPacket(packet) {
        const myNickname = currentChat.settings.myNickname || '我';

        // 1. 检查红包是否还能领
        const remainingCount = packet.count - Object.keys(packet.claimedBy || {}).length;
        if (remainingCount <= 0) {
                showToast("手慢了，红包派完了。");
                packet.isFullyClaimed = true;
                await db.chats.put(currentChat);
                return null;
        }

        // 2. 计算领取金额
        let claimedAmount = 0;
        const remainingAmount = packet.totalAmount - Object.values(packet.claimedBy || {}).reduce((s, v) => s + (v.amount || v || 0), 0);
        if (packet.packetType === 'lucky') {
                if (remainingCount === 1) {
                        claimedAmount = remainingAmount;
                } else {
                        const min = 0.01;
                        const max = remainingAmount - (remainingCount - 1) * min;
                        claimedAmount = Math.random() * (max - min) + min;
                }
        } else { // 专属红包
                claimedAmount = packet.totalAmount;
        }
        claimedAmount = parseFloat(claimedAmount.toFixed(2));

        // 3. 更新红包数据
        if (!packet.claimedBy) packet.claimedBy = {};
        packet.claimedBy[myNickname] = { amount: Math.max(0.01, claimedAmount), timestamp: Date.now() };

        if (Object.keys(packet.claimedBy).length >= packet.count) {
                packet.isFullyClaimed = true;
        }

        // 4. 创建一条对用户可见的系统消息
        const visibleMessage = {
                role: 'system',
                type: 'system_message',
                content: `你领取了 ${packet.senderName} 的红包`,
                timestamp: Date.now()
        };

        // 5. 创建一条对AI可见、对用户隐藏的系统消息
        const hiddenMessageForAI = {
                role: 'system',
                content: `[系统提示：用户 (${myNickname}) 领取了你发的红包，金额为 ${claimedAmount.toFixed(2)} 元。]`,
                timestamp: new Date(Date.now() + 1), // 确保时间戳在后
                isHidden: true
        };

        // 6. 将两条消息都推入历史记录
        currentChat.history.push(visibleMessage, hiddenMessageForAI);

        // 7. 保存到数据库
        await db.chats.put(currentChat);

        return claimedAmount;
}

/**
 * 点击红包卡片后的总处理函数
 * @param {Date} timestamp - 被点击红包的时间戳
 */
async function handlePacketClick(timestamp) {
        const targetTimestamp = toMillis(timestamp); // Use the helper function
        const packet = currentChat.history.find(m => toMillis(m.timestamp) === targetTimestamp);
        if (!packet) return;

        const myNickname = currentChat.settings.myNickname || '我';
        const hasClaimed = packet.claimedBy && packet.claimedBy[myNickname] !== undefined;

        // 关键检查：判断红包是否是发给用户的
        const isForMe = packet.packetType !== 'direct' || packet.receiverName === myNickname;

        // 如果红包不是给你的，直接提示并显示详情
        if (packet.packetType === 'direct' && !isForMe) {
                showToast(`这是给“${packet.receiverName}”的专属红包哦。`);
                //showRedPacketDetails(packet);
                return;
        }

        if (hasClaimed || packet.isFullyClaimed) {
                // 如果已领取或红包已领完，直接显示详情
                showRedPacketDetails(packet);
        } else {
                // 否则，尝试领取
                const claimedAmount = await handleOpenRedPacket(packet);

                if (claimedAmount !== null) {
                        // 成功领取后，刷新聊天界面以显示 "你领取了..." 的系统消息
                        renderMessages();
                }

                // 无论成功与否，最后都显示详情
                const updatedPacket = currentChat.history.find(m => new Date(m.timestamp).getTime() === timestamp.getTime());
                showRedPacketDetails(updatedPacket);
        }
}

/**
 * Shows the long-press action menu near the selected message.
 * @param {Event} e - The mouse/touch event that triggered the menu.
 * @param {object} msg - The message object that was long-pressed.
 */
function showLongPressMenu(e, msg) {
        activeMessageMenu.timestamp = toMillis(msg.timestamp);
        const wrapper = e.target.closest('.message-wrapper');
        if (!wrapper) return;

        // Position the menu
        const menu = messageActionsMenu;
        menu.classList.remove('hidden');

        // Get dimensions of the message bubble and the menu
        const rect = wrapper.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();

        // Calculate position to be centered above the bubble
        let top = rect.top - menuRect.height - 10; // 10px above the bubble
        if (top < 10) { // If there's not enough space on top, show below
                top = rect.bottom + 10;
        }

        // THIS IS THE KEY CHANGE: Center horizontally on the bubble, not the click point
        let left = rect.left + (rect.width / 2) - (menuRect.width / 2);

        // Ensure the menu doesn't go off-screen
        left = Math.max(10, Math.min(left, window.innerWidth - menuRect.width - 10));

        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;

        activeMessageMenu.element = menu;
        activeMessageMenu.triggerElement = wrapper;
}
/**
 * Hides the long-press action menu.
 */
function hideLongPressMenu() {
        if (activeMessageMenu.element) {
                activeMessageMenu.element.classList.add('hidden');
                activeMessageMenu.element = null;
                activeMessageMenu.timestamp = null;
                activeMessageMenu.sticker = null; // 清理sticker信息
                // 还原菜单为消息操作菜单
                messageActionsMenu.innerHTML = `
            <div class="bg-gray-700/90 backdrop-blur-sm rounded-xl p-1 flex items-center gap-1 shadow-lg">
                <button data-action="copy" class="action-menu-btn">复制</button>
                <button data-action="favorite" class="action-menu-btn">收藏</button>
                <button data-action="reply" class="action-menu-btn">引用</button>
                <button data-action="select" class="action-menu-btn">多选</button>
                <button data-action="delete" class="action-menu-btn text-red-400">删除</button>
            </div>
        `;
        }
}

/**
 * Copies the text content of the active message to the clipboard.
 */
function copyMessageText() {
        if (!activeMessageMenu.timestamp) return;
        const targetTs = activeMessageMenu.timestamp;          // 已是 number
        const message = currentChat.history.find(m => toMillis(m.timestamp) === targetTs);

        if (message && message.content) {
                navigator.clipboard.writeText(message.content)
                        .then(() => showToast('已复制到剪贴板'))
                        .catch(err => console.error('无法复制文本: ', err));
        }
}

/**
 * 切换收藏状态：若已存在则取消，否则加入
 */
async function favoriteMessage() {
        if (!activeMessageMenu.timestamp) return;
        const targetTs = activeMessageMenu.timestamp;            // number
        const msg = currentChat.history.find(m => toMillis(m.timestamp) === targetTs);
        if (!msg) return;

        // 不走 .where()，避免 “KeyPath … is not indexed” 报错
        const exist = await db.favorites
                .filter(f => f.chatId === charId && toMillis(f.originalTimestamp) === targetTs)
                .first();

        if (exist) {
                await db.favorites.delete(exist.id);             // 取消收藏
                showToast('已取消收藏');
        } else {
                await db.favorites.add({
                        type: 'chat_message',
                        chatId: charId,
                        originalTimestamp: msg.timestamp,
                        content: msg,
                        timestamp: Date.now()
                });
                showToast('已收藏！');
        }
}


/**
 * Deletes the active message after confirmation.
 */
async function deleteMessage() {
        const timestampToDelete = activeMessageMenu.timestamp;
        if (!timestampToDelete) return;

        const confirmed = await showConfirmModal(
                '删除消息',
                '确定要删除这条消息吗？',
                '删除',
                '取消'
        );
        if (confirmed) {
                // 使用我们预先保存的局部变量进行过滤
                currentChat.history = currentChat.history.filter(m => toMillis(m.timestamp) !== timestampToDelete);
                if (currentChat.history.length > 0) {
                        const newLastMessage = currentChat.history[currentChat.history.length - 1];
                        currentChat.lastMessageTimestamp = newLastMessage.timestamp;
                        currentChat.lastMessageContent = newLastMessage;
                } else {
                        currentChat.lastMessageTimestamp = null;
                        currentChat.lastMessageContent = null;
                }

                await db.chats.put(currentChat);
                renderMessages();
        }
}

/**
 * Initiates reply mode for the active message.
 */
function startReply() {
        if (!activeMessageMenu.timestamp) return;
        const targetTs = activeMessageMenu.timestamp;
        const message = currentChat.history.find(m => toMillis(m.timestamp) === targetTs);
        if (!message) return;

        const messageType = message.type || 'text';

        // 规则 1: 禁止引用转账或红包
        if (messageType === 'transfer' || messageType === 'red_packet') {
                showToast('转账和红包消息不支持引用。', 'error');
                return;
        }

        let contentSnippet = '';

        // 规则 2: 根据不同消息类型生成预览
        switch (messageType) {
                case 'sticker':
                        // 引用表情时，显示一个小尺寸的表情图片
                        contentSnippet = `<img src="${message.content}" alt="[表情]" class="inline-block h-5 w-5 align-middle">`;
                        break;
                case 'text_photo':
                        contentSnippet = '[图片]';
                        break;
                case 'voice_message':
                        contentSnippet = '[语音]';
                        break;
                case 'share_link':
                        contentSnippet = `[链接] ${message.title}`;
                        break;
                default: // 默认处理文本消息
                        contentSnippet = (typeof message.content === 'string') ? message.content : '[非文本内容]';
                        contentSnippet = contentSnippet.substring(0, 50) + (contentSnippet.length > 50 ? '...' : '');
                        break;
        }

        currentReplyContext = {
                senderName: message.senderName || (message.role === 'user' ? (activeUserPersona?.name || '我') : currentChat.name),
                content: contentSnippet
        };

        document.getElementById('reply-to-name').textContent = `回复 ${currentReplyContext.senderName}:`;
        // 使用 innerHTML 来渲染表情图片
        document.getElementById('reply-content-snippet').innerHTML = currentReplyContext.content;
        replyPreviewBar.classList.remove('hidden');
        chatInput.focus();
}

/**
 * Cancels reply mode.
 */
function cancelReply() {
        currentReplyContext = null;
        replyPreviewBar.classList.add('hidden');
}

/**
 * Enters multi-selection mode.
 */
function enterSelectionMode() {
        if (!activeMessageMenu.timestamp) return;
        isSelectionMode = true;


        // Toggle headers
        defaultHeader.classList.add('hidden');
        selectionHeader.classList.remove('hidden');
        document.getElementById('chat-input-actions-top').classList.add('hidden');
        chatForm.classList.add('hidden');

        selectionCount.textContent = `已选择 ${selectedMessages.size} 项`;

        renderMessages(); // Re-render to show checkboxes
}

/**
 * Exits multi-selection mode.
 */
function exitSelectionMode() {
        isSelectionMode = false;
        selectedMessages.clear();

        // Toggle headers back
        defaultHeader.classList.remove('hidden');
        selectionHeader.classList.add('hidden');
        document.getElementById('chat-input-actions-top').classList.remove('hidden');
        chatForm.classList.remove('hidden');

        renderMessages(); // Re-render to hide checkboxes
}

/**
 * Toggles the selection state of a message.
 * @param {Date} msgTimestamp - The timestamp of the message to toggle.
 */
function toggleMessageSelection(rawTs) {
        const ts = toMillis(rawTs);
        const wrapper = document.querySelector(`.message-wrapper[data-timestamp="${ts}"]`);
        if (!wrapper) return;

        // 直接获取复选框元素
        const checkbox = wrapper.querySelector('.selection-checkbox');
        if (!checkbox) return; // 安全检查

        if (selectedMessages.has(ts)) {
                selectedMessages.delete(ts);
                wrapper.classList.remove('selected');
                checkbox.classList.remove('checked'); // 直接移除 checked 类
        } else {
                selectedMessages.add(ts);
                wrapper.classList.add('selected');
                checkbox.classList.add('checked'); // 直接添加 checked 类
        }
        selectionCount.textContent = `已选择 ${selectedMessages.size} 项`;
        if (selectedMessages.size === 0) exitSelectionMode();
}


/**
 * Deletes all currently selected messages.
 */
async function deleteSelectedMessages() {
        if (selectedMessages.size === 0) return;

        const confirmed = await showConfirmModal(
                '删除消息',
                `确定要删除选中的 ${selectedMessages.size} 条消息吗？`,
                '确认',
                '取消'
        );
        if (confirmed) {
                const timestampsToDelete = Array.from(selectedMessages);       // 均为 number
                currentChat.history = currentChat.history.filter(
                        m => !timestampsToDelete.includes(toMillis(m.timestamp))
                );

                if (currentChat.history.length > 0) {
                        const newLastMessage = currentChat.history[currentChat.history.length - 1];
                        currentChat.lastMessageTimestamp = newLastMessage.timestamp;
                        currentChat.lastMessageContent = newLastMessage;
                } else {
                        currentChat.lastMessageTimestamp = null;
                        currentChat.lastMessageContent = null;
                }

                await db.chats.put(currentChat);
                exitSelectionMode();
        }
}


function setupPlayerControls() {
        document.addEventListener('spotifyStateUpdate', ({ detail: state }) => {
                if (playerUpdateInterval) clearInterval(playerUpdateInterval);

                if (!state || !state.track_window.current_track) {
                        musicPlayerBar.classList.add('hidden');
                        currentlyPlayingUri = null; // 停止播放时重置
                        return;
                }

                musicPlayerBar.classList.remove('hidden');
                const { paused, duration, position, track_window, shuffle } = state; // 新增获取 shuffle 状态
                const current_track = track_window.current_track;
                currentShuffleState = shuffle;

                playerSongTitle.textContent = current_track.name;
                playerSongArtist.textContent = current_track.artists.map(a => a.name).join(', ');

                const playIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16"><path d="M10.804 8 5 4.633v6.734L10.804 8zm.792-.696a.802.802 0 0 1 0 1.392l-6.363 3.692C4.713 12.69 4 12.345 4 11.692V4.308c0-.653.713-.998 1.233-.696l6.363 3.692z"/></svg>`;
                const pauseIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" class="bi bi-pause" viewBox="0 0 16 16"><path d="M6 3.5a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5m4 0a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5"/></svg>`;
                shuffleBtn.style.color = shuffle ? 'var(--accent-color)' : '#6b7280';

                const newShuffleBtn = shuffleBtn.cloneNode(true);
                shuffleBtn.parentNode.replaceChild(newShuffleBtn, shuffleBtn);
                shuffleBtn = newShuffleBtn; // 更新对按钮的引用
                shuffleBtn.addEventListener('click', () => spotifyManager.toggleShuffle(!currentShuffleState));

                playerToggleBtn.innerHTML = paused ? playIcon : pauseIcon;

                let currentPosition = position;
                const updateProgress = () => {
                        const progressPercent = (currentPosition / duration) * 100;
                        playerProgressBar.style.width = `${progressPercent}%`;
                };
                updateProgress();

                if (!paused) {
                        playerUpdateInterval = setInterval(() => {
                                currentPosition += 100;
                                updateProgress();
                                if (currentPosition >= duration) clearInterval(playerUpdateInterval);
                        }, 100);
                }

                // ▼▼▼ 仅在歌曲切换时通知AI ▼▼▼
                if (current_track.uri !== currentlyPlayingUri) {
                        currentlyPlayingUri = current_track.uri; // 更新当前播放的歌曲ID

                        const nextSongInfo = track_window.next_tracks.length > 0 ? `下一首是: ${track_window.next_tracks[0].name}` : '这是最后一首歌了。';
                        const systemMessage = {
                                role: 'system',
                                type: 'spotify_state_info',
                                content: `[系统提示：音乐状态已更新。正在播放: ${current_track.name} - ${current_track.artists.map(a => a.name).join(', ')}。${nextSongInfo}]`,
                                timestamp: Date.now(),
                                isHidden: true,
                        };

                        addUserMessageToDb(systemMessage, false, charId); // 只有新歌开始时才调用AI
                }
        });

        playerPrevBtn.addEventListener('click', spotifyManager.previousTrack);
        playerNextBtn.addEventListener('click', spotifyManager.nextTrack);
        playerToggleBtn.addEventListener('click', spotifyManager.togglePlay);
}

// --- Sticker Panel Logic ---
let stickerPanelRendered = false;

async function toggleStickerPanel() {
        const panel = document.getElementById('sticker-panel');
        const isOpen = panel.style.maxHeight !== '0px';

        if (!isOpen) { // 打开面板
                if (!stickerPanelRendered) {
                        await renderStickerPanel();
                        stickerPanelRendered = true;
                        setTimeout(() => {
                                scrollToBottom();
                        }, 300);
                }
                panel.style.maxHeight = '192px'; // h-48
                // 添加一个全局监听器
                document.addEventListener('click', closeStickerPanelOnClickOutside, true);
        } else { // 关闭面板
                panel.style.maxHeight = '0px';
                // 移除全局监听器
                document.removeEventListener('click', closeStickerPanelOnClickOutside, true);
        }
}

function closeStickerPanelOnClickOutside(event) {
        const footer = document.querySelector('footer');
        // 如果点击发生在 footer 外部，则关闭面板
        if (!footer.contains(event.target)) {
                const panel = document.getElementById('sticker-panel');
                if (panel.style.maxHeight !== '0px') {
                        panel.style.maxHeight = '0px';
                        document.removeEventListener('click', closeStickerPanelOnClickOutside, true);
                }
        }
}
async function renderStickerPanel() {
        stickerPanelGrid.innerHTML = '<p class="col-span-full text-center text-gray-500">加载中...</p>';
        const stickers = await db.userStickers.orderBy('order').reverse().toArray();
        stickerPanelGrid.innerHTML = '';

        if (stickers.length === 0) {
                stickerPanelGrid.innerHTML = '<p class="col-span-full text-center text-gray-500">表情库是空的</p>';
                return;
        }

        stickers.forEach(sticker => {
                const stickerEl = document.createElement('div');
                stickerEl.className = 'aspect-square bg-white rounded-md flex items-center justify-center p-1 cursor-pointer hover:bg-gray-200 transition';
                stickerEl.innerHTML = `<img src="${sticker.url}" alt="${sticker.name}" class="max-w-full max-h-full object-contain pointer-events-none">`;

                // 为每个表情创建一个独立的状态
                let pressTimer = null;
                let isLongPress = false;

                const startPress = (e) => {
                        isLongPress = false; // 每次按下时重置状态
                        pressTimer = setTimeout(() => {
                                isLongPress = true; // 确认这是一次长按
                                e.preventDefault();
                                showStickerActionMenu(e.target, sticker);
                        }, 500);
                };

                const cancelPress = () => {
                        clearTimeout(pressTimer);
                };

                // 修改 click 事件监听器
                stickerEl.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // 如果是长按，则不执行发送逻辑
                        if (isLongPress) {
                                return;
                        }
                        // 否则，正常发送表情
                        sendSticker(sticker);
                });

                stickerEl.addEventListener('mousedown', startPress);
                stickerEl.addEventListener('mouseup', cancelPress);
                stickerEl.addEventListener('mouseleave', cancelPress); // 增加 mouseleave 以取消计时
                stickerEl.addEventListener('touchstart', startPress, { passive: true });
                stickerEl.addEventListener('touchend', cancelPress);

                stickerPanelGrid.appendChild(stickerEl);
        });
}

async function sendSticker(sticker) {
        const stickerMessage = {
                role: 'user',
                type: 'sticker',
                content: sticker.url,
                meaning: sticker.name,
                timestamp: Date.now()
        };

        // 发送表情后，立即关闭面板并调整高度
        const panel = document.getElementById('sticker-panel');
        panel.style.maxHeight = '0px';
        document.removeEventListener('click', closeStickerPanelOnClickOutside);

        await addUserMessageToDb(stickerMessage, false);
}

function showStickerActionMenu(targetElement, sticker) {
        activeMessageMenu.sticker = sticker;
        const menu = messageActionsMenu;
        menu.innerHTML = `
        <div class="bg-gray-700/90 backdrop-blur-sm rounded-xl p-1 flex items-center gap-1 shadow-lg">
            <button data-action="delete_sticker" class="action-menu-btn text-red-400">删除</button>
            <button data-action="move_sticker_top" class="action-menu-btn">移到最前</button>
        </div>
    `;

        menu.classList.remove('hidden');
        const rect = targetElement.getBoundingClientRect();
        menu.style.left = `${rect.left + rect.width / 2 - menu.offsetWidth / 2}px`;
        menu.style.top = `${rect.top - menu.offsetHeight - 5}px`;
        activeMessageMenu.element = menu;
        activeMessageMenu.triggerElement = targetElement;
}

async function handleChatEntryLogic() {
        if (isGroupChat) return; // 情报网和离线事件播报暂时只在私聊中进行

        // --- 1. 离线事件处理  ---
        if (currentChat.groupId) {
                const unprocessedEvents = await db.eventLog
                        .where('groupId').equals(currentChat.groupId)
                        .filter(event => !(event.processedBy && event.processedBy.includes(charId)))
                        .toArray();

                if (unprocessedEvents.length > 0) {
                        console.log(`为 ${currentChat.name} 发现了 ${unprocessedEvents.length} 条新事件，正在处理...`);
                        const eventSummaries = unprocessedEvents.map(e => `- ${e.content}`).join('\n');
                        const systemMessage = {
                                role: 'system',
                                type: 'event_briefing',
                                content: `[系统提示：在你离线期间，你所在的圈子发生了以下事情：\n${eventSummaries}\n请基于这些新发生的事情，自然地开启与用户的对话，或者在对话中有所体现。你可能会想分享八卦、表达关心、或者改变对某事的看法。]`,
                                timestamp: Date.now(),
                                isHidden: true, // 这条消息只给AI看，不显示在聊天记录里
                        };
                        console.log(eventSummaries)

                        const shouldTriggerAI = globalSettings.intelGeneratesMessage !== false;
                        await addUserMessageToDb(systemMessage, shouldTriggerAI, charId);

                        // 标记事件为已处理
                        for (const event of unprocessedEvents) {
                                const processed = event.processedBy || [];
                                processed.push(charId);
                                await db.eventLog.update(event.id, { processedBy: processed });
                        }
                        // 事件处理完后，同时更新情报时间戳，避免立即重复搜集
                        await db.chats.update(charId, { lastIntelUpdateTime: Date.now() });
                        return; // 播报了重大事件，本次不再执行普通的情报搜集
                }
        }

        // --- 2. 情报网冷却检查 ---
        const cooldownMinutes = globalSettings.intelCooldownMinutes || 5;
        const lastUpdate = currentChat.lastIntelUpdateTime || 0;
        const now = Date.now();
        const minutesSinceLastUpdate = (now - lastUpdate) / (1000 * 60);

        if (minutesSinceLastUpdate < cooldownMinutes) {
                console.log(`距离上次情报更新仅 ${minutesSinceLastUpdate.toFixed(1)} 分钟，跳过本次搜集。`);
                return;
        }

        console.log("冷却时间已过，开始执行情报搜集...");

        // --- 3. 执行情报搜集 ---
        // 这个动作现在会生成一段可注入的Prompt文本
        const intelligencePrompt = await gatherIntelligenceFor(charId);
        console.log(`搜集到的情报：\n${intelligencePrompt}`);

        // 4. 如果搜集到了新情报，则触发一次AI的“自我思考”
        if (intelligencePrompt) {
                const systemMessage = {
                        role: 'system',
                        type: 'intelligence_briefing',
                        content: `[系统提示：你最近听到了一些关于你社交圈的事，请消化这些信息，并准备好与User的对话。情报如下：\n${intelligencePrompt}]`,
                        timestamp: Date.now(),
                        isHidden: true,
                };
                const shouldTriggerAI = globalSettings.intelGeneratesMessage !== false;
                await addUserMessageToDb(systemMessage, shouldTriggerAI, charId); // 让AI基于新情报，可能主动发消息
        }

        // 5. 更新情报时间戳
        await db.chats.update(charId, { lastIntelUpdateTime: Date.now() });
}

/**
 * 格式化时间戳为绝对时间字符串 (e.g., "2025-08-09 15:30")
 * @param {Date | string | number} timestamp - 要格式化的时间戳
 * @returns {string} - 格式化后的字符串
 */
function formatAbsoluteTime(timestamp) {
        const d = new Date(timestamp);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}`;
}

async function gatherIntelligenceFor(characterId) {
        if (!currentChat.groupId) return ""; // 角色必须在分组内才有社交圈

        const scanRange = globalSettings.infoScanRange || 50;
        let intelligenceContent = "";

        // 1. 获取角色自己的聊天记录，检查以前的情报简报
        const characterChat = await db.chats.get(characterId);
        const recentHistoryForBriefings = characterChat.history.slice(-20);
        const oldBriefings = new Set();
        recentHistoryForBriefings.forEach(msg => {
                if (msg.type === 'intelligence_briefing' && msg.content) {
                        // 从旧简报中提取出每一条情报，存入Set以便快速查找
                        const lines = msg.content.match(/- .*/g) || [];
                        lines.forEach(line => oldBriefings.add(line.trim()));
                }
        });

        // 2. 获取同组的其他角色和当前角色的关系
        const allChats = await db.chats.toArray();
        const groupMembers = allChats.filter(c => c.groupId === currentChat.groupId && c.id !== characterId && !c.isGroup);
        const myRelations = await db.relationships.where('sourceCharId').equals(characterId).toArray();
        const relationsMap = new Map(myRelations.map(r => [r.targetCharId, r]));

        // 3. 准备用于检查的名称列表
        const namesToCheck = [currentChat.name, currentChat.realName].filter(Boolean).map(n => n.toLowerCase());
        if (currentChat.realName && currentChat.realName.includes(' ')) {
                namesToCheck.push(currentChat.realName.split(' ')[0].toLowerCase());
        }

        // 4. 遍历朋友的聊天记录搜集情报
        for (const member of groupMembers) {
                const relation = relationsMap.get(member.id);
                if (relation && relation.score > 100) {
                        const friendChat = allChats.find(c => c.id === member.id);
                        if (friendChat && friendChat.history.length > 0) {
                                const recentHistory = friendChat.history.slice(-scanRange);
                                const filteredHistory = recentHistory.filter(msg =>
                                        msg.role !== 'system' &&
                                        !msg.isHidden &&
                                        msg.content &&
                                        typeof msg.content === 'string'
                                );

                                for (const msg of filteredHistory) {
                                        const lowerCaseContent = msg.content.toLowerCase();
                                        const mentionsMe = namesToCheck.some(name => lowerCaseContent.includes(name));

                                        if (mentionsMe) {
                                                const speaker = msg.role === 'user' ? activeUserPersona?.name : friendChat.name;
                                                const listener = msg.role === 'user' ? friendChat.name : activeUserPersona?.name;

                                                // 使用绝对时间来生成情报字符串
                                                const absoluteTime = formatAbsoluteTime(msg.timestamp);
                                                const newIntelLine = `- [${absoluteTime}] 你听说 ${speaker} 和 ${listener} 聊天时提到了你：“${msg.content}”。`;

                                                // 因为 newIntelLine 的字符串现在是固定的，所以去重逻辑可以正确工作了
                                                if (!oldBriefings.has(newIntelLine)) {
                                                        intelligenceContent += newIntelLine + '\n';
                                                }
                                        }
                                }
                        }
                }
        }
        return intelligenceContent;
}

/**
 * A generic prompt modal that returns a promise.
 * @param {string} title - The title of the modal.
 * @param {string} placeholder - The placeholder for the input.
 * @param {string} initialValue - The initial value of the input.
 * @returns {Promise<string|null>} - A promise that resolves with the input value or null if canceled.
 */
function promptForInputPat(title, placeholder = '', initialValue = '') {
        return new Promise((resolve) => {
                const modal = document.getElementById('prompt-modal');
                document.getElementById('prompt-title').textContent = title;
                const input = document.getElementById('prompt-input');
                input.placeholder = placeholder;
                input.value = initialValue;
                // The input in the modal is a textarea, which works fine for this.
                modal.classList.add('visible');

                const confirmBtn = document.getElementById('prompt-confirm-btn');
                const cancelBtn = document.getElementById('prompt-cancel-btn');

                const confirmHandler = () => {
                        cleanup();
                        resolve(input.value); // Resolve with the input value
                };

                const cancelHandler = () => {
                        cleanup();
                        resolve(null); // Resolve with null on cancel
                };

                const cleanup = () => {
                        modal.classList.remove('visible');
                        // Use removeEventListener to ensure no duplicate listeners are attached
                        confirmBtn.removeEventListener('click', confirmHandler);
                        cancelBtn.removeEventListener('click', cancelHandler);
                        // Restore the original onclick for other functions
                        confirmBtn.onclick = async () => { /* ... original logic from handlePromptAndSend if any ... */ };
                };

                // Use addEventListener with { once: true } for clean, one-time execution
                confirmBtn.addEventListener('click', confirmHandler, { once: true });
                cancelBtn.addEventListener('click', cancelHandler, { once: true });
        });
}

// “拍一拍” 功能
async function handleUserPat(targetChatId, targetName) {
        const chat = await db.chats.get(targetChatId);
        if (!chat) return;

        // 1. Use the new helper to prompt for an optional suffix.
        const suffix = await promptForInputPat(
                `你拍了拍 “${targetName}”`,
                "（可选）输入后缀，如“的脑袋”",
                ""
        );

        // 2. If the user clicked "Cancel", the suffix will be null. Exit the function.
        if (suffix === null) {
                return;
        }

        // 3. (Optional but recommended) Add screen shake animation
        document.body.classList.add('pat-animation');
        setTimeout(() => document.body.classList.remove('pat-animation'), 500);

        const myNickname = chat.isGroup ? (chat.settings.myNickname || '我') : '我';

        // 4. Construct message content, including the suffix if provided.
        const patText = `${myNickname} 拍了拍 "${targetName}"${suffix ? ' ' + suffix.trim() : ''}`;
        const hiddenTextForAI = `[系统提示：用户 (${myNickname}) 刚刚拍了拍你 (${targetName})${suffix ? ' ' + suffix.trim() : ''}。请你对此作出回应。]`;

        // 5. Create the visible and hidden messages.
        const visibleMessage = {
                role: 'system',
                type: 'system_message', // This type is correctly handled by createBubble for display
                content: patText,
                timestamp: Date.now()
        };

        const hiddenMessage = {
                role: 'system',
                content: hiddenTextForAI,
                timestamp: new Date(Date.now() + 1), // Ensure timestamp is later
                isHidden: true
        };

        // 6. Update the database and the UI.
        chat.history.push(visibleMessage, hiddenMessage);
        appendMessage(visibleMessage); // Append the visible message to the chat

        await db.chats.put(chat);
        currentChat = chat;
}

/**
 * Handles the logic for an AI-initiated pat action.
 * @param {string} patterName - The name of the character performing the pat.
 * @param {string} patteeName - The name of the character being patted.
 * @param {string} [suffix] - An optional suffix for the pat message.
 */
function handleAiPat(patterName, patteeName, suffix) {
        // Trigger the screen shake animation
        document.body.classList.add('pat-animation');
        setTimeout(() => document.body.classList.remove('pat-animation'), 500);

        const suffixText = suffix ? ' ' + suffix.trim() : '';
        const patText = `${patterName} 拍了拍 "${patteeName}"${suffixText}`;

        const patMessage = {
                role: 'system',
                type: 'system_message',
                content: patText,
                timestamp: Date.now()
        };

        currentChat.history.push(patMessage);
        appendMessage(patMessage);
}

// 发起外卖请求
async function sendWaimaiRequest() {
        const productInfo = document.getElementById('waimai-product-info').value.trim();
        const amount = parseFloat(document.getElementById('waimai-amount').value);

        if (!productInfo || isNaN(amount) || amount <= 0) {
                showToast("请输入有效的商品信息和金额！", 'error');
                return;
        }

        const myNickname = currentChat.settings.myNickname || '我';
        const message = {
                role: 'user',
                senderName: myNickname,
                type: 'waimai_request',
                productInfo,
                amount,
                status: 'pending', // 初始状态为待处理
                timestamp: Date.now()
        };

        await addUserMessageToDb(message, false);
        document.getElementById('waimai-request-modal').classList.remove('visible');
        document.getElementById('waimai-product-info').value = '';
        document.getElementById('waimai-amount').value = '';
}

function handleChatLock() {
        if (!currentChat || currentChat.isGroup) {
                lockOverlay.classList.add('hidden');
                chatInputArea.classList.remove('hidden');
                return;
        }

        const blockInfo = currentChat.blockStatus;
        let lockHtml = '';
        let shouldLock = true;

        if (!blockInfo) {
                shouldLock = false; // blockStatus 为 null 或 undefined，表示关系正常
        } else {
                switch (blockInfo.status) {
                        case 'blocked_by_user':
                                lockHtml = `
                    <p class="text-sm text-gray-600">你已将“${currentChat.name}”拉黑。</p>
                    <button id="unblock-btn" class="w-full p-2 rounded-lg text-white font-semibold primary-btn">解除拉黑</button>
                `;
                                break;
                        case 'blocked_by_ai':
                                lockHtml = `
                    <p class="text-sm text-gray-600">你被对方拉黑了。</p>
                    <button id="apply-friend-btn" class="w-full p-2 rounded-lg text-white font-semibold primary-btn">重新申请加为好友</button>
                `;
                                break;
                        case 'pending_user_approval':
                                lockHtml = `
                    <p class="text-sm text-gray-600">“${currentChat.name}”请求添加你为好友：<br><i>“${blockInfo.applicationReason || '你好！'}”</i></p>
                    <div class="grid grid-cols-2 gap-2">
                        <button id="reject-friend-btn" class="w-full p-2 rounded-lg font-semibold secondary-btn">拒绝</button>
                        <button id="accept-friend-btn" class="w-full p-2 rounded-lg text-white font-semibold primary-btn">接受</button>
                    </div>
                `;
                                break;
                        case 'pending_ai_approval':
                                lockHtml = `<p class="text-sm text-gray-600">好友申请已发送，等待对方通过...</p>`;
                                break;
                        default:
                                shouldLock = false;
                                break;
                }
        }

        if (shouldLock) {
                lockContent.innerHTML = lockHtml;
                lockOverlay.classList.remove('hidden');
                chatInputArea.classList.add('hidden');
        } else {
                lockOverlay.classList.add('hidden');
                chatInputArea.classList.remove('hidden');
        }
}

/**
 * 将URL转换为Base64数据
 * @param {string} url - 图片的URL
 * @returns {Promise<{mimeType: string, base64Data: string}>}
 */
async function urlToGenerativePart(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
        const blob = await response.blob();
        const mimeType = blob.type;

        return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                        // result 是 data:mime/type;base64,xxxx...
                        // 我们需要去掉前面的 "data:mime/type;base64," 部分
                        const base64Data = reader.result.split(',')[1];
                        resolve({ mimeType, base64Data });
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
        });
}

/**
 * 处理用户选择多张本地图片后的上传和发送流程
 * @param {Event} event - 文件输入框的 'change' 事件
 */
async function handleMultiImageUpload(event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        // 可以在这里添加一个UI提示，告诉用户“正在上传...”

        try {
                // 在上传前，一次性检查Cloudinary配置
                const cloudinaryConfig = await db.globalSettings.get('main');
                if (!cloudinaryConfig?.cloudinaryCloudName || !cloudinaryConfig?.cloudinaryUploadPreset) {
                        showToast("请先在“设置”页面配置 Cloudinary 图片上传服务。", 'error');
                        return;
                }

                // 使用 Promise.all 并行上传所有图片，以提高效率
                const uploadPromises = Array.from(files).map(file => uploadImage(file));
                const imageUrls = await Promise.all(uploadPromises);

                // 逐条发送图片消息
                for (let i = 0; i < imageUrls.length; i++) {
                        const imageUrl = imageUrls[i];
                        const userMessage = {
                                role: 'user',
                                type: 'image_url',
                                content: imageUrl,
                                timestamp: Date.now() + i
                        };

                        await addUserMessageToDb(userMessage, false);

                        if (i < imageUrls.length - 1) {
                                await sleep(300);
                        }
                }
        } catch (error) {
                console.error("多图片上传失败:", error);
                showToast("图片上传过程中发生错误，详情请查看控制台。", 'error');
        } finally {
                multiImageInput.value = '';
        }
}

/**
 * 格式化时间戳为相对时间字符串
 * @param {Date | string | number} timestamp - 要格式化的时间戳
 * @returns {string} - 格式化后的字符串 (例如 "刚刚", "5分钟前", "昨天")
 */
function formatRelativeTime(timestamp) {
        const now = new Date();
        const date = new Date(timestamp);
        const diffMs = now - date;
        const diffSeconds = Math.round(diffMs / 1000);
        const diffMinutes = Math.round(diffSeconds / 60);
        const diffHours = Math.round(diffMinutes / 60);
        const diffDays = Math.round(diffHours / 24);

        if (diffMinutes < 1) return '刚刚';
        if (diffMinutes < 60) return `${diffMinutes}分钟前`;
        if (diffHours < 24) return `${diffHours}小时前`;
        if (diffDays === 1) return '昨天';
        if (diffDays < 7) return `${diffDays}天前`;
        return date.toLocaleDateString('zh-CN'); // 超过一周则显示具体日期
}

// --- 通话核心功能函数 ---

/**
 * 用户发起呼叫请求
 * @param {'voice' | 'video'} type - 通话类型
 */
async function initiateOutgoingCall(type) {
        if (isCallActive || outgoingCallState?.pending) return;
        applyCallScreenTheme();
        outgoingCallState = { type: type, pending: true };
        callInitiator = 'user';
        // 1. 显示 "正在呼叫..." UI
        callAvatar.src = currentChat.settings.aiAvatar || '...';
        callName.textContent = currentChat.name;
        document.getElementById('call-status').classList.add('hidden');
        const speakingIndicator = document.getElementById('call-speaking-indicator');
        speakingIndicator.textContent = '正在呼叫...';
        speakingIndicator.classList.remove('opacity-0');

        callScreenModal.classList.remove('hidden');
        // 隐藏输入框，只显示挂断按钮
        videoContentArea.classList.add('hidden');
        voiceContentArea.classList.add('hidden');
        callInputContainer.classList.add('hidden');

        // 2. 创建对AI可见的系统消息
        const callRequestMessage = {
                role: 'system',
                content: `[系统提示：用户正在向你发起${type === 'voice' ? '语音' : '视频'}通话请求。请你基于人设和当前情景，决定是接受还是拒绝。]`,
                isHidden: true,
                timestamp: Date.now()
        };

        // 3. 将请求消息添加到数据库并触发AI响应
        await addUserMessageToDb(callRequestMessage, true);
}

/**
 * 挂断通话
 */
async function hangUpCall() {
        // 检查是否是正在呼叫但未接通的状态
        if (outgoingCallState?.pending) {
                // 1. 重置呼出状态，这会阻止后续的接通逻辑
                outgoingCallState = null;

                // 2. 隐藏通话界面
                callScreenModal.classList.add('hidden');

                // 3. 向AI发送一条隐藏消息，告知它你已取消
                //    这样可以防止AI在你挂断后，仍然尝试“接通”一个不存在的电话
                const cancelMessage = {
                        role: 'system',
                        content: `[系统提示：用户取消了通话请求。]`,
                        isHidden: true,
                        timestamp: Date.now()
                };
                // 注意：这里我们只更新数据库，不需要AI立即回应，所以第二个参数是 false
                await addUserMessageToDb(cancelMessage, false);

                console.log("用户在响铃时挂断了电话。");
                sessionStorage.removeItem('activeCallState');

                // 检查是否是已经接通的通话状态
        } else if (isCallActive) {

                const duration = Math.round((Date.now() - callStartTime) / 1000);
                clearInterval(callTimerInterval);

                // 1. 将完整的通话记录保存到 callLogs 表
                const callLogEntry = {
                        charId: charId,
                        type: callType,
                        startTime: callStartTime,
                        duration: duration,
                        initiator: callInitiator || 'user',
                        transcript: currentCallTranscript // 保存详细对话
                };
                await db.callLogs.add(callLogEntry);

                // 2. 创建对用户可见的 "通话结束" 消息
                const visibleEndMessage = {
                        role: 'system',
                        type: 'system_message',
                        content: `通话结束，时长 ${formatDuration(duration)}`,
                        timestamp: Date.now()
                };
                currentChat.history.push(visibleEndMessage);

                // 4. 保存对 chat 历史的所有修改
                await db.chats.put(currentChat);

                // 5. 重置UI和状态
                callScreenModal.classList.add('hidden');
                isCallActive = false;
                callType = null;
                callStartTime = null;
                callInitiator = null;
                currentCallTranscript = []; // 清空临时记录
                callInput.value = '';
                outgoingCallState = null;
                incomingCallOffer = null;

                // 6. 重新渲染聊天列表以显示 "通话结束" 消息
                renderMessages();
                sessionStorage.removeItem('activeCallState');
        }
}

/**
 * 在通话中发送消息
 */
async function handleSendCallMessage(e) {
        e.preventDefault();
        if (isAiRespondingInCall) return;

        const text = callInput.value.trim();
        if (!text) return;

        // 1. 创建对AI可见的、带有上下文标记的消息
        const userMessageForAI = {
                role: 'user',
                content: `[${callType === 'video' ? '视频' : '语音'}通话]: ${text}`,
                timestamp: Date.now(),
                isHidden: true // 标记为对聊天室UI隐藏，但对AI可见
        };

        // 2. 创建用于通话记录的、简洁的消息
        const userMessageForTranscript = {
                role: 'user',
                content: text,
                timestamp: Date.now()
        };
        currentCallTranscript.push(userMessageForTranscript);

        const savedCallStateJSON = sessionStorage.getItem('activeCallState');
        if (savedCallStateJSON) {
                const savedCallState = JSON.parse(savedCallStateJSON);
                savedCallState.transcript = currentCallTranscript;
                await syncCallStateToSessionStorage();
        }

        // 3. 更新通话界面的UI
        if (callType === 'video') {
                videoDialogueBox.innerHTML += `<p class="text-left"><span class="bg-blue-500/50 px-2 py-1 rounded-lg">${text}</span></p>`;
                videoDialogueBox.scrollTop = videoDialogueBox.scrollHeight;
        } else {
                voiceContentArea.innerHTML += `<p class="text-left"><span class="text-blue-300 font-semibold">你:</span> ${text}</p>`;
                voiceContentArea.scrollTop = voiceContentArea.scrollHeight;
        }

        callInput.value = '';

        await addUserMessageToDb(userMessageForAI, false);
}

/**
 * 更新通话计时器
 */
function updateCallTimer() {
        if (!callStartTime) return;
        const duration = Math.round((Date.now() - callStartTime) / 1000);
        callStatus.textContent = formatDuration(duration);
}

/**
 * 格式化秒数为 HH:MM:SS 或 MM:SS
 */
function formatDuration(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        const pad = (num) => String(num).padStart(2, '0');

        if (h > 0) {
                return `${pad(h)}:${pad(m)}:${pad(s)}`;
        }
        return `${pad(m)}:${pad(s)}`;
}


function updateParticipantUI() {
        const listEl = document.getElementById('call-participant-list');
        listEl.innerHTML = ''; // 清空

        // 总是先显示用户自己
        const userAvatar = activeUserPersona?.avatar || 'https://files.catbox.moe/kkll8p.svg';
        listEl.innerHTML += `<img src="${userAvatar}" class="w-12 h-12 rounded-full border-2 border-green-400" title="${activeUserPersona?.name || '我'}">`;

        // 再显示其他参与者
        callParticipants.forEach(p => {
                listEl.innerHTML += `<img src="${p.avatar || '...'}" class="w-12 h-12 rounded-full border-2 border-gray-500" title="${p.name}">`;
        });
}

/**
 * 处理AI对我们通话请求的回应
 * @param {'accept' | 'reject'} decision - AI的决定
 * @param {string} [reason] - 拒绝时的理由
 */
async function handleAiCallResponse(decision, reason) {
        if (!outgoingCallState?.pending) return;

        const callType = outgoingCallState.type;
        outgoingCallState = null; // 在做出任何决定后，都清除pending状态

        if (decision === 'accept') {
                // AI接受了通话
                // 1. 首先，只管连接UI，让通话界面先生效
                await connectCall(callType);

                // 2. （关键）等待一小段时间（例如500毫秒），确保UI渲染完成
                //    并且给上一个API任务的锁一个完全释放的时间，避免冲突
                await sleep(500);

                // 3. 现在，作为一个全新的、独立的任务，去请求AI说第一句话
                const initialPrompt = `[系统提示：你接通了用户的${callType === 'voice' ? '语音' : '视频'}通话。请你先开口说第一句话。]`;
                const callStartMessage = {
                        role: 'system',
                        content: initialPrompt,
                        isHidden: true,
                        timestamp: Date.now()
                };
                await addUserMessageToDb(callStartMessage, true); // 触发AI

        } else {
                // AI拒绝了通话
                callScreenModal.classList.add('hidden'); // 关闭"正在呼叫"界面

                // 在聊天界面显示系统提示
                const systemMessage = {
                        role: 'system',
                        type: 'system_message',
                        content: `对方已拒绝通话`,
                        timestamp: Date.now()
                };
                await addUserMessageToDb(systemMessage, false);

                // 显示AI的拒绝理由
                if (reason) {
                        const reasonMessage = {
                                role: 'assistant',
                                senderName: currentChat.name,
                                content: reason,
                                timestamp: new Date(Date.now() + 1)
                        };
                        await addUserMessageToDb(reasonMessage, false);
                }
        }
        // 重置呼叫状态
        outgoingCallState = null;
}

/**
 * 真正建立通话连接并显示UI
 * @param {'voice' | 'video'} type - 通话类型
 * @param {object} options - 选项
 * @param {'ai' | 'user'} options.whoSpeaksFirst - 决定谁先说话
 */
async function connectCall(type) {
        applyCallScreenTheme();
        isCallActive = true;
        callType = type;

        // 更新UI到“通话中”状态
        callStartTime = Date.now();

        const callState = {
                charId: charId,
                isCallActive: true,
                callType: type,
                callStartTime: callStartTime,
                transcript: [] // 初始转录为空
        };
        await syncCallStateToSessionStorage();

        document.getElementById('call-speaking-indicator').classList.add('opacity-0');
        const timerElement = document.getElementById('call-status');
        timerElement.textContent = '00:00';
        timerElement.classList.remove('hidden');
        callTimerInterval = setInterval(updateCallTimer, 1000);

        // UI更新
        callInputContainer.classList.remove('hidden');
        callInput.disabled = false;
        callInput.focus();
        callScreenModal.classList.remove('hidden');
        callAvatar.src = currentChat.settings.aiAvatar || '...';
        callName.textContent = currentChat.name;

        if (type === 'video') {
                videoContentArea.classList.remove('hidden');
                videoDescriptionBox.innerHTML = '';
                videoDialogueBox.innerHTML = '';
        } else {
                voiceContentArea.classList.remove('hidden');
                voiceContentArea.innerHTML = '';
        }

        // 立即开始计时，不再等待AI先开口
        callStatus.textContent = '00:00';
        callTimerInterval = setInterval(updateCallTimer, 1000);
}

/**
 * 显示来电UI
 * @param {'voice' | 'video'} type
 * @param {object} character
 */
function showIncomingCallUI(type, character) {
        incomingCallOffer = { type: type, from: character.id };

        incomingCallAvatar.src = character.settings.aiAvatar || defaultAvatar;
        incomingCallName.textContent = character.name;
        incomingCallStatus.textContent = `${type === 'voice' ? '语音' : '视频'}通话`;

        incomingCallModal.classList.remove('hidden');
}

/**
 * 为通话界面应用动态的主题样式
 */
function applyCallScreenTheme() {
        const callScreenModal = document.getElementById('call-screen-modal');

        // --- 1. 应用渐变背景 ---
        const userBg = getComputedStyle(document.documentElement).getPropertyValue('--user-bubble-bg').trim();
        const aiBg = getComputedStyle(document.documentElement).getPropertyValue('--ai-bubble-bg').trim();
        callScreenModal.style.backgroundColor = 'transparent';
        callScreenModal.style.backgroundImage = `linear-gradient(to bottom, ${userBg}, ${aiBg})`;

        // --- 2. 获取主题色和衍生色 ---
        const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
        // 使用 shadeColor 函数计算出用于图标的、稍深一点的颜色
        const themedIconColor = shadeColor(accentColor, -40);

        // --- 3. 定位通话界面的两个按钮 ---
        const generateResponseBtn = document.getElementById('generate-call-response-btn');
        const callSendBtn = document.querySelector('#call-input-form button[type="submit"]');

        // 我们通过检查body的背景色来做出最可靠的判断，不再依赖<html>的class
        const bodyBgColor = getComputedStyle(document.body).backgroundColor;
        // 一个简单的亮度判断：如果body背景色的R,G,B分量都很低（< 128），就认为是深色模式
        const isDarkMode = bodyBgColor.match(/\d+/g).map(Number).slice(0, 3).every(c => c < 128);

        // --- 4. 根据判断结果，强制应用正确的按钮颜色 ---
        if (isDarkMode) {
                // --- 深色模式下的样式 ---
                if (generateResponseBtn) {
                        generateResponseBtn.style.backgroundColor = '#374151'; // Tailwind gray-700
                        generateResponseBtn.style.color = '#9ca3af'; // Tailwind gray-400 (高对比度)
                }
        } else {
                // --- 浅色模式下的样式 ---
                if (generateResponseBtn) {
                        generateResponseBtn.style.backgroundColor = '#f3f4f6'; // Tailwind gray-100
                        // 使用 shadeColor 计算图标颜色
                        generateResponseBtn.style.color = shadeColor(accentColor, -40);
                }
        }

        if (callSendBtn) {
                // b. 设置“发送”按钮的背景色为主题色
                callSendBtn.style.backgroundColor = accentColor;
        }

        // --- 5. 动态创建 hover 样式 ---
        // 这是实现“生成回复”按钮悬停变色的关键
        let callHoverStyle = document.getElementById('call-hover-style');
        if (!callHoverStyle) {
                callHoverStyle = document.createElement('style');
                callHoverStyle.id = 'call-hover-style';
                document.head.appendChild(callHoverStyle);
        }
        // 设置悬停时，“生成回复”按钮的背景变为主题色，图标变为白色以保证对比度
        callHoverStyle.innerHTML = `
        #generate-call-response-btn:hover {
            background-color: ${accentColor} !important;
        }
    `;
}

/**
 * 将当前的通话状态完整同步到 sessionStorage
 */
async function syncCallStateToSessionStorage() {
        if (!isCallActive) {
                // 如果通话已非激活状态，确保清除存储
                sessionStorage.removeItem('activeCallState');
                return;
        }

        const callState = {
                charId: charId,
                isCallActive: true,
                callType: callType,
                callStartTime: callStartTime,
                transcript: currentCallTranscript // 使用内存中最新的完整通话记录
        };
        sessionStorage.setItem('activeCallState', JSON.stringify(callState));
}
/*
async function generateAudioFromText(text, voiceId, ttsProfile) {
        if (!text || !voiceId || !ttsProfile || !ttsProfile.apiKey) {
                throw new Error("Missing required parameters for TTS generation.");
        }

        // 更新的清理逻辑：只移除圆括号 () 和 （），保留方括号 []
        const cleanedText = text.replace(/（[^）]*）|\([^)]*\)/g, '').trim();
        if (!cleanedText) {
                throw new Error("Text content is empty after cleaning.");
        }

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
                method: 'POST',
                headers: {
                        'Content-Type': 'application/json',
                        'xi-api-key': ttsProfile.apiKey
                },
                body: JSON.stringify({
                        text: cleanedText, // 使用清理后的文本
                        // --- 指定使用 v3 模型 ---
                        model_id: "eleven_v3",
                        voice_settings: {
                                stability: 0.5,
                                similarity_boost: 0.75,
                                // v3 模型推荐开启 style exaggeration 以更好地响应标签
                                style: 0.25,
                                use_speaker_boost: true
                        }
                })        
        });

        if (!response.ok) {
                const errorData = await response.json();
                const errorMessage = errorData?.detail?.message || `API Error ${response.status}`;
                // 检查是否是因为模型不支持 v3
                if (errorMessage.includes("is not allowed for model")) {
                        throw new Error("您的 ElevenLabs 账户可能尚未开通 v3 模型权限。");
                }
                throw new Error(`ElevenLabs API Error: ${errorMessage}`);
        }

        const audioBlob = await response.blob();
        return URL.createObjectURL(audioBlob);
}
*/


async function generateAudioFromText(text, voiceId, ttsProfile) {
        if (!text || !voiceId || !ttsProfile || !ttsProfile.apiKey) {
                throw new Error("Missing required parameters for TTS generation.");
        }

        // v2 兼容模式：移除所有方括号和圆括号内的描述性文本
        const cleanedText = text.replace(/（[^）]*）|\([^)]*\)|\[[^\]]*\]/g, '').trim();
        if (!cleanedText) {
                throw new Error("Text content is empty after cleaning.");
        }

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
                method: 'POST',
                headers: {
                        'Content-Type': 'application/json',
                        'xi-api-key': ttsProfile.apiKey
                },
                body: JSON.stringify({
                        text: cleanedText, // 使用清理后的文本
                        model_id: "eleven_multilingual_v2",
                        voice_settings: {
                                stability: 0.5,
                                similarity_boost: 0.75
                        }
                })
        });

        if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`ElevenLabs API Error: ${errorData?.detail?.message || response.statusText}`);
        }

        const audioBlob = await response.blob();
        return URL.createObjectURL(audioBlob);
}