// characterGenerator.js (恢复UI和逻辑)

import { db } from './db.js';
import { generateNewCharacterPersona } from './simulationEngine.js';
import { showToast, showToastOnNextPage } from './ui-helpers.js';

/**
 * 显示一个用于AI生成新角色的模态框，支持用户自定义关系。
 * @param {object} [prefilledData={}] - (可选) 预填充的数据。
 */
export async function showCharacterGeneratorModal(prefilledData = {}) {
                const modalId = 'character-generator-modal';
                document.getElementById(modalId)?.remove();

                const modal = document.createElement('div');
                modal.id = modalId;
                modal.className = 'modal visible';
                modal.innerHTML = `
        <style>
            #${modalId} #gen-birthday-input {
                /* 强制重置外观，让宽度计算更可控 */
                -webkit-appearance: none;
                -moz-appearance: none;
                appearance: none;
                
                /* 核心修复：强制宽度为100%，并覆盖所有其他最小宽度限制 */
                width: 100% !important;
                min-width: 0 !important;
            }
        </style>
        <div class="modal-content bg-white rounded-lg w-full max-w-md max-h-[90vh] flex flex-col">
            <header class="p-4 border-b text-center">
                <h3 class="font-semibold text-lg">查找可能认识的人</h3>
            </header>
            <main class="flex-grow p-4 space-y-4 overflow-y-auto">
                <div>
                    <label for="gen-group-select" class="block text-sm font-medium text-gray-700">将新角色添加到分组</label>
                    <select id="gen-group-select" class="form-input w-full mt-1 p-2 border rounded-md"></select>
                </div>

                <details id="gen-relations-container" class="hidden rounded-md border">
                    <summary class="cursor-pointer p-2 text-sm font-medium text-gray-700 flex justify-between items-center">
                        <span>与组内成员的预设关系 (可选)</span>
                        <svg class="w-5 h-5 text-gray-500 transition-transform transform" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                    </summary>
                    <div id="gen-relations-list" class="max-h-32 overflow-y-auto space-y-2 border-t p-2"></div>
                </details>

                <div>
                    <label for="gen-name-input" class="block text-sm font-medium text-gray-700">名字 (可选)</label>
                    <input type="text" id="gen-name-input" placeholder="留空则由AI生成" class="form-input w-full mt-1 p-2 border rounded-md">
                </div>
                
                <div>
                    <label for="gen-birthday-input" class="block text-sm font-medium text-gray-700">生日 (可选)</label>
                    <input type="date" id="gen-birthday-input" class="form-input w-full mt-1 p-2 h-10 border rounded-md">
                </div>

                <div>
                    <label class="block text-sm font-medium text-gray-700">性别 (可选)</label>
                    <select id="gen-gender-select" class="form-input w-full mt-1 p-2 border rounded-md">
                        <option value="">由AI决定</option>
                        <option value="male">男</option>
                        <option value="female">女</option>
                    </select>
                </div>
            </main>
            <footer class="p-4 border-t flex justify-end gap-3">
                <button id="gen-cancel-btn" class="modal-btn modal-btn-cancel">取消</button>
                <button id="gen-confirm-btn" class="modal-btn modal-btn-confirm flex items-center justify-center gap-2">
                    <svg id="gen-spinner" class="animate-spin -ml-1 mr-2 h-5 w-5 text-white hidden" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>开始生成</span>
                </button>
            </footer>
        </div>
    `;
                document.body.appendChild(modal);

                const groupSelect = modal.querySelector('#gen-group-select');
                const relationsContainer = modal.querySelector('#gen-relations-container');
                const nameInput = modal.querySelector('#gen-name-input');
                const birthdayInput = modal.querySelector('#gen-birthday-input');
                const genderSelect = modal.querySelector('#gen-gender-select');
                const confirmBtn = modal.querySelector('#gen-confirm-btn');
                const cancelBtn = modal.querySelector('#gen-cancel-btn');
                const spinner = modal.querySelector('#gen-spinner');

                const groups = await db.xzoneGroups.toArray();
                if (groups.length === 0) {
                        showToast("请先至少创建一个分组", "error");
                        modal.remove();
                        return;
                }
                groupSelect.innerHTML = groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');

                if (prefilledData.groupId) groupSelect.value = prefilledData.groupId;
                if (prefilledData.name) nameInput.value = prefilledData.name;
                if (prefilledData.gender) genderSelect.value = prefilledData.gender;
                if (prefilledData.birthday) birthdayInput.value = prefilledData.birthday;


        // 关系UI的更新逻辑
        async function updateRelationsUI(selectedGroupId) {
                const relationsList = modal.querySelector('#gen-relations-list');
                const members = await db.chats.where({ groupId: selectedGroupId, isGroup: 0 }).toArray();
                if (members.length === 0) {
                        relationsContainer.classList.add('hidden');
                        return;
                }
                relationsList.innerHTML = members.map(m => `
            <div class="flex items-center gap-2" data-char-id="${m.id}">
                <label class="text-sm flex-1">与 ${m.name} 的关系是...</label>
                <select class="gen-relation-type-select form-input p-1 border rounded-md text-sm w-1/2">
                    <option value="">由AI决定</option> <option value="朋友">朋友</option>
                    <option value="家人">家人</option>
                    <option value="恋人">恋人</option>
                    <option value="对手">对手</option>
                </select>
            </div>
        `).join('');

                if (prefilledData.relations) {
                        prefilledData.relations.forEach(rel => {
                                const select = relationsList.querySelector(`[data-char-id="${rel.charId}"] .gen-relation-type-select`);
                                if (select) select.value = rel.relationship;
                        });
                }

                relationsContainer.classList.remove('hidden');
        }

        groupSelect.addEventListener('change', () => updateRelationsUI(parseInt(groupSelect.value)));
        await updateRelationsUI(parseInt(groupSelect.value));

        relationsContainer.querySelector('summary').addEventListener('click', (e) => {
                e.preventDefault();
                const details = e.currentTarget.parentElement;
                const icon = e.currentTarget.querySelector('svg');
                if (details.hasAttribute('open')) {
                        details.removeAttribute('open');
                        icon.style.transform = 'rotate(0deg)';
                } else {
                        details.setAttribute('open', '');
                        icon.style.transform = 'rotate(180deg)';
                }
        });

        // 生成逻辑现在会传递用户选择的关系
        const handleGenerate = async () => {
                spinner.classList.remove('hidden');
                confirmBtn.disabled = true;
                confirmBtn.querySelector('span').textContent = '生成中...';

                try {
                        const relationsList = modal.querySelector('#gen-relations-list');
                        //  收集用户定义的关系
                        const userDefinedRelations = Array.from(relationsList.querySelectorAll('.gen-relation-type-select'))
                                .map(select => ({
                                        charId: select.closest('[data-char-id]').dataset.charId,
                                        relationship: select.value
                                }))
                                .filter(r => r.relationship); // 只包括用户明确选择了的

                        const options = {
                                groupId: parseInt(groupSelect.value),
                                name: nameInput.value.trim() || undefined,
                                gender: genderSelect.value || undefined,
                                birthday: birthdayInput.value || undefined,
                                relations: userDefinedRelations.length > 0 ? userDefinedRelations : (prefilledData.relations || undefined),
                                recommendationContext: prefilledData.recommendationContext
                        };

                        const newCharData = await generateNewCharacterPersona(options);

                        if (!newCharData) throw new Error("AI未能生成有效的角色数据。");

                        const newCharacter = {
                                id: (crypto.randomUUID ? crypto.randomUUID() : `fallback-${Date.now()}-${Math.random().toString(16).substr(2, 8)}`),
                                name: newCharData.name,
                                realName: newCharData.realName,
                                gender: newCharData.gender,
                                birthday: newCharData.birthday,
                                settings: {
                                        aiPersona: newCharData.persona,
                                        aiAvatar: 'https://files.catbox.moe/kkll8p.svg',
                                        aiAvatarLibrary: [],
                                },
                                groupId: options.groupId,
                                isGroup: 0,
                                history: [],
                        };

                        await db.chats.add(newCharacter);

                        const groupMembers = await db.chats.where({ groupId: options.groupId, isGroup: 0 }).toArray();
                        const membersMap = new Map(groupMembers.map(m => [m.name, m.id]));

                        // 保存新角色 -> 旧角色的关系
                        if (newCharData.relationships) {
                                for (const rel of newCharData.relationships) {
                                        const targetId = membersMap.get(rel.targetCharName);
                                        if (targetId) {
                                                await db.relationships.add({
                                                        sourceCharId: newCharacter.id,
                                                        targetCharId: targetId,
                                                        type: rel.type,
                                                        score: parseInt(rel.score) || 0,
                                                        description: rel.reason
                                                });
                                        }
                                }
                        }

                        // 保存旧角色 -> 新角色的双向关系
                        if (newCharData.reciprocal_relationships) {
                                for (const rel of newCharData.reciprocal_relationships) {
                                        const sourceId = membersMap.get(rel.sourceCharName);
                                        if (sourceId) {
                                                await db.relationships.add({
                                                        sourceCharId: sourceId,
                                                        targetCharId: newCharacter.id,
                                                        type: rel.type,
                                                        score: parseInt(rel.score) || 0,
                                                        description: rel.reason
                                                });
                                        }
                                }
                        }

                        showToastOnNextPage("新角色生成成功！", "success");
                        window.location.href = `charEditProfile.html?id=${newCharacter.id}`;

                } catch (error) {
                        console.error("生成角色失败:", error);
                        showToast("生成失败，请检查API设置或稍后再试。", "error");
                        spinner.classList.add('hidden');
                        confirmBtn.disabled = false;
                        confirmBtn.querySelector('span').textContent = '开始生成';
                }
        };

        confirmBtn.addEventListener('click', handleGenerate);
        cancelBtn.addEventListener('click', () => modal.remove());
}