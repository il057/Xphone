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
    const groupsContainer = document.getElementById('groups-management-container');
    const worldbookModal = document.getElementById('worldbook-modal');
    const worldbookList = document.getElementById('worldbook-list');
    const modalGroupName = document.getElementById('modal-group-name');
    const cancelWorldbookBtn = document.getElementById('cancel-worldbook-btn');
    const saveWorldbookBtn = document.getElementById('save-worldbook-btn');

    // --- State ---
    let globalSettings = {};
    let allGroups = [];
    let allWorldBooks = [];
    let editingGroupId = null;

    // --- Functions ---
    async function loadData() {
        [globalSettings, allGroups, allWorldBooks] = await Promise.all([
            db.globalSettings.get('main'), // 直接获取
            db.xzoneGroups.toArray(),
            db.worldBooks.toArray()
        ]);
        // [修复] 如果数据库中没有设置，确保 globalSettings 是一个空对象而不是 null
        if (!globalSettings) {
            globalSettings = {};
        }
    }

    function populateUI() {
        // Populate simulation settings
        offlineSimHoursInput.value = globalSettings.offlineSimHours || 1;
        infoScanRangeInput.value = globalSettings.infoScanRange || 50;
        intelCooldownInput.value = globalSettings.intelCooldownMinutes || 5; 
        intelGeneratesMessageSwitch.checked = globalSettings.intelGeneratesMessage !== false;
        
        // Populate groups management
        groupsContainer.innerHTML = '';
        allGroups.forEach(group => {
            const groupEl = document.createElement('div');
            groupEl.className = 'flex items-center justify-between p-3 bg-gray-50 rounded-lg';
            // 检查 enableOfflineSim 属性，如果未定义，则默认为 true (勾选状态)
            const isSimEnabled = group.enableOfflineSim !== false;

            groupEl.innerHTML = `
                <span class="font-medium">${group.name}</span>
                <div class="flex items-center gap-4">
                    <button data-group-id="${group.id}" class="manage-books-btn text-sm hover:underline" style="color: var(--theme-color)">关联世界书</button>
                    <div class="flex items-center">
                        <input type="checkbox" id="sim-switch-${group.id}" data-group-id="${group.id}" class="sim-toggle-switch h-4 w-4 rounded border-gray-300" ${isSimEnabled ? 'checked' : ''}>
                        <label for="sim-switch-${group.id}" class="ml-2 text-sm text-gray-600">模拟简报</label>
                    </div>
                </div>
            `;
            groupsContainer.appendChild(groupEl);
        });
    }

    function handleOpenWorldbookModal(event) {
        editingGroupId = parseInt(event.target.dataset.groupId);
        const group = allGroups.find(g => g.id === editingGroupId);
        if (!group) return;

        modalGroupName.textContent = group.name;
        const associatedBookIds = new Set(group.worldBookIds || []);
        
        worldbookList.innerHTML = '';
        allWorldBooks.forEach(book => {
            const isChecked = associatedBookIds.has(book.id);
            worldbookList.innerHTML += `
                <div class="flex items-center mb-2">
                    <input type="checkbox" id="book-${book.id}" value="${book.id}" class="h-4 w-4" ${isChecked ? 'checked' : ''}>
                    <label for="book-${book.id}" class="ml-2">${book.name}</label>
                </div>
            `;
        });
        
        worldbookModal.classList.remove('hidden');
    }

    async function handleSaveSettings() {
        if (!globalSettings) {
            globalSettings = {}; 
        }
        
        // Save global settings
        globalSettings.id = 'main';
        globalSettings.offlineSimHours = parseFloat(offlineSimHoursInput.value);
        globalSettings.infoScanRange = parseInt(infoScanRangeInput.value);
        globalSettings.intelCooldownMinutes = parseInt(intelCooldownInput.value);
        globalSettings.intelGeneratesMessage = intelGeneratesMessageSwitch.checked; // Save the new setting

        await db.globalSettings.put(globalSettings);

        const groupUpdates = [];
        document.querySelectorAll('.sim-toggle-switch').forEach(toggle => {
            const groupId = parseInt(toggle.dataset.groupId);
            const enableOfflineSim = toggle.checked;
            groupUpdates.push({ key: groupId, changes: { enableOfflineSim: enableOfflineSim } });
        });

        if (groupUpdates.length > 0) {
            await db.xzoneGroups.bulkUpdate(groupUpdates);
        }
        
        showToast('世界设定已保存！');
    }

    async function handleSaveWorldbookAssociation() {
        if (editingGroupId === null) return;

        const selectedCheckboxes = worldbookList.querySelectorAll('input[type="checkbox"]:checked');
        const selectedBookIds = Array.from(selectedCheckboxes).map(cb => cb.value);

        await db.xzoneGroups.update(editingGroupId, { worldBookIds: selectedBookIds });

        // Refresh local data and UI
        await loadData();
        populateUI();
        
        worldbookModal.classList.add('hidden');
        editingGroupId = null;
    }

    // --- Event Listeners ---
    saveSettingsBtn.addEventListener('click', handleSaveSettings);
    cancelWorldbookBtn.addEventListener('click', () => worldbookModal.classList.add('hidden'));
    saveWorldbookBtn.addEventListener('click', handleSaveWorldbookAssociation);
    groupsContainer.addEventListener('click', (event) => {
        // 检查被点击的元素是否是“关联世界书”按钮
        if (event.target.classList.contains('manage-books-btn')) {
            handleOpenWorldbookModal(event);
        }
    });
    // --- Initial Load ---
    await loadData();
    populateUI();
});