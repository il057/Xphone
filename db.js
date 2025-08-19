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

db.version(34).stores({
    chats: '&id, isGroup, groupId, realName, lastIntelUpdateTime, unreadCount, &blockStatus, lastMessageTimestamp', 
    apiProfiles: '++id, &profileName',
    globalSettings: '&id, activeApiProfileId',
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
    // 这段代码会在数据库从 v33 (或更低) 升级到 v34 时执行一次
    console.log("正在执行数据库版本 34 的迁移任务...");
    return tx.table('chats').toCollection().modify(chat => {
        // 如果字段已存在，则跳过此条记录，防止重复执行
        if (chat.lastMessageTimestamp) {
            return;
        }

        if (chat.history && chat.history.length > 0) {
            const lastMessage = chat.history[chat.history.length - 1];
            
            // 填充新字段
            chat.lastMessageTimestamp = lastMessage.timestamp;
            chat.lastMessageContent = lastMessage; // 存储整个消息对象
            if (chat.lastMessageTimestamp && typeof chat.lastMessageTimestamp === 'string') {
                // 将字符串日期转换为数字格式的Unix时间戳 (毫秒)
                chat.lastMessageTimestamp = new Date(chat.lastMessageTimestamp).getTime();
                }
        }
    }).then(() => {
        console.log("版本 34 的数据迁移完成！");
    }).catch(err => {
        console.error("数据迁移失败:", err);
    });
});

db.version(35).stores({
    chats: '&id, isGroup, groupId, realName, lastIntelUpdateTime, unreadCount, &blockStatus, lastMessageTimestamp', 
    apiProfiles: '++id, &profileName',
    globalSettings: '&id, activeApiProfileId',
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
    console.log("正在执行数据库版本 35 的迁移：将群聊成员转换为ID存储...");
    return tx.table('chats').where('isGroup').equals(1).modify(group => {
        // 检查 members 字段是否已经是新格式（数组里是字符串或数字）
        // 或者第一个成员对象没有 id 属性，则认为需要迁移
        if (group.members && group.members.length > 0 && typeof group.members[0] === 'object' && group.members[0] !== null) {
            console.log(`正在迁移群聊 "${group.name}" 的成员...`);
            // 将成员对象数组转换为成员ID数组
            group.members = group.members.map(member => member.id);
        }
    }).then(() => {
        console.log("版本 35 的数据迁移完成！");
    }).catch(err => {
        console.error("版本 35 数据迁移失败:", err);
    });
});

db.version(38).stores({
        chats: '&id, isGroup, groupId, realName, lastIntelUpdateTime, unreadCount, &blockStatus, lastMessageTimestamp, personaAbstract', 
        apiProfiles: '++id, &profileName',
        ttsProfiles: '++id, &profileName',
        globalSettings: '&id, activeApiProfileId',
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
        callLogs: '++id, charId, type, startTime, duration',
        diaries: '++id, chatId, authorId, timestamp, content, keywords, &[authorId+timestamp]'
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

/**
 * 将音频 Blob 数据上传到 Cloudinary 并返回直接链接。
 * @param {Blob} audioBlob 要上传的音频 Blob 数据。
 * @param {string} fileName 上传时使用的文件名。
 * @returns {Promise<string>} 一个解析为音频直接链接的 Promise。
 */
export async function uploadAudioBlob(audioBlob, fileName = 'voice_message.mp3') {
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
        // 注意：我们将 Blob 作为一个文件添加进去
        formData.append('file', audioBlob, fileName);
        formData.append('upload_preset', uploadPreset);
        // 指定资源类型为 video，Cloudinary 会自动处理音频
        formData.append('resource_type', 'video');

        const apiUrl = `https://api.cloudinary.com/v1_1/${cloudName}/upload`;

        try {
                const response = await fetch(apiUrl, {
                        method: 'POST',
                        body: formData,
                });
                const result = await response.json();
                if (!response.ok) {
                        throw new Error(result.error?.message || `上传失败，状态码 ${response.status}`);
                }
                return result.secure_url;
        } catch (error) {
                console.error('Cloudinary 音频上传失败:', error);
                throw error;
        }
}

// db.js (在文件末尾添加或替换)

/**
 * (辅助函数) 将图片URL转换为Gemini API所需的Base64格式
 * @param {string} url - 图片的URL
 * @returns {Promise<{mimeType: string, base64Data: string}>}
 */
async function urlToGenerativePart(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
        const blob = await response.blob();
        const mimeType = blob.type;

        return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                        const base64Data = reader.result.split(',')[1];
                        resolve({ mimeType, base64Data });
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
        });
}


/**
 * 通用的 AI API 调用函数(版本 3 - 支持不同响应类型)
        * @param { string } systemPrompt - 发送给 AI 的系统提示或主指令。
 * @param { Array < object >} [messagesPayload = []] - 对话历史消息数组。
 * @param { object } [generationConfig = {}] - (可选) AI生成配置。
 * @param { 'json' | 'text' } [responseType = 'json'] - (可选) 期望的响应类型。'json'会尝试解析为对象, 'text'返回原始字符串。
 * @returns { Promise < object | string >} - 返回一个解析后的 JSON 对象或原始字符串。
 * @throws { Error } - 如果 API 调用失败或配置缺失，则抛出错误。
 */
export async function callApi(systemPrompt, messagesPayload = [], generationConfig = {}, responseType = 'json') {
        const apiConfig = await getActiveApiProfile();

        if (!apiConfig || !apiConfig.apiKey || !apiConfig.model) {
                throw new Error("请先在“设置”中配置并选择一个有效的API方案。");
        }
        if (apiConfig.apiProvider !== 'gemini' && !apiConfig.proxyUrl) {
                throw new Error("使用默认/反代服务商时，AI API地址不能为空。");
        }

        let response;

        // --- 根据服务商构建不同的请求体 (这部分逻辑不变) ---
        if (apiConfig.apiProvider === 'gemini') {
                const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${apiConfig.model}:generateContent?key=${apiConfig.apiKey}`;
                const geminiContents = [];
                let currentUserParts = [{ text: systemPrompt }];

                for (const msg of messagesPayload) {
                        const role = msg.role === 'assistant' ? 'model' : 'user';
                        if (role === 'user') {
                                if (msg.type === 'image_url') {
                                        try {
                                                const { mimeType, base64Data } = await urlToGenerativePart(msg.content);
                                                currentUserParts.push({ inline_data: { mime_type: mimeType, data: base64Data } });
                                        } catch (e) {
                                                console.error("无法转换图片为Base64，已跳过:", e);
                                                currentUserParts.push({ text: "[图片加载失败]" });
                                        }
                                } else {
                                        currentUserParts.push({ text: msg.content || "" });
                                }
                        } else {
                                if (currentUserParts.length > 0) {
                                        geminiContents.push({ role: 'user', parts: currentUserParts });
                                }
                                geminiContents.push({ role: 'model', parts: [{ text: msg.content || "" }] });
                                currentUserParts = [];
                        }
                }
                if (currentUserParts.length > 0) {
                        geminiContents.push({ role: 'user', parts: currentUserParts });
                }

                response = await fetch(geminiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                                contents: geminiContents,
                                generationConfig: {
                                        temperature: generationConfig.temperature || 0.7,
                                        responseMimeType: responseType === 'json' ? "application/json" : "text/plain",
                                }
                        })
                });

        } else {
                const defaultUrl = `${apiConfig.proxyUrl}/v1/chat/completions`;
                const textMessages = messagesPayload
                        .filter(msg => typeof msg.content === 'string')
                        .map(msg => ({ role: msg.role, content: msg.content }));
                const messages = [{ role: 'system', content: systemPrompt }, ...textMessages];

                response = await fetch(defaultUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                        body: JSON.stringify({
                                model: apiConfig.model,
                                messages: messages,
                                temperature: generationConfig.temperature || 0.7,
                                response_format: responseType === 'json' ? { type: "json_object" } : { type: "text" }
                        })
                });
        }

        // --- 通用的响应处理 ---
        if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        let rawContent;

        if (apiConfig.apiProvider === 'gemini') {
                rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
        } else {
                rawContent = data.choices?.[0]?.message?.content;
        }

        if (!rawContent) {
                console.error("Invalid API Response:", data);
                throw new Error("API返回了无效的数据结构。");
        }

        // **新增逻辑：根据 responseType 决定如何返回**
        if (responseType === 'text') {
                // 对于文本，清理 markdown 并返回原始字符串
                return rawContent.replace(/```(json|css)?/g, '').trim();
        }

        // 默认行为是解析 'json'
        try {
                const cleanedJsonString = extractAndParseJson(rawContent);
                return cleanedJsonString;
        } catch (e) {
                console.error("Failed to parse JSON from AI response:", rawContent);
                throw new Error("AI响应格式错误，无法解析JSON。");
        }
}

/**
 * Extracts and parses a JSON object from a string that may contain markdown or other text.
 * This version is the most robust, designed to strip all non-JSON characters including
 * invisible BOMs and control characters before parsing.
 * @param {string} raw - The raw string from the AI.
 * @returns {object|null} - The parsed JSON object or null if parsing fails.
 */
function extractAndParseJson(raw) {
        if (typeof raw !== 'string' || !raw.trim()) return null;

        // 1. 统一常见不可见字符与全角符号
        let s = raw
                .replace(/[“”]/g, '"')
                .replace(/[‘’]/g, "'")
                .replace(/\u00A0/g, ' '); // NBSP → Space

        // 2. 截取第一个 {...} 或 [...] 片段
        const match = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (!match) return null;
        s = match[0];

        // 3. 移除 BOM / C0‑C1 控制符
        s = s.replace(/[\uFEFF\u0000-\u001F\u007F-\u009F]/g, '');

        // 4. 自动添加数组中缺失的逗号
        //    这个正则表达式会查找一个右花括号 `}` 后面跟着一个左花括号 `{` 的情况（中间可以有空格），并用 `},{` 替换它
        s = s.replace(/\}\s*\{/g, '},{');

        // 5. 第一次尝试严格解析
        try { return JSON.parse(s); } catch (_) { }

        // 6. 自动修正常见错误 —— 先简单后复杂，便于定位
        s = s
                // a) 单引号键值 → 双引号
                .replace(/(['"])?([a-zA-Z0-9_]+)\1\s*:/g, '"$2":')
                .replace(/:\s*'([^']*)'/g, ':"$1"')
                // b) 数字前多余的 + 号
                .replace(/:\s*\+([0-9.]+)/g, ':$1')
                // c) 结尾多余逗号
                .replace(/,\s*([}\]])/g, '$1');

        s = s.replace(/:\s*"((?:\\"|[^"])*)/g, (match, valueContent) => {
                // 将这里面所有未转义的 " 替换为 \"
                const repairedContent = valueContent.replace(/(?<!\\)"/g, '\\"');
                return `: "${repairedContent}`;
        });
        // 7. 再次解析；失败则返回 null
        try { return JSON.parse(s); } catch (e) {
                console.error('extractJson() failed:', e, '\nProblematic string:', s);
                console.error("String that failed parsing:", raw);
                return null;
        }
}