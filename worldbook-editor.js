// settings.js
// Import the shared database instance from db.js
import { db } from './db.js';
import { showToast, showToastOnNextPage } from './ui-helpers.js';


document.addEventListener('DOMContentLoaded', () => {

        const editorTitle = document.getElementById('editor-title');
        const nameInput = document.getElementById('world-book-name-input');
        const contentInput = document.getElementById('world-book-content-input');
        const saveBtn = document.getElementById('save-world-book-btn');

        const triggerTypeSelect = document.getElementById('trigger-type-select');
        const keywordsContainer = document.getElementById('keywords-input-container');
        const keywordsInput = document.getElementById('world-book-keywords-input');


        let editingBookId = null;

        /**
         * 初始化编辑器页面
         */
        async function initializeEditor() {
                const urlParams = new URLSearchParams(window.location.search);
                const bookId = urlParams.get('id');

                if (bookId) {
                        // 编辑模式
                        editingBookId = bookId;
                        const book = await db.worldBooks.get(bookId);
                        if (book) {
                                editorTitle.textContent = '编辑世界书';
                                nameInput.value = book.name;
                                contentInput.value = book.content || '';
                                triggerTypeSelect.value = book.triggerType || 'always';
                                keywordsInput.value = (book.keywords || []).join(', ');
                                toggleKeywordsInput();
                        } else {
                                showToastOnNextPage('找不到要编辑的世界书！', 'error');
                                window.location.href = 'worldbook.html';
                        }
                } else {
                        // 新建模式
                        editorTitle.textContent = '新建世界书';
                        toggleKeywordsInput();
                }
        }

        function toggleKeywordsInput() {
                keywordsContainer.classList.toggle('hidden', triggerTypeSelect.value !== 'keyword');
        }

        /**
         * 保存世界书
         */
        async function saveWorldBook() {
                const name = nameInput.value.trim();
                const content = contentInput.value.trim();
                const triggerType = triggerTypeSelect.value;
                const keywords = keywordsInput.value.split(',').map(k => k.trim()).filter(Boolean);


                if (!name) {
                        showToast('世界书的名字不能为空！', 'error');
                        return;
                }

                if (triggerType === 'keyword' && keywords.length === 0) {
                        showToast('关键词触发的世界书必须至少有一个关键词！', 'error');
                        return;
                }

                saveBtn.textContent = '保存中...';
                saveBtn.disabled = true;

                try {
                        const bookData = { name, content, triggerType, keywords };
                        if (editingBookId) {
                                // 更新现有的
                                await db.worldBooks.update(editingBookId, bookData);
                        } else {
                                // 创建新的
                                await db.worldBooks.add({ ...bookData, id: 'wb_' + Date.now() });
                        }
                        showToastOnNextPage('保存成功！');
                        window.location.href = 'worldbook.html';

                } catch (error) {
                        console.error('保存世界书失败:', error);
                        showToast('保存失败，详情请看控制台。', 'error');
                } finally {
                        saveBtn.textContent = '保存';
                        saveBtn.disabled = false;
                }
        }

        // 初始化
        initializeEditor();

        saveBtn.addEventListener('click', saveWorldBook);
        triggerTypeSelect.addEventListener('change', toggleKeywordsInput);
});