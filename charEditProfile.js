// settings.js
// Import the shared database instance from db.js
import { db, uploadImage, getActiveApiProfile, callApi } from './db.js'; 
import { showUploadChoiceModal, showImagePickerModal, showAlbumPickerModal, promptForInput } from './ui-helpers.js'; // 导入三个助手
import { showToast, showToastOnNextPage, showConfirmModal } from './ui-helpers.js';

document.addEventListener('DOMContentLoaded', async () => {
    // --- DB & State ---

    const urlParams = new URLSearchParams(window.location.search);
    const isNew = urlParams.get('isNew') === 'true';
    const charId = isNew ? null : urlParams.get('id'); // Only get charId if not new
    const prefilledName = urlParams.get('name') || '';
    let chatData;
    let customPresets = []; // 用于存储从数据库加载的自定义预设
    let customCssPresets = [];
    const defaultAvatar = 'https://files.catbox.moe/kkll8p.svg';

    // --- DOM Elements ---
    const backBtn = document.getElementById('back-btn');
    const avatarPreview = document.getElementById('avatar-preview');
    const remarkInput = document.getElementById('remark-input');
    const realNameInput = document.getElementById('real-name-input');
    const birthdayInput = document.getElementById('birthday-input');
    const genderSelect = document.getElementById('gender-select');
    const personaInput = document.getElementById('persona-input');
    const backgroundUrlInput = document.getElementById('background-url-input');
    
    const customThemePreview = document.getElementById('custom-theme-preview');
    const blockBtn = document.getElementById('block-char-btn');
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    const themeSwatchesContainer = document.getElementById('theme-swatches-container');
    const customThemePicker = document.getElementById('custom-theme-picker');
    const themePreviewContainer = document.getElementById('theme-preview-container'); // The always-visible preview area
    const colorInputs = {
        aiBg: document.getElementById('ai-bubble-bg-color'),
        aiText: document.getElementById('ai-bubble-text-color'),
        userBg: document.getElementById('user-bubble-bg-color'),
        userText: document.getElementById('user-bubble-text-color')
    };

    const saveBtn = document.getElementById('save-btn');
    // Avatar Library Modal
    const avatarModal = document.getElementById('avatar-library-modal');
    const avatarGrid = document.getElementById('avatar-grid');
    const changeAvatarBtn = document.getElementById('change-avatar-btn');
    const closeAvatarBtn = document.getElementById('close-avatar-modal-btn');
    const addAvatarBtn = document.getElementById('add-avatar-btn');
    
    const worldBookSelect = document.getElementById('world-book-select');
    const customBubbleCssInput = document.getElementById('custom-bubble-css-input');
    const livePreviewStyleTag = document.createElement('style');
    livePreviewStyleTag.id = 'live-preview-bubble-style';
    document.head.appendChild(livePreviewStyleTag);

    const aiBubblePromptInput = document.getElementById('ai-bubble-prompt-input');
    const generateCssBtn = document.getElementById('generate-css-btn');
    const saveCssPresetBtn = document.getElementById('save-css-preset-btn');
    const cssPresetsContainer = document.getElementById('css-presets-container');

        const ttsProfileSelect = document.getElementById('tts-profile-select'); 
        const ttsVoiceSelect = document.getElementById('tts-voice-select');

    const bubbleThemes = [
        { name: '默认', value: 'default', colors: { userBg: '#dcf8c6', userText: '#000000', aiBg: '#e9e9e9', aiText: '#000000' } },
        { name: '粉蓝', value: 'pink_blue', colors: { userBg: '#eff7ff', userText: '#263a4e', aiBg: '#fff0f6', aiText: '#432531' } },
        { name: '蓝白', value: 'blue_white', colors: { userBg: '#eff7ff', userText: '#263a4e', aiBg: '#f8f9fa', aiText: '#383d41' } },
        { name: '紫黄', value: 'purple_yellow', colors: { userBg: '#fffde4', userText: '#5C4033', aiBg: '#faf7ff', aiText: '#827693' } },
        { name: '黑白', value: 'black_white', colors: { userBg: '#343a40', userText: '#f8f9fa', aiBg: '#f8f9fa', aiText: '#343a40' } },
    ];
    
    // --- Functions ---

    async function initializeNewCharacter() {
        customPresets = await db.bubbleThemePresets.toArray(); 
        // Set the back button to go to the contacts page as a sensible default
        backBtn.href = 'contacts.html';
        
        // Pre-fill the name from the prompt in the previous page
        realNameInput.value = prefilledName;
        remarkInput.value = prefilledName; // Can also prefill remark
    
        // Set default empty state for chatData
        chatData = {
            settings: {
                aiAvatarLibrary: [],
                aiAvatar: defaultAvatar
            },
            history: [],
            signature: ''
        };
        
        // Load groups for the dropdown
        const groupSelect = document.getElementById('group-select');
        groupSelect.innerHTML = '<option value="">未分组</option>';
        const groups = await db.xzoneGroups.toArray();
        groups.forEach(group => {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = group.name;
            groupSelect.appendChild(option);
        });
        groupSelect.appendChild(new Option('＋ 新建分组...', 'new_group'));
    
        // Render default theme
        renderThemeSwatches('default');
        renderThemePreview('default');
        renderRelationshipEditor(null);
        await applyPageTheme(chatData);
        await loadWorldBooks();
        await loadAndRenderCssPresets();
        await loadVoiceSettings();
    }

    async function loadData() {
        if (!charId) {
            showToastOnNextPage('无效的编辑链接', 'error');
            window.location.href = 'chat.html';
            return;
        }
        
        chatData = await db.chats.get(charId);
        
        if (!chatData) {
            showToastOnNextPage('数据不存在', 'error');
            window.location.href = 'chat.html';
            return;
        }

        customPresets = await db.bubbleThemePresets.toArray();
        if (!chatData.settings) chatData.settings = {};
            let inheritedBookIds = [];
            // 如果角色属于某个分组，则获取该分组的世界书
            if (chatData.groupId) {
                    const group = await db.xzoneGroups.get(chatData.groupId);
                    if (group && group.worldBookIds) {
                            inheritedBookIds = group.worldBookIds;
                    }
            }
            // 获取角色自己绑定的世界书ID（确保它是一个数组）
            const individualBookIds = chatData.settings.worldBookIds || [];

        const maxMemoryInput = document.getElementById('max-memory-input');
        
        if (chatData.isGroup) {
            backBtn.href = `chatRoom.html?id=${charId}`;
            // --- 群聊编辑UI逻辑 ---
            document.querySelector('h1').textContent = '编辑群聊资料';
            
            document.getElementById('single-char-fields').style.display = 'none';
            document.getElementById('group-char-fields').classList.remove('hidden');
            document.getElementById('relationship-settings').style.display = 'none';
    
            document.getElementById('remark-label').textContent = '群聊名称';
            remarkInput.value = chatData.name || '';
            
            document.getElementById('block-char-btn').style.display = 'none';
    
            document.getElementById('delete-char-btn').textContent = '删除并退出群聊';
    
            document.getElementById('manage-group-members-btn').href = `contactsPicker.html?groupId=${charId}`;
            document.getElementById('change-avatar-btn').style.display = 'none';

            avatarPreview.src = chatData.settings.groupAvatar || defaultAvatar;
            avatarPreview.onerror = () => { avatarPreview.src = defaultAvatar; };
            
            maxMemoryInput.value = chatData.settings.maxMemory || '';
            backgroundUrlInput.value = chatData.settings.background || ''; 
            renderThemeSwatches(chatData.settings.theme);
            renderThemePreview(chatData.settings.theme);
    
        } else {
            backBtn.href = `charProfile.html?id=${charId}`;
            // --- 单人角色编辑UI逻辑 ---
            if (!chatData.settings.aiAvatarLibrary) chatData.settings.aiAvatarLibrary = [];
            document.getElementById('relationship-settings').style.display = 'block';
            
            avatarPreview.src = chatData.settings.aiAvatar || defaultAvatar;
            remarkInput.value = chatData.name || '';
            realNameInput.value = chatData.realName || '';
            birthdayInput.value = chatData.birthday || '';
            genderSelect.value = chatData.gender || 'unspecified';
    
            const groupSelect = document.getElementById('group-select');
            groupSelect.innerHTML = '<option value="">未分组</option>';
            const groups = await db.xzoneGroups.toArray();
            groups.forEach(group => {
                const option = document.createElement('option');
                option.value = group.id;
                option.textContent = group.name;
                if (chatData.groupId === group.id) {
                    option.selected = true;
                }
                groupSelect.appendChild(option);
            });
            groupSelect.appendChild(new Option('＋ 新建分组...', 'new_group'));
            personaInput.value = chatData.settings.aiPersona || '';
            maxMemoryInput.value = chatData.settings.maxMemory || '';
            backgroundUrlInput.value = chatData.settings.background || '';
            
            const loadedCss = chatData.settings.customBubbleCss || '';
            customBubbleCssInput.value = loadedCss; // 填充文本框
            renderThemeSwatches(chatData.settings.theme);
            // 将CSS作为参数传入，确保初始加载时预览正确
            renderThemePreview(chatData.settings.theme, loadedCss); 
            renderRelationshipEditor(chatData.groupId);
            await loadVoiceSettings(chatData.settings.voiceConfig);
        }
        await applyPageTheme(chatData); 
            await loadWorldBooks(individualBookIds, inheritedBookIds);
        await loadAndRenderCssPresets();
        customBubbleCssInput.value = chatData.settings.customBubbleCss || '';
       
    }

        async function loadWorldBooks(individualBookIds = [], inheritedBookIds = []) {
                const container = document.getElementById('world-book-select-container');
                if (!container) return;

                const books = await db.worldBooks.toArray();
                container.innerHTML = '';

                if (books.length === 0) {
                        container.innerHTML = '<p class="text-xs text-gray-500">还没有创建任何世界书。</p>';
                        return;
                }

                const individualSet = new Set(individualBookIds);
                const inheritedSet = new Set(inheritedBookIds);

                books.forEach(book => {
                        const isIndividuallyChecked = individualSet.has(book.id);
                        const isInherited = inheritedSet.has(book.id);
                        const isChecked = isIndividuallyChecked || isInherited;
                        const isDisabled = isInherited;

                        const checkboxWrapper = document.createElement('div');
                        checkboxWrapper.className = `flex items-center ${isDisabled ? 'opacity-60' : ''}`;
                        checkboxWrapper.innerHTML = `
            <input type="checkbox" id="book-check-${book.id}" value="${book.id}" class="h-4 w-4 rounded world-book-checkbox" 
                ${isChecked ? 'checked' : ''} 
                ${isDisabled ? 'disabled' : ''}>
            <label for="book-check-${book.id}" class="ml-2 text-sm">${book.name} ${isDisabled ? '(由分组继承)' : ''}</label>
        `;
                        container.appendChild(checkboxWrapper);
                });
        }

    function renderThemeSwatches(activeTheme) {
        themeSwatchesContainer.innerHTML = '';
        
        // 1. 渲染默认主题
        bubbleThemes.forEach(theme => {
            const swatch = createSwatch(theme.value, `linear-gradient(to top right, ${theme.colors.aiBg}, ${theme.colors.userBg})`);
            themeSwatchesContainer.appendChild(swatch);
        });

        // 2. 渲染用户自定义主题（带删除功能）
        customPresets.forEach(preset => {
            // 创建一个容器来包裹色板和删除按钮
            const container = document.createElement('div');
            container.className = 'swatch-container';

            // 创建色板本身
            const swatch = createSwatch(preset.name, `linear-gradient(to top right, ${preset.colors.aiBg}, ${preset.colors.userBg})`);
            
            // 创建删除按钮
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'swatch-delete-btn';
            deleteBtn.innerHTML = '&times;'; // "×" 符号
            deleteBtn.title = `删除预设: ${preset.name}`;

            // 为删除按钮添加点击事件
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation(); // 防止触发色板的点击事件
                const confirmed = await showConfirmModal(
                    '删除预设',
                    `确定要删除预设 “${preset.name}” 吗？此操作不可恢复。`,
                    '删除',
                    '取消'
                );
                if (confirmed) {
                    // 从数据库删除
                    await db.bubbleThemePresets.delete(preset.name);
                    // 从内存中删除
                    customPresets = customPresets.filter(p => p.name !== preset.name);
                    // 重新渲染所有色板
                    renderThemeSwatches(chatData.settings.theme);
                }
            });

            // 将色板和删除按钮都添加到容器中
            container.appendChild(swatch);
            container.appendChild(deleteBtn);
            // 将整个容器添加到主区域
            themeSwatchesContainer.appendChild(container);
        });
        
        // 3. 渲染“+”号自定义按钮
        const customBtn = createCustomButton();
        themeSwatchesContainer.appendChild(customBtn);
        
        // 4. 设置初始激活状态
        if (typeof activeTheme === 'object' && activeTheme !== null) {
            handleSwatchClick('custom', activeTheme);
        } else {
            handleSwatchClick(activeTheme || 'default');
        }
    }

    function renderThemePreview(theme, customCss = '') {
        let themeColors;
        const preset = bubbleThemes.find(t => t.value === theme) || customPresets.find(p => p.name === theme);
        
        if (typeof theme === 'object' && theme !== null && theme.userBg) {
            themeColors = theme;
        } else {
            themeColors = preset ? preset.colors : bubbleThemes[0].colors;
        }

        themePreviewContainer.style.setProperty('--user-bubble-bg', themeColors.userBg);
        themePreviewContainer.style.setProperty('--user-bubble-text', themeColors.userText);
        themePreviewContainer.style.setProperty('--ai-bubble-bg', themeColors.aiBg);
        themePreviewContainer.style.setProperty('--ai-bubble-text', themeColors.aiText);
        
        const accentColor = (localStorage.getItem('chatAccentThemeSource') === 'ai') ? themeColors.aiBg : themeColors.userBg;
        themePreviewContainer.style.setProperty('--accent-color', accentColor);

        // 与实际聊天室的HTML结构完全一致
        themePreviewContainer.innerHTML = `
            <div class="message-wrapper ai" data-timestamp="${Date.now()}">
                <img class="avatar" src="${chatData?.settings?.aiAvatar || defaultAvatar}">
                <div class="flex flex-col message-content-column">
                    <div class="chat-bubble ai-bubble">
                        <div class="quoted-message">
                            <div class="quoted-sender">回复 User:</div>
                            <div class="quoted-content">这是引用的消息...</div>
                        </div>
                        对方气泡预览
                    </div>
                </div>
                <div class="message-content-group flex items-end gap-2"></div>
                <span class="timestamp">12:34</span>
            </div>
            <div class="message-wrapper user" data-timestamp="${Date.now() + 1}">
                <img class="avatar" src="https://files.catbox.moe/kkll8p.svg">
                <div class="flex flex-col message-content-column">
                    <div class="chat-bubble user-bubble">
                        我的气泡预览，长消息换行展示，这是一条很长的信息。
                    </div>
                </div>
                <div class="message-content-group flex items-end gap-2"></div>
                <span class="timestamp">12:35</span>
            </div>
        `;
        
        applyLiveCssPreview(customCss || customBubbleCssInput.value);
    }
    
    function applyLiveCssPreview(cssCode) {
        // 智能地将用户CSS中的选择器映射到正确的预览结构上
        const scopedCss = (cssCode || '')
            .replace(/\.message-wrapper/g, '#theme-preview-container .message-wrapper')
            .replace(/\.message-bubble\.user\s*\.content/g, '#theme-preview-container .user-bubble')
            .replace(/\.message-bubble\.ai\s*\.content/g, '#theme-preview-container .ai-bubble')
            .replace(/\.message-bubble\s*\.content/g, '#theme-preview-container .chat-bubble')
            .replace(/\.message-bubble/g, '#theme-preview-container .chat-bubble'); // 将 .message-bubble 也指向 .chat-bubble

        livePreviewStyleTag.textContent = scopedCss;
    }


    function handleSwatchClick(themeValue, customThemeObject = null) {
        // 第1步：更新哪个色板被视觉选中
        document.querySelectorAll('.swatch').forEach(el => el.classList.remove('active'));
        const activeEl = document.querySelector(`.swatch[data-theme-value="${themeValue}"]`);
        if (activeEl) activeEl.classList.add('active');
        
        // 第2步：如果点击的是"+"号，则显示自定义颜色选择器
        customThemePicker.classList.toggle('hidden', themeValue !== 'custom');
        
        if (themeValue === 'custom' && customThemeObject) {
            colorInputs.aiBg.value = customThemeObject.aiBg;
            colorInputs.aiText.value = customThemeObject.aiText;
            colorInputs.userBg.value = customThemeObject.userBg;
            colorInputs.userText.value = customThemeObject.userText;
        }
        // 第3步：通知预览区根据新的选择进行重绘
        let themeToPreview;
        if (themeValue === 'custom') {
            // 如果点击的是"+"号，就用颜色选择器的当前值进行预览
            themeToPreview = customThemeObject || {
                aiBg: colorInputs.aiBg.value,
                aiText: colorInputs.aiText.value,
                userBg: colorInputs.userBg.value,
                userText: colorInputs.userText.value
            };
        } else {
            // 如果点击的是预设主题，就用它的名字（比如 'pink_blue'）进行预览
            themeToPreview = themeValue;
        }
        
        // 调用函数，真正地去重绘预览气泡
        renderThemePreview(themeToPreview);
    }

    async function saveCustomTheme() {
        const presetName = await promptForInput("为你的自定义方案起个名字吧：", "例如：清新蓝、温暖橙", false, false);
        if (!presetName || !presetName.trim()) {
            if (presetName !== null) showToast("名字不能为空！");
            return;
        }

        // 检查名称是否与默认主题或已保存的自定义主题冲突
        const isNameTaken = bubbleThemes.some(t => t.name === presetName.trim()) || customPresets.some(p => p.name === presetName.trim());
        if (isNameTaken) {
            showToast(`这个名字 “${presetName.trim()}” 已经被占用了，换一个吧！`, 'error');
            return;
        }

        const newPreset = {
            name: presetName.trim(),
            colors: {
                aiBg: colorInputs.aiBg.value, aiText: colorInputs.aiText.value,
                userBg: colorInputs.userBg.value, userText: colorInputs.userText.value
            }
        };

        await db.bubbleThemePresets.add(newPreset);
        customPresets.push(newPreset); // 更新内存中的自定义预设列表
        
        renderThemeSwatches(chatData.settings.theme); // 重新渲染所有色板
        showToast('保存成功！现在可以在所有角色编辑页使用这个方案了。', 'success');
    }

    function createSwatch(value, background) {
        const swatch = document.createElement('div');
        swatch.className = 'swatch h-12 w-12 rounded-lg cursor-pointer border-2 border-transparent';
        swatch.style.background = background;
        swatch.dataset.themeValue = value;
        swatch.addEventListener('click', () => handleSwatchClick(value));
        return swatch;
    }

    function createCustomButton() {
        const swatch = document.createElement('div');
        swatch.className = 'swatch h-12 w-12 rounded-lg cursor-pointer border-2 border-dashed border-gray-300 flex items-center justify-center';
        swatch.dataset.themeValue = 'custom';
        swatch.innerHTML = '<span class="text-2xl font-light text-gray-400">+</span>';
        swatch.title = '自定义主题';
        swatch.addEventListener('click', () => {
            // 当点击"+"号时，传入'custom'值并激活颜色选择器
            handleSwatchClick('custom');
        });
        return swatch;
    }

    /**
     * 根据角色数据和用户偏好，应用页面主色调
     * @param {object} chatData - 当前角色的数据
     */
    async function applyPageTheme(chatData) {
        // 1. 设定一个最终的回退颜色
        let themeColor = '#3b82f6'; 
        let themeTextColor = '#000000'
        let finalThemeColors = null;

        // 2. 尝试从角色数据中获取主题颜色对象
        const charThemeSetting = chatData?.settings?.theme;

        if (typeof charThemeSetting === 'object' && charThemeSetting !== null) {
            finalThemeColors = charThemeSetting;
        } else if (typeof charThemeSetting === 'string') {
            const allPresets = [...bubbleThemes, ...customPresets.map(p => ({ value: p.name, colors: p.colors }))];
            const preset = allPresets.find(t => t.value === charThemeSetting);
            if (preset) finalThemeColors = preset.colors;
        }

        // 3. 如果成功获取了主题颜色对象，则根据用户偏好选择来源
        if (finalThemeColors) {
            // 从 localStorage 读取用户在聊天室中的选择 ('user' 或 'ai')
            const themeSource = localStorage.getItem('chatAccentThemeSource') || 'user'; // 默认为 user
            themeColor = (themeSource === 'ai') ? finalThemeColors.aiBg : finalThemeColors.userBg;
            themeTextColor = (themeSource === 'ai') ? finalThemeColors.aiText : finalThemeColors.userText;
        } else {
            // 如果角色没有设置主题，可以回退到全局设置（如果未来有的话）或保持默认蓝色
        }

        // 4. 将最终计算出的颜色应用到页面
        document.documentElement.style.setProperty('--theme-color', themeColor);
        document.documentElement.style.setProperty('--theme-text-color', themeTextColor);

        // 5. 更新滑块的颜色
        const existingSliderStyle = document.getElementById('slider-accent-style');
        if (existingSliderStyle) existingSliderStyle.remove();
        
        const sliderStyle = document.createElement('style');
        sliderStyle.id = 'slider-accent-style';
        sliderStyle.textContent = `
            input[type="range"] {
                accent-color: ${themeColor};
            }
        `;
        document.head.appendChild(sliderStyle);
    }

    const fileInput = document.getElementById('char-avatar-upload-input');

    // --- Avatar Logic ---
    async function openCharAvatarPicker() {
        let library = chatData.settings.aiAvatarLibrary || [];

        // 数据迁移逻辑
        // 检查并为没有ID的旧数据分配一个临时但唯一的ID
        library.forEach(avatar => {
            if (!avatar.id) {
                avatar.id = `char_avatar_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            }
        });

        const selectedUrl = await showImagePickerModal(
            '选择头像',
            library, // 现在直接传递处理过的 library
            () => handleAddNewCharAvatar(),
            (avatarToDelete) => handleDeleteCharAvatar(avatarToDelete)
        );

        if (selectedUrl) {
            chatData.settings.aiAvatar = selectedUrl;
            avatarPreview.src = selectedUrl;
        }
    }

    async function handleDeleteCharAvatar(avatarToDelete) {
        const confirmed = await showConfirmModal(
            '删除头像',
            `确定要删除头像 “${avatarToDelete.name}” 吗？`,
            '删除',
            '取消'
        );
        if (!confirmed) return;

        // 使用唯一的 ID 来精确查找和删除
        const indexToDelete = chatData.settings.aiAvatarLibrary.findIndex(avatar => avatar.id === avatarToDelete.id);

        if (indexToDelete > -1) {
            chatData.settings.aiAvatarLibrary.splice(indexToDelete, 1);
            showToast('头像已删除。记得点击页面顶部的“保存”按钮来保存所有更改。', 'success');
            await openCharAvatarPicker(); // 重新打开选择器以刷新列表
        } else {
            showToast('未找到要删除的头像，可能已被移除。', 'error');
        }
    }

    async function handleAddNewCharAvatar() {
        const fileInput = document.getElementById('char-avatar-upload-input');
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
                imageUrl = await uploadImage(choice.value);
            } catch (error) {
                showToast(error.message, 'error');
                return;
            }
        } else {
            imageUrl = choice.value;
        }

        if (imageUrl) {
            await processAndSaveCharAvatar(imageUrl);
        }
    }

   async function processAndSaveCharAvatar(url) {
        const name = await promptForInput('为头像命名', '例如：开心、哭泣', false, false);
        if (name === null) return; // 用户取消

        if (!chatData.settings.aiAvatarLibrary) {
            chatData.settings.aiAvatarLibrary = [];
        }

        if (chatData.settings.aiAvatarLibrary.some(avatar => avatar.name === name)) {
            showToast('这个名字已经存在了，请换一个。', 'error');
            return;
        }

        // 为新头像添加唯一的ID
        const newAvatar = {
            id: `char_avatar_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: name,
            url: url
        };
        chatData.settings.aiAvatarLibrary.push(newAvatar);

        showToast('新头像已添加！记得点击页面顶部的“保存”按钮来保存所有更改。', 'success');
        await openCharAvatarPicker();
    }
    
    async function saveChanges() {
        saveBtn.textContent = '保存中...';
        saveBtn.disabled = true;
        
        const activeSwatch = themeSwatchesContainer.querySelector('.active');
        let themeSetting;
        if (activeSwatch) {
            const themeValue = activeSwatch.dataset.themeValue;
            if (themeValue === 'custom') {
                themeSetting = {
                    aiBg: colorInputs.aiBg.value, aiText: colorInputs.aiText.value,
                    userBg: colorInputs.userBg.value, userText: colorInputs.userText.value
                };
            } else {
                themeSetting = themeValue;
            }
        } else {
            // 如果没有激活的 swatch，可能意味着正在编辑自定义CSS，也需要保存
            themeSetting = chatData.settings.theme;
        }
    
        const checkedBooks = document.querySelectorAll('.world-book-checkbox:checked:not(:disabled)');
        const selectedWorldBookIds = Array.from(checkedBooks).map(cb => cb.value);

        const sharedSettings = {
            background: backgroundUrlInput.value.trim(),
            theme: themeSetting,
            maxMemory: parseInt(document.getElementById('max-memory-input').value) || 10,
            worldBookIds: selectedWorldBookIds,
            customBubbleCss: customBubbleCssInput.value.trim(),
                voiceConfig: { 
                        profileId: parseInt(ttsProfileSelect.value) || null,
                        voiceId: ttsVoiceSelect.value || null
                }
        };

        const finalCharId = charId || (crypto.randomUUID ? crypto.randomUUID() : `fallback-${Date.now()}-${Math.random().toString(16).substr(2, 8)}`);
        // 1. 保存与 User 的关系
        const userRelationType = document.getElementById('relation-type-user')?.value;
        const userRelationScore = document.getElementById('relation-score-user')?.value;
        if (userRelationType && userRelationScore) {
            const score = parseInt(userRelationScore);
            // 保存 char -> user 的关系
            const rel_char_user = { sourceCharId: finalCharId, targetCharId: 'user', type: userRelationType, score: score };
            await db.relationships.where({ sourceCharId: finalCharId, targetCharId: 'user' }).delete(); // 先删除旧的
            await db.relationships.add(rel_char_user); 
        }
        
        // 2. 保存与其他角色的关系
        const relationsList = document.getElementById('relations-list');
        const relationSelects = relationsList.querySelectorAll('select[data-target-id]');
        for (const select of relationSelects) {
            const targetId = select.dataset.targetId;
            const type = select.value;
            const scoreInput = relationsList.querySelector(`input[data-target-id="${targetId}"]`);
            const score = scoreInput ? parseInt(scoreInput.value) : 0;
            const relationData = { sourceCharId: finalCharId, targetCharId: targetId, type, score };
            // 使用同样安全的“先删后增”模式确保数据正确
            await db.relationships.where({ sourceCharId: finalCharId, targetCharId: targetId }).delete();
            await db.relationships.add(relationData);
        }
            
        if (isNew) {
            // 此页面只用于创建单人角色
            const newCharacter = {
                name: remarkInput.value.trim(),
                realName: realNameInput.value.trim(),
                birthday: birthdayInput.value,
                gender: genderSelect.value,
                groupId: parseInt(document.getElementById('group-select').value) || null,
                settings: {
                    ...(chatData.settings || {}),
                    ...sharedSettings,
                    aiPersona: personaInput.value.trim(),
                },
                id: finalCharId,
                history: [], 
                isGroup: 0,
                signature: '',
                status: { text: '在线', color: '#2ecc71' },
                blockStatus: null
            };
            try {
                await db.chats.add(newCharacter); 
                showToastOnNextPage('角色创建成功！', 'success');
                window.location.href = `charProfile.html?id=${finalCharId}`;
            } catch (error) {
                console.error("Failed to create new character:", error);
                showToast("创建失败，请稍后再试。", 'error');
                saveBtn.textContent = '保存';
                saveBtn.disabled = false;
            }
        } else {
            // --- 更新现有角色或群组的逻辑 ---
            if (chatData.isGroup) {
                // 更新群聊
                const updatedData = { 
                    ...chatData, 
                    name: remarkInput.value.trim(),
                    settings: { ...chatData.settings, ...sharedSettings }
                };
                await db.chats.put(updatedData);
                showToastOnNextPage('群聊资料保存成功！', 'success');
                window.location.href = `chatRoom.html?id=${chatData.id}`;

            } else {
                // 更新单人角色
                const updatedData = { 
                    ...chatData,
                    name: remarkInput.value.trim(),
                    realName: realNameInput.value.trim(),
                    birthday: birthdayInput.value,
                    gender: genderSelect.value,
                    groupId: parseInt(document.getElementById('group-select').value) || null,
                    settings: {
                        ...(chatData.settings || {}),
                        ...sharedSettings,
                        aiPersona: personaInput.value.trim(),
                    }
                };
                await db.chats.put(updatedData);
                showToastOnNextPage('保存成功！', 'success');
                window.location.href = `charProfile.html?id=${chatData.id}`;
            }
        }
    }
    /**
     * 专门用于刷新分组下拉列表，并选中指定的ID
     * @param {number} [selectedGroupId] - 可选，要自动选中的分组ID
     */
    async function refreshGroupSelect(selectedGroupId) {
        const groupSelect = document.getElementById('group-select');
        const groups = await db.xzoneGroups.toArray();

        // 记录当前的值，以便刷新后恢复
        const currentValue = selectedGroupId || groupSelect.value;
        
        // 清空现有选项
        groupSelect.innerHTML = '<option value="">未分组</option>';

        // 重新填充
        groups.forEach(group => {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = group.name;
            groupSelect.appendChild(option);
        });

        // 添加“新建”选项
        groupSelect.appendChild(new Option('＋ 新建分组...', 'new_group'));

        // 恢复或设置新的选中项
        if (currentValue) {
            groupSelect.value = currentValue;
        }
    }
        async function loadAndRenderCssPresets() {
                customCssPresets = await db.bubbleCssPresets.toArray();
                renderCssPresets(chatData?.settings?.customBubbleCss);
        }

        async function renderRelationshipEditor(groupId) {
                const relationsList = document.getElementById('relations-list');
                const userRelationContainer = document.getElementById('relation-with-user');

                // --- 第 1 步: 渲染与 User 的关系 (这部分逻辑永远执行) ---
                relationsList.innerHTML = ''; // 只清空一次，准备重建
                relationsList.appendChild(userRelationContainer); // 把 User 容器先放回去

                const userRelation = charId ? await db.relationships.where({ sourceCharId: charId, targetCharId: 'user' }).first() : null;
                const displayUserRelation = userRelation || { type: 'stranger', score: 0 };

                userRelationContainer.innerHTML = `
            <div class="flex items-center justify-between">
                <label class="font-medium text-sm" for="relation-type-user" style=" color: var(--theme-text-color)">与 User (你) 的关系</label>
                <select id="relation-type-user" class="form-input w-2/5 text-sm p-1 rounded-md">
                    <option value="stranger" ${displayUserRelation.type === 'stranger' ? 'selected' : ''}>陌生人</option>
                    <option value="friend" ${displayUserRelation.type === 'friend' ? 'selected' : ''}>朋友</option>
                    <option value="family" ${displayUserRelation.type === 'family' ? 'selected' : ''}>家人</option>
                    <option value="lover" ${displayUserRelation.type === 'lover' ? 'selected' : ''}>恋人</option>
                    <option value="rival" ${displayUserRelation.type === 'rival' ? 'selected' : ''}>对手</option>
                </select>
            </div>
            <div class="flex items-center gap-3">
                <label class="text-sm text-gray-600" for="relation-score-user" style=" color: var(--theme-text-color)">好感度</label>
                <input type="range" id="relation-score-user" min="-1000" max="1000" value="${displayUserRelation.score}" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                <span id="score-value-user" class="text-sm font-mono w-12 text-center" style=" color: var(--theme-text-color)">${displayUserRelation.score}</span>
            </div>
        `;

                const userScoreSlider = document.getElementById('relation-score-user');
                const userScoreDisplay = document.getElementById('score-value-user');
                userScoreSlider.addEventListener('input', () => {
                        userScoreDisplay.textContent = userScoreSlider.value;
                });

                // --- 第 2 步: 独立处理与同组角色的关系 ---

                // 创建一个专门用于放置分组关系的容器
                const groupRelationsContainer = document.createElement('div');
                groupRelationsContainer.className = "space-y-3 mt-4 pt-4 border-t"; // 添加样式与上方分隔
                relationsList.appendChild(groupRelationsContainer);

                if (!groupId) {
                        groupRelationsContainer.innerHTML = '<p class="text-sm text-gray-500">请先为该角色选择一个分组，才能设定与同组角色的初始关系。</p>';
                        return; // 结束函数
                }

                const allChats = await db.chats.toArray();
                const groupMembers = allChats.filter(c => c.groupId === groupId && c.id !== charId && !c.isGroup);

                if (groupMembers.length === 0) {
                        groupRelationsContainer.innerHTML = '<p class="text-sm text-gray-500">该分组内还没有其他角色可供设定关系。</p>';
                        return; // 结束函数
                }

                const existingRelations = charId ? await db.relationships.where('sourceCharId').equals(charId).toArray() : [];
                const relationsMap = new Map(existingRelations.map(r => [r.targetCharId, r]));

                groupMembers.forEach(member => {
                        const relation = relationsMap.get(member.id) || { type: 'stranger', score: 0 };
                        const relationEl = document.createElement('div');
                        relationEl.className = 'p-3 border rounded-md space-y-2 bg-gray-50';

                        relationEl.innerHTML = `
                <div class="flex items-center justify-between">
                    <label class="font-medium text-sm" for="relation-type-${member.id}">与 ${member.name} 的关系</label>
                    <select id="relation-type-${member.id}" data-target-id="${member.id}" class="form-input w-2/5 text-sm p-1 rounded-md">
                        <option value="stranger" ${relation.type === 'stranger' ? 'selected' : ''}>陌生人</option>
                        <option value="friend" ${relation.type === 'friend' ? 'selected' : ''}>朋友</option>
                        <option value="family" ${relation.type === 'family' ? 'selected' : ''}>家人</option>
                        <option value="lover" ${relation.type === 'lover' ? 'selected' : ''}>恋人</option>
                        <option value="rival" ${relation.type === 'rival' ? 'selected' : ''}>对手</option>
                    </select>
                </div>
                <div class="flex items-center gap-3">
                    <label class="text-sm text-gray-600" for="relation-score-${member.id}">好感度</label>
                    <input type="range" id="relation-score-${member.id}" data-target-id="${member.id}" min="-1000" max="1000" value="${relation.score}" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">                    
                    <span id="score-value-${member.id}" class="text-sm font-mono w-12 text-center">${relation.score}</span>
                </div>
            `;
                        groupRelationsContainer.appendChild(relationEl);

                        const scoreSlider = relationEl.querySelector(`#relation-score-${member.id}`);
                        const scoreValueDisplay = relationEl.querySelector(`#score-value-${member.id}`);
                        scoreSlider.addEventListener('input', () => {
                                scoreValueDisplay.textContent = scoreSlider.value;
                        });
                });
        }
        // 新建一个函数来渲染已保存的CSS预设按钮
        function renderCssPresets(activeCss) {
                cssPresetsContainer.innerHTML = '';
                if (customCssPresets.length > 0) {
                        const title = document.createElement('label');
                        title.className = 'block text-sm font-medium text-gray-700';
                        title.textContent = '应用样式预设';
                        cssPresetsContainer.appendChild(title);

                        const buttonGroup = document.createElement('div');
                        buttonGroup.className = 'flex flex-wrap gap-2';

                        customCssPresets.forEach(preset => {
                                const btnWrapper = document.createElement('div');
                                btnWrapper.className = 'relative group';

                                const btn = document.createElement('button');
                                btn.textContent = preset.name;
                                btn.className = 'text-xs secondary-btn px-2 py-1 rounded-md transition-colors';

                                // 检查当前应用的CSS是否与预设的CSS完全相同
                                if (activeCss && activeCss.trim() === preset.cssCode.trim()) {
                                        btn.style.backgroundColor = 'var(--theme-color)';
                                        btn.style.color = 'white';
                                        btn.style.borderColor = 'var(--theme-color)';
                                }

                                btn.addEventListener('click', () => {
                                        customBubbleCssInput.value = preset.cssCode;
                                        customBubbleCssInput.dispatchEvent(new Event('input'));
                                        renderCssPresets(preset.cssCode);
                                });

                                const deleteBtn = document.createElement('button');
                                deleteBtn.innerHTML = '&times;';
                                deleteBtn.className = 'absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs hidden group-hover:flex items-center justify-center';
                                deleteBtn.title = '删除此预设';
                                deleteBtn.addEventListener('click', async () => {
                                        const confirmed = await showConfirmModal(
                                                '删除样式预设',
                                                `确定要删除样式预设 "${preset.name}" 吗？`,
                                                '删除',
                                                '取消'
                                        );
                                        if (confirmed) {
                                                await db.bubbleCssPresets.delete(preset.name);
                                                await loadAndRenderCssPresets();
                                        }
                                });

                                btnWrapper.appendChild(btn);
                                btnWrapper.appendChild(deleteBtn);
                                buttonGroup.appendChild(btnWrapper);
                        });
                        cssPresetsContainer.appendChild(buttonGroup);
                }
        }


        // 新建一个函数来处理AI生成CSS的逻辑
        async function handleGenerateCss() {
                const promptText = aiBubblePromptInput.value.trim();
                if (!promptText) {
                        showToast('请输入您想要的样式描述！', 'error');
                        return;
                }

                generateCssBtn.textContent = '生成中...';
                generateCssBtn.disabled = true;

                const currentCss = customBubbleCssInput.value.trim();


                // 从数据库获取当前激活的API配置
                const apiConfig = await getActiveApiProfile();
                if (!apiConfig) {
                        showToast('请先在设置中配置API！', 'error');
                        generateCssBtn.textContent = '生成';
                        generateCssBtn.disabled = false;
                        return;
                }

                const systemPrompt = `
You are an expert CSS code generator for a chat application. Your task is to generate or modify CSS code to style message elements based on a user's request.

Here is the HTML structure of a message. You can target any of these classes:

<div class="message-wrapper user"> <img class="avatar" src="...">
    <div class="message-content-column">
        <div class="chat-bubble user-bubble"> <div class="quoted-message">...</div>
            </div>
    </div>
    <span class="timestamp">12:34</span>
</div>

**Available Selectors:**
- \`.message-wrapper\`: The container for the entire message line.
- \`.avatar\`: The avatar's container (the frame), NOT the image content itself. You can style its border, padding, box-shadow, border-radius, etc.
- \`.chat-bubble\`: Styles both user and AI bubbles.
- \`.user-bubble\`: Targets ONLY the user's bubble.
- \`.ai-bubble\`: Targets ONLY the AI's bubble.
- \`.timestamp\`: The small text showing the time.
- \`.quoted-message\`: The container for a replied-to message.
- \`.message-content-column .text-xs.text-gray-500\`: The sender's name in group chats.

**Available Theme CSS Variables (Highly Recommended):**
- \`var(--user-bubble-bg)\`, \`var(--user-bubble-text)\`
- \`var(--ai-bubble-bg)\`, \`var(--ai-bubble-text)\`
- \`var(--accent-color)\`

${currentCss ? `
**Current CSS Code (for modification):**
\`\`\`css
${currentCss}
\`\`\`
` : ''}

**User's Request:** "${promptText}"

**IMPORTANT RULES:**
1.  Your response MUST be **raw CSS code ONLY**.
2.  If modifying, provide the **complete, updated stylesheet**.
3.  Do NOT include any explanations, comments, or markdown like \`\`\`css.
    `;

                try {
                        const generatedCss = await callApi(systemPrompt, [], { temperature: 0.5 }, 'text');

                        customBubbleCssInput.value = generatedCss;
                        // 手动触发 input 事件来更新实时预览
                        customBubbleCssInput.dispatchEvent(new Event('input'));
                        renderCssPresets(generatedCss);

                } catch (error) {
                        console.error("AI生成CSS失败:", error);
                        showToast(`生成失败: ${error.message}`, 'error');
                } finally {
                        generateCssBtn.textContent = '生成';
                        generateCssBtn.disabled = false;
                }
        }

        // 保存CSS预设的逻辑
        async function handleSaveCssPreset() {
                const cssCode = customBubbleCssInput.value.trim();
                if (!cssCode) {
                        showToast('没有可保存的CSS样式。', 'error');
                        return;
                }

                const presetName = await promptForInput("为这个样式预设起个名字：", "例如：可爱，简约", false, false);
                if (!presetName || !presetName.trim()) {
                        if (presetName !== null) showToast("名字不能为空！", 'error');
                        return;
                }

                try {
                        await db.bubbleCssPresets.add({ name: presetName.trim(), cssCode });
                        showToast('样式预设已保存！', 'success');
                        // 重新加载并渲染预设列表
                        await loadAndRenderCssPresets();
                } catch (error) {
                        if (error.name === 'ConstraintError') {
                                showToast(`这个名字 “${presetName.trim()}” 已经被占用了，换一个吧！`, 'error');
                        } else {
                                console.error("保存CSS预设失败:", error);
                                showToast("保存失败，详情请看控制台。", 'error');
                        }
                }
        }

        async function loadVoiceSettings(voiceConfig) {
                const profiles = await db.ttsProfiles.toArray();
                ttsProfileSelect.innerHTML = '<option value="">不使用语音</option>';
                if (profiles.length === 0) {
                        ttsProfileSelect.disabled = true;
                        return;
                }

                profiles.forEach(p => {
                        const option = document.createElement('option');
                        option.value = p.id;
                        option.textContent = p.profileName;
                        if (voiceConfig && p.id === voiceConfig.profileId) {
                                option.selected = true;
                        }
                        ttsProfileSelect.appendChild(option);
                });

                if (voiceConfig && voiceConfig.profileId) {
                        await fetchAndPopulateVoices(voiceConfig.profileId, voiceConfig.voiceId);
                }
        }

        // --- 获取并填充声音列表 ---
        async function fetchAndPopulateVoices(profileId, selectedVoiceId = null) {
                ttsVoiceSelect.innerHTML = '<option value="">加载中...</option>';
                ttsVoiceSelect.disabled = true;

                if (!profileId) {
                        ttsVoiceSelect.innerHTML = '<option value="">请先选择方案</option>';
                        return;
                }

                try {
                        const profile = await db.ttsProfiles.get(parseInt(profileId));
                        if (!profile || !profile.apiKey) throw new Error("API Key not found");

                        // 使用代理URL来避免CORS问题
                        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
                                headers: { 'xi-api-key': profile.apiKey }
                        });

                        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);

                        const data = await response.json();
                        ttsVoiceSelect.innerHTML = '<option value="">请选择声音</option>';
                        data.voices.forEach(voice => {
                                const option = document.createElement('option');
                                option.value = voice.voice_id;
                                option.textContent = `${voice.name} (${voice.labels.gender}, ${voice.labels.age})`;
                                if (voice.voice_id === selectedVoiceId) {
                                        option.selected = true;
                                }
                                ttsVoiceSelect.appendChild(option);
                        });
                        ttsVoiceSelect.disabled = false;

                } catch (error) {
                        console.error("Failed to fetch voices:", error);
                        showToast("获取声音列表失败，请检查API Key和网络。", 'error');
                        ttsVoiceSelect.innerHTML = '<option value="">获取失败</option>';
                }
        }
        function setupCollapsibleSection(headerId, contentId, defaultOpen = false) {
                const header = document.getElementById(headerId);
                const content = document.getElementById(contentId);
                const icon = header.querySelector('svg');

                if (!header || !content || !icon) return;

                // 设置初始状态
                if (defaultOpen) {
                        content.classList.remove('hidden');
                        icon.classList.add('rotate-180');
                } else {
                        content.classList.add('hidden');
                        icon.classList.remove('rotate-180');
                }

                // 添加点击事件
                header.addEventListener('click', () => {
                        content.classList.toggle('hidden');
                        icon.classList.toggle('rotate-180');
                });
        }


    // --- Event Listeners ---
    customBubbleCssInput.addEventListener('input', () => applyLiveCssPreview(customBubbleCssInput.value));
    document.getElementById('save-custom-theme-btn').addEventListener('click', saveCustomTheme);

    generateCssBtn.addEventListener('click', handleGenerateCss);
    saveCssPresetBtn.addEventListener('click', handleSaveCssPreset);

    Object.values(colorInputs).forEach(input => {
        if(input) input.addEventListener('input', () => {
            const customColors = {
                aiBg: colorInputs.aiBg.value, aiText: colorInputs.aiText.value,
                userBg: colorInputs.userBg.value, userText: colorInputs.userText.value
            };
            renderThemePreview(customColors);
        });
    });
    saveBtn.addEventListener('click', saveChanges);
    document.getElementById('group-select').addEventListener('change', async (event) => {
        const select = event.target;
        if (select.value === 'new_group') {
            // 1. 暂存当前选择，以便用户取消时恢复
            const previousGroupId = chatData.groupId;

            const newGroupName = await promptForInput("请输入新的分组名：", "例如：我的新分组", false, false);

            if (newGroupName && newGroupName.trim()) {
                // 2. 检查分组名是否已存在
                const existing = await db.xzoneGroups.where('name').equals(newGroupName.trim()).first();
                if (existing) {
                    showToast(`分组 "${newGroupName.trim()}" 已经存在了！`, 'error');
                    select.value = previousGroupId || ""; // 恢复之前的选择
                    return;
                }
                // 3. 创建新分组并保存
                const newGroupId = await db.xzoneGroups.add({ name: newGroupName.trim() });

                // 3.1 自动创建对应的编年史世界书
                const chronicleName = `${newGroupName.trim()}编年史`;
                const newBook = {
                    id: 'wb_' + Date.now(), // 使用时间戳确保ID唯一
                    name: chronicleName,
                    content: ``
                };
                await db.worldBooks.add(newBook);

                // 3.2 将新创建的世界书ID绑定到新分组上
                await db.xzoneGroups.update(newGroupId, { worldBookIds: [newBook.id] });
                
                // 4. 刷新下拉菜单并自动选中新创建的分组
                await refreshGroupSelect(newGroupId); 
                
                // 确保新创建的分组被选中
                setTimeout(() => {
                     document.getElementById('group-select').value = newGroupId;
                }, 0);
    
            } else {
                // 如果用户取消或输入为空，则恢复之前的选择
                select.value = previousGroupId || "";
            }
        }
        renderRelationshipEditor(parseInt(select.value) || null);
    });

    changeAvatarBtn.addEventListener('click', openCharAvatarPicker);
    
    blockBtn.addEventListener('click', async () => {
        if (!chatData) return;

        const confirmed = await showConfirmModal(
            '拉黑确认',
            `确定要拉黑 “${chatData.name}” 吗？\n拉黑后您将无法向其发送消息，直到您将Ta移出黑名单。`,
            '拉黑',
            '取消'
        );
        if (confirmed) {
            chatData.blockStatus = {
                status: 'blocked_by_user',
                timestamp: Date.now()
            };
                
            await db.chats.put(chatData);
            showToastOnNextPage(`“${chatData.name}” 已被拉黑。`);
            window.location.href = `charProfile.html?id=${charId}`;
        }
    });

    clearHistoryBtn.addEventListener('click', async () => {
        if (!chatData) return;
        const confirmed = await showConfirmModal(
            '清空聊天记录',
            `此操作不可撤销！\n确定要永久删除与 “${chatData.name}” 的所有聊天记录吗？`,
            '删除',
            '取消'
        );
        if (confirmed) {
                chatData.history = [];
                chatData.lastMessageTimestamp = null;
                chatData.lastMessageContent = null;
                await db.chats.put(chatData);
                showToast('聊天记录已清空！');
        }
    });

    // delete char
    const deleteBtn = document.getElementById('delete-char-btn');

    // 为删除按钮添加点击事件
    deleteBtn.addEventListener('click', async () => {
        if (!chatData) return;
    
        let confirmationPrompt;
        let successMessage;
    
        if (chatData.isGroup) {
            confirmationPrompt = `此操作不可恢复！\n\n您确定要删除并退出群聊 “${chatData.name}” 吗？\n群聊记录和设置都将被清除。\n\n请输入群聊名称 “${chatData.name}” 来确认删除：`;
            successMessage = `群聊 “${chatData.name}” 已被成功删除。`;
        } else {
            confirmationPrompt = `此操作不可恢复！\n\n您确定要永久删除 “${chatData.name}” 吗？\n所有聊天记录、动态、回忆、人际关系等数据都将被清除。\n\n请输入角色备注名 “${chatData.name}” 来确认删除：`;
            successMessage = `角色 “${chatData.name}” 已被成功删除。`;
        }

        const confirmation = await promptForInput(confirmationPrompt, `${chatData.name}`, false, false);

        if (confirmation === chatData.name) {
            try {
                // --- 使用事务进行级联删除 ---
                await db.transaction('rw', db.chats, db.xzonePosts, db.relationships, db.memories, db.favorites, db.callLogs, db.diaries, async () => {
                    const idToDelete = chatData.id;

                    // 1. 删除角色/群聊本身
                    await db.chats.delete(idToDelete);

                    // 2. 如果是单人角色，则删除其所有相关数据
                    if (!chatData.isGroup) {
                        // 删除该角色发布的所有动态
                        await db.xzonePosts.where('authorId').equals(idToDelete).delete();
                        
                        // 删除该角色的所有人际关系 (作为源头或目标的)
                        await db.relationships.where('sourceCharId').equals(idToDelete).delete();
                        await db.relationships.where('targetCharId').equals(idToDelete).delete();
                        
                        // 删除该角色的所有回忆
                        await db.memories.where('chatId').equals(idToDelete).delete();
                        await db.diaries.where('authorId').equals(idToDelete).delete();

                        // 删除与该角色聊天相关的收藏
                        await db.favorites.where('chatId').equals(idToDelete).delete();
                        
                        // 删除该角色发布的动态的收藏
                        const postsToDelete = await db.xzonePosts.where('authorId').equals(idToDelete).primaryKeys();
                        await db.favorites.where('type').equals('xzone_post').and(fav => postsToDelete.includes(fav.content.id)).delete();

                        // 删除与该角色的所有通话记录
                        await db.callLogs.where('charId').equals(idToDelete).delete();

                        // 从群聊中移除该角色
                        await db.chats.where('isGroup').equals(1).modify(group => {
                                if (group.members && group.members.includes(idToDelete)) {
                                        group.members = group.members.filter(memberId => memberId !== idToDelete);
                                }
                        });
                    }
                    // 对于群聊，目前我们只删除群聊本身，成员角色保留。
                });

                showToastOnNextPage(successMessage);
                window.location.href = 'contacts.html';

            } catch (error) {
                console.error("删除失败:", error);
                showToast("删除过程中发生错误，请查看控制台。", 'error');
            }
        } else if (confirmation !== null) {
            showToast("输入的名称不匹配，删除操作已取消。", 'error');
        }
    });

        ttsProfileSelect.addEventListener('change', (e) => { 
                fetchAndPopulateVoices(e.target.value);
        });

        // 选择背景图片

    document.getElementById('select-bg-from-album-btn').addEventListener('click', async () => {
        const selectedUrl = await showAlbumPickerModal();
        if (selectedUrl) {
            document.getElementById('background-url-input').value = selectedUrl;
            // 你也可以在这里添加一个预览效果，但这步是可选的
        }
    });
        setupCollapsibleSection('world-book-header', 'world-book-content');
        setupCollapsibleSection('relationship-header', 'relationship-content');
    

    // --- Init ---
 
    if (isNew) {
        document.querySelector('h1').textContent = '创建新角色'; // Change header title
        initializeNewCharacter();
    } else if (charId) {
        loadData(); // This function is now for existing characters only
    } else {
        showToastOnNextPage('无效的链接，缺少必要参数。', 'error');
        window.location.href = 'contacts.html';
    }
});