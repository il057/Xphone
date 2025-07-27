// phone/stickers.js (使用共享UI组件的新版本)
import { db, uploadImage } from './db.js';
import { showUploadChoiceModal, promptForInput } from './ui-helpers.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const gridContainer = document.getElementById('sticker-grid-container');
    const editBtn = document.getElementById('edit-stickers-btn');
    const bulkAddBtn = document.getElementById('bulk-add-btn');
    const fileInput = document.getElementById('local-sticker-input');
    
    const defaultTitle = document.getElementById('default-title');
    const editModeActions = document.getElementById('edit-mode-actions');
    const backBtn = document.getElementById('back-btn');
    const moveTopBtn = document.getElementById('move-top-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');

    // --- State ---
    let isEditMode = false;
    let selectedStickers = new Set();

    // --- Core Functions ---
    async function renderStickers() {
        gridContainer.innerHTML = '';
        
        // “添加”按钮
        const addButton = document.createElement('div');
        addButton.className = 'sticker-grid-item border-2 border-dashed border-gray-300';
        addButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" class="text-gray-400" viewBox="0 0 16 16"><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/></svg>`;
        addButton.addEventListener('click', () => {
            if (isEditMode) return;
            handleAddSticker(); // 调用新的添加流程
        });
        gridContainer.appendChild(addButton);

        // 渲染已有表情
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
        stickerEl.innerHTML = `
            <img src="${sticker.url}" alt="${sticker.name}" class="pointer-events-none w-full h-full object-contain">
            <div class="absolute inset-0 bg-black/20 hidden items-center justify-center edit-mode-item">
                <input type="checkbox" class="absolute top-2 right-2 w-5 h-5 accent-pink-500 pointer-events-none">
            </div>
        `;
        return stickerEl;
    }

    function toggleEditMode() {
        isEditMode = !isEditMode;
        
        defaultTitle.classList.toggle('hidden', isEditMode);
        backBtn.classList.toggle('hidden', isEditMode);
        editModeActions.classList.toggle('hidden', !isEditMode);
        bulkAddBtn.classList.toggle('hidden', isEditMode);
        editBtn.textContent = isEditMode ? '完成' : '编辑';
        gridContainer.classList.toggle('edit-mode', isEditMode);

        if (!isEditMode) {
            selectedStickers.clear();
            renderStickers();
        }
    }
    
    // --- New Add Sticker Flow ---
    async function handleAddSticker() {
        const choice = await showUploadChoiceModal(fileInput);
        if (!choice) return;

        let imageUrl = null;

        if (choice.type === 'local') {
            const apiConfig = await db.globalSettings.get('main');
            if (!apiConfig?.cloudinaryCloudName || !apiConfig?.cloudinaryUploadPreset) {
                alert("请先在“设置”页面配置 Cloudinary！");
                return;
            }
            try {
                imageUrl = await uploadImage(choice.value); // choice.value 是 File 对象
            } catch (error) {
                console.error("上传或保存表情失败:", error);
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
        const name = await promptForInput('给表情起个名字', '例如：开心、疑惑、赞', true);
        if (name === null) return; // 用户取消

        try {
            const highestOrder = await db.userStickers.orderBy('order').last();
            const newOrder = (highestOrder?.order || 0) + 1;
            await db.userStickers.add({ url, name, order: newOrder });
            await renderStickers();
        } catch (e) {
            alert(e.name === 'ConstraintError' ? '这个表情已经添加过了！' : '添加失败，请检查URL。');
        }
    }

    async function handleBulkAdd() {
        const jsonInput = await promptForInput(
            '批量添加表情',
            '请粘贴JSON数组，格式为：\n[{name:\"表情1\", url:\"...\"}, ...]',
            true, // isTextarea = true
            false // isOptional = false
        );
    
        if (!jsonInput) return; // User cancelled
    
        try {
            const stickersToAdd = JSON.parse(jsonInput);
    
            if (!Array.isArray(stickersToAdd)) {
                throw new Error("输入的不是一个有效的JSON数组。");
            }
    
            const validStickers = [];
            const invalidStickers = [];
    
            for (const item of stickersToAdd) {
                if (item && typeof item.name === 'string' && typeof item.url === 'string' && item.name.trim() && item.url.trim()) {
                    validStickers.push({
                        name: item.name.trim(),
                        url: item.url.trim(),
                    });
                } else {
                    invalidStickers.push(item);
                }
            }
    
            if (invalidStickers.length > 0) {
                console.warn("以下项目格式无效，已被忽略:", invalidStickers);
            }
    
            if (validStickers.length === 0) {
                alert("没有找到有效的表情数据来添加。");
                return;
            }
    
            const highestOrderItem = await db.userStickers.orderBy('order').last();
            let currentOrder = (highestOrderItem?.order || 0);
    
            const stickersWithOrder = validStickers.map(sticker => {
                currentOrder++;
                return { ...sticker, order: currentOrder };
            });
    
            await db.userStickers.bulkAdd(stickersWithOrder);
    
            alert(`成功添加了 ${validStickers.length} 个表情！${invalidStickers.length > 0 ? `\n有 ${invalidStickers.length} 个格式错误的条目被忽略。` : ''}`);
            await renderStickers();
    
        } catch (error) {
            console.error("批量添加表情失败:", error);
            alert(`添加失败：\n${error.message}\n请检查JSON格式是否正确。`);
        }
    }

    // --- Event Listeners ---
    editBtn.addEventListener('click', toggleEditMode);
    bulkAddBtn.addEventListener('click', handleBulkAdd);

    moveTopBtn.addEventListener('click', async () => {
        if (selectedStickers.size === 0) return alert('请先选择要操作的表情。');
        const highestOrder = await db.userStickers.orderBy('order').last();
        const newOrder = (highestOrder?.order || 0) + 1;
        const updates = Array.from(selectedStickers).map(id => ({
            key: id,
            changes: { order: newOrder }
        }));
        await db.userStickers.bulkUpdate(updates);
        toggleEditMode();
    });

    deleteSelectedBtn.addEventListener('click', async () => {
        if (selectedStickers.size === 0) return alert('请先选择要操作的表情。');
        if (confirm(`确定要删除选中的 ${selectedStickers.size} 个表情吗？`)) {
            await db.userStickers.bulkDelete(Array.from(selectedStickers));
            toggleEditMode();
        }
    });

    gridContainer.addEventListener('click', (e) => {
        if (!isEditMode) return;
        const stickerItem = e.target.closest('.sticker-grid-item[data-id]');
        if (!stickerItem) return;

        const stickerId = parseInt(stickerItem.dataset.id);
        const checkbox = stickerItem.querySelector('input[type="checkbox"]');
        
        checkbox.checked = !checkbox.checked;
        if (checkbox.checked) {
            selectedStickers.add(stickerId);
        } else {
            selectedStickers.delete(stickerId);
        }
    });

    // --- Initial Render ---
    renderStickers();
});