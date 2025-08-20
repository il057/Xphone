// management.js
import { db } from './db.js';
import { showToast, showConfirmModal, showToastOnNextPage } from './ui-helpers.js';

/**
 * [已修复] 显示一个通用的角色选择模态框，用于批量操作
 * @param {string} title - 模态框的标题
 * @param {string} confirmText - 确认按钮的文字
 * @returns {Promise<string[]|null>} - 用户确认则返回包含选中角色ID的数组，取消则返回 null
 */
async function showCharacterSelectorModal(title, confirmText) {
        const allChars = await db.chats.filter(c => !c.isGroup).toArray();

        if (allChars.length === 0) {
                showToast('没有可操作的角色。', 'info');
                return null; // 返回null表示没有角色可选
        }

        return new Promise((resolve) => {
                const modalId = 'char-selector-modal';
                document.getElementById(modalId)?.remove();

                const modal = document.createElement('div');
                modal.id = modalId;
                modal.className = 'modal visible';
                modal.innerHTML = `
            <div class="modal-content bg-white rounded-lg w-full max-w-sm max-h-[80vh] flex flex-col">
                <header class="p-4 border-b font-semibold text-center">${title}</header>
                <div class="p-2 border-b">
                    <button id="select-all-chars" class="text-sm text-blue-500 px-2">全选</button>
                    <button id="deselect-all-chars" class="text-sm text-blue-500 px-2">全不选</button>
                </div>
                <main class="flex-grow p-4 space-y-2 overflow-y-auto">
                    ${allChars.map(char => `
                        <div class="flex items-center">
                            <input type="checkbox" id="char-select-${char.id}" value="${char.id}" class="h-4 w-4 rounded char-checkbox">
                            <label for="char-select-${char.id}" class="ml-2 flex items-center gap-2 cursor-pointer">
                                <img src="${char.settings?.aiAvatar || 'https://files.catbox.moe/kkll8p.svg'}" class="w-8 h-8 rounded-full">
                                <span>${char.name}</span>
                            </label>
                        </div>
                    `).join('')}
                </main>
                <footer class="p-4 border-t grid grid-cols-2 gap-2">
                    <button id="selector-cancel-btn" class="w-full p-2 bg-gray-200 rounded">取消</button>
                    <button id="selector-confirm-btn" class="w-full p-2 text-white rounded">${confirmText}</button>
                </footer>
            </div>
        `;
                document.body.appendChild(modal);

                const confirmBtn = modal.querySelector('#selector-confirm-btn');
                const cancelBtn = modal.querySelector('#selector-cancel-btn');
                const checkboxes = modal.querySelectorAll('.char-checkbox');

                if (confirmText.includes('删除') || confirmText.includes('清空') || confirmText.includes('重置')) {
                        confirmBtn.style.backgroundColor = '#ef4444'; // red-500
                } else {
                        confirmBtn.style.backgroundColor = 'var(--theme-color)';
                }

                modal.querySelector('#select-all-chars').addEventListener('click', () => checkboxes.forEach(cb => cb.checked = true));
                modal.querySelector('#deselect-all-chars').addEventListener('click', () => checkboxes.forEach(cb => cb.checked = false));

                const cleanup = () => modal.remove();

                cancelBtn.addEventListener('click', () => {
                        cleanup();
                        resolve(null); // 用户取消，resolve为null
                });

                confirmBtn.addEventListener('click', () => {
                        const selectedIds = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
                        if (selectedIds.length === 0) {
                                showToast('请至少选择一个角色。', 'error');
                                return;
                        }
                        cleanup();
                        resolve(selectedIds); // 用户确认，resolve为ID数组
                });
        });
}

document.addEventListener('DOMContentLoaded', () => {

        const exportCharBtn = document.getElementById('export-char-btn');
        const importCharBtn = document.getElementById('import-char-btn');
        const importCharInput = document.getElementById('import-char-input');
        const batchRepairBtn = document.getElementById('batch-repair-btn');
        const batchClearHistoryBtn = document.getElementById('batch-clear-history-btn');
        const batchResetContentBtn = document.getElementById('batch-reset-content-btn');
        const batchDeleteCharsBtn = document.getElementById('batch-delete-chars-btn');

        // --- 角色卡导出逻辑 ---
        exportCharBtn.addEventListener('click', async () => {
                const selectedIds = await showCharacterSelectorModal('请选择要导出的角色', '导出');
                if (!selectedIds) return; // 用户取消或未选择

                if (selectedIds.length > 1) {
                        showToast('一次只能导出一个角色。', 'error');
                        return;
                }

                const charId = selectedIds[0];
                try {
                        const characterData = await db.chats.get(charId);
                        if (!characterData) throw new Error('找不到角色数据。');

                        const exportedChar = { ...characterData };
                        delete exportedChar.history;
                        delete exportedChar.lastMessageTimestamp;
                        delete exportedChar.lastMessageContent;
                        delete exportedChar.unreadCount;
                        delete exportedChar.blockStatus;

                        const exportPackage = {
                                version: 1.0,
                                character: exportedChar,
                                worldBook: null,
                                themePreset: null,
                                cssPreset: null
                        };

                        if (characterData.settings.worldBookId) {
                                const worldBook = await db.worldBooks.get(characterData.settings.worldBookId);
                                if (worldBook) exportPackage.worldBook = worldBook;
                        }

                        if (typeof characterData.settings.theme === 'string') {
                                const themePreset = await db.bubbleThemePresets.get(characterData.settings.theme);
                                if (themePreset) exportPackage.themePreset = themePreset;
                        }

                        if (characterData.settings.customBubbleCss) {
                                const cssPreset = await db.bubbleCssPresets.where('cssCode').equals(characterData.settings.customBubbleCss).first();
                                if (cssPreset) {
                                        exportPackage.cssPreset = cssPreset;
                                } else {
                                        exportPackage.cssPreset = { name: `${characterData.name}-custom-style`, cssCode: characterData.settings.customBubbleCss };
                                }
                        }

                        const blob = new Blob([JSON.stringify(exportPackage, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${characterData.name}_char_card.json`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);

                        showToast('角色卡导出成功！', 'success');

                } catch (error) {
                        console.error("导出角色失败:", error);
                        showToast(`导出失败: ${error.message}`, 'error');
                }
        });

        // --- 角色卡导入逻辑 ---
        importCharBtn.addEventListener('click', () => importCharInput.click());
        importCharInput.addEventListener('change', (event) => {
                const file = event.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = async (e) => {
                        try {
                                const importPackage = JSON.parse(e.target.result);
                                if (!importPackage.character || !importPackage.character.id) {
                                        throw new Error('无效的角色卡文件格式。');
                                }

                                const confirmed = await showConfirmModal(
                                        '导入角色确认',
                                        `您确定要导入角色 “${importPackage.character.name}” 吗？`,
                                        '确认导入',
                                        '取消'
                                );
                                if (!confirmed) return;

                                await db.transaction('rw', db.chats, db.worldBooks, db.bubbleThemePresets, db.bubbleCssPresets, async () => {
                                        const newChar = importPackage.character;
                                        newChar.id = `imported_${Date.now()}_${Math.random().toString(16).substr(2, 8)}`;
                                        newChar.history = [];
                                        newChar.lastMessageTimestamp = null;
                                        newChar.lastMessageContent = null;
                                        newChar.unreadCount = 0;
                                        newChar.blockStatus = null;
                                        newChar.groupId = null;

                                        if (importPackage.worldBook) {
                                                const existingBook = await db.worldBooks.get(importPackage.worldBook.id);
                                                if (!existingBook) await db.worldBooks.add(importPackage.worldBook);
                                                newChar.settings.worldBookId = importPackage.worldBook.id;
                                        }

                                        if (importPackage.themePreset) {
                                                const existingTheme = await db.bubbleThemePresets.get(importPackage.themePreset.name);
                                                if (!existingTheme) await db.bubbleThemePresets.add(importPackage.themePreset);
                                                newChar.settings.theme = importPackage.themePreset.name;
                                        }

                                        if (importPackage.cssPreset) {
                                                const existingCss = await db.bubbleCssPresets.get(importPackage.cssPreset.name);
                                                if (!existingCss) await db.bubbleCssPresets.add(importPackage.cssPreset);
                                                newChar.settings.customBubbleCss = importPackage.cssPreset.cssCode;
                                        }

                                        await db.chats.add(newChar);
                                });

                                showToastOnNextPage(`角色 “${importPackage.character.name}” 导入成功！`, 'success');
                                window.location.href = 'contacts.html';

                        } catch (error) {
                                console.error("导入角色失败:", error);
                                showToast(`导入失败: ${error.message}`, 'error');
                        } finally {
                                importCharInput.value = '';
                        }
                };
                reader.readAsText(file);
        });

        // --- 批量操作按钮事件 ---
        batchRepairBtn.addEventListener('click', async () => {
                const selectedIds = await showCharacterSelectorModal('选择要修复记录的角色', '确认修复');
                if (!selectedIds) return;

                const confirmed = await showConfirmModal('确认修复', `确定要修复选中的 ${selectedIds.length} 个角色的聊天记录吗？将删除所有不可见的系统消息。`, '修复', '取消');
                if (!confirmed) return;

                let totalRemoved = 0;
                await db.transaction('rw', db.chats, async () => {
                        const chatsToUpdate = await db.chats.bulkGet(selectedIds);
                        for (const chat of chatsToUpdate) {
                                if (!chat) continue;
                                const originalCount = chat.history.length;
                                chat.history = chat.history.filter(msg => !msg.isHidden && msg.role !== 'system');
                                totalRemoved += originalCount - chat.history.length;

                                if (chat.history.length > 0) {
                                        const lastMsg = chat.history[chat.history.length - 1];
                                        chat.lastMessageTimestamp = lastMsg.timestamp;
                                        chat.lastMessageContent = lastMsg;
                                } else {
                                        chat.lastMessageTimestamp = null;
                                        chat.lastMessageContent = null;
                                }
                        }
                        await db.chats.bulkPut(chatsToUpdate.filter(Boolean));
                });
                showToast(`修复完成！共清除了 ${totalRemoved} 条系统消息。`, 'success');
        });

        batchClearHistoryBtn.addEventListener('click', async () => {
                const selectedIds = await showCharacterSelectorModal('选择要清空记录的角色', '确认清空');
                if (!selectedIds) return;

                const confirmed = await showConfirmModal('确认清空', `【警告】确定要永久清空选中的 ${selectedIds.length} 个角色的所有聊天记录吗？`, '清空', '取消');
                if (!confirmed) return;

                await db.transaction('rw', db.chats, async () => {
                        const updates = selectedIds.map(id => ({ key: id, changes: { 
                                history: [], 
                                lastMessageTimestamp: null, 
                                lastMessageContent: null,
                                lastSummaryActionCount: null,
                                userActionCount: 0
                        } }));
                        await db.chats.bulkUpdate(updates);
                });
                showToast(`已成功清空 ${selectedIds.length} 个角色的聊天记录。`, 'success');
        });

        batchResetContentBtn.addEventListener('click', async () => {
                const selectedIds = await showCharacterSelectorModal('选择要重置的角色', '确认重置');
                if (!selectedIds) return;

                const confirmed = await showConfirmModal('确认重置', `【警告】此操作将删除选中 ${selectedIds.length} 个角色的所有AI生成内容（动态、日记、回忆等）和聊天记录，但会保留人设。`, '重置', '取消');
                if (!confirmed) return;

                await db.transaction('rw', db.chats, db.xzonePosts, db.memories, db.diaries, db.callLogs, db.favorites, async () => {
                        const historyUpdates = selectedIds.map(id => ({ key: id, changes: { 
                                history: [], 
                                lastMessageTimestamp: null, 
                                lastMessageContent: null,
                                lastSummaryActionCount: null,
                                userActionCount: 0
                        } }));
                        await db.chats.bulkUpdate(historyUpdates);

                        for (const id of selectedIds) {

                                // 删除该角色发布的所有动态
                                await db.xzonePosts.where('authorId').equals(id).delete();

                                // 删除该角色的所有回忆
                                await db.memories.where('chatId').equals(id).delete();
                                await db.diaries.where('authorId').equals(id).delete();

                                // 删除与该角色聊天相关的收藏
                                await db.favorites.where('chatId').equals(id).delete();

                                // 删除与该角色的所有通话记录
                                await db.callLogs.where('charId').equals(id).delete();

                                
                        }
                });
                showToast(`已成功重置 ${selectedIds.length} 个角色的内容。`, 'success');
        });

        batchDeleteCharsBtn.addEventListener('click', async () => {
                const selectedIds = await showCharacterSelectorModal('选择要删除的角色', '确认删除');
                if (!selectedIds) return;

                const confirmed = await showConfirmModal('确认删除', `【严重警告】您确定要永久删除选中的 ${selectedIds.length} 个角色及其所有相关数据吗？`, '永久删除', '取消');
                if (!confirmed) return;

                await db.transaction('rw', ...db.tables, async () => {
                        const charactersToDelete = await db.chats.bulkGet(selectedIds);
                        const charNameMap = new Map(charactersToDelete.map(c => [c.id, { name: c.name, realName: c.realName }]));

                        for (const id of selectedIds) {
                                const charInfo = charNameMap.get(id);
                                if (!charInfo) continue;

                                const { name: charName, realName: charRealName } = charInfo;

                                await db.chats.delete(id);
                                await db.xzonePosts.where('authorId').equals(id).delete();
                                await db.memories.where('chatId').equals(id).delete();
                                await db.diaries.where('authorId').equals(id).delete();
                                await db.callLogs.where('charId').equals(id).delete();
                                await db.favorites.where('chatId').equals(id).delete();
                                await db.relationships.where('sourceCharId').equals(id).delete();
                                await db.relationships.where('targetCharId').equals(id).delete();
                                const eventLogsToDelete = await db.eventLog.filter(log =>
                                        log.content.includes(charName) || log.content.includes(charRealName)
                                ).primaryKeys();
                                if (eventLogsToDelete.length > 0) {
                                        await db.eventLog.bulkDelete(eventLogsToDelete);
                                }

                                // 从群聊中移除该角色
                                await db.chats.where('isGroup').equals(1).modify(group => {
                                        if (group.members && group.members.includes(id)) {
                                                group.members = group.members.filter(memberId => memberId !== id);
                                        }
                                });
                        }
                        const allNames = charactersToDelete.flatMap(c => [c.name, c.realName]);

                        // 清理 OfflineSummary
                        const summariesToUpdate = await db.offlineSummary.toArray();
                        for (const summary of summariesToUpdate) {
                                const originalEventCount = summary.events.length;
                                summary.events = summary.events.filter(event =>
                                        !allNames.some(name => event.includes(name))
                                );
                                if (summary.events.length < originalEventCount) {
                                        if (summary.events.length > 0) {
                                                await db.offlineSummary.put(summary);
                                        } else {
                                                await db.offlineSummary.delete(summary.id);
                                        }
                                }
                        }

                        // 清理 WorldBooks (编年史)
                        const chroniclesToUpdate = await db.worldBooks.filter(book => book.name.includes('编年史')).toArray();
                        for (const chronicle of chroniclesToUpdate) {
                                const lines = chronicle.content.split('\n');
                                const newLines = lines.filter(line =>
                                        !allNames.some(name => line.includes(name))
                                );
                                if (newLines.length < lines.length) {
                                        chronicle.content = newLines.join('\n');
                                        await db.worldBooks.put(chronicle);
                                }
                        }
                });
                showToast(`已成功删除 ${selectedIds.length} 个角色。`, 'success');
        });
});