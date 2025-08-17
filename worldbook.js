import { db } from './db.js';
import { showToast, showConfirmModal } from './ui-helpers.js';

document.addEventListener('DOMContentLoaded', () => {

        const listContainer = document.getElementById('world-book-list');

        /**
         * [工具函数] 计算 HEX 颜色的亮度 (0 for black, 1 for white)
         */
        function getLuminance(hex) {
                if (!hex) return 0;
                try {
                        let c = hex.substring(1).split('');
                        if (c.length === 3) { c = [c[0], c[0], c[1], c[1], c[2], c[2]]; }
                        c = '0x' + c.join('');
                        const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
                        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                } catch (e) { return 0; }
        }

        /**
         * 渲染世界书列表
         */
        async function renderWorldBookList() {
                if (!listContainer) return;

                const [books, allChars, allGroups, settings] = await Promise.all([
                        db.worldBooks.toArray(),
                        db.chats.where('isGroup').equals(0).toArray(),
                        db.xzoneGroups.toArray(),
                        db.globalSettings.get('main')
                ]);

                const themeColor = settings?.themeColor || '#3b82f6';

                // 强制判断当前模式，并设置正确的文字颜色
                const isDarkMode = document.documentElement.classList.contains('dark');
                const titleColor = isDarkMode ? '#f9fafb' : '#1f2937';
                const textColor = isDarkMode ? '#d1d5db' : '#4b5563';

                listContainer.innerHTML = '';

                if (books.length === 0) {
                        listContainer.innerHTML = '<p class="text-center text-gray-500 mt-10">点击右上角“+”创建你的第一本世界书</p>';
                        return;
                }

                const bookUsageMap = new Map();
                allGroups.forEach(group => {
                        (group.worldBookIds || []).forEach(bookId => {
                                if (!bookUsageMap.has(bookId)) bookUsageMap.set(bookId, { groups: [], chars: [] });
                                bookUsageMap.get(bookId).groups.push(group.name);
                        });
                });
                allChars.forEach(char => {
                        (char.settings?.worldBookIds || []).forEach(bookId => {
                                if (!bookUsageMap.has(bookId)) bookUsageMap.set(bookId, { groups: [], chars: [] });
                                bookUsageMap.get(bookId).chars.push(char.name);
                        });
                });

                const ul = document.createElement('ul');
                ul.className = 'divide-y divide-gray-200 dark:divide-gray-700';

                // 分组标签颜色计算逻辑
                const isThemeColorDark = getLuminance(themeColor) < 0.5;
                const groupTagBg = themeColor;
                const groupTagText = isThemeColorDark ? '#FFFFFF' : '#111827';

                books.forEach(book => {
                        const li = document.createElement('li');
                        li.className = 'list-item p-4 cursor-pointer';

                        const usage = bookUsageMap.get(book.id);
                        let usageHtml = '<p class="text-xs text-gray-400 mt-2">暂未被任何分组或角色使用</p>';

                        if (usage) {
                                // 分组标签保持实心主题色背景
                                const groupTags = usage.groups.map(name =>
                                        `<span style="background-color: ${groupTagBg}; color: ${groupTagText};" class="text-xs font-medium mr-2 px-2.5 py-0.5 rounded">${name}</span>`
                                ).join('');

                                // 角色标签改为主题色边框样式
                                const charTags = usage.chars.map(name =>
                                        `<span 
        class="text-xs font-medium mr-2 px-2.5 py-0.5 rounded border-2 bg-transparent"
        style="border-color: ${themeColor}; color: ${themeColor};"
    >${name}</span>`
                                ).join('');

                                usageHtml = `<div class="mt-2 flex flex-wrap items-center gap-y-2">${groupTags}${charTags}</div>`;
                        }

                        // 直接使用 style 属性设置颜色，确保最高优先级
                        li.innerHTML = `
                <h3 class="font-semibold" style="color: ${titleColor};">${book.name}</h3>
                <p class="text-sm mt-1 truncate" style="color: ${textColor};">${(book.content || '暂无内容...').replace(/\n/g, ' ')}</p>
                ${usageHtml}
            `;

                        li.addEventListener('click', () => {
                                window.location.href = `worldbook-editor.html?id=${book.id}`;
                        });

                        let pressTimer;
                        const startPress = (e) => {
                                pressTimer = window.setTimeout(async () => {
                                        e.preventDefault();
                                        const confirmed = await showConfirmModal("删除世界书", `确定要删除世界书《${book.name}》吗？\n此操作不可撤销。`, "删除", "取消");
                                        if (confirmed) {
                                                try {
                                                        await db.transaction('rw', db.worldBooks, db.chats, db.xzoneGroups, async () => {
                                                                const bookIdToDelete = book.id;
                                                                await db.worldBooks.delete(bookIdToDelete);
                                                                const relatedChars = await db.chats.filter(chat => chat.settings?.worldBookIds?.includes(bookIdToDelete)).toArray();
                                                                for (const char of relatedChars) {
                                                                        const updatedBookIds = char.settings.worldBookIds.filter(id => id !== bookIdToDelete);
                                                                        await db.chats.update(char.id, { 'settings.worldBookIds': updatedBookIds });
                                                                }
                                                                const relatedGroups = await db.xzoneGroups.where('worldBookIds').equals(bookIdToDelete).toArray();
                                                                for (const group of relatedGroups) {
                                                                        const updatedBookIds = group.worldBookIds.filter(id => id !== bookIdToDelete);
                                                                        await db.xzoneGroups.update(group.id, { worldBookIds: updatedBookIds });
                                                                }
                                                        });
                                                        showToast('删除成功！');
                                                        renderWorldBookList();
                                                } catch (error) {
                                                        console.error('删除世界书失败:', error);
                                                        showToast('删除失败，详情请看控制台。', 'error');
                                                }
                                        }
                                }, 500);
                        };
                        const cancelPress = () => clearTimeout(pressTimer);

                        li.addEventListener('mousedown', startPress);
                        li.addEventListener('mouseup', cancelPress);
                        li.addEventListener('mouseleave', cancelPress);
                        li.addEventListener('touchstart', startPress, { passive: true });
                        li.addEventListener('touchend', cancelPress);
                        li.addEventListener('touchmove', cancelPress);

                        ul.appendChild(li);
                });

                listContainer.appendChild(ul);
        }

        // 初始化
        renderWorldBookList();
});