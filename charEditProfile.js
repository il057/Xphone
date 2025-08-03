// settings.js
// Import the shared database instance from db.js
import { db, uploadImage } from './db.js'; 
import { showUploadChoiceModal, showImagePickerModal, showAlbumPickerModal, promptForInput } from './ui-helpers.js'; // 导入三个助手

document.addEventListener('DOMContentLoaded', async () => {
    // --- DB & State ---

    const urlParams = new URLSearchParams(window.location.search);
    const isNew = urlParams.get('isNew') === 'true';
    const charId = isNew ? null : urlParams.get('id'); // Only get charId if not new
    const prefilledName = urlParams.get('name') || '';
    let chatData;
    let customPresets = []; // 用于存储从数据库加载的自定义预设
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
    }

    async function loadData() {
        if (!charId) {
            alert('无效的编辑链接');
            window.location.href = 'chat.html';
            return;
        }
        
        chatData = await db.chats.get(charId);
        
        if (!chatData) {
            alert('数据不存在');
            window.location.href = 'chat.html';
            return;
        }

        customPresets = await db.bubbleThemePresets.toArray();
        if (!chatData.settings) chatData.settings = {};
    
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
        }
        await applyPageTheme(chatData); 
        await loadWorldBooks(chatData.settings.worldBookId);
        customBubbleCssInput.value = chatData.settings.customBubbleCss || '';
       
    }

    async function loadWorldBooks(selectedBookId) {
        const books = await db.worldBooks.toArray();
        worldBookSelect.innerHTML = '<option value="">不使用</option>'; // 重置
        books.forEach(book => {
            const option = document.createElement('option');
            option.value = book.id;
            option.textContent = book.name;
            if (book.id === selectedBookId) {
                option.selected = true;
            }
            worldBookSelect.appendChild(option);
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
                if (confirm(`确定要删除预设 “${preset.name}” 吗？此操作不可恢复。`)) {
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
        const presetName = prompt("为你的自定义方案起个名字吧：");
        if (!presetName || !presetName.trim()) {
            if (presetName !== null) alert("名字不能为空哦！");
            return;
        }

        // 检查名称是否与默认主题或已保存的自定义主题冲突
        const isNameTaken = bubbleThemes.some(t => t.name === presetName.trim()) || customPresets.some(p => p.name === presetName.trim());
        if (isNameTaken) {
            alert(`这个名字 “${presetName.trim()}” 已经被占用了，换一个吧！`);
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
        alert('保存成功！现在可以在所有角色编辑页使用这个方案了。');
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
        if (confirm(`确定要删除头像 “${avatarToDelete.name}” 吗？`)) {
            // 使用唯一的 ID 来精确查找和删除
            const indexToDelete = chatData.settings.aiAvatarLibrary.findIndex(avatar => avatar.id === avatarToDelete.id);

            if (indexToDelete > -1) {
                chatData.settings.aiAvatarLibrary.splice(indexToDelete, 1);
                alert('头像已删除。记得点击页面顶部的“保存”按钮来保存所有更改。');
                await openCharAvatarPicker(); // 重新打开选择器以刷新列表
            } else {
                alert('未找到要删除的头像，可能已被移除。');
            }
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
                alert("请先在“设置”页面配置 Cloudinary！");
                return;
            }
            try {
                imageUrl = await uploadImage(choice.value);
            } catch (error) { return; }
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
            alert('这个名字已经存在了，请换一个。');
            return;
        }

        // 为新头像添加唯一的ID
        const newAvatar = {
            id: `char_avatar_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: name,
            url: url
        };
        chatData.settings.aiAvatarLibrary.push(newAvatar);

        alert('新头像已添加！记得点击页面顶部的“保存”按钮来保存所有更改。');
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
    
        const checkedBooks = document.querySelectorAll('#world-book-dropdown input[type="checkbox"]:checked');
        const selectedWorldBookIds = Array.from(checkedBooks).map(cb => cb.value);

        const sharedSettings = {
            background: backgroundUrlInput.value.trim(),
            theme: themeSetting,
            maxMemory: parseInt(document.getElementById('max-memory-input').value) || 10,
            worldBookIds: selectedWorldBookIds, // 保存新的ID数组
            worldBookId: worldBookSelect.value,
            customBubbleCss: customBubbleCssInput.value.trim()
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
                alert('角色创建成功！');
                window.location.href = `charProfile.html?id=${finalCharId}`;
            } catch (error) {
                console.error("Failed to create new character:", error);
                alert("创建失败，请稍后再试。");
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
                alert('群聊资料保存成功！');
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
                alert('保存成功！');
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

    // --- Event Listeners ---
    customBubbleCssInput.addEventListener('input', () => applyLiveCssPreview(customBubbleCssInput.value));
    document.getElementById('save-custom-theme-btn').addEventListener('click', saveCustomTheme);

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
    
            const newGroupName = prompt("请输入新的分组名：");
    
            if (newGroupName && newGroupName.trim()) {
                // 2. 检查分组名是否已存在
                const existing = await db.xzoneGroups.where('name').equals(newGroupName.trim()).first();
                if (existing) {
                    alert(`分组 "${newGroupName.trim()}" 已经存在了！`);
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
        const confirmed = confirm(`确定要拉黑 “${chatData.name}” 吗？\n拉黑后您将无法向其发送消息，直到您将Ta移出黑名单。`);
        if (confirmed) {
            chatData.blockStatus = {
                status: 'blocked_by_user',
                timestamp: Date.now()
            };
                
            await db.chats.put(chatData);
            alert(`“${chatData.name}” 已被拉黑。`);
            window.location.href = `charProfile.html?id=${charId}`;
        }
    });

    clearHistoryBtn.addEventListener('click', async () => {
        if (!chatData) return;
        const confirmed = confirm(`此操作不可撤销！\n确定要永久删除与 “${chatData.name}” 的所有聊天记录吗？`);
        if (confirmed) {
            chatData.history = [];
            await db.chats.put(chatData);
            alert('聊天记录已清空！');
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
    
        const confirmation = prompt(confirmationPrompt);
    
        if (confirmation === chatData.name) {
            try {
                // --- 使用事务进行级联删除 ---
                await db.transaction('rw', db.chats, db.xzonePosts, db.relationships, db.memories, db.favorites, async () => {
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

                        // 删除与该角色聊天相关的收藏
                        await db.favorites.where('chatId').equals(idToDelete).delete();
                        
                        // 删除该角色发布的动态的收藏
                        const postsToDelete = await db.xzonePosts.where('authorId').equals(idToDelete).primaryKeys();
                        await db.favorites.where('type').equals('xzone_post').and(fav => postsToDelete.includes(fav.content.id)).delete();

                        // 删除与该角色的所有通话记录
                        await db.callLogs.where('charId').equals(idToDelete).delete();
                    }
                    // 对于群聊，目前我们只删除群聊本身，成员角色保留。
                });

                alert(successMessage);
                window.location.href = 'contacts.html';

            } catch (error) {
                console.error("删除失败:", error);
                alert("删除过程中发生错误，请查看控制台。");
            }
        } else if (confirmation !== null) {
            alert("输入的名称不匹配，删除操作已取消。");
        }
    });

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

    document.getElementById('select-bg-from-album-btn').addEventListener('click', async () => {
        const selectedUrl = await showAlbumPickerModal();
        if (selectedUrl) {
            document.getElementById('background-url-input').value = selectedUrl;
            // 你也可以在这里添加一个预览效果，但这步是可选的
        }
    });
        

    // --- Init ---
 
    if (isNew) {
        document.querySelector('h1').textContent = '创建新角色'; // Change header title
        initializeNewCharacter();
    } else if (charId) {
        loadData(); // This function is now for existing characters only
    } else {
        alert('无效的链接，缺少必要参数。');
        window.location.href = 'contacts.html';
    }
});