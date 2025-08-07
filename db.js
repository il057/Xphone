// db.js
// Centralized Dexie DB definition to be shared across the application.
// All other modules will import the 'db' instance from this file.

// Initialize Dexie with the database name.
export const db = new Dexie('ChatDB');

// Define the database schema. This should be the single source of truth for the database structure.
db.version(33).stores({
    chats: '&id, isGroup, groupId, realName, lastIntelUpdateTime, unreadCount, &blockStatus',
    // 将 'apiConfig' 重命名为 'apiProfiles' 并修改其结构
    apiProfiles: '++id, &profileName', // 使用自增ID和方案名称索引
    globalSettings: '&id, activeApiProfileId', // 增加一个字段用于存储当前激活的方案ID
    userStickers: '++id, &url, name, order',
    worldBooks: '&id, name',
    musicLibrary: '&id',
    personaPresets: '++id, name, avatar, gender, birthday, persona', 
    xzoneSettings: '&id',
    xzonePosts: '++id, timestamp, authorId',
    xzoneAlbums: '++id, name, createdAt',
    xzonePhotos: '++id, albumId',
    favorites: '++id, [type+content.id], type, timestamp, chatId',
    memories: '++id, chatId, [chatId+isImportant], authorName, isImportant, timestamp, type, targetDate',
    bubbleThemePresets: '&name',
    bubbleCssPresets: '&name, cssCode', 
    globalAlbum: '++id, url',
    userAvatarLibrary: '++id, &url, name',
    xzoneGroups: '++id, name, worldBookIds',
    relationships: '++id, [sourceCharId+targetCharId], sourceCharId, targetCharId', 
    eventLog: '++id, timestamp, type, groupId, processedBy',
    offlineSummary: '&id, timestamp',
    callLogs: '++id, charId, type, startTime, duration'
}).upgrade(tx => {
    // 版本 31 的迁移任务：将 Cloudinary 设置从 apiProfiles 移至 globalSettings
    return tx.table('apiProfiles').toArray().then(profiles => {
        if (profiles.length > 0) {
            const firstProfile = profiles[0];
            const cloudinarySettings = {
                cloudinaryCloudName: firstProfile.cloudinaryCloudName,
                cloudinaryUploadPreset: firstProfile.cloudinaryUploadPreset
            };

            // 更新 globalSettings 表
            tx.table('globalSettings').update('main', cloudinarySettings);

            const updates = profiles.map(p => {
                delete p.cloudinaryCloudName;
                delete p.cloudinaryUploadPreset;
                return p;
            });
            return tx.table('apiProfiles').bulkPut(updates);
        }
    });
});

/**
 * 获取当前激活的API连接方案
 * @returns {Promise<object|null>}
 */
export async function getActiveApiProfile() {
    const settings = await db.globalSettings.get('main');
    if (!settings || !settings.activeApiProfileId) {
        // 如果没有设置，尝试获取第一个作为后备
        return await db.apiProfiles.toCollection().first();
    }
    return await db.apiProfiles.get(settings.activeApiProfileId);
}

/**
 * A simple, priority-based asynchronous lock for controlling access to the API.
 * Prevents race conditions between user-initiated requests and background tasks.
 */
export const apiLock = {
    _lockKey: 'xphone_api_lock',
    _lockTTL: 30000, // 30 seconds Time-To-Live for the lock to prevent deadlocks

    /**
     * Attempts to acquire the lock.
     * @param {string} requester - A descriptive name for the task requesting the lock (e.g., 'user_chat', 'background_tick').
     * @returns {Promise<boolean>} - True if the lock was acquired, false otherwise.
     */
    async acquire(requester) {
        const now = Date.now();
        const currentLock = localStorage.getItem(this._lockKey);

        if (currentLock) {
            const { timestamp } = JSON.parse(currentLock);
            // If lock is old, consider it expired and allow acquiring.
            if (now - timestamp > this._lockTTL) {
                 console.warn("Found an expired API lock. Overriding.");
            } else {
                // If a lock exists and is not expired, deny acquisition.
                // console.log(`API lock is held by another process. Requester "${requester}" must wait.`);
                return false;
            }
        }

        // Acquire the lock
        const newLock = { requester, timestamp: now };
        localStorage.setItem(this._lockKey, JSON.stringify(newLock));
        // console.log(`API lock acquired by "${requester}".`);
        return true;
    },

    /**
     * Releases the lock.
     * @param {string} requester - The name of the task releasing the lock. Should match the acquiring requester.
     */
    release(requester) {
        const currentLock = localStorage.getItem(this._lockKey);
        if (currentLock) {
            const { requester: lockRequester } = JSON.parse(currentLock);
            // Only the original acquirer should release the lock
            if (lockRequester === requester) {
                localStorage.removeItem(this._lockKey);
                // console.log(`API lock released by "${requester}".`);
            }
        }
    },

    /**
     * Gets the current lock holder's name.
     * @returns {string} - 'idle' if no lock, or the name of the lock holder.
     */
    getCurrentLock() {
        const currentLock = localStorage.getItem(this._lockKey);
        if (currentLock) {
            const { requester, timestamp } = JSON.parse(currentLock);
            if (Date.now() - timestamp > this._lockTTL) {
                localStorage.removeItem(this._lockKey); // Clean up expired lock
                return 'idle';
            }
            return requester;
        }
        return 'idle';
    }
};


/**
 * 将图片文件上传到 Cloudinary 并返回直接链接。
 * 此函数会自动从数据库读取用户的 Cloudinary 配置。
 * @param {File} file 要上传的图片文件。
 * @returns {Promise<string>} 一个解析为图片直接链接的 Promise。
 */
export async function uploadImage(file) {
    // 1. 从数据库获取API配置
    const settings = await db.globalSettings.get('main');
    const cloudName = settings?.cloudinaryCloudName;
    const uploadPreset = settings?.cloudinaryUploadPreset;

    // 2. 检查配置是否存在
    if (!cloudName || !uploadPreset) {
        throw new Error("请先在“设置”页面中填写你的 Cloudinary Cloud Name 和 Upload Preset。");
    }

    // 3. 构建上传请求
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);

    const apiUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

    // 4. 显示加载提示
    const loadingIndicator = document.createElement('div');
    loadingIndicator.textContent = '图片上传中，请稍候...';
    loadingIndicator.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background-color: rgba(0,0,0,0.7); color: white; padding: 15px 25px;
        border-radius: 10px; z-index: 9999; font-family: sans-serif;
    `;
    document.body.appendChild(loadingIndicator);

    try {
        // 5. 发送请求
        const response = await fetch(apiUrl, {
            method: 'POST',
            body: formData,
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error?.message || `上传失败，状态码 ${response.status}`);
        }

        // 6. 返回安全的 https 链接
        return result.secure_url;
    } catch (error) {
        console.error('Cloudinary 图片上传失败:', error);
        throw error;
    } finally {
        // 7. 移除加载提示
        document.body.removeChild(loadingIndicator);
    }
}