// ui-helpers.js (新版本)
import { db } from './db.js';

/**
 * 动态创建一个通用的模态框外壳。
 * @param {string} modalId - 模态框的ID
 * @param {string} contentHtml - 模态框内部的主要HTML内容
 * @returns {HTMLElement} 返回创建的模态框元素
 */
function createModal(modalId, contentHtml) {
    // 防止重复创建
    const existingModal = document.getElementById(modalId);
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal'; 
    modal.innerHTML = `
        <div class="modal-content">
            ${contentHtml}
        </div>
    `;
    document.body.appendChild(modal);
    
    // 点击模态框背景关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });

    // 强制重绘以确保动画效果
    void modal.offsetWidth;
    modal.classList.add('visible');
    return modal;
}

/**
 * 显示一个通用的、可自定义的输入框菜单。
 * @param {string} title - 菜单标题
 * @param {string} placeholder - 输入框的提示文字
 * @param {boolean} isTextarea - 是否使用多行文本框
 * @param {boolean} isOptional - 是否允许输入为空
 * @returns {Promise<string|null>} - 用户确认则返回输入的字符串，取消则返回 null
 */
export function promptForInput(title, placeholder = '', isTextarea = false, isOptional = false) {
    return new Promise((resolve) => {
        const inputHtml = isTextarea
            ? `<textarea id="prompt-input-field" class="modal-input w-full" rows="3" placeholder="${placeholder}"></textarea>`
            : `<input id="prompt-input-field" class="modal-input" placeholder="${placeholder}">`;

        const modalHtml = `
            <h3 class="text-lg font-semibold text-center p-4 border-b">${title}</h3>
            <div class="p-4">${inputHtml}</div>
            <div class="p-4 border-t grid grid-cols-2 gap-3">
                <button id="prompt-cancel-btn" class="modal-btn modal-btn-cancel">取消</button>
                <button id="prompt-confirm-btn" class="modal-btn modal-btn-confirm">确认</button>
            </div>
        `;

        const modal = createModal('dynamic-prompt-modal', modalHtml);
        const inputField = document.getElementById('prompt-input-field');
        inputField.focus();

        const handleConfirm = () => {
            const value = inputField.value.trim();
            if (!value && !isOptional) { // 只有在非可选时才检查
                alert("内容不能为空！");
                return;
            }
            cleanup();
            resolve(value); // 返回 trim 后的值，如果为空就是空字符串
        };

        const handleCancel = () => {
            cleanup();
            resolve(null); // 用户取消
        };

        const cleanup = () => {
            modal.remove();
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
        };

        const confirmBtn = document.getElementById('prompt-confirm-btn');
        const cancelBtn = document.getElementById('prompt-cancel-btn');

        confirmBtn.addEventListener('click', handleConfirm, { once: true });
        cancelBtn.addEventListener('click', handleCancel, { once: true });
    });
}

/**
 * 显示上传方式选择菜单 (本地上传 vs URL)，并处理移动端兼容性问题。
 * @param {HTMLInputElement} fileInputElement - 当用户点击本地上传时，需要被触发的文件输入元素。
 * @returns {Promise<{type: 'url'|'local', value: string|File}|null>}
 */
export function showUploadChoiceModal(fileInputElement) {
    return new Promise((resolve) => {
        const modalHtml = `
            <h3 class="text-lg font-semibold text-center p-4 border-b">添加图片</h3>
            <div class="p-4 space-y-4">
                <button id="choice-local-btn" class="w-full p-3 rounded-lg font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200">从本地上传</button>
                <div>
                    <label class="text-sm font-medium text-gray-600 block mb-1">或使用URL</label>
                    <input type="url" id="choice-url-input" class="modal-input" placeholder="https://...">
                </div>
            </div>
            <div class="p-4 border-t grid grid-cols-2 gap-3">
                <button id="choice-cancel-btn" class="modal-btn modal-btn-cancel">取消</button>
                <button id="choice-confirm-url-btn" class="modal-btn modal-btn-confirm">确认</button>
            </div>
        `;
        const modal = createModal('dynamic-choice-modal', modalHtml);
        const urlInput = document.getElementById('choice-url-input');

        const cleanup = () => {
            window.removeEventListener('focus', focusHandler);
            fileInputElement.removeEventListener('change', fileChangeHandler);
            modal.remove();
        };
        
        // --- 新增：处理取消文件选择的逻辑 ---
        let filePickerOpened = false;
        const focusHandler = () => {
            // 当窗口重新获得焦点时，稍作延迟后检查
            setTimeout(() => {
                // 如果文件选择器已打开但input中没有文件，说明用户取消了
                if (filePickerOpened && !fileInputElement.files.length) {
                    cleanup();
                    resolve(null);
                }
            }, 300); // 300ms延迟足以让change事件先触发
        };
        
        // --- 新增：文件选择后的处理逻辑 ---
        const fileChangeHandler = (event) => {
            const file = event.target.files[0];
            if (file) {
                cleanup();
                resolve({ type: 'local', value: file });
            }
        };

        const handleLocal = () => {
            filePickerOpened = true;
            // 监听窗口焦点变化，以捕捉取消操作
            window.addEventListener('focus', focusHandler);
            // 监听文件输入框的变化
            fileInputElement.addEventListener('change', fileChangeHandler, { once: true });
            fileInputElement.click();
            // 注意：这里不再关闭模态框
        };

        const handleUrl = () => {
            const url = urlInput.value.trim();
            if (!url || !url.startsWith('http')) {
                alert("请输入有效的图片URL。");
                return;
            }
            cleanup();
            resolve({ type: 'url', value: url });
        };

        const handleCancel = () => {
            cleanup();
            resolve(null);
        };

        document.getElementById('choice-local-btn').addEventListener('click', handleLocal, { once: true });
        document.getElementById('choice-confirm-url-btn').addEventListener('click', handleUrl, { once: true });
        document.getElementById('choice-cancel-btn').addEventListener('click', handleCancel, { once: true });
    });
}

/**
 * 显示一个通用的、可复用的图片选择器模态框，带有hover删除功能。
 * @param {string} title - 模态框的标题.
 * @param {Array<{url: string, id?: any, name?: string}>} images - 要显示的图片对象数组 (需要可选的 id 字段用于删除).
 * @param {Function} onAdd - 当点击“添加新图片”按钮时要执行的回调函数.
 * @param {Function} onDelete - (可选) 当点击图片上的删除按钮时要执行的回调函数，接收图片对象作为参数. 如果不提供，则不显示删除按钮.
 * @returns {Promise<string|null>} - 用户选择则返回图片URL，关闭或点击添加则返回null.
 */
export function showImagePickerModal(title, images, onAdd, onDelete) {
    return new Promise((resolve) => {
        let gridContent = '';
        if (images.length === 0) {
            gridContent = '<p class="col-span-full text-center text-gray-500">图库是空的</p>';
        } else {
            gridContent = images.map(img => `
                <div class="aspect-square group relative cursor-pointer" data-url="${img.url}" data-id="${img.id || ''}">
                    <img src="${img.url}" title="${img.name || ''}" class="w-full h-full object-cover rounded-md">
                    ${onDelete ? `
                        <button class="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm opacity-0 group-hover:opacity-100 transition-opacity" aria-label="删除" data-delete-id="${img.id}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x" viewBox="0 0 16 16">
                                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708"/>
                            </svg>
                        </button>
                    ` : ''}
                </div>
            `).join('');
        }

        const modalHtml = `
            <h3 class="text-lg font-semibold p-4 border-b text-center">${title}</h3>
            <div id="modal-photo-grid" class="flex-grow p-4 overflow-y-auto grid grid-cols-4 gap-2" style="max-height: 60vh;">
                ${gridContent}
            </div>
            <div class="p-2 border-t grid grid-cols-2 gap-3">
                <button id="picker-cancel-btn" class="modal-btn modal-btn-cancel">关闭</button>
                <button id="picker-add-btn" class="modal-btn modal-btn-confirm">添加新图片</button>
            </div>
        `;
        const modal = createModal('dynamic-image-picker', modalHtml);

        const cleanup = () => modal.remove();
        const gridElement = modal.querySelector('#modal-photo-grid, .grid');

        gridElement.addEventListener('click', (e) => {
            const item = e.target.closest('[data-url]');
            if (item) {
                cleanup();
                resolve(item.dataset.url);
            }

            // 处理删除按钮点击
            const deleteButton = e.target.closest('[data-delete-id]');
            if (deleteButton && onDelete) {
                const itemId = deleteButton.dataset.deleteId;
                const itemToDelete = images.find(img => img.id?.toString() === itemId);
                if (itemToDelete) {
                    onDelete(itemToDelete);
                    cleanup(); // 关闭模态框，删除操作通常会触发重新渲染
                    resolve(null);
                }
            }
        });

        modal.querySelector('#picker-add-btn').addEventListener('click', () => {
            cleanup();
            onAdd();
            resolve(null);
        }, { once: true });

        modal.querySelector('#picker-cancel-btn').addEventListener('click', () => {
            cleanup();
            resolve(null);
        }, { once: true });
    });
}

/**
 * 显示一个从相册选择图片的模态框。
 * @returns {Promise<string|null>} 用户选择则返回图片URL，否则返回null
 */
export function showAlbumPickerModal() {
    return new Promise(async (resolve) => {
        const photos = await db.globalAlbum.toArray();
        let gridContent = '';
        if (photos.length === 0) {
            gridContent = '<p class="col-span-full text-center text-gray-500">相册是空的</p>';
        } else {
            gridContent = photos.map(photo => `
                <div class="aspect-square group cursor-pointer" data-url="${photo.url}">
                    <img src="${photo.url}" title="${photo.description}" class="w-full h-full object-cover rounded-md">
                </div>
            `).join('');
        }

        const modalHtml = `
            <h3 class="text-lg font-semibold p-4 border-b text-center">从相册选择</h3>
            <div id="modal-photo-grid" class="flex-grow p-4 overflow-y-auto grid grid-cols-5 gap-2" style="max-height: 60vh;">
                ${gridContent}
            </div>
            <div class="p-2 border-t text-right">
                <button id="picker-cancel-btn" class="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">关闭</button>
            </div>
        `;
        const modal = createModal('dynamic-album-picker', modalHtml);
        
        const cleanup = () => modal.remove();

        modal.querySelector('#modal-photo-grid').addEventListener('click', (e) => {
            const item = e.target.closest('[data-url]');
            if (item) {
                cleanup();
                resolve(item.dataset.url);
            }
        });

        modal.querySelector('#picker-cancel-btn').addEventListener('click', () => {
            cleanup();
            resolve(null);
        }, { once: true });
    });
}