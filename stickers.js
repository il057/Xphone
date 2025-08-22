// phone/stickers.js (使用共享UI组件的新版本)
import { db, uploadImage, getActiveApiProfile, callApi } from './db.js';
import { showUploadChoiceModal, promptForInput, showToast, showConfirmModal } from './ui-helpers.js';

document.addEventListener('DOMContentLoaded', () => {
        // --- DOM Elements ---
        const gridContainer = document.getElementById('sticker-grid-container');
        const fileInput = document.getElementById('local-sticker-input');

        // Header elements
        const headerLeftBtn = document.getElementById('header-left-btn');
        const defaultTitle = document.getElementById('default-title');
        const moreOptionsBtn = document.getElementById('more-options-btn');
        const moreOptionsMenu = document.getElementById('more-options-menu');

        // Menu items
        const bulkAddBtn = document.getElementById('bulk-add-btn');
        const exportAllBtn = document.getElementById('export-all-btn');
        const editBtn = document.getElementById('edit-stickers-btn');

        // Edit mode footer elements
        const editModeFooter = document.getElementById('edit-mode-footer');
        const deleteSelectedBtn = document.getElementById('delete-selected-btn');
        const moveTopBtn = document.getElementById('move-top-btn');

        // --- State ---
        let isEditMode = false;
        let selectedStickers = new Set();
        let isDragging = false;
        let dragStartPos = { x: 0, y: 0 };
        let selectionRectEl = null;
        let touchTimer;

        // --- Core Functions ---
        async function renderStickers() {
                gridContainer.innerHTML = '';

                const addButton = document.createElement('div');
                addButton.className = 'sticker-grid-item border-2 border-dashed border-gray-300';
                addButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" class="text-gray-400" viewBox="0 0 16 16"><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/></svg>`;
                addButton.addEventListener('click', () => {
                        if (isEditMode) return;
                        handleAddSticker();
                });
                gridContainer.appendChild(addButton);

                const stickers = await db.userStickers.orderBy('order').reverse().toArray();
                stickers.forEach(sticker => {
                        const stickerEl = createStickerElement(sticker);
                        gridContainer.appendChild(stickerEl);
                });
        }

        function createStickerElement(sticker) {
                const stickerEl = document.createElement('div');
                stickerEl.className = 'sticker-grid-item relative group';
                stickerEl.dataset.id = sticker.id;
                let thumbnailUrl = sticker.url;
                if (thumbnailUrl.includes('res.cloudinary.com')) {
                        thumbnailUrl = thumbnailUrl.replace('/upload/', '/upload/w_200/');
                }
                stickerEl.innerHTML = `
            <img src="${thumbnailUrl}" alt="${sticker.name}">
            <div class="absolute inset-0 bg-black/20 hidden items-center justify-center edit-mode-item">
                <input type="checkbox" class="absolute top-2 right-2 w-5 h-5 pointer-events-none" style="accent-color: var(--theme-color);">
            </div>
        `;
                return stickerEl;
        }

        function toggleEditMode() {
                isEditMode = !isEditMode;
                gridContainer.classList.toggle('edit-mode', isEditMode);

                if (isEditMode) {
                        defaultTitle.textContent = '选择项目';
                        headerLeftBtn.textContent = '导出所选';
                        headerLeftBtn.onclick = handleExportSelected;
                        headerLeftBtn.disabled = true; // Initially disabled

                        moreOptionsBtn.textContent = '完成';
                        moreOptionsBtn.onclick = toggleEditMode;
                        moreOptionsMenu.classList.add('hidden'); // Hide menu in edit mode

                        editModeFooter.classList.add('visible');
                        editModeFooter.classList.remove('hidden');
                        updateSelectionCount(); // Initial count update
                } else {
                        // This is the part that fixes the back button
                        defaultTitle.textContent = '我的表情';
                        headerLeftBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>`;
                        headerLeftBtn.onclick = () => window.location.href = 'me.html'; // Restore back functionality
                        headerLeftBtn.disabled = false; // Re-enable the button

                        moreOptionsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 16 16"><path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg>`;
                        moreOptionsBtn.onclick = (e) => { e.stopPropagation(); moreOptionsMenu.classList.toggle('hidden'); };

                        editModeFooter.classList.remove('visible');

                        // Reset selection state
                        selectedStickers.clear();
                        document.querySelectorAll('.sticker-grid-item.drag-selected').forEach(el => el.classList.remove('drag-selected'));
                        document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                }
        }

        function updateSelectionCount() {
                const count = selectedStickers.size;
                deleteSelectedBtn.textContent = `删除 (${count})`;
                deleteSelectedBtn.disabled = count === 0;
                moveTopBtn.disabled = count === 0;
                headerLeftBtn.disabled = count === 0;
        }

        async function handleAddSticker() {
                const choice = await showUploadChoiceModal(fileInput);
                if (!choice) return;

                let imageUrl = null;

                if (choice.type === 'local') {
                        try {
                                imageUrl = await uploadImage(choice.value);
                        } catch (error) {
                                showToast(error.message, 'error');
                                return;
                        }
                } else if (choice.type === 'url') {
                        imageUrl = choice.value;
                }

                if (imageUrl) {
                        await processAndSaveSticker(imageUrl);
                }
        }

        async function processAndSaveSticker(url) {
                const name = await promptForInput('给表情起个名字', '例如：开心、疑惑、赞', false, true, '');
                if (name === null) return;

                try {
                        const highestOrder = await db.userStickers.orderBy('order').last();
                        const newOrder = (highestOrder?.order || 0) + 1;
                        await db.userStickers.add({ url, name, order: newOrder });
                        await renderStickers();
                } catch (e) {
                        showToast(e.name === 'ConstraintError' ? '这个表情已经添加过了！' : '添加失败，请检查URL。', 'error');
                }
        }

        async function handleBulkAdd() {
                const jsonInput = await promptForInput(
                        '批量添加表情',
                        '请粘贴JSON数组或纯文本列表...\nAI会自动尝试转换文本格式。',
                        true, false
                );

                if (!jsonInput) return;

                let stickersToAdd = [];
                try {
                        stickersToAdd = JSON.parse(jsonInput);
                } catch (error) {
                        // If JSON parsing fails, call the AI for conversion
                        console.log("JSON parsing failed, initiating AI text conversion...");

                        const moreOptionsBtn = document.getElementById('more-options-btn');
                        const moreOptionsMenu = document.getElementById('more-options-menu');

                        // Ensure the menu is closed before showing the loader
                        moreOptionsMenu.classList.add('hidden');

                        // Store original icon, show spinner, and disable the button
                        const originalIconHTML = moreOptionsBtn.innerHTML;
                        const spinnerHTML = `<svg class="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="var(--theme-color)" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;

                        moreOptionsBtn.innerHTML = spinnerHTML;
                        moreOptionsBtn.disabled = true;

                        try {
                                const convertedJson = await convertTextToJsonWithAI(jsonInput);
                                if (!convertedJson) {
                                        showToast("AI无法将文本转换为有效的JSON格式，请检查您的文本或API设置。", 'error');
                                        return; // Exit if AI fails
                                }
                                stickersToAdd = convertedJson;
                        } catch (aiError) {
                                console.error("AI conversion error:", aiError);
                                showToast(`AI转换失败: ${aiError.message}`, 'error');
                                return; // Exit on error
                        } finally {
                                // IMPORTANT: Restore the button's state in the finally block
                                moreOptionsBtn.innerHTML = originalIconHTML;
                                moreOptionsBtn.disabled = false;
                        }
                }

                try {
                        if (!Array.isArray(stickersToAdd)) throw new Error("输入的不是一个有效的JSON数组。");
                        const validStickers = stickersToAdd.filter(item => item && typeof item.name === 'string' && typeof item.url === 'string');
                        if (validStickers.length === 0) throw new Error("没有找到有效的表情数据。");

                        const highestOrder = await db.userStickers.orderBy('order').last();
                        let currentOrder = (highestOrder?.order || 0);
                        const stickersWithOrder = validStickers.map(s => ({ ...s, order: ++currentOrder }));

                        await db.userStickers.bulkAdd(stickersWithOrder);
                        showToast(`成功添加了 ${validStickers.length} 个表情！`);
                        await renderStickers();
                } catch (e) {
                        showToast(`添加失败: ${e.message}`, 'error');
                }
        }

        // AI转换函数
        async function convertTextToJsonWithAI(text) {
                const apiConfig = await getActiveApiProfile();

                if (!apiConfig || !apiConfig.apiKey || !apiConfig.model) {
                        showToast("AI转换功能需要有效的API配置。请前往“设置”页面检查您的API方案。", 'error');
                        throw new Error("API configuration is missing.");
                }
                // 对非Gemini服务商检查proxyUrl
                if (apiConfig.apiProvider !== 'gemini' && !apiConfig.proxyUrl) {
                        showToast("使用默认/反代服务商时，AI API地址不能为空。请前往“设置”检查。", 'error');
                        throw new Error("Proxy URL is missing for default provider.");
                }

                const systemPrompt = `
You are a highly intelligent text-to-JSON converter. Your task is to accurately convert the user's plain text list of stickers into a valid JSON array.

**Input Format Rules:**
The user may provide text in one of two formats. You must handle both:
1.  **Name Colon Code Format:**
    - Each line represents one sticker.
    - The format is \`Sticker Name: Code/filename.jpg\`
    - The base URL is \`https://i.postimg.cc/\`
    - You must combine the base URL and the code/filename to create the full URL.
    - Example Input: \`你掉茅坑了：SQBgSLGP/20250711214117.jpg\`
    - Example Output: \`{"name": "你掉茅坑了", "url": "https://i.postimg.cc/SQBgSLGP/20250711214117.jpg"}\`

2.  **Name Colon Full URL Format:**
    - Each line represents one sticker.
    - The format is \`Sticker Name: https://www.example.com/image.png\`
    - In this case, the URL is already complete.
    - Example Input: \`开心：https://a.com/happy.gif\`
    - Example Output: \`{"name": "开心", "url": "https://a.com/happy.gif"}\`

**User's Text to Convert:**
---
${text}
---

**IMPORTANT INSTRUCTIONS:**
- Your response **MUST** be a single, valid JSON array (e.g., \`[ { ... }, { ... } ]\`).
- Do **NOT** include any explanations, comments, or markdown like \`\`\`json.
- If a line does not match either format, ignore it.
- Ensure the final output is a clean, raw JSON string that can be parsed directly.
    `;

                try {
                        const rawJsonString = await callApi(systemPrompt, [], { temperature: 0.1 }, 'text');

                        if (!rawJsonString) {
                                throw new Error("API返回内容为空或格式无效。");
                        }

                        // 在这里自己解析，更灵活
                        return JSON.parse(rawJsonString);
                } catch (error) {
                        console.error("AI aPI call or parsing failed:", error);
                        // 将具体的错误信息抛出，以便上层函数可以捕获并显示给用户
                        throw error;
                }
        }

        // --- Export Functions ---
        async function showExportOptionsModal() {
                return new Promise(resolve => {
                        const modalHtml = `
                <h3 class="text-lg font-semibold text-center p-4 border-b">选择导出格式</h3>
                <div class="p-4 space-y-3">
                    <button data-format="json" class="w-full p-3 rounded-lg font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200">JSON</button>
                    <button data-format="text" class="w-full p-3 rounded-lg font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200">纯文本</button>
                </div>
                <div class="p-2 border-t">
                    <button data-format="cancel" class="modal-btn modal-btn-cancel w-full">取消</button>
                </div>`;
                        const modal = document.createElement('div');
                        modal.className = 'modal visible';
                        modal.innerHTML = `<div class="modal-content">${modalHtml}</div>`;
                        document.body.appendChild(modal);

                        modal.addEventListener('click', (e) => {
                                const format = e.target.dataset.format;
                                if (format) {
                                        modal.remove();
                                        resolve(format === 'cancel' ? null : format);
                                }
                        });
                });
        }

        async function exportStickers(stickersToExport) {
                if (stickersToExport.length === 0) {
                        showToast("没有可导出的表情。", "info");
                        return;
                }

                const format = await showExportOptionsModal();
                if (!format) return;

                let fileContent, fileExtension, mimeType;
                if (format === 'json') {
                        fileContent = JSON.stringify(stickersToExport.map(({ name, url }) => ({ name, url })), null, 2);
                        fileExtension = 'json';
                        mimeType = 'application/json';
                } else { // text
                        fileContent = stickersToExport.map(s => `${s.name}: ${s.url}`).join('\n');
                        fileExtension = 'txt';
                        mimeType = 'text/plain';
                }

                const blob = new Blob([fileContent], { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Xphone_Stickers_${new Date().toISOString().slice(0, 10)}.${fileExtension}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
        }

        async function handleExportAll() {
                const allStickers = await db.userStickers.orderBy('order').reverse().toArray();
                exportStickers(allStickers);
        }

        async function handleExportSelected() {
                const selectedIds = Array.from(selectedStickers);
                const stickersToExp = await db.userStickers.bulkGet(selectedIds);
                exportStickers(stickersToExp.filter(Boolean));
        }

        // --- Event Listeners ---
        editBtn.addEventListener('click', toggleEditMode);
        bulkAddBtn.addEventListener('click', () => { handleBulkAdd(); moreOptionsMenu.classList.add('hidden'); });
        exportAllBtn.addEventListener('click', () => { handleExportAll(); moreOptionsMenu.classList.add('hidden'); });

        moveTopBtn.addEventListener('click', async () => {
                if (selectedStickers.size === 0) return;
                const highestOrder = await db.userStickers.orderBy('order').last();
                const newOrder = (highestOrder?.order || 0) + 1;
                const updates = Array.from(selectedStickers).map(id => ({ key: id, changes: { order: newOrder } }));
                await db.userStickers.bulkUpdate(updates);
                toggleEditMode();
                await renderStickers();
        });

        deleteSelectedBtn.addEventListener('click', async () => {
                if (selectedStickers.size === 0) return;
                const confirmed = await showConfirmModal('删除表情', `确定要删除选中的 ${selectedStickers.size} 个表情吗？`, '删除', '取消');
                if (confirmed) {
                        await db.userStickers.bulkDelete(Array.from(selectedStickers));
                        toggleEditMode();
                        await renderStickers();
                }
        });

        // --- Drag-to-Select & Click Logic (Robust Mobile & Desktop Version) ---

        let longPressTimer = null;
        let isInteracting = false; // A single flag to know if an interaction is happening

        // --- Interaction Start ---
        const handleInteractionStart = (e) => {
                if (!isEditMode) return;

                isInteracting = true;
                const pos = getEventPosition(e);
                dragStartPos = { x: pos.clientX, y: pos.clientY };

                if (e.type === 'touchstart') {
                        // For touch, we start a timer. If it fires, it's a drag.
                        longPressTimer = setTimeout(() => {
                                // Prevent this from being treated as a click later
                                isDragging = true;
                                // Create the visual rectangle for dragging
                                if (!selectionRectEl) {
                                        selectionRectEl = document.createElement('div');
                                        selectionRectEl.id = 'selection-rectangle';
                                        document.body.appendChild(selectionRectEl);
                                }
                        }, 500); // 500ms defines a long press
                }
                // For mouse, we don't start dragging immediately, but on the first significant move.
        };

        // --- Interaction Move ---
        const handleInteractionMove = (e) => {
                if (!isInteracting || !isEditMode) return;

                const pos = getEventPosition(e);

                // If it's a touch event, any movement means it's not a tap/long-press, so clear the timer.
                if (e.type === 'touchmove') {
                        clearTimeout(longPressTimer);
                }

                // For mouse, if we move more than a few pixels, it's officially a drag.
                const distance = Math.hypot(pos.clientX - dragStartPos.x, pos.clientY - dragStartPos.y);
                if (e.type === 'mousemove' && e.buttons === 1 && distance > 10 && !isDragging) {
                        isDragging = true;
                        if (!selectionRectEl) {
                                selectionRectEl = document.createElement('div');
                                selectionRectEl.id = 'selection-rectangle';
                                document.body.appendChild(selectionRectEl);
                        }
                }

                if (!isDragging) return;
                e.preventDefault(); // Prevent page scroll while dragging

                // Update selection rectangle visuals
                const top = Math.min(pos.clientY, dragStartPos.y);
                const left = Math.min(pos.clientX, dragStartPos.x);
                const width = Math.abs(pos.clientX - dragStartPos.x);
                const height = Math.abs(pos.clientY - dragStartPos.y);

                selectionRectEl.style.top = `${top}px`;
                selectionRectEl.style.left = `${left}px`;
                selectionRectEl.style.width = `${width}px`;
                selectionRectEl.style.height = `${height}px`;

                // Check for intersections
                const rectBounds = selectionRectEl.getBoundingClientRect();
                document.querySelectorAll('.sticker-grid-item[data-id]').forEach(item => {
                        const itemBounds = item.getBoundingClientRect();
                        const isIntersecting = !(rectBounds.right < itemBounds.left || rectBounds.left > itemBounds.right || rectBounds.bottom < itemBounds.top || rectBounds.top > itemBounds.bottom);
                        item.classList.toggle('drag-selected', isIntersecting);
                });
        };

        // --- Interaction End ---
        const handleInteractionEnd = (e) => {
                clearTimeout(longPressTimer); // Always clear the timer on interaction end
                if (!isInteracting || !isEditMode) return;

                if (isDragging) {
                        // This was a confirmed drag-select action
                        document.querySelectorAll('.sticker-grid-item.drag-selected').forEach(item => {
                                const stickerId = parseInt(item.dataset.id);
                                selectedStickers.add(stickerId); // Add all visually selected items to the set
                        });
                } else {
                        // This was a click or a short tap
                        e.preventDefault(); // CRITICAL: This stops the browser from firing a delayed 'click' event
                        const stickerItem = e.target.closest('.sticker-grid-item[data-id]');
                        if (stickerItem) {
                                const stickerId = parseInt(stickerItem.dataset.id);
                                if (selectedStickers.has(stickerId)) {
                                        selectedStickers.delete(stickerId);
                                } else {
                                        selectedStickers.add(stickerId);
                                }
                        }
                }

                // Single point of truth: Update UI based on the final `selectedStickers` set
                document.querySelectorAll('.sticker-grid-item[data-id]').forEach(item => {
                        const stickerId = parseInt(item.dataset.id);
                        const isSelected = selectedStickers.has(stickerId);
                        item.querySelector('input').checked = isSelected;
                        item.classList.toggle('drag-selected', isSelected);
                });
                updateSelectionCount();

                // Cleanup
                isDragging = false;
                isInteracting = false;
                if (selectionRectEl) {
                        selectionRectEl.remove();
                        selectionRectEl = null;
                }
        };

        const getEventPosition = (e) => {
                if (e.touches && e.touches.length > 0) {
                        return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
                }
                return { clientX: e.clientX, clientY: e.clientY };
        };

        // Bind all events
        gridContainer.addEventListener('mousedown', handleInteractionStart);
        window.addEventListener('mousemove', handleInteractionMove);
        window.addEventListener('mouseup', handleInteractionEnd);
        gridContainer.addEventListener('touchstart', handleInteractionStart, { passive: false });
        window.addEventListener('touchmove', handleInteractionMove, { passive: false });
        window.addEventListener('touchend', handleInteractionEnd);

        // --- Initial Setup ---
        function initializePage() {
                headerLeftBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>`;
                headerLeftBtn.onclick = () => window.location.href = 'me.html';
                moreOptionsBtn.onclick = (e) => { e.stopPropagation(); moreOptionsMenu.classList.toggle('hidden'); };
                window.addEventListener('click', () => moreOptionsMenu.classList.add('hidden'));

                renderStickers();
        }

        initializePage();
});