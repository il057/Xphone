import { db } from './db.js';
import { showAlbumPickerModal } from './ui-helpers.js';
import { applyThemeMode } from './applyGlobalStyles.js';
import { showToast, promptForInput, showConfirmModal } from './ui-helpers.js';

document.addEventListener('DOMContentLoaded', () => {
        // --- DB & State ---
        let state = {
                globalSettings: {},
                gradientWallpaperPresets: [],
                topologyWallpaperPresets: [] 
        };

        let vantaEffect = null; // To hold the Vanta.js instance
        let currentWallpaperValue = '';
        let currentThemeColor = '#3b82f6';
        let longPressTimer = null;
        let longPressJustFinished = false;

        // Caching last known configurations for each mode
        let lastImageConfig = { wallpaper: '', theme: '#3b82f6' };
        let lastGradientConfig = { wallpaper: 'linear-gradient(to top, #a18cd1, #fbc2eb)', theme: '#9333ea' };
        // Default topology config, inspired by the screenshot
        let lastTopologyConfig = { wallpaper: 'topology(#222222,#89964e)', theme: '#89964e' };


        // --- DOM Elements ---
        const saveAllBtn = document.getElementById('save-all-btn');
        const fontUrlInput = document.getElementById('font-url-input');
        const fontPreviewBox = document.getElementById('font-preview');
        const resetFontBtn = document.getElementById('reset-font-btn');
        const preview = document.getElementById('wallpaper-preview');
        const wallpaperModeRadios = document.querySelectorAll('input[name="wallpaper-mode"]');
        const imageModeSettings = document.getElementById('image-mode-settings');
        const gradientModeSettings = document.getElementById('gradient-mode-settings');
        const topologyModeSettings = document.getElementById('topology-mode-settings'); // new ID
        const urlInput = document.getElementById('wallpaper-url');
        const imageThemeColorPicker = document.getElementById('image-theme-color-picker');

        // Generic preset configuration object
        const presetConfig = {
                gradient: {
                        container: document.getElementById('preset-container'),
                        customMaker: document.getElementById('custom-color-maker'),
                        color1: document.getElementById('color1'),
                        color2: document.getElementById('color2'),
                        themePicker: document.getElementById('theme-color-picker'),
                        savePresetBtn: document.getElementById('save-custom-preset')
                },
                topology: {
                        container: document.getElementById('topology-preset-container'),
                        customMaker: document.getElementById('topology-custom-color-maker'),
                        color1: document.getElementById('topology-color1'),
                        color2: document.getElementById('topology-color2'),
                        themePicker: document.getElementById('topology-theme-color-picker'),
                        savePresetBtn: document.getElementById('save-topology-preset-btn')
                }
        };

        // ... (The rest of the initial DOM element selections and style tag creation)
        const selectFromAlbumBtn = document.getElementById('select-from-album-btn');
        const applyUrlBtn = document.getElementById('apply-wallpaper-url');
        const presetContainer = document.getElementById('preset-container');
        const color1Input = document.getElementById('color1');
        const color2Input = document.getElementById('color2');
        const themeColorPicker = document.getElementById('theme-color-picker');

        // Topology mode inputs
        const topologyColor1Input = document.getElementById('topology-color1');
        const topologyColor2Input = document.getElementById('topology-color2');
        const topologyThemeColorPicker = document.getElementById('topology-theme-color-picker');

        // --- Functions ---

        /**
         * Applies the custom font to the page body and preview box.
         * @param {string} fontUrl - The URL of the font file.
         * @param {boolean} isPreviewOnly - If true, only applies to the preview box.
         */
        function applyFontForPreview(fontUrl) {
                if (!fontUrl) {
                        fontPreviewBox.style.fontFamily = '';
                        return;
                }
                const fontName = 'preview-user-font';
                let styleTag = document.getElementById('preview-font-style');
                if (!styleTag) {
                        styleTag = document.createElement('style');
                        styleTag.id = 'preview-font-style';
                        document.head.appendChild(styleTag);
                }
                styleTag.textContent = `
            @font-face {
                font-family: '${fontName}';
                src: url('${fontUrl}');
                font-display: swap;
            }`;
                fontPreviewBox.style.fontFamily = `'${fontName}', 'Inter', sans-serif`;
        }

        /**
         * Loads all settings from the database and updates the UI.
         */
        async function loadSettings() {
                const settings = await db.globalSettings.get('main');
                state.globalSettings = settings || { id: 'main' };

                state.gradientWallpaperPresets = state.globalSettings.wallpaperPresets || [];
                // Load topology presets from the new property
                state.topologyWallpaperPresets = state.globalSettings.topologyWallpaperPresets || [];

                const themeMode = state.globalSettings.themeMode || 'auto';
                document.querySelector(`input[name="theme-mode"][value="${themeMode}"]`).checked = true;

                const savedWallpaper = state.globalSettings.wallpaper || lastGradientConfig.wallpaper;
                const savedThemeColor = state.globalSettings.themeColor || '#3b82f6';

                let currentMode = 'gradient'; // Default
                if (savedWallpaper.startsWith('url(')) {
                        currentMode = 'image';
                        lastImageConfig = { wallpaper: savedWallpaper, theme: savedThemeColor };
                        urlInput.value = savedWallpaper.slice(5, -2);
                        imageThemeColorPicker.value = savedThemeColor;
                } else if (savedWallpaper.startsWith('topology(')) { // Check for topology
                        currentMode = 'topology';
                        lastTopologyConfig = { wallpaper: savedWallpaper, theme: savedThemeColor };
                        const colors = savedWallpaper.match(/#([0-9a-f]{6})/gi);
                        if (colors && colors.length === 2) {
                                topologyColor1Input.value = colors[0];
                                topologyColor2Input.value = colors[1];
                        }
                        topologyThemeColorPicker.value = savedThemeColor;
                } else { // Gradient
                        lastGradientConfig = { wallpaper: savedWallpaper, theme: savedThemeColor };
                }

                document.querySelector(`input[name="wallpaper-mode"][value="${currentMode}"]`).checked = true;
                switchWallpaperModeUI(currentMode);

                renderPresets('gradient');
                renderPresets('topology'); // Render topology presets

                updateWallpaperPreview(savedWallpaper);
                applyThemeColor(savedThemeColor);
                setActiveSwatch(savedWallpaper);

                fontUrlInput.value = state.globalSettings.fontUrl || '';
                applyFontForPreview(state.globalSettings.fontUrl);
        }

        async function saveAllSettingsToDB() {
                saveAllBtn.textContent = '保存中...';
                saveAllBtn.disabled = true;

                const activeMode = document.querySelector('input[name="wallpaper-mode"]:checked').value;

                try {
                        const settingsToSave = state.globalSettings;
                        const selectedThemeMode = document.querySelector('input[name="theme-mode"]:checked').value;

                        switch (activeMode) {
                                case 'image':
                                        settingsToSave.wallpaper = `url("${urlInput.value.trim()}")`;
                                        settingsToSave.themeColor = imageThemeColorPicker.value;
                                        break;
                                case 'topology': // Save topology settings
                                        settingsToSave.wallpaper = `topology(${topologyColor1Input.value},${topologyColor2Input.value})`;
                                        settingsToSave.themeColor = topologyThemeColorPicker.value;
                                        break;
                                case 'gradient':
                                default:
                                        settingsToSave.wallpaper = currentWallpaperValue;
                                        settingsToSave.themeColor = currentThemeColor;
                                        break;
                        }

                        settingsToSave.fontUrl = fontUrlInput.value.trim();
                        settingsToSave.wallpaperPresets = state.gradientWallpaperPresets;
                        settingsToSave.topologyWallpaperPresets = state.topologyWallpaperPresets; // Save topology presets
                        settingsToSave.themeMode = selectedThemeMode;

                        await db.globalSettings.put(settingsToSave);
                        localStorage.setItem('xphone-theme-mode', selectedThemeMode);
                        await applyThemeMode();
                        presetContainer.classList.remove('edit-mode');
                        presetConfig.topology.container.classList.remove('edit-mode');
                        showToast('个性化设置已保存！');

                } catch (error) {
                        console.error("保存设置失败:", error);
                        showToast("保存失败: " + error.message, 'error');
                } finally {
                        saveAllBtn.textContent = '保存';
                        saveAllBtn.disabled = false;
                }
        }

        // --- Other UI and Helper Functions ---
        const defaultPresets = [
                { name: '紫霞', gradient: ['#a18cd1', '#fbc2eb'], theme: '#9333ea' },
                { name: '清新', gradient: ['#84fab0', '#8fd3f4'], theme: '#0ea5e9' },
                { name: '暖阳', gradient: ['#ffecd2', '#fcb69f'], theme: '#f97316' },
                { name: '深海', gradient: ['#2E3192', '#1BFFFF'], theme: '#1BFFFF' },
                { name: '甜桃', gradient: ['#ff9a9e', '#fecfef'], theme: '#f43f5e' },
        ];

        const defaultTopologyPresets = [
                { name: 'Matrix', gradient: ['#222222', '#89964e'], theme: '#89964e' },
                { name: '星空', gradient: ['#000000', '#ffffff'], theme: '#ffffff' },
                { name: '海洋', gradient: ['#002b4d', '#00c6ff'], theme: '#00c6ff' },
                { name: '日落', gradient: ['#581c87', '#ff7e5f'], theme: '#ff7e5f' }
        ];

        /**
        * Generic preset rendering function
        * @param {'gradient' | 'topology'} type - The type of preset
        */
        function renderPresets(type) {
                const config = presetConfig[type];
                const presets = state[type + 'WallpaperPresets'];

                config.container.innerHTML = ''; // 清空容器

                // 确定要使用的默认预设列表
                const defaultList = type === 'gradient' ? defaultPresets : defaultTopologyPresets;

                // 渲染系统默认预设
                defaultList.forEach(preset => {
                        const previewBg = `linear-gradient(to top, ${preset.gradient[0]}, ${preset.gradient[1]})`;
                        // Generate the correct style value string
                        const styleValue = type === 'topology'
                                ? `topology(${preset.gradient[0]},${preset.gradient[1]})`
                                : `linear-gradient(to top, ${preset.gradient[0]}, ${preset.gradient[1]})`;

                        const swatch = createSwatch(styleValue, previewBg, preset.theme);
                        config.container.appendChild(swatch);
                });

                // 渲染用户自定义预设
                presets.forEach((preset, index) => {
                        const swatchWrapper = document.createElement('div');
                        swatchWrapper.className = 'relative';

                        const styleValue = type === 'topology'
                                ? `topology(${preset.gradient[0]},${preset.gradient[1]})`
                                : `linear-gradient(to top, ${preset.gradient[0]}, ${preset.gradient[1]})`;

                        const previewBg = `linear-gradient(to top, ${preset.gradient[0]}, ${preset.gradient[1]})`;

                        const swatch = createSwatch(styleValue, previewBg, preset.theme, index);

                        const deleteBtn = document.createElement('div');
                        deleteBtn.className = 'delete-btn';
                        deleteBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-circle-fill" viewBox="0 0 16 16">
            <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293z"/>
            </svg>`;
                        deleteBtn.title = '删除预设';

                        swatchWrapper.appendChild(swatch);
                        swatchWrapper.appendChild(deleteBtn);
                        config.container.appendChild(swatchWrapper);
                });

                // 创建自定义按钮
                const customButton = createCustomButton(type);
                config.container.appendChild(customButton);
        }

        function createCustomButton(type) {
                const wrapper = document.createElement('div');
                wrapper.className = 'relative';
                const button = document.createElement('div');
                button.className = 'custom-btn h-12 rounded-lg cursor-pointer border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors';
                button.dataset.type = type; // 标记类型
                button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-gear" viewBox="0 0 16 16">
            <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0"/>
            <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115z"/>
        </svg>`;
                wrapper.appendChild(button);
                return wrapper;
        }

        /**
     * 创建色板的通用函数
     */
        function createSwatch(styleValue, background, theme, index = -1) {
                const swatch = document.createElement('div');
                swatch.className = 'swatch h-12 rounded-lg cursor-pointer border-2 border-transparent transition-all';
                swatch.style.background = background;
                swatch.dataset.wallpaper = styleValue;
                swatch.dataset.theme = theme;
                if (index > -1) { // 只有自定义预设才有 index
                        swatch.dataset.index = index;
                }
                return swatch;
        }


        function applyThemeColor(color) {
                currentThemeColor = color;
                const root = document.documentElement;
                root.style.setProperty('--theme-color', color);
                const hoverColor = shadeColor(color, -20);
                root.style.setProperty('--theme-color-hover', hoverColor);
        }

        function shadeColor(color, percent) {
                let R = parseInt(color.substring(1, 3), 16);
                let G = parseInt(color.substring(3, 5), 16);
                let B = parseInt(color.substring(5, 7), 16);
                R = parseInt(R * (100 + percent) / 100);
                G = parseInt(G * (100 + percent) / 100);
                B = parseInt(B * (100 + percent) / 100);
                R = (R < 255) ? R : 255;
                G = (G < 255) ? G : 255;
                B = (B < 255) ? B : 255;
                const RR = ((R.toString(16).length == 1) ? "0" + R.toString(16) : R.toString(16));
                const GG = ((G.toString(16).length == 1) ? "0" + G.toString(16) : G.toString(16));
                const BB = ((B.toString(16).length == 1) ? "0" + B.toString(16) : B.toString(16));
                return "#" + RR + GG + BB;
        }


        /**
         * Switch UI based on the selected wallpaper mode
         */
        function switchWallpaperModeUI(mode) {
                imageModeSettings.classList.toggle('hidden', mode !== 'image');
                gradientModeSettings.classList.toggle('hidden', mode !== 'gradient');
                topologyModeSettings.classList.toggle('hidden', mode !== 'topology'); // Use topology settings
        }


        function updateWallpaperPreview(style) {
                if (!style || typeof style !== 'string') return;
                currentWallpaperValue = style;

                // Destroy previous Vanta instance if it exists to prevent conflicts
                if (vantaEffect) {
                        vantaEffect.destroy();
                        vantaEffect = null;
                }

                preview.style.backgroundImage = 'none';
                preview.style.backgroundColor = 'transparent';

                if (style.startsWith('topology(')) {
                        const colors = style.match(/#([0-9a-f]{6}|[0-9a-f]{3})/gi);
                        if (colors && colors.length === 2 && typeof VANTA !== 'undefined') {
                                vantaEffect = VANTA.TOPOLOGY({
                                        el: "#wallpaper-preview",
                                        mouseControls: true,
                                        touchControls: true,
                                        gyroControls: false,
                                        minHeight: 200.00,
                                        minWidth: 200.00,
                                        scale: 1.00,
                                        scaleMobile: 1.00,
                                        backgroundColor: colors[0],
                                        color: colors[1]
                                });
                        }
                } else if (style.startsWith('url(') || style.startsWith('linear-gradient')) {
                        preview.style.backgroundImage = style;
                } else {
                        preview.style.backgroundColor = style;
                }
        }

        function setActiveSwatch(style) {
                document.querySelectorAll('.active-swatch').forEach(el => el.classList.remove('active-swatch'));
                if (style && !style.startsWith('url')) {
                        // 现在它会同时在两个容器里查找
                        const swatch = document.querySelector(`[data-wallpaper="${style}"]`);
                        if (swatch) swatch.classList.add('active-swatch');
                }
        }

        /**
       * Handles live changes from the custom color pickers for a smooth experience.
       * @param {'gradient' | 'topology'} type - The type of customizer being used.
       */
        function handleCustomColorChange(type) {
                if (type === 'topology') {
                        const bgColor = presetConfig.topology.color1.value;
                        const fgColor = presetConfig.topology.color2.value;
                        const themeColor = presetConfig.topology.themePicker.value;

                        // If a Vanta effect exists, update it smoothly without re-creating.
                        if (vantaEffect) {
                                vantaEffect.setOptions({
                                        backgroundColor: bgColor,
                                        color: fgColor
                                });
                        }
                        applyThemeColor(themeColor);

                        // Update the state and deselect any preset
                        currentWallpaperValue = `topology(${bgColor},${fgColor})`;
                        currentThemeColor = themeColor;
                        lastTopologyConfig = { wallpaper: currentWallpaperValue, theme: currentThemeColor };
                        setActiveSwatch(null);

                } else { // Gradient logic
                        const gradient = `linear-gradient(to top, ${presetConfig.gradient.color1.value}, ${presetConfig.gradient.color2.value})`;
                        const themeColor = presetConfig.gradient.themePicker.value;

                        updateWallpaperPreview(gradient);
                        applyThemeColor(themeColor);

                        currentWallpaperValue = gradient;
                        currentThemeColor = themeColor;
                        lastGradientConfig = { wallpaper: currentWallpaperValue, theme: currentThemeColor };
                        setActiveSwatch(null);
                }
        }


        // 为所有会影响预览的输入框添加一个统一的处理器
        function handleSettingsChange() {
                const activeMode = document.querySelector('input[name="wallpaper-mode"]:checked').value;
                if (activeMode === 'image') {
                        const style = `url("${urlInput.value.trim()}")`;
                        const theme = imageThemeColorPicker.value;
                        lastImageConfig = { wallpaper: style, theme: theme };
                        updateWallpaperPreview(style);
                        applyThemeColor(theme);
                }
                // Other modes are now handled by their more specific functions.
        }

        /**
     * 通用的预设容器事件处理器
     */
        async function handlePresetContainerClick(e) {
                const container = e.currentTarget;
                const type = container.dataset.type; // 'gradient' or 'topology'

                const swatch = e.target.closest('[data-wallpaper]');
                const customBtn = e.target.closest('.custom-btn');
                const deleteBtn = e.target.closest('.delete-btn');

                if (longPressJustFinished) {
                        longPressJustFinished = false;
                        return;
                }

                if (container.classList.contains('edit-mode') && !deleteBtn) {
                        container.classList.remove('edit-mode');
                        e.stopPropagation();
                        return;
                }

                if (deleteBtn) {
                        e.stopPropagation();
                        const indexToDelete = parseInt(deleteBtn.parentElement.querySelector('[data-wallpaper]').dataset.index);
                        const presets = state[type + 'WallpaperPresets'];
                        const confirmed = await showConfirmModal('删除预设', `确定删除预设 "${presets[indexToDelete].name}" 吗？`, '删除', '取消');
                        if (confirmed) {
                                presets.splice(indexToDelete, 1);
                                renderPresets(type);
                                setActiveSwatch(currentWallpaperValue);
                        }
                        return;
                }

                if (swatch) {
                        const wallpaperStyle = swatch.dataset.wallpaper;
                        const theme = swatch.dataset.theme;
                        setActiveSwatch(wallpaperStyle);
                        updateWallpaperPreview(wallpaperStyle);
                        applyThemeColor(theme);

                        // 更新对应模式的缓存
                        if (type === 'gradient') {
                                lastGradientConfig = { wallpaper: wallpaperStyle, theme: theme };
                                // Also update the color pickers
                                const gradientColors = wallpaperStyle.match(/#([0-9a-f]{6}|[0-9a-f]{3})/gi);
                                if (gradientColors && gradientColors.length >= 2) {
                                        presetConfig.gradient.color1.value = gradientColors[0];
                                        presetConfig.gradient.color2.value = gradientColors[1];
                                }
                                presetConfig.gradient.themePicker.value = theme;

                        } else { // Handles topology
                                lastTopologyConfig = { wallpaper: wallpaperStyle, theme: theme };

                                //  Update the topology color pickers' values when a preset is selected
                                const topologyColors = wallpaperStyle.match(/#([0-9a-f]{6}|[0-9a-f]{3})/gi);
                                if (topologyColors && topologyColors.length === 2) {
                                        presetConfig.topology.color1.value = topologyColors[0];
                                        presetConfig.topology.color2.value = topologyColors[1];
                                }
                                presetConfig.topology.themePicker.value = theme;
                        }
                        presetConfig[type].customMaker.classList.add('hidden');
                } else if (customBtn) {
                        presetConfig[type].customMaker.classList.toggle('hidden');
                }
        }

         /**
         * 通用的保存自定义预设函数
         */
        async function saveCustomPreset(type) {
                const config = presetConfig[type];
                const presets = state[type + 'WallpaperPresets'];
                // Dynamic prompt text
                const newPresetName = await promptForInput(`为你的新${type === 'topology' ? '拓扑' : '渐变'}方案命名：`, "我的方案", false, false, '');

                if (newPresetName && newPresetName.trim()) {
                        presets.push({
                                name: newPresetName.trim(),
                                gradient: [config.color1.value, config.color2.value],
                                theme: config.themePicker.value
                        });
                        renderPresets(type);
                        showToast('预设已添加！点击页面顶部“保存”后生效。');
                }
        }

        // --- Event Listeners ---
        saveAllBtn.addEventListener('click', saveAllSettingsToDB);

        selectFromAlbumBtn.addEventListener('click', async () => {
                const selectedUrl = await showAlbumPickerModal();
                if (selectedUrl) {
                        urlInput.value = selectedUrl;
                        updateWallpaperPreview(`url("${selectedUrl}")`);
                }
        });

        // Wallpaper & Theme Listeners
        applyUrlBtn.addEventListener('click', () => {
                const url = urlInput.value.trim();
                if (url && (url.startsWith('http') || url.startsWith('data:'))) {
                        updateWallpaperPreview(`url("${url}")`);
                       
                } else {
                        showToast("请输入一个有效的图片URL。", "error");
                }
        });

        // 模式切换监听
        wallpaperModeRadios.forEach(radio => {
                radio.addEventListener('change', () => {
                        const mode = radio.value;
                        switchWallpaperModeUI(mode);
                        let config;
                        switch (mode) {
                                case 'image': config = lastImageConfig; break;
                                case 'topology': config = lastTopologyConfig; break;
                                default: config = lastGradientConfig; break;
                        }
                        updateWallpaperPreview(config.wallpaper);
                        applyThemeColor(config.theme);

                        // Sync UI control values
                        urlInput.value = lastImageConfig.wallpaper.slice(5, -2);
                        imageThemeColorPicker.value = lastImageConfig.theme;
                        const topologyColors = lastTopologyConfig.wallpaper.match(/#([0-9a-f]{6}|[0-9a-f]{3})/gi);
                        if (topologyColors) {
                                topologyColor1Input.value = topologyColors[0];
                                topologyColor2Input.value = topologyColors[1];
                        }
                        topologyThemeColorPicker.value = lastTopologyConfig.theme;
                });
        });

        urlInput.addEventListener('input', handleSettingsChange);
        imageThemeColorPicker.addEventListener('input', handleSettingsChange);

        // Listeners for Gradient custom colors
        presetConfig.gradient.color1.addEventListener('input', () => handleCustomColorChange('gradient'));
        presetConfig.gradient.color2.addEventListener('input', () => handleCustomColorChange('gradient'));
        presetConfig.gradient.themePicker.addEventListener('input', () => handleCustomColorChange('gradient'));

        // Listeners for Topology custom colors for a smooth experience
        presetConfig.topology.color1.addEventListener('input', () => handleCustomColorChange('topology'));
        presetConfig.topology.color2.addEventListener('input', () => handleCustomColorChange('topology'));
        presetConfig.topology.themePicker.addEventListener('input', () => handleCustomColorChange('topology'));

        function cancelLongPress() {
                if (longPressTimer) {
                        clearTimeout(longPressTimer);
                        longPressTimer = null;
                }
        }

        // 通用的长按启动函数
        function handleLongPressStart(e) {
                const container = e.currentTarget;
                // 只有用户自定义的预设（有 data-index）才能被删除
                const swatch = e.target.closest('[data-wallpaper][data-index]');
                if (swatch) {
                        longPressJustFinished = false; // 重置状态
                        cancelLongPress(); // 清除旧计时器
                        longPressTimer = setTimeout(() => {
                                container.classList.add('edit-mode'); // 进入编辑模式
                                longPressJustFinished = true; // 标记长按已完成
                        }, 700); // 700毫秒触发长按
                }
        }

        // Bind unified click handler
        presetConfig.gradient.container.addEventListener('click', handlePresetContainerClick);
        presetConfig.topology.container.addEventListener('click', handlePresetContainerClick);

        // Bind unified save preset buttons
        presetConfig.gradient.savePresetBtn.addEventListener('click', () => saveCustomPreset('gradient'));
        presetConfig.topology.savePresetBtn.addEventListener('click', () => saveCustomPreset('topology'));

        // 通过循环，将所有事件监听器应用到两个容器上
        Object.values(presetConfig).forEach(config => {
                const container = config.container;

                container.addEventListener('click', handlePresetContainerClick);

                // 绑定长按逻辑 (鼠标和触摸)
                container.addEventListener('mousedown', handleLongPressStart);
                container.addEventListener('mouseup', cancelLongPress);
                container.addEventListener('mouseleave', cancelLongPress);
                container.addEventListener('touchstart', handleLongPressStart, { passive: true });
                container.addEventListener('touchend', cancelLongPress);
                container.addEventListener('touchmove', cancelLongPress);
        });
        [color1Input, color2Input, themeColorPicker].forEach(input => {
                input.addEventListener('input', handleCustomColorChange);
        });

        // Font Listeners
        fontUrlInput.addEventListener('input', () => {
                applyCustomFont(fontUrlInput.value.trim(), true);
        });

        resetFontBtn.addEventListener('click', async () => {
                const confirmed = await showConfirmModal('恢复默认字体', '确定要恢复默认字体吗？', '恢复', '取消');
                if (confirmed) {
                        fontUrlInput.value = '';
                        applyCustomFont(''); // Apply reset immediately
                        // The change will be persisted on the next "Save All" click
                        showToast("已恢复默认字体。请点击顶部的“保存”按钮以应用更改。");
                }
        });

        // --- Initialization ---
        loadSettings();
});