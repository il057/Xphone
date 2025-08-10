// settings.js
// Import the shared database instance from db.js
import { db } from './db.js';
import { showToast, showConfirmModal } from './ui-helpers.js';


document.addEventListener('DOMContentLoaded', () => {

    const listContainer = document.getElementById('world-book-list');

    /**
     * 渲染世界书列表
     */
    async function renderWorldBookList() {
        if (!listContainer) return;

        const books = await db.worldBooks.toArray();
        listContainer.innerHTML = '';

        if (books.length === 0) {
            listContainer.innerHTML = '<p class="text-center text-gray-500 mt-10">点击右上角“+”创建你的第一本世界书</p>';
            return;
        }

        const ul = document.createElement('ul');
        ul.className = 'divide-y divide-gray-200';

        books.forEach(book => {
            const li = document.createElement('li');
            li.className = 'list-item p-4 cursor-pointer';
            
            li.innerHTML = `
                <h3 class="font-semibold text-gray-800">${book.name}</h3>
                <p class="text-sm text-gray-500 mt-1 truncate">${(book.content || '暂无内容...').replace(/\n/g, ' ')}</p>
            `;

            // 单击事件：跳转到编辑器
            li.addEventListener('click', () => {
                window.location.href = `worldbook-editor.html?id=${book.id}`;
            });

            // 长按事件：删除
            let pressTimer;
            li.addEventListener('mousedown', (e) => {
                pressTimer = window.setTimeout(async () => {
                    e.preventDefault();
                    const confirmed = await showConfirmModal("删除世界书", `确定要删除世界书《${book.name}》吗？\n此操作不可撤销。`, "删除", "取消");
                    if (confirmed) {
                        try {
                            // 使用数据库事务来确保数据一致性
                            await db.transaction('rw', db.worldBooks, db.chats, db.xzoneGroups, async () => {
                                const bookIdToDelete = book.id;

                                // 1. 删除世界书本身
                                await db.worldBooks.delete(bookIdToDelete);

                                // 2. 移除所有单人角色对该世界书的引用
                                    const relatedChars = await db.chats.filter(chat => chat.settings && chat.settings.worldBookId === bookIdToDelete).toArray();
                                    for (const char of relatedChars) {
                                            // 使用 Dexie 的 dotted notation 来更新内嵌对象
                                            await db.chats.update(char.id, { 'settings.worldBookId': '' });
                                    }

                                    // 3. 移除所有分组对该世界书的引用
                                    const relatedGroups = await db.xzoneGroups.where('worldBookIds').equals(bookIdToDelete).toArray();
                                    for (const group of relatedGroups) {
                                            const updatedBookIds = group.worldBookIds.filter(id => id !== bookIdToDelete);
                                            await db.xzoneGroups.update(group.id, { worldBookIds: updatedBookIds });
                                    }
                            });

                            showToast('删除成功！');
                            renderWorldBookList(); // 重新渲染列表

                        } catch (error) {
                            console.error('删除世界书失败:', error);
                            showToast('删除失败，详情请看控制台。', 'error');
                        }
                    }
                }, 500); // 500毫秒触发长按
            });
            li.addEventListener('mouseup', () => clearTimeout(pressTimer));
            li.addEventListener('mouseleave', () => clearTimeout(pressTimer));

            ul.appendChild(li);
        });

        listContainer.appendChild(ul);
    }

    // 初始化
    renderWorldBookList();
});