// phone/worldSetting.js
import { db } from './db.js';
import { showToast } from './ui-helpers.js';

document.addEventListener('DOMContentLoaded', async () => {
        // --- DOM Elements ---
        const saveSettingsBtn = document.getElementById('save-settings-btn');
        const offlineSimHoursInput = document.getElementById('offline-sim-hours');
        const infoScanRangeInput = document.getElementById('info-scan-range');
        const intelCooldownInput = document.getElementById('intel-cooldown-minutes');
        const intelGeneratesMessageSwitch = document.getElementById('intel-generates-message-switch');
        const groupsContainer = document.getElementById('groups-container'); 
        const worldbookModal = document.getElementById('worldbook-modal');
        const worldbookList = document.getElementById('worldbook-list');
        const modalGroupName = document.getElementById('modal-group-name');
        const cancelWorldbookBtn = document.getElementById('cancel-worldbook-btn');
        const saveWorldbookBtn = document.getElementById('save-worldbook-btn');

        // --- State ---
        let globalSettings = {};
        let allGroups = [];
        let allChars = []; 
        let allWorldBooks = [];
        let editingTarget = { type: null, id: null }; 

        // --- Functions ---

        /**
         * 加载所有需要的数据
         */
        async function loadData() {
                [globalSettings, allGroups, allChars, allWorldBooks] = await Promise.all([
                        db.globalSettings.get('main').then(s => s || {}),
                        db.xzoneGroups.toArray(),
                        db.chats.where('isGroup').equals(0).toArray(), // 只获取单人角色
                        db.worldBooks.toArray()
                ]);
        }

        /**
         * 渲染整个页面UI
         */
        function populateUI() {
                // 填充模拟设置
                offlineSimHoursInput.value = globalSettings.offlineSimHours || 1;
                infoScanRangeInput.value = globalSettings.infoScanRange || 50;
                intelCooldownInput.value = globalSettings.intelCooldownMinutes || 5;
                intelGeneratesMessageSwitch.checked = globalSettings.intelGeneratesMessage !== false;

                // 渲染分组和角色
                groupsContainer.innerHTML = '';
                const charsByGroup = allChars.reduce((acc, char) => {
                        const groupId = char.groupId || 'ungrouped';
                        if (!acc[groupId]) acc[groupId] = [];
                        acc[groupId].push(char);
                        return acc;
                }, {});

                allGroups.forEach(group => {
                        const groupEl = createGroupElement(group, charsByGroup[group.id] || []);
                        groupsContainer.appendChild(groupEl);
                });
        }

        /**
         * 创建单个分组的HTML元素
         * @param {object} group - 分组数据
         * @param {Array} members - 该分组下的角色数组
         * @returns {HTMLElement}
         */
        function createGroupElement(group, members) {
                const details = document.createElement('details');
                details.className = 'bg-gray-50 rounded-lg overflow-hidden';

                const isSimEnabled = group.enableOfflineSim !== false;

                details.innerHTML = `
            <summary class="flex items-center justify-between p-3 cursor-pointer">
                <span class="font-medium">${group.name} (${members.length})</span>
                <div class="flex items-center gap-4">
                    <button data-type="group" data-id="${group.id}" class="manage-books-btn text-sm hover:underline" style="color: var(--theme-color)">管理世界书</button>
                    <div class="flex items-center">
                        <input type="checkbox" id="sim-switch-${group.id}" data-group-id="${group.id}" class="sim-toggle-switch h-4 w-4 rounded border-gray-300" ${isSimEnabled ? 'checked' : ''}>
                        <label for="sim-switch-${group.id}" class="ml-2 text-sm text-gray-600">模拟简报</label>
                    </div>
                </div>
            </summary>
            <div class="border-t border-gray-200 px-3 py-2 space-y-1">
                ${members.length > 0 ? members.map(m => createMemberElement(m)).join('') : '<p class="text-xs text-gray-500 px-2">该分组下暂无角色</p>'}
            </div>
        `;
                return details;
        }

        /**
         * 创建分组下单个角色的HTML元素
         * @param {object} member - 角色数据
         * @returns {string}
         */
        function createMemberElement(member) {
                return `
            <div class="flex items-center justify-between p-2 rounded hover:bg-gray-100">
                <div class="flex items-center gap-2">
                    <img src="${member.settings.aiAvatar || 'https://files.catbox.moe/kkll8p.svg'}" class="w-8 h-8 rounded-full object-cover">
                    <span class="text-sm">${member.name}</span>
                </div>
                <button data-type="char" data-id="${member.id}" class="manage-books-btn text-xs hover:underline" style="color: var(--theme-color)">关联世界书</button>
            </div>
        `;
        }

        /**
         * 打开世界书选择模态框
         */
        function handleOpenWorldbookModal(event) {
                const target = event.target;
                if (!target.classList.contains('manage-books-btn')) return;

                editingTarget.type = target.dataset.type;
                editingTarget.id = target.dataset.type === 'group' ? parseInt(target.dataset.id) : target.dataset.id;

                let targetName = '';
                let associatedBookIds = new Set();
                let inheritedBookIds = new Set(); // 用于存储继承自群组的世界书ID

                if (editingTarget.type === 'group') {
                        const group = allGroups.find(g => g.id === editingTarget.id);
                        if (!group) return;
                        targetName = group.name;
                        associatedBookIds = new Set(group.worldBookIds || []);
                } else { // 'char'
                        const char = allChars.find(c => c.id === editingTarget.id);
                        if (!char) return;
                        targetName = char.name;
                        // 注意：角色现在也使用 worldBookIds 数组
                        associatedBookIds = new Set(char.settings.worldBookIds || []);
                        // 找出角色所在分组，并获取其世界书ID
                        const parentGroup = allGroups.find(g => g.id === char.groupId);
                        if (parentGroup) {
                                inheritedBookIds = new Set(parentGroup.worldBookIds || []);
                        }
                }

                modalGroupName.textContent = targetName;
                worldbookList.innerHTML = '';

                allWorldBooks.forEach(book => {
                        const isChecked = associatedBookIds.has(book.id);
                        const isInherited = inheritedBookIds.has(book.id);

                        // 如果是为角色设置，且这本书是从分组继承的，则显示为灰色勾选且不可编辑
                        const isDisabled = editingTarget.type === 'char' && isInherited;

                        worldbookList.innerHTML += `
                <div class="flex items-center mb-2 ${isDisabled ? 'opacity-50' : ''}">
                    <input type="checkbox" id="book-${book.id}" value="${book.id}" class="h-4 w-4" 
                        ${isChecked || isInherited ? 'checked' : ''} 
                        ${isDisabled ? 'disabled' : ''}>
                    <label for="book-${book.id}" class="ml-2">${book.name} ${isDisabled ? '(由分组继承)' : ''}</label>
                </div>
            `;
                });

                worldbookModal.classList.remove('hidden');
        }

        /**
         * 保存世界书关联
         */
        async function handleSaveWorldbookAssociation() {
                if (!editingTarget.id) return;

                const selectedCheckboxes = worldbookList.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)');
                const selectedBookIds = Array.from(selectedCheckboxes).map(cb => cb.value);

                try {
                        if (editingTarget.type === 'group') {
                                await db.xzoneGroups.update(editingTarget.id, { worldBookIds: selectedBookIds });
                                showToast('分组世界书已更新！');
                        } else {
                                // 角色也保存为 worldBookIds 数组
                                await db.chats.update(editingTarget.id, { 'settings.worldBookIds': selectedBookIds });
                                showToast('角色世界书已更新！');
                        }
                } catch (error) {
                        console.error('保存世界书关联失败:', error);
                        showToast('保存失败，详情请看控制台。', 'error');
                } finally {
                        worldbookModal.classList.add('hidden');
                        editingTarget = { type: null, id: null };
                        // 重新加载数据并渲染UI以反映变化
                        await loadData();
                        populateUI();
                }
        }

        /**
         *  保存全局设置和分组的模拟开关
         */
        async function handleSaveSettings() {
                // 保存全局设置
                globalSettings.id = 'main';
                globalSettings.offlineSimHours = parseFloat(offlineSimHoursInput.value);
                globalSettings.infoScanRange = parseInt(infoScanRangeInput.value);
                globalSettings.intelCooldownMinutes = parseInt(intelCooldownInput.value);
                globalSettings.intelGeneratesMessage = intelGeneratesMessageSwitch.checked;
                await db.globalSettings.put(globalSettings);

                // 批量更新分组的模拟开关状态
                const groupUpdates = [];
                document.querySelectorAll('.sim-toggle-switch').forEach(toggle => {
                        const groupId = parseInt(toggle.dataset.groupId);
                        const enableOfflineSim = toggle.checked;
                        groupUpdates.push({ key: groupId, changes: { enableOfflineSim } });
                });

                if (groupUpdates.length > 0) {
                        await db.xzoneGroups.bulkUpdate(groupUpdates);
                }

                showToast('世界设定已保存！');
        }

        // --- Event Listeners ---
        saveSettingsBtn.addEventListener('click', handleSaveSettings);
        cancelWorldbookBtn.addEventListener('click', () => worldbookModal.classList.add('hidden'));
        saveWorldbookBtn.addEventListener('click', handleSaveWorldbookAssociation);

        // 使用事件委托来处理所有“管理世界书”按钮的点击
        groupsContainer.addEventListener('click', handleOpenWorldbookModal);

        // --- Initial Load ---
        await loadData();
        populateUI();
});