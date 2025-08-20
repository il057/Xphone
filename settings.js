// settings.js
// Import the shared database instance from db.js
import { db } from './db.js';
import { startActiveSimulation, stopActiveSimulation } from './simulationEngine.js';
import { promptForInput, showToast, showConfirmModal } from './ui-helpers.js';

document.addEventListener('DOMContentLoaded', () => {

        // 状态变量，用于存储从数据库加载的设置
        let state = {
                allProfiles: [],
                allTtsProfiles: [],
                activeProfileId: null,
                activeTtsProfileId: null,
                globalSettings: {}
        };
        // 获取DOM元素
        const profileSelector = document.getElementById('profile-selector');
        const addProfileBtn = document.getElementById('add-profile-btn');
        const deleteProfileBtn = document.getElementById('delete-profile-btn');
        const profileNameInput = document.getElementById('profile-name-input');
        const editorContainer = document.getElementById('profile-editor-container');

        const privateChatProbSlider = document.getElementById('private-chat-prob-slider');
        const privateChatProbDisplay = document.getElementById('private-chat-prob-display');
        const groupChatProbSlider = document.getElementById('group-chat-prob-slider');
        const groupChatProbDisplay = document.getElementById('group-chat-prob-display');

        // 云同步相关的 DOM 元素
        const syncGitHubTokenInput = document.getElementById('sync-github-token');
        const syncGistIdInput = document.getElementById('sync-gist-id');
        const uploadDataBtn = document.getElementById('upload-data-btn');
        const downloadDataBtn = document.getElementById('download-data-btn');

        // TTS
        const ttsProfileSelector = document.getElementById('tts-profile-selector');
        const addTtsProfileBtn = document.getElementById('add-tts-profile-btn');
        const deleteTtsProfileBtn = document.getElementById('delete-tts-profile-btn');
        const ttsProfileNameInput = document.getElementById('tts-profile-name-input');
        const ttsEditorContainer = document.getElementById('tts-profile-editor-container');
        const ttsApiKeyInput = document.getElementById('tts-api-key');

        /**
         * 从数据库加载API和全局设置
         */
        async function loadSettings() {
                const [profiles, ttsProfiles, globalSettings] = await Promise.all([
                        db.apiProfiles.toArray(),
                        db.ttsProfiles.toArray(),
                        db.globalSettings.get('main')
                ]);

                state.allProfiles = profiles || [];
                state.allTtsProfiles = ttsProfiles || [];
                state.globalSettings = globalSettings || { id: 'main' };
                state.activeProfileId = state.globalSettings.activeApiProfileId || (profiles[0] ? profiles[0].id : null);
                state.activeTtsProfileId = state.globalSettings.activeTtsProfileId || (ttsProfiles[0] ? ttsProfiles[0].id : null);

                if (state.allProfiles.length === 0) {
                        editorContainer.classList.add('hidden');
                } else {
                        editorContainer.classList.remove('hidden');
                }
                if (state.allTtsProfiles.length === 0) {
                        ttsEditorContainer.classList.add('hidden');
                } else {
                        ttsEditorContainer.classList.remove('hidden');
                }
                syncGitHubTokenInput.value = state.globalSettings.syncGitHubToken || '';
                syncGistIdInput.value = state.globalSettings.syncGistId || '';

        }

        function populateTtsEditor(profileId) {
                if (!profileId) {
                        ttsEditorContainer.classList.add('hidden');
                        return;
                }
                const profile = state.allTtsProfiles.find(p => p.id === profileId);
                if (!profile) return;

                ttsEditorContainer.classList.remove('hidden');
                ttsProfileNameInput.value = profile.profileName || '';
                ttsApiKeyInput.value = profile.apiKey || '';
        }

        /**
         * 根据指定的方案ID填充编辑器表单
         */
        function populateEditor(profileId) {
                if (!profileId) {
                        // 如果没有方案，清空并隐藏编辑器
                        editorContainer.classList.add('hidden');
                        return;
                }

                const profile = state.allProfiles.find(p => p.id === profileId);
                if (!profile) return;

                editorContainer.classList.remove('hidden');

                profileNameInput.value = profile.profileName || '';
                document.getElementById('api-provider').value = profile.apiProvider || 'default';
                document.getElementById('proxy-url').value = profile.proxyUrl || '';
                document.getElementById('api-key').value = profile.apiKey || '';
                const modelSelect = document.getElementById('model-select');
                modelSelect.innerHTML = profile.model ? `<option value="${profile.model}" selected>${profile.model}</option>` : '';
        }


        /**
         * 将加载的设置填充到UI界面
         */
        function populateUI() {
                // 填充方案选择下拉框
                profileSelector.innerHTML = '';
                state.allProfiles.forEach(profile => {
                        const option = document.createElement('option');
                        option.value = profile.id;
                        option.textContent = profile.profileName;
                        profileSelector.appendChild(option);
                });

                ttsProfileSelector.innerHTML = '';
                state.allTtsProfiles.forEach(profile => {
                        const option = document.createElement('option');
                        option.value = profile.id;
                        option.textContent = profile.profileName;
                        ttsProfileSelector.appendChild(option);
                });

                // 设置当前激活的方案
                if (state.activeProfileId) {
                        profileSelector.value = state.activeProfileId;
                }

                if (state.activeTtsProfileId) {
                        ttsProfileSelector.value = state.activeTtsProfileId;
                }

                // 根据选中的方案填充编辑器
                populateEditor(state.activeProfileId);
                populateTtsEditor(state.activeTtsProfileId);

                document.getElementById('cloudinary-cloud-name').value = state.globalSettings.cloudinaryCloudName || '';
                document.getElementById('cloudinary-upload-preset').value = state.globalSettings.cloudinaryUploadPreset || '';

                document.getElementById('background-activity-switch').checked = state.globalSettings.enableBackgroundActivity || false;
                document.getElementById('background-interval-input').value = state.globalSettings.backgroundActivityInterval || 60;
                document.getElementById('block-cooldown-input').value = state.globalSettings.blockCooldownHours || 1;
                document.getElementById('summary-trigger-count-input').value = state.globalSettings.summaryTriggerCount || 25;
                // 填充云同步设置
                syncGitHubTokenInput.value = state.globalSettings.syncGitHubToken || '';
                syncGistIdInput.value = state.globalSettings.syncGistId || '';

                const privateProb = (state.globalSettings.activeSimTickProb || 0.3) * 100;
                const groupProb = (state.globalSettings.groupActiveSimTickProb || 0.15) * 100;

                privateChatProbSlider.value = privateProb;
                privateChatProbDisplay.textContent = privateProb;
                groupChatProbSlider.value = groupProb;
                groupChatProbDisplay.textContent = groupProb;
        }

        /**
         * 保存所有设置到数据库
         */
        async function saveAllSettings() {
                const saveBtn = document.getElementById('save-all-settings-btn');
                saveBtn.textContent = '保存中...';
                saveBtn.disabled = true;

                try {
                        // 1. 保存当前编辑的API方案
                        const currentProfileId = parseInt(profileSelector.value);
                        if (currentProfileId) {
                                const currentProfile = state.allProfiles.find(p => p.id === currentProfileId);
                                if (currentProfile) {
                                        currentProfile.profileName = profileNameInput.value.trim();
                                        currentProfile.apiProvider = document.getElementById('api-provider').value;
                                        currentProfile.proxyUrl = document.getElementById('proxy-url').value.trim();
                                        currentProfile.apiKey = document.getElementById('api-key').value.trim();
                                        currentProfile.model = document.getElementById('model-select').value;
                                        await db.apiProfiles.put(currentProfile);
                                }
                        }

                        const currentTtsProfileId = parseInt(ttsProfileSelector.value);
                        if (currentTtsProfileId) {
                                const currentTtsProfile = state.allTtsProfiles.find(p => p.id === currentTtsProfileId);
                                if (currentTtsProfile) {
                                        currentTtsProfile.profileName = ttsProfileNameInput.value.trim();
                                        currentTtsProfile.apiKey = ttsApiKeyInput.value.trim();
                                        await db.ttsProfiles.put(currentTtsProfile);
                                }
                        }

                        // 2. 保存激活的方案ID到全局设置
                        state.globalSettings.activeApiProfileId = currentProfileId;
                        state.globalSettings.activeTtsProfileId = currentTtsProfileId;

                        state.globalSettings.cloudinaryCloudName = document.getElementById('cloudinary-cloud-name').value.trim();
                        state.globalSettings.cloudinaryUploadPreset = document.getElementById('cloudinary-upload-preset').value.trim();

                        // 保存云同步设置到 globalSettings
                        state.globalSettings.syncGitHubToken = syncGitHubTokenInput.value.trim();
                        state.globalSettings.syncGistId = syncGistIdInput.value.trim();


                        // 保存后台活动设置
                        const oldEnableState = state.globalSettings.enableBackgroundActivity || false;
                        const newEnableState = document.getElementById('background-activity-switch').checked;

                        if (newEnableState && !oldEnableState) {
                                const userConfirmed = await showConfirmModal(
                                        '启用后台活动',
                                        "【高费用警告】\n\n您正在启用“后台角色活动”功能。\n\n这会使您的AI角色们在您不和他们聊天时，也能“独立思考”并主动给您发消息或进行社交互动，极大地增强沉浸感。\n\n但请注意：这会【在后台自动、定期地调用API】，即使您不进行任何操作。根据您的角色数量和检测间隔，这可能会导致您的API费用显著增加。\n\n您确定要开启吗？",
                                        '确认',
                                        '取消'
                                );

                                if (!userConfirmed) {
                                        document.getElementById('background-activity-switch').checked = false;
                                        return;
                                }
                        }

                        state.globalSettings.enableBackgroundActivity = newEnableState;
                        state.globalSettings.backgroundActivityInterval = parseInt(document.getElementById('background-interval-input').value) || 60;
                        state.globalSettings.blockCooldownHours = parseFloat(document.getElementById('block-cooldown-input').value) || 1;
                        state.globalSettings.activeSimTickProb = parseInt(privateChatProbSlider.value) / 100;
                        state.globalSettings.groupActiveSimTickProb = parseInt(groupChatProbSlider.value) / 100;
                        state.globalSettings.summaryTriggerCount = parseInt(document.getElementById('summary-trigger-count-input').value) || 25;

                        // 如果启用了后台活动，启动模拟引擎
                        await db.globalSettings.put(state.globalSettings);

                        showToast('设置已成功保存！');
                        await main();

                } catch (error) {
                        console.error("保存设置失败:", error);
                        showToast("保存失败，请查看控制台获取错误信息。", 'error');
                } finally {
                        saveBtn.textContent = '保存';
                        saveBtn.disabled = false;
                }
        }

        /**
         * 从API拉取可用模型列表
         */
        async function fetchModels() {
                const url = document.getElementById('proxy-url').value.trim();
                const key = document.getElementById('api-key').value.trim();
                const provider = document.getElementById('api-provider').value;


                let fetchUrl;
                let headers = { 'Content-Type': 'application/json' };

                const fetchBtn = document.getElementById('fetch-models-btn');
                if (provider === 'gemini') {
                        fetchUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
                } else {
                        if (!url) {
                                showToast('请填写反代地址', 'error');
                                return;
                        }
                        fetchUrl = `${url}/v1/models`;
                        headers['Authorization'] = `Bearer ${key}`;
                }

                fetchBtn.textContent = '拉取中...';
                fetchBtn.disabled = true;

                try {
                        const response = await fetch(fetchUrl, { headers });
                        if (!response.ok) {
                                const errorData = await response.json();
                                throw new Error(errorData?.error?.message || '无法获取模型列表');
                        }
                        const data = await response.json();
                        const modelSelect = document.getElementById('model-select');
                        modelSelect.innerHTML = '';
                        const models = provider === 'gemini' ? data.models : data.data;
                        const currentProfileId = parseInt(profileSelector.value);
                        const currentProfile = state.allProfiles.find(p => p.id === currentProfileId);

                        models.forEach(model => {
                                const modelId = provider === 'gemini' ? model.name.replace('models/', '') : model.id;
                                // Gemini API 返回的模型包含 vision 等，这里只筛选 generateContent 支持的模型
                                if (provider === 'gemini' && !model.supportedGenerationMethods.includes("generateContent")) {
                                        return;
                                }
                                const option = document.createElement('option');
                                option.value = modelId;
                                option.textContent = modelId;
                                if (currentProfile && modelId === currentProfile.model) {
                                        option.selected = true;
                                }
                                modelSelect.appendChild(option);
                        });
                        showToast('模型列表已更新');
                } catch (error) {
                        showToast(`拉取模型失败: ${error.message}`, 'error');
                } finally {
                        fetchBtn.textContent = '拉取';
                        fetchBtn.disabled = false;
                }
        }

        /**
         * 导出完整备份数据
         */
        async function exportBackup() {
                const confirmed = await showConfirmModal(
                        '导出备份',
                        '确定要导出所有数据吗？这将生成一个包含您所有聊天记录和设置的JSON文件。',
                        '导出',
                        '取消'
                );
                if (!confirmed) return;
                try {
                        const backupData = {
                                version: 39, // 确保导出版本与当前数据库版本一致
                                timestamp: Date.now()
                        };

                        const tableNames = db.tables.map(t => t.name);
                        const tableData = await Promise.all(
                                tableNames.map(name => db.table(name).toArray())
                        );

                        // 定义哪些表是只包含单个对象的
                        const singleObjectTables = ['globalSettings', 'musicLibrary', 'xzoneSettings'];

                        tableNames.forEach((name, i) => {
                                if (singleObjectTables.includes(name)) {
                                        // 对于单对象表，导出对象本身
                                        backupData[name] = tableData[i][0] || null;
                                } else {
                                        // 对于其他表 (如 apiProfiles, chats)，导出整个数组
                                        backupData[name] = tableData[i];
                                }
                        });

                        const blob = new Blob(
                                [JSON.stringify(backupData, null, 2)],
                                { type: 'application/json' }
                        );
                        const url = URL.createObjectURL(blob);
                        const link = Object.assign(document.createElement('a'), {
                                href: url,
                                download: `XPhone-Backup-${new Date().toISOString().split('T')[0]}.json`
                        });
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);

                        showToast('导出成功！已将备份文件下载到您的设备。');

                } catch (error) {
                        console.error("导出数据时出错:", error);
                        showToast(`导出失败: ${error.message}`, 'error');
                }
        }

        /**
        * 导入备份文件 (兼容旧版本)
        * @param {File} file - 用户选择的JSON文件
        */
        async function importBackup(file) {
                if (!file) return;

                const confirmed = await showConfirmModal(
                        '导入备份',
                        '【严重警告】\n\n导入备份将完全覆盖您当前的所有数据，包括聊天、动态、设置等。此操作不可撤销！\n\n您确定要继续吗？',
                        '导入',
                        '取消'
                );

                if (!confirmed) return;

                try {
                        const text = await file.text();
                        const backupData = JSON.parse(text);
                        await restoreDataFromBackup(backupData);

                } catch (error) {
                        console.error("导入数据时出错:", error);
                        showToast(`导入失败: 文件格式不正确或数据已损坏: ${error.message}`, 'error');
                }
        }

        function handleEnableNotifications() {
                if (!("Notification" in window)) {
                        showToast("抱歉，您的浏览器不支持桌面通知。", "error");
                        return;
                }

                if (Notification.permission === "granted") {
                        showToast("通知权限已经开启！");
                        new Notification("弦镜通知测试", { body: "如果看到这条消息，说明通知功能一切正常。" });
                } else if (Notification.permission !== "denied") {
                        Notification.requestPermission().then(permission => {
                                if (permission === "granted") {
                                        showToast("通知权限已成功开启！");
                                        new Notification("弦镜通知测试", { body: "您将会在后台收到角色的消息提醒。" });
                                } else {
                                        showToast("您拒绝了通知权限，将无法收到后台消息提醒。", "error");
                                }
                        });
                } else {
                        showToast("通知权限已被禁用。请在您的浏览器设置中手动开启本网站的通知权限。", "error");
                }
        }

        /**
        * 处理添加新方案
        */
        async function handleAddNewProfile() {
                const profileName = await promptForInput("请输入新方案的名称:", `方案 ${state.allProfiles.length + 1}`, false, false);
                if (!profileName || !profileName.trim()) return;

                const newProfile = {
                        profileName: profileName.trim(),
                        apiProvider: 'default',
                        proxyUrl: '',
                        apiKey: '',
                        model: ''
                };
                const newId = await db.apiProfiles.add(newProfile);

                // 如果这是第一个方案，则自动设为激活
                if (state.allProfiles.length === 0) {
                        state.globalSettings.activeApiProfileId = newId;
                        await db.globalSettings.put(state.globalSettings);
                }

                await main(); // 重新加载所有数据并刷新UI
        }

        /**
         * 处理删除方案
         */
        async function handleDeleteProfile() {
                const profileIdToDelete = parseInt(profileSelector.value);
                if (!profileIdToDelete) return;

                const profileToDelete = state.allProfiles.find(p => p.id === profileIdToDelete);

                const confirmed = await showConfirmModal(
                        '删除方案',
                        `确定要删除方案 “${profileToDelete.profileName}” 吗？`,
                        '删除',
                        '取消'
                );
                if (confirmed) {
                        await db.apiProfiles.delete(profileIdToDelete);

                        // 如果删除的是当前激活的方案，则将激活方案重置为第一个
                        if (state.activeProfileId === profileIdToDelete) {
                                const remainingProfiles = state.allProfiles.filter(p => p.id !== profileIdToDelete);
                                const newActiveId = remainingProfiles[0] ? remainingProfiles[0].id : null;
                                state.globalSettings.activeApiProfileId = newActiveId;
                                await db.globalSettings.put(state.globalSettings);
                        }

                        await main(); // 重新加载并渲染
                }
        }

        async function handleAddNewTtsProfile() {
                const profileName = await promptForInput("请输入新 TTS 方案的名称:", `ElevenLabs 方案 ${state.allTtsProfiles.length + 1}`, false, false);
                if (!profileName || !profileName.trim()) return;

                const newProfile = {
                        profileName: profileName.trim(),
                        apiKey: ''
                };
                const newId = await db.ttsProfiles.add(newProfile);

                if (state.allTtsProfiles.length === 0) {
                        state.globalSettings.activeTtsProfileId = newId;
                        await db.globalSettings.put(state.globalSettings);
                }
                await main();
        }

        async function handleDeleteTtsProfile() {
                const profileIdToDelete = parseInt(ttsProfileSelector.value);
                if (!profileIdToDelete) return;

                const profileToDelete = state.allTtsProfiles.find(p => p.id === profileIdToDelete);
                const confirmed = await showConfirmModal('删除方案', `确定要删除 TTS 方案 “${profileToDelete.profileName}” 吗？`, '删除', '取消');

                if (confirmed) {
                        await db.ttsProfiles.delete(profileIdToDelete);
                        if (state.activeTtsProfileId === profileIdToDelete) {
                                const remaining = state.allTtsProfiles.filter(p => p.id !== profileIdToDelete);
                                state.globalSettings.activeTtsProfileId = remaining[0] ? remaining[0].id : null;
                                await db.globalSettings.put(state.globalSettings);
                        }
                        await main();
                }
        }
        /**
         * 打包所有本地数据为一个JSON对象 (函数内容不变)
         */
        async function packAllData() {
                const backupData = {
                        version: 39, // 确保导出版本与当前数据库版本一致
                        timestamp: Date.now()
                };
                const tableNames = db.tables.map(t => t.name);
                const tableData = await Promise.all(
                        tableNames.map(name => db.table(name).toArray())
                );
                const singleObjectTables = ['globalSettings', 'musicLibrary', 'xzoneSettings'];
                tableNames.forEach((name, i) => {
                        if (singleObjectTables.includes(name)) {
                                backupData[name] = tableData[i][0] || null;
                        } else {
                                backupData[name] = tableData[i];
                        }
                });
                return backupData;
        }

        /**
         * 上传数据到 GitHub Gist
         */
        async function uploadDataToCloud() {
                const token = syncGitHubTokenInput.value.trim();
                const gistId = syncGistIdInput.value.trim();

                if (!token || !gistId) {
                        showToast('请先填写您的 GitHub Personal Access Token 和 Gist ID。', 'error');
                        return;
                }
                const confirmed = await showConfirmModal(
                        '上传数据',
                        '确定要上传当前所有数据吗？这将覆盖云端的旧数据。',
                        '上传',
                        '取消'
                );
                if (!confirmed) return;

                uploadDataBtn.textContent = '上传中...';
                uploadDataBtn.disabled = true;

                try {
                        const allData = await packAllData();

                        // GitHub Gist API 要求文件内容是字符串
                        const content = JSON.stringify(allData, null, 2);

                        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
                                method: 'PATCH',
                                headers: {
                                        'Authorization': `token ${token}`,
                                        'Accept': 'application/vnd.github.v3+json',
                                        'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                        files: {
                                                'xphone_backup.json': { // 使用固定的文件名
                                                        content: content
                                                }
                                        }
                                })
                        });

                        if (!response.ok) {
                                const errorData = await response.json();
                                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
                        }
                        showToast('数据上传成功！');
                } catch (error) {
                        console.error('上传失败:', error);
                        showToast(`上传失败: ${error.message}`, 'error');
                } finally {
                        uploadDataBtn.textContent = '上传数据到云端';
                        uploadDataBtn.disabled = false;
                }
        }

        /**
         * 从 GitHub Gist 下载数据并恢复
         */
        async function downloadDataFromCloud() {
                const token = syncGitHubTokenInput.value.trim();
                const gistId = syncGistIdInput.value.trim();

                if (!token || !gistId) {
                        showToast('请先填写您的 GitHub Personal Access Token 和 Gist ID。', 'error');
                        return;
                }
                const confirmed = await showConfirmModal(
                        '下载数据',
                        '【严重警告】\n\n此操作将从云端下载数据并完全覆盖您当前设备上的所有数据！此操作不可撤销！\n\n确定要继续吗？',
                        '下载',
                        '取消'
                );
                if (!confirmed) return;

                downloadDataBtn.textContent = '下载中...';
                downloadDataBtn.disabled = true;

                try {
                        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
                                method: 'GET',
                                headers: {
                                        'Authorization': `token ${token}`,
                                        'Accept': 'application/vnd.github.v3+json'
                                }
                        });

                        if (!response.ok) {
                                const errorData = await response.json();
                                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
                        }

                        const gistData = await response.json();
                        const fileContent = gistData.files['xphone_backup.json']?.content;

                        if (!fileContent) {
                                throw new Error("在Gist中找不到 'xphone_backup.json' 文件。");
                        }

                        const backupData = JSON.parse(fileContent);

                        await restoreDataFromBackup(backupData);

                } catch (error) {
                        console.error('下载并恢复失败:', error);
                        showToast(`下载并恢复失败: ${error.message}`, 'error');
                } finally {
                        downloadDataBtn.textContent = '从云端下载并覆盖本地';
                        downloadDataBtn.disabled = false;
                }
        }

        // --- 初始化流程 ---
        async function main() {
                await loadSettings();
                populateUI();

                profileSelector.addEventListener('change', () => {
                        const selectedId = parseInt(profileSelector.value);
                        state.activeProfileId = selectedId; // 更新内存中的 activeId
                        populateEditor(selectedId);
                        // 注意：切换方案本身不保存，只有点击“保存”按钮才将 activeId 写入数据库
                });
                addProfileBtn.addEventListener('click', handleAddNewProfile);
                deleteProfileBtn.addEventListener('click', handleDeleteProfile);

                ttsProfileSelector.addEventListener('change', () => {
                        const selectedId = parseInt(ttsProfileSelector.value);
                        state.activeTtsProfileId = selectedId;
                        populateTtsEditor(selectedId);
                });

                addTtsProfileBtn.addEventListener('click', handleAddNewTtsProfile);
                deleteTtsProfileBtn.addEventListener('click', handleDeleteTtsProfile);

                // --- 绑定事件监听器 ---
                document.getElementById('save-all-settings-btn').addEventListener('click', saveAllSettings);
                document.getElementById('enable-notifications-btn').addEventListener('click', handleEnableNotifications);
                document.getElementById('fetch-models-btn').addEventListener('click', fetchModels);
                document.getElementById('export-data-btn').addEventListener('click', exportBackup);
                document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-data-input').click());
                document.getElementById('import-data-input').addEventListener('change', e => importBackup(e.target.files[0]));

                uploadDataBtn.addEventListener('click', uploadDataToCloud);
                downloadDataBtn.addEventListener('click', downloadDataFromCloud);

                privateChatProbSlider.addEventListener('input', () => {
                        privateChatProbDisplay.textContent = privateChatProbSlider.value;
                });
                groupChatProbSlider.addEventListener('input', () => {
                        groupChatProbDisplay.textContent = groupChatProbSlider.value;
                });
        }

        main();
});

async function restoreDataFromBackup(backupData) {
        const backupVersion = backupData.version || 0;

        if (backupVersion < 35 && backupData.chats) {
                console.log(`检测到旧版本备份 (v${backupVersion})，正在迁移群聊成员格式...`);
                backupData.chats.forEach(chat => {
                        // 如果是群聊，且成员列表是对象数组
                        if (chat.isGroup && chat.members && chat.members.length > 0 && typeof chat.members[0] === 'object' && chat.members[0] !== null) {
                                // 将其转换为只包含ID的数组
                                chat.members = chat.members.map(member => member.id);
                        }
                });
                console.log("群聊成员格式迁移完成。");
        }

        if (backupVersion < 34 && backupData.chats) {
                console.log(`检测到旧版本备份 (v${backupVersion})，正在执行手动迁移...`);
                // 遍历备份文件中的 chats 数据
                backupData.chats.forEach(chat => {
                        // 只有在 history 存在且不为空时才操作
                        if (chat.history && chat.history.length > 0) {
                                const lastMessage = chat.history[chat.history.length - 1];
                                // 在内存中直接为这条 chat 数据添加新字段
                                chat.lastMessageTimestamp = lastMessage.timestamp;
                                chat.lastMessageContent = lastMessage;
                                if (chat.lastMessageTimestamp && typeof chat.lastMessageTimestamp === 'string') {
                                        // 将字符串日期转换为数字格式的Unix时间戳 (毫秒)
                                        chat.lastMessageTimestamp = new Date(chat.lastMessageTimestamp).getTime();
                                }
                        }
                });
                console.log("手动迁移完成，现在写入数据库...");
        }
        await db.transaction('rw', db.tables, async () => {
                // 1. 清空所有当前表
                for (const table of db.tables) {
                        await table.clear();
                }

                // 2. 如果是v29或更早的备份，执行手动迁移
                if (backupVersion <= 29) {
                        console.log("正在导入并迁移旧版本(v29)的备份文件...");

                        let newProfileId = null;
                        const oldApiConfig = backupData.apiConfig; // 从备份文件中读取旧的 apiConfig

                        // A. 迁移 apiConfig -> apiProfiles
                        if (oldApiConfig) {
                                const newProfile = {
                                        profileName: '默认方案 (从备份导入)',
                                        apiProvider: oldApiConfig.apiProvider || 'default',
                                        proxyUrl: oldApiConfig.proxyUrl || '',
                                        apiKey: oldApiConfig.apiKey || '',
                                        model: oldApiConfig.model || ''
                                };
                                newProfileId = await db.apiProfiles.add(newProfile);
                        }

                        // B. 准备并保存 globalSettings
                        const globalSettingsData = backupData.globalSettings || { id: 'main' };
                        if (newProfileId) {
                                globalSettingsData.activeApiProfileId = newProfileId;
                        }
                        // 将 Cloudinary 设置从旧的 apiConfig 迁移到新的 globalSettings
                        if (oldApiConfig) {
                                globalSettingsData.cloudinaryCloudName = oldApiConfig.cloudinaryCloudName || '';
                                globalSettingsData.cloudinaryUploadPreset = oldApiConfig.cloudinaryUploadPreset || '';
                        }
                        await db.globalSettings.put(globalSettingsData);

                        // C. 导入所有其他常规表
                        for (const tableName in backupData) {
                                if (['version', 'timestamp', 'apiConfig', 'globalSettings'].includes(tableName)) {
                                        continue; // 跳过已手动处理的表
                                }
                                const table = db.table(tableName);
                                const dataToImport = backupData[tableName];
                                if (table && Array.isArray(dataToImport) && dataToImport.length > 0) {
                                        await table.bulkPut(dataToImport);
                                }
                        }
                } else {
                        // 为 v30+ 的新版本备份文件提供通用导入逻辑
                        console.log(`正在导入新版本(v${backupVersion})的备份文件...`);
                        for (const tableName in backupData) {
                                if (['version', 'timestamp'].includes(tableName)) continue;

                                const table = db.table(tableName);
                                const data = backupData[tableName];
                                if (table && data) {
                                        if (Array.isArray(data)) {
                                                if (data.length > 0) await table.bulkPut(data);
                                        } else { // 处理单对象表
                                                await table.put(data);
                                        }
                                }
                        }
                }
        });

        showToast('导入成功！所有数据已成功恢复！页面即将刷新以应用所有更改。');

        setTimeout(() => {
                window.location.reload();
        }, 1500);
}