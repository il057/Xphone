import { db } from './db.js';
import { showToast, showConfirmModal } from './ui-helpers.js';

document.addEventListener('DOMContentLoaded', async () => {
    // --- DOM Elements ---
    const container = document.getElementById('call-log-container');
    const editBtn = document.getElementById('edit-btn');
    const defaultHeader = document.getElementById('default-header');
    const editHeader = document.getElementById('edit-header');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    const selectionCount = document.getElementById('selection-count');
    const backBtn = document.getElementById('back-btn');

    // --- State ---
    let isEditMode = false;
    let selectedLogs = new Set();
    let allLogs = [];
    let chatsMap = {};
    let myName = '我';

    // --- Core Functions ---

    function toggleEditMode() {
        isEditMode = !isEditMode;
        container.classList.toggle('edit-mode', isEditMode);
        defaultHeader.classList.toggle('hidden', isEditMode);
        editHeader.classList.toggle('hidden', !isEditMode);
        backBtn.classList.toggle('hidden', isEditMode);
        editBtn.textContent = isEditMode ? '' : '编辑';
        
        if (!isEditMode) {
            selectedLogs.clear();
            document.querySelectorAll('.selection-checkbox').forEach(cb => cb.checked = false);
            updateSelectionCount();
        }
    }

    function updateSelectionCount() {
        const count = selectedLogs.size;
        selectionCount.textContent = count > 0 ? `已选择 ${count} 项` : '选择项目';
        deleteSelectedBtn.disabled = count === 0;
    }

    function toggleLogSelection(logId) {
        const checkbox = document.querySelector(`details[data-log-id="${logId}"] .selection-checkbox`);
        if (!checkbox) return;

        if (selectedLogs.has(logId)) {
            selectedLogs.delete(logId);
            checkbox.checked = false;
        } else {
            selectedLogs.add(logId);
            checkbox.checked = true;
        }
        updateSelectionCount();
    }

    async function deleteSelectedLogs() {
        const count = selectedLogs.size;
        if (count === 0) return;
        const confirmed = await showConfirmModal(
            '删除通话记录',
            `确定要删除选中的 ${count} 条通话记录吗？\n此操作将同步删除聊天记录中的隐藏上下文。`,
            '删除',
            '取消'
        );
        if (!confirmed) return;

        try {
            const logsToDelete = await db.callLogs.bulkGet(Array.from(selectedLogs));
            
            await db.transaction('rw', db.callLogs, db.chats, async () => {
                const chatUpdates = new Map();
                for (const log of logsToDelete) {
                    if (!log) continue;
                    const transcriptTimestamps = new Set(log.transcript.map(msg => msg.timestamp));
                    if (!chatUpdates.has(log.charId)) {
                        chatUpdates.set(log.charId, { chat: await db.chats.get(log.charId), timestamps: new Set() });
                    }
                    transcriptTimestamps.forEach(ts => chatUpdates.get(log.charId).timestamps.add(ts));
                }

                for (const [charId, update] of chatUpdates.entries()) {
                    if (update.chat) {
                        update.chat.history = update.chat.history.filter(msg => !update.timestamps.has(msg.timestamp));
                        await db.chats.put(update.chat);
                    }
                }
                
                await db.callLogs.bulkDelete(Array.from(selectedLogs));
            });

            showToast('删除成功！');
            toggleEditMode();
            main(); // Re-render the entire list

        } catch (error) {
            console.error("批量删除通话记录失败:", error);
            showToast("删除失败，请查看控制台。", 'error');
        }
    }

    function renderLogs() {
        container.innerHTML = '';
        if (allLogs.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-500 py-16">还没有通话记录</p>';
            editBtn.classList.add('hidden'); // Hide edit button if no logs
            return;
        }
        editBtn.classList.remove('hidden');

        allLogs.forEach(log => {
            const char = chatsMap[log.charId];
            if (!char) return;

            const callTime = new Date(log.startTime + log.duration * 1000);
            const callDateStr = callTime.toLocaleDateString('zh-CN');
            const callTimeStr = callTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

            const details = document.createElement('details');
            details.className = 'bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden';
            details.dataset.logId = log.id;


            let transcriptHtml = '<p class="p-4 text-sm text-gray-500">没有对话记录。</p>';
            if (log.transcript && log.transcript.length > 0) {
                transcriptHtml = log.transcript.map(msg => {
                    const senderName = msg.role === 'user' ? myName : char.name;
                    return `<div class="p-1.5 text-left"><span class="px-3 py-1.5 rounded-lg inline-block text-sm"><strong class="font-semibold">${senderName}:</strong> ${msg.content.replace(/\[(视频|语音)通话\]: /g, '')}</span></div>`;
                }).join('');
            }
            
            const initiatorIcon = log.initiator === 'user' 
                ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-up-right text-green-500" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M14 2.5a.5.5 0 0 0-.5-.5h-6a.5.5 0 0 0 0 1h4.793L2.146 13.146a.5.5 0 0 0 .708.708L13 3.707V8.5a.5.5 0 0 0 1 0z"/></svg>`
                : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-arrow-down-left text-red-500" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M2 13.5a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 0-1H3.707L13.854 2.854a.5.5 0 0 0-.708-.708L3 12.293V7.5a.5.5 0 0 0-1 0z"/></svg>`;


            details.innerHTML = `
                <summary class="p-4 flex items-center justify-between cursor-pointer relative">
                    <input type="checkbox" class="selection-checkbox mr-3">
                    <div class="flex items-center gap-3 flex-grow">
                        <img src="${char.settings.aiAvatar || 'https://files.catbox.moe/kkll8p.svg'}" class="w-10 h-10 rounded-full">
                        <div>
                            <p class="font-semibold">${char.name}</p>
                            <div class="flex items-center gap-1 text-xs text-gray-500">
                                ${initiatorIcon}
                                <span>${log.type === 'video' ? '视频通话' : '语音通话'}・${formatDuration(log.duration)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="text-right text-sm text-gray-500 flex-shrink-0">
                        <p>${callDateStr}</p>
                        <p>${callTimeStr}</p>
                    </div>
                </summary>
                <div class="details-content p-2 border-t border-gray-200 dark:border-gray-700">
                    ${transcriptHtml}
                </div>
            `;
            container.appendChild(details);
        });
    }

    function formatDuration(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        const pad = (num) => String(num).padStart(2, '0');
        return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    async function main() {
        container.innerHTML = '<p class="text-center text-gray-500 py-8">正在加载通话记录...</p>';
        const [logs, chats, personas, globalSettings] = await Promise.all([
            db.callLogs.orderBy('startTime').reverse().toArray(),
            db.chats.toArray().then(c => c.reduce((map, obj) => (map[obj.id] = obj, map), {})),
            db.personaPresets.toArray(),
            db.globalSettings.get('main')
        ]);
        
        allLogs = logs;
        chatsMap = chats;
        if (globalSettings?.defaultPersonaId) {
            const defaultPersona = personas.find(p => p.id === globalSettings.defaultPersonaId);
            if(defaultPersona) myName = defaultPersona.name;
        }

        renderLogs();
    }

    // --- Event Listeners ---
    editBtn.addEventListener('click', toggleEditMode);
    cancelEditBtn.addEventListener('click', toggleEditMode);
    deleteSelectedBtn.addEventListener('click', deleteSelectedLogs);

    container.addEventListener('click', e => {
        if (!isEditMode) return;
        const summary = e.target.closest('summary');
        if (summary) {
            e.preventDefault();
            const detailsEl = summary.closest('details');
            const logId = parseInt(detailsEl.dataset.logId);
            toggleLogSelection(logId);
        }
    });
    
    // --- Initial Load ---
    main();
});