import { db } from './db.js';

document.addEventListener('DOMContentLoaded', async () => {
        // --- DOM Elements & State ---
        const listEl = document.getElementById('diary-list');
        const headerTitle = document.getElementById('header-title');
        const urlParams = new URLSearchParams(window.location.search);
        const authorId = urlParams.get('authorId');

        // Edit Modal Elements
        const editModal = document.getElementById('edit-modal');
        const editTextArea = document.getElementById('edit-textarea');
        const editKeywordsInput = document.getElementById('edit-keywords-input');
        const saveEditBtn = document.getElementById('save-edit');
        const cancelEditBtn = document.getElementById('cancel-edit');
        let editingDiaryId = null;


        if (!authorId) {
                listEl.innerHTML = '<p class="text-center text-gray-500 py-8">未指定角色ID</p>';
                return;
        }

        // --- Core Functions ---

        /**
         * Parses custom markdown-like syntax into HTML for rich text display.
         * @param {string} content - The raw diary content.
         * @returns {string} - HTML formatted content.
         */
        function parseDiaryContent(content) {
                if (!content) return '';
                return content
                        .replace(/==([^=]+)==/g, '<span class="highlight">$1</span>')
                        .replace(/~~([^~]+)~~/g, '<s class="text-gray-500">$1</s>')
                        .replace(/__([^_]+)__/g, '<u class="decoration-wavy">$1</u>')
                        .replace(/\|\|([^|]+)\|\|/g, '<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>')
                        .replace(/\n/g, '<br>'); // Keep line breaks
        }

        // --- Theme Color Application ---
        async function applyCharacterTheme() {
                const author = await db.chats.get(authorId);
                if (!author) return;

                let themeColor = '#3b82f6'; // Default
                const themeSetting = author.settings?.theme;
                let finalThemeColors = null;

                const bubbleThemes = [
                        { name: '默认', value: 'default', colors: { userBg: '#dcf8c6' } },
                        { name: '粉蓝', value: 'pink_blue', colors: { userBg: '#eff7ff' } },
                        { name: '蓝白', value: 'blue_white', colors: { userBg: '#eff7ff' } },
                        { name: '紫黄', value: 'purple_yellow', colors: { userBg: '#fffde4' } },
                        { name: '黑白', value: 'black_white', colors: { userBg: '#343a40' } }
                ];

                if (typeof themeSetting === 'object' && themeSetting !== null) {
                        finalThemeColors = themeSetting;
                } else if (typeof themeSetting === 'string') {
                        const customPresets = await db.bubbleThemePresets.toArray();
                        const allPresets = [...bubbleThemes, ...customPresets.map(p => ({ value: p.name, colors: p.colors }))];
                        const preset = allPresets.find(t => t.value === themeSetting);
                        if (preset) finalThemeColors = preset.colors;
                }

                if (finalThemeColors) {
                        const themeSource = localStorage.getItem('chatAccentThemeSource') || 'user';
                        themeColor = (themeSource === 'ai') ? finalThemeColors.aiBg : finalThemeColors.userBg;
                }

                document.documentElement.style.setProperty('--theme-color', themeColor);
        }

        /**
         * Fetches diaries for the specified author and renders them to the page.
         */
        async function renderDiaries() {
                listEl.innerHTML = '<p class="text-center text-gray-500 py-8">正在加载日记...</p>';

                const [author, diaries] = await Promise.all([
                        db.chats.get(authorId),
                        db.diaries.where('authorId').equals(authorId).reverse().toArray()
                ]);

                if (!author) {
                        headerTitle.textContent = '未知角色的日记';
                        listEl.innerHTML = '<p class="text-center text-gray-500 py-8">找不到该角色的信息</p>';
                        return;
                }

                headerTitle.textContent = `${author.realName}的日记`;

                if (diaries.length === 0) {
                        listEl.innerHTML = '<p class="text-center text-gray-500 py-8">这本日记还是空的。</p>';
                        return;
                }

                listEl.innerHTML = ''; // Clear loading text

                diaries.forEach(diary => {
                        const card = document.createElement('div');
                        card.className = "diary-card relative group bg-white p-4 rounded-lg shadow-sm border border-gray-100";

                        const parsedContent = parseDiaryContent(diary.content);
                        const diaryDate = new Date(diary.timestamp);
                        const dateString = `${diaryDate.getFullYear()}年${diaryDate.getMonth() + 1}月${diaryDate.getDate()}日 ${diaryDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
                        const keywordsHtml = (diary.keywords && diary.keywords.length > 0)
                                ? `<div class="mt-4 text-right text-xs text-gray-400 font-mono">关键词: ${(diary.keywords || []).join(', ')}</div>`
                                : '';


                        card.innerHTML = `
                <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                    <button data-edit-id="${diary.id}" class="edit-btn p-1 text-gray-400 hover:text-blue-500" title="编辑">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/><path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"/></svg>
                    </button>
                    <button data-delete-id="${diary.id}" class="delete-btn p-1 text-gray-400 hover:text-red-500" title="删除">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
                    </button>
                </div>
                <div class="flex justify-between items-center text-xs text-gray-400 mb-2">
                    <span>${dateString}</span>
                </div>
                <div class="diary-content text-gray-800 leading-relaxed">${parsedContent}</div>
                ${keywordsHtml}
            `;
                        listEl.appendChild(card);
                });
        }

        /**
         * Opens the modal to edit a diary entry.
         * @param {object} diary - The diary object to edit.
         */
        function openEditModal(diary) {
                editingDiaryId = diary.id;
                editTextArea.value = diary.content; // Populate with original content
                editKeywordsInput.value = (diary.keywords || []).join(', '); // Populate keywords
                editModal.classList.remove('hidden');
        }

        /**
         * Handles saving the edited diary content and keywords.
         */
        async function handleSaveEdit() {
                if (editingDiaryId === null) return;

                const newContent = editTextArea.value.trim();
                const newKeywordsString = editKeywordsInput.value.trim();

                if (!newContent) {
                        alert("日记内容不能为空！");
                        return;
                }

                // Process keywords: split by comma, trim whitespace, remove empty entries
                const newKeywords = newKeywordsString
                        .split(',')
                        .map(k => k.trim())
                        .filter(Boolean);

                await db.diaries.update(editingDiaryId, {
                        content: newContent,
                        keywords: newKeywords
                });

                editModal.classList.add('hidden');
                editingDiaryId = null;
                renderDiaries(); // Re-render to show changes
        }

        // --- Event Listeners ---

        listEl.addEventListener('click', async (e) => {
                const editBtn = e.target.closest('.edit-btn');
                const deleteBtn = e.target.closest('.delete-btn');

                if (editBtn) {
                        const diaryId = parseInt(editBtn.dataset.editId);
                        const diaryToEdit = await db.diaries.get(diaryId);
                        if (diaryToEdit) {
                                openEditModal(diaryToEdit);
                        }
                }

                if (deleteBtn) {
                        const diaryId = parseInt(deleteBtn.dataset.deleteId);
                        const confirmed = confirm("确定要删除这篇日记吗？此操作不可撤销。");
                        if (confirmed) {
                                await db.diaries.delete(diaryId);
                                renderDiaries();
                        }
                }
        });

        saveEditBtn.addEventListener('click', handleSaveEdit);
        cancelEditBtn.addEventListener('click', () => {
                editModal.classList.add('hidden');
                editingDiaryId = null;
        });

        // --- Initial Load ---
        await applyCharacterTheme();
        renderDiaries();
});