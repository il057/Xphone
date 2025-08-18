// phone/stickers.js (使用共享UI组件的新版本)
import { db, uploadImage, getActiveApiProfile, callApi } from './db.js';
import { showUploadChoiceModal, promptForInput, showToast, showConfirmModal } from './ui-helpers.js';

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
        let thumbnailUrl = sticker.url;
        // 检查URL是否是Cloudinary的URL
        if (thumbnailUrl.includes('res.cloudinary.com')) {
            // 在 /upload/ 后插入变换参数 'w_200/'
            thumbnailUrl = thumbnailUrl.replace('/upload/', '/upload/w_200/');
        }
        stickerEl.innerHTML = `
            <img src="${thumbnailUrl}" alt="${sticker.name}" class="pointer-events-none w-full h-full object-contain">
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
                showToast("请先在“设置”页面配置 Cloudinary！", 'error');
                return;
            }
            try {
                imageUrl = await uploadImage(choice.value); // choice.value 是 File 对象
            } catch (error) {
                showToast(error.message, 'error');
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
            showToast(e.name === 'ConstraintError' ? '这个表情已经添加过了！' : '添加失败，请检查URL。', 'error');
        }
    }

    async function handleBulkAdd() {
        const jsonInput = await promptForInput(
            '批量添加表情',
            '请粘贴JSON数组或纯文本列表...\nAI会自动尝试转换文本格式。',
            true, // isTextarea = true
            false // isOptional = false
        );

        if (!jsonInput) return; // 用户取消

        let stickersToAdd = [];

        // 步骤 1: 尝试直接解析JSON
       try {
            stickersToAdd = JSON.parse(jsonInput);
        } catch (error) {
            // 步骤 2: 如果JSON解析失败，则调用AI进行转换
            console.log("JSON解析失败，启动AI文本转换...");
            
            // 在调用AI前，更新UI并禁用按钮
            bulkAddBtn.textContent = 'AI转换中...';
            bulkAddBtn.disabled = true;

            try {
                const convertedJson = await convertTextToJsonWithAI(jsonInput);
                if (!convertedJson) {
                    showToast("AI无法将文本转换为有效的JSON格式，请检查您的文本或API设置。", 'error');
                    return; // 提前返回
                }
                stickersToAdd = convertedJson;
            } catch (aiError) {
                console.error("AI转换过程中出错:", aiError);
                showToast(`AI转换失败: ${aiError.message}`, 'error');
                return; // 提前返回
            } finally {
                // 无论成功或失败，最后都恢复按钮状态
                bulkAddBtn.textContent = '批量添加';
                bulkAddBtn.disabled = false;
            }
        }

        // 步骤 3: 后续处理流程 
        try {
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
                showToast("没有找到有效的表情数据来添加。", 'error');
                return;
            }

            const highestOrderItem = await db.userStickers.orderBy('order').last();
            let currentOrder = (highestOrderItem?.order || 0);

            const stickersWithOrder = validStickers.map(sticker => {
                currentOrder++;
                return { ...sticker, order: currentOrder };
            });

            await db.userStickers.bulkAdd(stickersWithOrder);

            showToast(`成功添加了 ${validStickers.length} 个表情！${invalidStickers.length > 0 ? `\n有 ${invalidStickers.length} 个格式错误的条目被忽略。` : ''}`);
            await renderStickers();

        } catch (processingError) {
            console.error("批量添加表情失败:", processingError);
            showToast(`添加失败：\n${processingError.message}\n请检查JSON格式是否正确。`, 'error');
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

    // --- Event Listeners ---
    editBtn.addEventListener('click', toggleEditMode);
    bulkAddBtn.addEventListener('click', handleBulkAdd);

    moveTopBtn.addEventListener('click', async () => {
        if (selectedStickers.size === 0) return showToast('请先选择要操作的表情。', 'error');
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
        if (selectedStickers.size === 0) return showToast('请先选择要操作的表情。', 'error');
        const confirmed = await showConfirmModal(
            '删除表情',
            `确定要删除选中的 ${selectedStickers.size} 个表情吗？`,
            '删除',
            '取消'
        );
        if (confirmed) {
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