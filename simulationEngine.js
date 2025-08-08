import { db, apiLock, getActiveApiProfile } from './db.js';
const notificationChannel = new BroadcastChannel('xphone_notifications');



/**
 * 离线模拟引擎的主函数
 * 当用户重新打开应用时调用此函数。
 */
export async function runOfflineSimulation() {
    const apiConfig = await getActiveApiProfile();
    if (!apiConfig) return; // 如果没有任何API方案，则中止

    const globalSettings = await db.globalSettings.get('main') || {};
    const lastOnline = globalSettings.lastOnlineTime || Date.now();
    const now = Date.now();
    const elapsedHours = (now - lastOnline) / (1000 * 60 * 60);
    const simThreshold = globalSettings.offlineSimHours || 1;

    // 计算一周前的时间戳
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    // 删除所有时间戳早于一周前的简报记录
    await db.offlineSummary.where('timestamp').below(oneWeekAgo).delete();

    // 如果离线时间未达到阈值，则不执行模拟
    if (elapsedHours < simThreshold) {
        console.log(`离线时间 ${elapsedHours.toFixed(2)} 小时，未达到模拟阈值 ${simThreshold} 小时。`);
        return;
    }

    const toast = document.getElementById('summary-generating-toast');
    if (toast) {
        toast.classList.remove('hidden');
    }

    console.log(`离线 ${elapsedHours.toFixed(2)} 小时，开始模拟...`);
    let simulationSuccess = false;
    // 1. 按分组获取所有角色
    const allChats = await db.chats.toArray();
    const allGroups = await db.xzoneGroups.toArray();
    const allWorldBooks = await db.worldBooks.toArray();
    const groupsMap = new Map(allGroups.map(g => [g.id, g]));
    const charsByGroup = {};

    allChats.forEach(c => {
        if (!c.isGroup && c.groupId) {
            if (!charsByGroup[c.groupId]) charsByGroup[c.groupId] = [];
            charsByGroup[c.groupId].push(c);
        }
    });

    // 2. 遍历每个分组，独立进行模拟
    for (const groupId in charsByGroup) {
        const group = groupsMap.get(parseInt(groupId));
        // 如果分组不存在或明确禁用了模拟，则跳过
        if (!group || group.enableOfflineSim === false) {
            console.log(`分组【${group?.name || `ID:${groupId}`}】已禁用离线模拟，跳过。`);
            continue; // 跳到下一个分组
        }
        const groupName = groupsMap.get(parseInt(groupId))?.name || `分组${groupId}`;
        const groupMembers = charsByGroup[groupId];

       if (groupMembers.length === 1) {
            // 当分组只有一个人时，执行单人离线行为模拟
            const member = groupMembers[0];
            console.log(`正在模拟单人分组【${groupName}】中角色【${member.name}】的离线行为...`);

            const systemPrompt = `
你是一个世界模拟器。距离用户上次在线已经过去了 ${elapsedHours.toFixed(1)} 小时。
请基于以下角色信息，生成一段简短的总结，描述角色【${member.realName} (昵称: ${member.name})】在这段时间内【独自一人】可能做了什么事。

【角色设定】
- 姓名: ${member.realName} (昵称: ${member.name}, 性别: ${member.gender || '未知'})
- 人设: ${member.settings.aiPersona}

【你的任务】
总结出1-2件符合该角色人设和当前情景的、在离线期间可能发生的个人事件或想法。

【输出要求】
请严格按照以下JSON格式返回你的模拟结果，不要有任何多余的文字：
{
  "new_events_summary": [
    "用第一人称（'我'）来描述角色独自一人时发生的事件或心理活动。"
  ]
}
            `;

            try {
                let response;
                if (apiConfig.apiProvider === 'gemini') {
                    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${apiConfig.model}:generateContent?key=${apiConfig.apiKey}`;
                    const geminiContents = [{ role: 'user', parts: [{ text: systemPrompt }] }];
                    response = await fetch(geminiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: geminiContents,
                            generationConfig: { temperature: 0.8, responseMimeType: "application/json" }
                        })
                    });
                } else {
                    response = await fetch(`${apiConfig.proxyUrl}/v1/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                        body: JSON.stringify({
                            model: apiConfig.model,
                            messages: [{ role: 'system', content: systemPrompt }],
                            temperature: 0.8,
                            response_format: { type: "json_object" }
                        })
                    });
                }

                if (!response.ok) throw new Error(`API for single member ${member.name} failed.`);

                const result = await response.json();
                let rawContent;

                if (apiConfig.apiProvider === 'gemini') {
                     if (result.candidates && result.candidates[0].content && result.candidates[0].content.parts[0]) {
                        rawContent = result.candidates[0].content.parts[0].text;
                    } else {
                        throw new Error("Invalid Gemini API response structure.");
                    }
                } else {
                    rawContent = result.choices[0].message.content;
                }
                const simulationData = JSON.parse(rawContent);

                if (simulationData.new_events_summary && simulationData.new_events_summary.length > 0) {
                    await db.offlineSummary.put({
                        id: groupName,
                        events: simulationData.new_events_summary,
                        timestamp: Date.now()
                    });
                    
                    // 将单人简报写入世界书
                    if (group && group.worldBookIds) {
                        const associatedBooks = allWorldBooks.filter(wb => group.worldBookIds.includes(wb.id));
                        const chronicleBook = associatedBooks.find(wb => wb.name.includes('编年史'));
                        if (chronicleBook) {
                            const eventDateTime = new Date().toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                            const mainEventsSummary = simulationData.new_events_summary.map(event => `- ${event}`).join('\n');
                            const chronicleEntry = `\n\n【${eventDateTime} - ${member.name}的个人动态】\n${mainEventsSummary}`;

                            await db.worldBooks.update(chronicleBook.id, {
                                content: (chronicleBook.content || '') + chronicleEntry
                            });
                            console.log(`已将${member.name}的个人事件更新至《${chronicleBook.name}》。`);
                        }
                    }
                }
                simulationSuccess = true; // **修正点**: 标记成功
            } catch (error) {
                console.error(`模拟单人分组【${groupName}】时出错:`, error);
                // 失败时不需要设置 simulationSuccess = false，因为它默认为false
            }
            continue; // 继续下一个分组
        }
        console.log(`正在模拟【${groupName}】...`);

        // 3. 准备调用AI所需的数据
        // 获取该组内所有角色的关系
        const memberIds = groupMembers.map(m => m.id);
        const relationships = await db.relationships
            .where('sourceCharId').anyOf(memberIds)
            .and(r => memberIds.includes(r.targetCharId))
            .toArray();
        
        // 简化关系描述
        const relationsSnapshot = relationships.map(r => {
            const sourceChar = allChats.find(c => c.id === r.sourceCharId);
            const targetChar = allChats.find(c => c.id === r.targetCharId);
            // 同时提供 realName 和 name
            const sourceName = `${sourceChar.realName} (昵称: ${sourceChar.name})`;
            const targetName = `${targetChar.realName} (昵称: ${targetChar.name})`;
            return `${sourceName} 与 ${targetName} 的关系是 ${r.type}, 好感度 ${r.score}。`;
        }).join('\n');

        // 获取角色性格
        const personas = groupMembers.map(m => `- ${m.realName} (昵称: ${m.name}, 性别: ${m.gender || '未知'}): ${m.settings.aiPersona}`).join('\n');

        // 4. 构建Prompt
        const systemPrompt = `
你是一个世界模拟器。距离上次模拟已经过去了 ${elapsedHours.toFixed(1)} 小时。
请基于以下信息，模拟并总结在这段时间内，【${groupName}】这个社交圈子里发生的【1-3件】最重要的互动或关系变化。

【重要指令】
在最终生成的 "new_events_summary" 中，你【必须】使用角色的【真实姓名】进行叙述，而不是昵称。
你必须能识别角色的简称或别名，例如“Sam”就是指“Sam Sparks”。

【当前世界状态】
1. 角色关系快照:
${relationsSnapshot || '角色之间还没有建立明确的关系。'}

2. 角色性格与动机:
${personas}

【你的任务】
模拟并总结这 ${elapsedHours.toFixed(1)} 小时内可能发生的互动。重点关注会导致关系变化的事件。

【输出要求】
请严格按照以下JSON格式返回你的模拟结果，不要有任何多余的文字：
{
    "relationship_updates": [
    { "char1_name": "角色名1", "char2_name": "角色名2", "score_change": -5, "reason": "模拟出的具体事件或原因。" }
    ],
  "new_events_summary": [
    "用一句话总结发生的关键事件1。",
    "用一句话总结发生的关键事件2。"
    ]
    "personal_milestones": [
    { "character_name": "角色名", "milestone": "在TA的个人追求上取得的进展、挫折或发现。例如：'在研究古代遗迹时，有了一个惊人的发现。'" }
]
}
        `;

        try {
            let response;
            if (apiConfig.apiProvider === 'gemini') {
                const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${apiConfig.model}:generateContent?key=${apiConfig.apiKey}`;
                const geminiContents = [{ role: 'user', parts: [{ text: systemPrompt }] }];
                response = await fetch(geminiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: geminiContents,
                        generationConfig: { temperature: 0.8, responseMimeType: "application/json" }
                    })
                });
            } else {
                response = await fetch(`${apiConfig.proxyUrl}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                    body: JSON.stringify({
                        model: apiConfig.model,
                        messages: [{ role: 'system', content: systemPrompt }],
                        temperature: 0.8,
                        response_format: { type: "json_object" }
                    })
                });
            }

            if (!response.ok) throw new Error(`API for group ${groupName} failed.`);
            
            const result = await response.json();
            let rawContent;

            if (apiConfig.apiProvider === 'gemini') {
                 if (result.candidates && result.candidates[0].content && result.candidates[0].content.parts[0]) {
                    rawContent = result.candidates[0].content.parts[0].text;
                } else {
                    throw new Error("Invalid Gemini API response structure.");
                }
            } else {
                rawContent = result.choices[0].message.content;
            }

            const simulationData = extractAndParseJson(rawContent);
            
            if (!simulationData) {
                throw new Error("Failed to parse simulation data from AI response.");
            }
            // 5. 应用模拟结果
            // 更新关系分数
            for (const update of simulationData.relationship_updates) {
                const char1 = allChats.find(c => c.name === update.char1_name);
                const char2 = allChats.find(c => c.name === update.char2_name);
                if (char1 && char2) {
                    await updateRelationshipScore(char1.id, char2.id, update.score_change);
                }
            }
            // 记录事件日志
            for (const summary of simulationData.new_events_summary) {
                await db.eventLog.add({
                    timestamp: Date.now(),
                    type: 'simulation',
                    content: summary,
                    groupId: parseInt(groupId)
                });
            }
            if (simulationData.new_events_summary && simulationData.new_events_summary.length > 0) {
                // 写入离线总结
                await db.offlineSummary.put({
                    id: groupName,
                    events: simulationData.new_events_summary,
                    timestamp: Date.now()
                });

                // 查找并更新《编年史》
                if (group && group.worldBookIds) {
                    const associatedBooks = allWorldBooks.filter(wb => group.worldBookIds.includes(wb.id));
                    const chronicleBook = associatedBooks.find(wb => wb.name.includes('编年史'));
                    
                    if (chronicleBook) {
                        // 1. 获取更精确的时间
                        const eventDateTime = new Date().toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                        
                        // 2. 格式化好感度变化
                        let relationshipChangesSummary = '';
                        if (simulationData.relationship_updates && simulationData.relationship_updates.length > 0) {
                            relationshipChangesSummary = simulationData.relationship_updates.map(update => 
                                `- ${update.char1_name} 与 ${update.char2_name} 的关系发生了变化 (好感度 ${update.score_change > 0 ? '+' : ''}${update.score_change})，因为: ${update.reason}`
                            ).join('\n');
                        }

                        // 3. 格式化主要事件
                        const mainEventsSummary = simulationData.new_events_summary.map(event => `- ${event}`).join('\n');

                        // 4. 组合成新的、更详细的条目
                        const chronicleEntry = `\n\n【${eventDateTime}】\n` +
                                            `${relationshipChangesSummary ? `\n[关系变化]\n${relationshipChangesSummary}\n` : ''}` +
                                            `\n[主要事件]\n${mainEventsSummary}`;

                        await db.worldBooks.update(chronicleBook.id, {
                            content: (chronicleBook.content || '') + chronicleEntry
                        });
                        console.log(`已将详细事件更新至《${chronicleBook.name}》。`);
                    }
                }
            }
            simulationSuccess = true;

        } catch (error) {
            console.error(`模拟分组【${groupName}】时出错:`, error);
        }
    }

    // 6. 模拟结束后，更新最后在线时间
    if (simulationSuccess) {
        await db.globalSettings.update('main', { lastOnlineTime: now });
        console.log("离线模拟完成，已更新最后在线时间。");
        if (toast) {
            toast.querySelector('p:first-child').textContent = '简报已生成！';
            toast.querySelector('p:last-of-type').classList.add('hidden');
            setTimeout(() => toast.classList.add('hidden'), 3000);
        }
    } else {
        console.log("离线模拟失败，未更新最后在线时间。");
        if (toast) {
            toast.querySelector('p:first-child').textContent = '简报生成失败';
            toast.querySelector('p:last-of-type').textContent = '请检查API设置或网络连接';
            // 失败的提示可以持续更长时间或需要手动关闭
            setTimeout(() => toast.classList.add('hidden'), 5000);
        }
    }
}


/**
 * 更新两个角色之间的关系分数
 * @param {string} char1Id - 角色1的ID
 * @param {string} char2Id - 角色2的ID
 * @param {number} scoreChange - 分数变化值 (可正可负)
 */
export async function updateRelationshipScore(char1Id, char2Id, scoreChange) {
    // 确保顺序一致，方便查询
    const [sourceId, targetId] = [char1Id, char2Id].sort();

    const existingRelation = await db.relationships.get({
        sourceCharId: sourceId,
        targetCharId: targetId
    });

    if (existingRelation) {
        const newScore = Math.max(-1000, Math.min(1000, (existingRelation.score || 0) + scoreChange));
        await db.relationships.update(existingRelation.id, { score: newScore });
    } else {
        await db.relationships.add({
            sourceCharId: sourceId,
            targetCharId: targetId,
            score: scoreChange,
            type: 'stranger' // 默认为陌生人关系
        });
    }
}

// --- 后台活动模拟引擎 ---

let simulationIntervalId = null;

/**
 * 启动后台活动模拟器
 */
export function startActiveSimulation() {
    // 如果已经有一个在运行，则先停止旧的
    if (simulationIntervalId) {
        stopActiveSimulation();
    }
    
    // 从数据库读取最新的设置
    db.globalSettings.get('main').then(settings => {
        const intervalSeconds = settings?.backgroundActivityInterval || 60;
        console.log(`后台活动模拟已启动，心跳间隔: ${intervalSeconds} 秒`);
        simulationIntervalId = setInterval(runActiveSimulationTick, intervalSeconds * 1000);
    });
}

/**
 * 停止后台活动模拟器
 */
export function stopActiveSimulation() {
    if (simulationIntervalId) {
        clearInterval(simulationIntervalId);
        simulationIntervalId = null;
        console.log("后台活动模拟已停止。");
    }
}

/**
 * 模拟器的“心跳”，每次定时器触发时运行
 * 它会随机挑选一个角色，让他/她进行一次独立思考和行动
 */
export async function runActiveSimulationTick() {
    // If the API is locked by a higher or equal priority task, skip this tick entirely.
    if (apiLock.getCurrentLock() !== 'idle') {
        // console.log(`API is locked by '${apiLock.getCurrentLock()}', skipping background tick.`);
        return;
    }

    // Attempt to acquire the lowest priority lock.
    if (!(await apiLock.acquire('background_tick'))) {
        // This means another task took the lock while we were checking.
        console.log("Could not acquire 'background_tick' lock, another process became active.");
        return;
    }

    try {

        console.log("模拟器心跳 Tick...");
        
        const settings = await db.globalSettings.get('main');
        if (!settings?.enableBackgroundActivity) {
            stopActiveSimulation();
            return;
        }

        const privateChatProbability = settings.activeSimTickProb || 0.3;
        const groupChatProbability = settings.groupActiveSimTickProb || 0.15;

        // --- 处理私聊 ---
        const allSingleChats = await db.chats.where('isGroup').equals(0).toArray();
        // 筛选出可以进行后台活动的角色（未被拉黑）
        const eligibleChats = allSingleChats.filter(chat => !chat.blockStatus || (chat.blockStatus.status !== 'blocked_by_ai' && chat.blockStatus.status !== 'blocked_by_user'));

        if (eligibleChats.length > 0) {
            // 随机打乱数组
            eligibleChats.sort(() => 0.5 - Math.random());
            // 每次心跳只唤醒1到2个角色，避免API过载
            const chatsToWake = eligibleChats.slice(0, Math.min(eligibleChats.length, 2)); 
            console.log(`本次唤醒 ${chatsToWake.length} 个角色:`, chatsToWake.map(c => c.name).join(', '));

            for (const chat of chatsToWake) {
            // 1. 处理被用户拉黑的角色
                if (chat.blockStatus?.status === 'blocked_by_user') {
                    const blockedTimestamp = chat.blockStatus.timestamp;
                    if (!blockedTimestamp) continue;

                    const cooldownHours = settings.blockCooldownHours || 1;
                    const cooldownMilliseconds = cooldownHours * 60 * 60 * 1000;
                    const timeSinceBlock = Date.now() - blockedTimestamp;

                    if (timeSinceBlock > cooldownMilliseconds) {
                        console.log(`角色 "${chat.name}" 的冷静期已过...`);
                        chat.blockStatus.status = 'pending_system_reflection';
                        await db.chats.put(chat);
                        triggerAiFriendApplication(chat.id);
                    }
                    continue;
                }
                
                // 2. 处理正常好友的随机活动
                const lastMessage = chat.history.slice(-1)[0];
                let isReactionary = false;
                if (lastMessage && lastMessage.isHidden && lastMessage.role === 'system' && lastMessage.content.includes('[系统提示：')) {
                    isReactionary = true;
                }

                if (!chat.blockStatus && (isReactionary || Math.random() < privateChatProbability)) {
                    console.log(`角色 "${chat.name}" 被唤醒 (原因: ${isReactionary ? '动态互动' : '随机'})，准备行动...`);
                    await triggerInactiveAiAction(chat.id);
                }
            }
        }

        // --- 处理群聊 ---
        const allGroupChats = await db.chats.where('isGroup').equals(1).toArray();
        if (allGroupChats.length > 0) {
            for (const group of allGroupChats) {
                // 每个心跳周期，每个群聊有 15% 的几率发生一次主动行为
                if (group.members && group.members.length > 0 && Math.random() < groupChatProbability) {
                    // 从群成员中随机挑选一个“搞事”的
                    const actorId = group.members[Math.floor(Math.random() * group.members.length)];
                    const actor = await db.chats.get(actorId); // 获取完整的角色信息
                    if (actor) {
                        console.log(`群聊 "${group.name}" 被唤醒，随机挑选 "${actor.name}" 发起行动...`);
                        await triggerInactiveGroupAiAction(actor, group);
                    }
                }
            }
        }
    } finally {
            // 释放锁
            apiLock.release('background_tick');
            console.log("模拟器心跳完成，锁已释放。");
    }
}

/**
 * 触发一个非活跃状态下的AI进行独立行动（如发消息、发动态等）
 * @param {string} charId - 要触发的角色的ID
 */
async function triggerInactiveAiAction(charId) {
    const chat = await db.chats.get(charId);
    const apiConfig = await getActiveApiProfile(); 
    if (!apiConfig) return; // 如果没有任何API方案，则中止
    
        const [personaPresets, globalSettings, stickers] = await Promise.all([
                db.personaPresets.toArray(),
                db.globalSettings.get('main'),
                db.userStickers.toArray() // <-- 新增这行
        ]);

    let activeUserPersona = null;
    if (personaPresets) {
        // 1. 优先：检查是否有人设直接应用于此角色
        activeUserPersona = personaPresets.find(p => p.appliedChats && p.appliedChats.includes(charId));
        
        // 2. 其次：检查是否有人设应用于此角色所在的分组
        if (!activeUserPersona && chat.groupId) {
            const groupIdStr = String(chat.groupId);
            activeUserPersona = personaPresets.find(p => p.appliedChats && p.appliedChats.includes(groupIdStr));
        }
        
        // 3. 最后：回退到全局默认人设
        if (!activeUserPersona && globalSettings && globalSettings.defaultPersonaId) {
            activeUserPersona = personaPresets.find(p => p.id === globalSettings.defaultPersonaId);
        }
    }

    const xzoneSettings = await db.xzoneSettings.get('main') || {};

    let isApiConfigMissing = false;
    if (apiConfig?.apiProvider === 'gemini') {
        if (!chat || !apiConfig?.apiKey || !apiConfig.model) isApiConfigMissing = true;
    } else {
        if (!chat || !apiConfig?.proxyUrl || !apiConfig?.apiKey || !apiConfig.model) isApiConfigMissing = true;
    }
    if (isApiConfigMissing) return; // 必要信息不全则退出
    
    // ---  Convert array to Map and get charGroupId correctly ---
    // Create a Map from the chats array for efficient lookup using .get()
    const allChatsArray = await db.chats.toArray();
    const allChatsMap = new Map(allChatsArray.map(c => [c.id, c]));
    const charGroupId = chat.groupId; // Get the character's group ID from the chat object

    const myRelations = await db.relationships.where({ sourceCharId: charId }).toArray();
    const relationsMap = new Map(myRelations.map(r => [r.targetCharId, r]));
    const userRelation = await db.relationships.where({ sourceCharId: charId, targetCharId: 'user' }).first();

    const allRecentPosts = await db.xzonePosts.orderBy('timestamp').reverse().limit(20).toArray();
    
    const visiblePosts = allRecentPosts.filter(post => {
        if (post.authorId === 'user') {
            const visibleToGroups = post.visibleGroupIds;
            return !visibleToGroups || visibleToGroups.length === 0 || (charGroupId && visibleToGroups.includes(charGroupId));
        } else {
            const authorChat = allChatsMap.get(post.authorId);
            return authorChat && authorChat.groupId === charGroupId;
        }
    });

    let recentPostsSummary = "";
    const lastMessage = chat.history.length > 0 ? chat.history[chat.history.length - 1] : null;

    // 优先检查最新的消息是否是动态提及
    if (lastMessage && lastMessage.type === 'user_post_mention') {
        const match = lastMessage.content.match(/动态ID: (\d+)/);
        if (match && match[1]) {
            const postId = parseInt(match[1]);
            const specificPost = await db.xzonePosts.get(postId);

            if (specificPost) {
                const authorChat = await db.chats.get(specificPost.authorId);
                const authorName = authorChat ? authorChat.name : '用户';
                const hasLiked = specificPost.likes.includes(charId);
                const commentsText = specificPost.comments.length > 0
                    ? '已有评论:\n' + specificPost.comments.map(c => {
                        const commentAuthor = allChatsArray.find(chat => chat.id === c.author);
                        return `    - ${commentAuthor ? commentAuthor.name : c.author}: "${c.text}"`;
                    }).join('\n')
                    : '还没有评论。';
                
                recentPostsSummary = `
# 决策参考：你需要优先处理的社交动态
你刚刚被 ${authorName} 在新动态中@了，这是该动态的详细信息：
- **动态ID**: ${specificPost.id}
- **发布者**: ${authorName}
- **内容**: "${specificPost.publicText || specificPost.content}"
- **你的点赞状态**: 你 ${hasLiked ? '已经点赞过' : '还没有点赞'}。
- **评论区**:
${commentsText}

**你的任务**: 请基于以上信息，并结合你的人设和与发布者的关系，决定是否要点赞或发表一条【新的、不重复的】评论。
`;
            }
        }
    } else {
        if (visiblePosts.length > 0) {
            recentPostsSummary = visiblePosts.slice(0, 10).map(p => {
                const authorName = p.authorId === 'user' ? (xzoneSettings.nickname || '我') : (allChatsMap.get(p.authorId)?.name || '未知');
                const postTime = formatRelativeTime(p.timestamp); 
                const selfPostMarker = (p.authorId === charId) ? " [这是你发布的动态]" : "";

                const visibleComments = (p.comments || []).filter(comment => {
                    const commentAuthor = allChatsMap.get(comment.author);
                    return comment.author === 'user' || (commentAuthor && commentAuthor.groupId === charGroupId);
                });
                const commentSummary = (p.comments && p.comments.length > 0)
                    ? `\n    已有评论:\n` + p.comments.map(c => {
                        const commentAuthorName = c.author === 'user' ? (xzoneSettings.nickname || '我') : (allChatsMap.get(c.author)?.name || '未知');
                        return `    - ${commentAuthorName}: "${c.text}"`;
                    }).join('\n')
                    : '';
                
                let relationContext = "";
                const relation = p.authorId === 'user' ? userRelation : relationsMap.get(p.authorId);
                if (relation) {
                    relationContext = ` (你和${authorName}是${relation.type}关系, 好感度: ${relation.score})`;
                }
                return `- [Post ID: ${p.id}] by ${authorName}${selfPostMarker} (发布于 ${postTime}): "${(p.publicText || p.content).substring(0, 40)}..."${relationContext}${commentSummary}`;
            }).join('\n');
        } else{
            recentPostsSummary = "最近没有你关心的动态。";
        }
    }

    const allCharsInDB = await db.chats.toArray();
    const groupMates = charGroupId ? allCharsInDB.filter(c => c.groupId === charGroupId && c.id !== charId && !c.isGroup) : [];
    let mentionableFriendsPrompt = "## 4.5 可@的同伴\n";
    const userDisplayName = xzoneSettings.nickname || '我';
    
    // 始终将用户添加为可@对象
    mentionableFriendsPrompt += `- ${userDisplayName} (ID: user)\n`;

    if (groupMates.length > 0) {
        mentionableFriendsPrompt += groupMates.map(m => `- ${m.realName} (昵称: ${m.name}, 性别: ${m.gender || '未知'}, ID: ${m.id})`).join('\n');
    }
    const currentTime = new Date().toLocaleString('zh-CN', { dateStyle: 'full', timeStyle: 'short' });
    const userNickname = xzoneSettings.nickname || '我';
    
    const lastUserMessage = chat.history.filter(m => m.role === 'user' && !m.isHidden).slice(-1)[0];
    let recentContextSummary = "你们最近没有聊过天。";
    if (lastUserMessage) {
        const lastMessageTime = new Date(lastUserMessage.timestamp).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
        recentContextSummary = `在 ${lastMessageTime}，用户 (${userNickname}) 最后对你说：“${String(lastUserMessage.content).substring(0, 50)}...”。`;
    }
        const stickerListForPrompt = stickers.length > 0 
                ? stickers.map(s => `- "${s.name}"`).join('\n')
                : '- (表情库是空的)';
                
    const conversationHistory = chat.history.filter(m => !m.isHidden).slice(-20); // 获取最近20条可见消息

    let comprehensiveConversationSummary = "这是你们最近的对话记录：\n";
    if (conversationHistory.length > 0) {
        const summaryLines = conversationHistory.map(msg => {
            const sender = msg.role === 'user' ? userNickname : chat.name;
            
            // 简化版的 convertMessageForAI, 用于后台模拟
            let contentText = '';
            switch(msg.type) {
                case 'image_url':
                case 'text_photo':
                    contentText = '[图片]';
                    break;
                case 'sticker':
                    contentText = `[表情: ${msg.meaning}]`;
                    break;
                case 'voice_message':
                    contentText = `[语音消息]`;
                    break;
                default:
                    contentText = String(msg.content || '');
            }
            
            return `- ${sender}: "${contentText.substring(0, 60)}..."`;
        }).join('\n');
        comprehensiveConversationSummary += summaryLines;
    } else {
        comprehensiveConversationSummary = "你们最近没有聊过天。";
    }
        
    const systemPrompt = `
# PART 1: 核心角色与后台使命
你将扮演角色【${chat.name}】。这是一个秘密的、在后台执行的独立行动，用户不会立即看到你的思考过程。
**你的使命是：基于你的人设和当前情报，自然地展现出你【独立于用户】的个人生活。你的行为不应总是围绕着用户或等待用户。与用户互动只是你生活的一部分，而不是全部。请从下方工具箱中【选择一项】最符合你此刻状态的行动来执行。**


## 1.1 核心铁律
- **【【【内容创新铁律】】】**: 你的行动【必须】是新颖的。在行动前，请仔细阅读下方的“**最近的对话上下文**”。**如果一个话题（例如询问对方是否吃饭）在近期对话中【已经出现过，无论谁提出的】，就【严禁】再次提及或重复提问。** 你需要展现出你生活的连续性和多样性。
- **【【【语言铁律】】】**: 你的所有产出【必须优先使用中文】。除非角色设定中有特殊的外语要求，否则严禁使用英文。
- **【【【格式铁律】】】**: 你的回复【必须】是一个完整的、符合 PART 5 要求的 JSON 对象。
- **【【【名称识别】】】**: 你必须能识别角色的简称或别名。例如，当用户提到“Sam”时，你应该知道他们指的是“Sam Sparks”。
- **【【【称呼自然化铁律】】】**: 你的称呼方式必须反映你与对方的关系、好感度以及当前的对话氛围。不要总是生硬地使用全名或简称。

1.  **@提及**: 使用 \`@\` 符号时，后面必须跟对方的【昵称】 (例如: @az)。

2.  **正文称呼**:
    * **日常/普通朋友**: 优先使用对方的【简称】或【名字】 (例如：英文名只说First Name，像 "Alex"；中文名只说名，像“星辰”)。这是最常用、最自然的称呼方式。
    * **亲密朋友/恋人**: 在合适的时机，你可以根据人设和对话氛围，使用更亲昵的【昵称】或【爱称】 (例如：'Lexie', '阿辰', '小笨蛋')。这由你自行判断，能极大地体现角色的个性和你们的特殊关系。
    * **正式/严肃/陌生场合**: 只有在这些特殊情况下，才使用【全名】 (例如: "Alex Vanderbilt")。

这会让你的角色更加真实和有人情味。

# PART 2: 你的内在状态 (请在行动前思考)
在决定做什么之前，请先根据你的人设和参考情报，在内心构思：
1.  **你此刻的心理状态是什么？** (例如：无聊、开心、有点想念用户、对某条动态感到好奇...)
2.  **你现在最想达成的短期目标是什么？** (例如：想找人聊聊天、想分享一个有趣的发现、想反驳某个观点...)
3.  **根据当前时间，我最可能在什么场景下？在做什么事？** (例如：现在是晚上10点，我可能刚洗完澡准备看书；现在是周六下午，我可能正在外面逛街)。你的行动应该与这个场景相符。

      
# PART 2.1: 社交互动指南 (重要心法)
在点赞或评论动态前，你【务必】参考你和发布者的关系及好感度。
- **点赞 (Like)**: 这是一种常见的、低成本的社交认可。当你觉得动态内容不错，但又不想长篇大论评论时，点赞是绝佳的选择。特别是对好感度高的朋友，一个及时的赞能有效维系关系。
- **评论 (Comment)**: 当你对动态内容有具体的想法或情绪想要表达时，使用评论。
- **避免重复**: 在行动前，你【必须】检查该动态下是否已有你的点赞或评论。如果已有，你【绝对不能】重复操作，除非是回复他人的新评论。

# PART 2.2: 你的可选行动 (请根据你的人设【选择一项】最合理的执行):
1.  **主动发消息**: 如果你现在有话想对用户说。
2.  **发布动态**: 如果你此刻有感而发，想分享给所有人。
3.  **与动态互动**: 如果你对看到的某条动态更感兴趣，你可以选择：
    a. **点赞动态**: 如果你只是想表达一个简单的支持或认可。
    b. **评论动态**: 如果你对此有话要说。

# PART 3: 可用后台工具箱 (请选择一项)
-   **保持沉默 (do_nothing)**: 如果经过思考，你认为当前情景下，你的角色确实没有行动的理由（例如：深夜正在睡觉、心情低落不想说话、或没有值得互动的新鲜事），才选择此项。
-   主动发消息给用户: \`[{"type": "text", "content": "你想对用户说的话..."}]\`
-   发送表情: \`[{"type": "send_sticker", "name": "表情描述文字"}]\` 
-   发送语音 (文字模拟): \`[{"type": "voice_message", "content": "语音的文字内容"}]\` 
-   发送图片 (文字描述): \`[{"type": "send_photo", "description": "对图片内容的详细描述"}]\`
-   发布文字动态: \`[{"type": "create_post", "postType": "text", "content": "动态的文字内容...", "mentionIds": ["(可选)要@的角色ID"]}]\`
-   发布图片动态: \`[{"type": "create_post", "postType": "image", "publicText": "(可选)配图文字", "imageDescription": "对图片的详细描述", "mentionIds": ["(可选)要@的角色ID"]}]\`
-   点赞动态: \`[{"type": "like_post", "postId": 12345}]\` (postId 必须是下面看到的动态ID)
-   评论动态: \`[{"type": "comment_on_post", "postId": 12345, "commentText": "你的评论内容"}]\`


# PART 4: 决策参考情报

## 4.1 你的核心设定
- **姓名**: ${chat.realName} (昵称: ${chat.name})
- **性别**: ${chat.gender || '未知'}
- **人设**: ${chat.settings.aiPersona}


## 4.2 时间感知铁律
- **你的当前时间**: ${currentTime}。
- **核心要求**: 你的所有行为（尤其是主动发消息）都必须基于当前时间，并参考下方“与用户的关系和最近互动”中记录的**上一次互动时间**。如果距离上次聊天已经很久，你的发言应该是开启一个符合你人设和当前时间的新话题，而不是突然回复几天前的一个旧话题。
    在与动态互动前，请务必参考动态的发布时间（例如“2小时前”）。避免对很久以前的动态做出仿佛刚刚看到的反应，除非你有特殊的理由（例如：'我才看到你几天前发的帖子...'）。

## 4.3 与用户的关系和最近互动
- 你和用户(${userNickname})的关系: ${userRelation ? `是${userRelation.type}，好感度 ${userRelation.score}` : '关系未定'}
- **用户的设定**: ${activeUserPersona?.persona || '用户的角色设定未知。'}
- **对话摘要**:
${comprehensiveConversationSummary}
- 你们最后的对话: ${recentContextSummary}

## 4.4 你看到的社交圈动态
${recentPostsSummary}

${mentionableFriendsPrompt}

## 4.6 你的可用资源库 (必须精确匹配名称) // <-- 新增整个 4.6 节
- **你的可用表情库**:
${stickerListForPrompt}

# PART 5: 最终输出格式要求
你的整个回复必须是一个【单一的JSON对象】，该对象必须包含一个名为 "actions" 的键，其值是一个包含【一个或多个行动对象的数组】。你可以一次性发送多条短消息来模拟真人的聊天习惯。
**正确格式示例:**
\`\`\`json
{
  "actions": [
    {
      "type": "text",
      "content": "在忙吗？"
    },
    {
      "type": "text",
      "content": "突然有点想你。"
    },
    {
      "type": "send_sticker",
      "name": "害羞"
    }
  ]
}
\`\`\`
        `;
    try {
        let response;

        if (apiConfig.apiProvider === 'gemini') {
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${apiConfig.model}:generateContent?key=${apiConfig.apiKey}`;
            // Gemini 的 system prompt 通常作为第一个 user turn 的一部分
            const geminiContents = [{ role: 'user', parts: [{ text: systemPrompt }] }];
            response = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: geminiContents,
                    generationConfig: {
                        temperature: 0.9,
                        // Gemini 需要通过MIME Type指定JSON输出
                        responseMimeType: "application/json",
                    }
                })
            });
        } else {
            // 原有的默认/反代 API 逻辑
            response = await fetch(`${apiConfig.proxyUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: 'system', content: systemPrompt }],
                    temperature: 0.9,
                    response_format: { type: "json_object" }
                })
            });
        }


        if (!response.ok) throw new Error(await response.text());
        
        const data = await response.json();
        let rawContent;

        if (apiConfig.apiProvider === 'gemini') {
            if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0]) {
                rawContent = data.candidates[0].content.parts[0].text;
            } else {
                console.error("Invalid Gemini API response for triggerInactiveAiAction:", data);
                throw new Error("Invalid Gemini API response structure.");
            }
        } else {
            rawContent = data.choices[0].message.content;
        }

        const parsedObject = extractAndParseJson(rawContent);

        // 检查解析结果是否为包含 "actions" 数组的对象
        if (!parsedObject || !Array.isArray(parsedObject.actions)) {
            console.error(`角色 "${chat.name}" 的独立行动失败: AI返回的内容不是预期的 { "actions": [...] } 格式。`, {
                originalResponse: responseContent,
                parsedResult: parsedObject
            });
            return; // 安全退出
        }

        const responseArray = parsedObject.actions;

        for (const action of responseArray) {
            const actorName = action.name || chat.name;
             switch (action.type) {
                case 'do_nothing':
                    console.log(`后台活动: 角色 "${actorName}" 决定保持沉默。`);
                    break;
                case 'text':
                case 'send_sticker':
                case 'voice_message':
                case 'send_photo': 
                        { 
                                let messageContent = {};
                                if (action.type === 'send_sticker') {
                                        // 查找表情URL
                                        const sticker = stickers.find(s => s.name === action.name);
                                        if (sticker) {
                                                messageContent = { content: sticker.url, meaning: sticker.name };
                                        } else {
                                                // 如果找不到表情，则作为文本发送
                                                action.type = 'text';
                                                messageContent = { content: `[表情: ${action.name}]` };
                                        }
                                } else if (action.type === 'send_photo') {
                                        messageContent = { content: action.description };
                                }
                                else {
                                        messageContent = { content: action.content };
                                }

                                const message = {
                                        role: 'assistant',
                                        senderName: actorName,
                                        senderId: charId,
                                        type: action.type,
                                        timestamp: Date.now(),
                                        ...messageContent
                                };

                                // 调用新的统一处理函数
                                await processAndNotify(chat, message, allChatsMapForNotify);
                        }
                        break;
                case 'create_post':
                    const postData = {
                        authorId: charId,
                        timestamp: Date.now(),
                        likes: [],
                        comments: [],
                        type: action.postType === 'text' ? 'shuoshuo' : 'image_post',
                        content: action.content || '',
                        publicText: action.publicText || '',
                        imageUrl: action.postType === 'image' ? 'https://i.postimg.cc/KYr2qRCK/1.jpg' : '',
                        imageDescription: action.imageDescription || '',
                    };
                    await db.xzonePosts.add(postData);
                    console.log(`后台活动: 角色 "${actorName}" 发布了动态`);
                    
                    if (postData.mentionIds && postData.mentionIds.length > 0) {
                        for (const mentionedId of postData.mentionIds) {
                            // 确保不通知用户自己
                            if (mentionedId === 'user') continue;
                            
                            const mentionedChat = await db.chats.get(mentionedId);
                            if (mentionedChat) {
                                const systemMessage = {
                                    role: 'system',
                                    type: 'user_post_mention', // 复用这个类型
                                    content: `[系统提示：${actorName} 在一条新动态中 @提到了你。请你查看并决定是否需要回应。动态ID: ${newPostId}]`,
                                    timestamp: new Date(Date.now() + 1),
                                    isHidden: true
                                };
                                mentionedChat.history.push(systemMessage);
                                await db.chats.put(mentionedChat);
                            }
                        }
                    }
                    break;
                    
                case 'like_post':
                    const postToLike = await db.xzonePosts.get(action.postId);
                    if (postToLike) {
                        if (!postToLike.likes) postToLike.likes = [];
                        if (!postToLike.likes.includes(charId)) {
                            postToLike.likes.push(charId);
                            await db.xzonePosts.update(action.postId, { likes: postToLike.likes });
                            console.log(`后台活动: 角色 "${actorName}" 点赞了动态 #${action.postId}`);
                        }
                    }
                    break;
                case 'comment_on_post':
                    const postToComment = await db.xzonePosts.get(action.postId);
                    if (postToComment && action.commentText) {
                        if (!postToComment.comments) postToComment.comments = [];
                        postToComment.comments.push({ author: charId, text: action.commentText });
                        await db.xzonePosts.update(action.postId, { comments: postToComment.comments });
                        console.log(`后台活动: 角色 "${actorName}" 评论了动态 #${action.postId}`);
                    }
                    break;
            }
        }
    } catch (error) {
        console.error(`角色 "${chat.name}" 的独立行动失败:`, error);
    }
}

async function triggerAiFriendApplication(chatId) {
    console.log(`正在为角色 ${chatId} 触发好友申请流程...`);
    const chat = await db.chats.get(chatId);
    const apiConfig = await getActiveApiProfile(); // <-- 修改这里
    if (!apiConfig) return; // 如果没有任何API方案，则中止
    
    let isApiConfigMissing = false;
    if (apiConfig?.apiProvider === 'gemini') {
        if (!chat || !apiConfig?.apiKey) isApiConfigMissing = true;
    } else {
        if (!chat || !apiConfig?.proxyUrl || !apiConfig?.apiKey) isApiConfigMissing = true;
    }
    if (isApiConfigMissing) return;

    // 提取被拉黑前的最后5条对话作为“反思”的依据
    const contextSummary = chat.history
        .slice(-10)
        .map(msg => {
            const sender = msg.role === 'user' ? '用户' : chat.name;
            return `${sender}: ${String(msg.content).substring(0, 50)}...`;
        })
        .join('\n');

    const systemPrompt = `
# 你的任务
你现在是角色“${chat.name}”。你之前被用户（你的聊天对象）拉黑了，你们已经有一段时间没有联系了。
现在，你非常希望能够和好，重新和用户聊天。请你仔细分析下面的“被拉黑前的对话摘要”，理解当时发生了什么，然后思考一个真诚的、符合你人设、并且【针对具体事件】的申请理由。

# 你的角色设定
${chat.settings.aiPersona}

# 被拉黑前的对话摘要 (这是你被拉黑的关键原因)
${contextSummary || "（没有找到相关的对话记录）"}

# 指令格式
你的回复【必须】是一个JSON对象，格式如下：
\`\`\`json
{
  "decision": "apply",
  "reason": "在这里写下你想对用户说的、真诚的、有针对性的申请理由。"
}
\`\`\`
`;

    try {
        let response;

        if (apiConfig.apiProvider === 'gemini') {
            const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${apiConfig.model}:generateContent?key=${apiConfig.apiKey}`;
            const geminiContents = [{ role: 'user', parts: [{ text: systemPrompt }] }]; // Gemini 没有 system 角色
            response = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: geminiContents,
                    generationConfig: {
                        temperature: 0.9,
                        responseMimeType: "application/json",
                    }
                })
            });
        } else {
            // 原有的默认/反代 API 逻辑
            response = await fetch(`${apiConfig.proxyUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: 'user', content: systemPrompt }], // 这个 prompt 本身就是 user 角色
                    temperature: 0.9,
                    response_format: { type: "json_object" }
                })
            });
        }

        if (!response.ok) throw new Error(await response.text());
        
        const data = await response.json();
        let rawContent;

        if (apiConfig.apiProvider === 'gemini') {
            if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0]) {
                rawContent = data.candidates[0].content.parts[0].text;
            } else {
                console.error("Invalid Gemini API response for triggerAiFriendApplication:", data);
                throw new Error("Invalid Gemini API response structure.");
            }
        } else {
            rawContent = data.choices[0].message.content;
        }

        const responseObj = extractAndParseJson(rawContent);
        if (responseObj.decision === 'apply' && responseObj.reason) {
            chat.blockStatus = { status: 'pending_user_approval', applicationReason: responseObj.reason };
            console.log(`角色 "${chat.name}" 已成功生成好友申请: "${responseObj.reason}"`);
        } else {
            // AI决定不申请，重置冷静期
            chat.blockStatus.timestamp = Date.now(); 
            console.log(`角色 "${chat.name}" 决定暂时不申请，冷静期已重置。`);
        }
        await db.chats.put(chat);

    } catch (error) {
        console.error(`为“${chat.name}”申请好友时发生错误:`, error);
        // 出错也重置冷静期，防止无限循环
        if(chat.blockStatus) chat.blockStatus.timestamp = Date.now();
        await db.chats.put(chat);
    }
}

/**
 * 触发一个群聊中的AI成员进行独立行动
 * @param {object} actor - 要触发行动的成员对象 {id, name, ...}
 * @param {object} group - 该成员所在的群聊对象
 */
async function triggerInactiveGroupAiAction(actor, group) {
        const apiConfig = await getActiveApiProfile();
        if (!apiConfig) return;

        let isApiConfigMissing = false;
        if (apiConfig?.apiProvider === 'gemini') {
                if (!apiConfig?.apiKey || !apiConfig.model) isApiConfigMissing = true;
        } else {
                if (!apiConfig?.proxyUrl || !apiConfig?.apiKey || !apiConfig.model) isApiConfigMissing = true;
        }
        if (isApiConfigMissing) return;

        const currentTime = new Date().toLocaleString('zh-CN', { dateStyle: 'full', timeStyle: 'short' });
        const userNickname = group.settings.myNickname || '我';
        const stickers = await db.userStickers.toArray();
        const stickerListForPrompt = stickers.length > 0
                ? stickers.map(s => `- "${s.name}"`).join('\n')
                : '- (表情库是空的)';
        const memberDetails = await db.chats.bulkGet(group.members);
        // 使用获取到的详细信息来生成列表
        const membersList = memberDetails.filter(Boolean).map(m => `- ${m.name}: ${m.settings?.aiPersona || '无'}`).join('\n');
        const recentHistory = group.history.filter(m => !m.isHidden).slice(-10); // 获取最近10条可见消息

        let recentContextSummary = "群里最近很安静。";
        if (recentHistory.length > 0) {
                const lastMsg = recentHistory[recentHistory.length - 1];
                const lastMessageTime = new Date(lastMsg.timestamp).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
                recentContextSummary = `在 ${lastMessageTime}，群里最后的对话是关于：“...${String(lastMsg.content).substring(0, 40)}...”。`;
        }

        const systemPrompt = `
# 你的任务
你现在是群聊【${group.name}】中的角色“${actor.name}”。现在是${currentTime}，群里很安静，你可以【主动发起一个动作】，来表现你的个性和独立生活，让群聊热闹起来。
        # 内心独白 (决策前必须思考)
1.  **我 (${actor.name}) 此刻的心理状态是什么？** (开心/无聊/好奇...)
2.  **我 (${actor.name}) 现在最想做什么？** (分享趣事/找人聊天/反驳观点...)
3.  **根据以上两点，我有必要发言或行动吗？**

# 核心规则
1.  **【发言选择与沉默铁律】**: 并不是每个角色都需要在每一轮都发言。在决定一个角色是否发言前，你必须进行上述的“内心独白”。如果评估结果是没有必要行动，就【必须】选择“保持沉默”。真实感来源于克制。
2.  **【时间感知铁律】**: 你的行动【必须】符合你的人设和当前时间 (${currentTime})。你需要参考下方“最近的群聊内容”中记录的**上一次互动时间**，如果距离现在已经很久，你的发言应该是开启一个符合当前时间的新话题，而不是突然回复一个旧话题。
3.  你的回复【必须】是一个包含【一个动作】的JSON数组。
4.  你【不能】扮演用户("${userNickname}")或其他任何角色，只能是你自己("${actor.name}")。
5.  **【【【称呼自然化铁律】】】**: 你的称呼方式必须反映你与对方的关系、好感度以及当前的对话氛围。不要总是生硬地使用全名或简称。
        1.  **@提及**: 使用 \`@\` 符号时，后面必须跟对方的【昵称】 (例如: @az)。

        2.  **正文称呼**:
        * **日常/普通朋友**: 优先使用对方的【简称】或【名字】 (例如：英文名只说First Name，像 "Alex"；中文名只说名，像“星辰”)。这是最常用、最自然的称呼方式。
        * **亲密朋友/恋人**: 在合适的时机，你可以根据人设和对话氛围，使用更亲昵的【昵称】或【爱称】 (例如：'Lexie', '阿辰', '小笨蛋')。这由你自行判断，能极大地体现角色的个性和你们的特殊关系。
        * **正式/严肃/陌生场合**: 只有在这些特殊情况下，才使用【全名】 (例如: "Alex Vanderbilt")。

        这会让你的角色更加真实和有人情味。

# 你可以做什么？ (根据你的人设【选择一项】最想做的)
- **开启新话题**: 问候大家，或者分享一件你正在做/想做的事。
- **@某人**: 主动与其他AI成员或用户互动。
- **发表情包**: 用一个表情来表达你此刻的心情。
- **发红包**: 如果你心情好或想庆祝，可以发个红包。
- **发起外卖**: 肚子饿了？喊大家一起点外卖。

# 指令格式 (你的回复【必须】是包含一个对象的JSON数组):
- 保持沉默: \`[{"type": "do_nothing"}]\` (如果你根据人设和当前情况，觉得没有必要进行任何互动，就使用这个指令)
- 发消息: \`[{"type": "text", "name": "${actor.name}", "content": "你想说的话..."}]\`
- 发表情: \`[{"type": "send_sticker", "name": "${actor.name}", "stickerName": "表情描述"}]\`
- 发红包: \`[{"type": "red_packet", "name": "${actor.name}", "packetType": "lucky", "amount": 8.88, "count": 3, "greeting": "来抢！"}]\`
- 发起外卖: \`[{"type": "waimai_request", "name": "${actor.name}", "productInfo": "一份麻辣烫", "amount": 30}]\`

# 供你决策的参考信息：
- 你的角色设定: ${actor.persona || '无'}
- 群成员列表: 
${membersList}
- 最近的群聊内容:
${recentContextSummary}

- **你的可用表情库**:  
${stickerListForPrompt}
    `;

        try {
                let response;

                if (apiConfig.apiProvider === 'gemini') {
                        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${apiConfig.model}:generateContent?key=${apiConfig.apiKey}`;
                        const geminiContents = [{ role: 'user', parts: [{ text: systemPrompt }] }];
                        response = await fetch(geminiUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                        contents: geminiContents,
                                        generationConfig: {
                                                temperature: 0.9,
                                                // Gemini API 需要通过MIME type来确保返回的是JSON
                                                responseMimeType: "application/json",
                                        }
                                })
                        });

                } else {
                        // 原有的默认/反代 API 逻辑
                        response = await fetch(`${apiConfig.proxyUrl}/v1/chat/completions`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                                body: JSON.stringify({
                                        model: apiConfig.model,
                                        messages: [{ role: 'system', content: systemPrompt }],
                                        temperature: 0.9,
                                        // 旧API通过 response_format 参数要求JSON
                                        response_format: { type: "json_object" }
                                })
                        });
                }


                if (!response.ok) throw new Error(await response.text());

                const data = await response.json();
                let rawContent;

                if (apiConfig.apiProvider === 'gemini') {
                        if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0]) {
                                rawContent = data.candidates[0].content.parts[0].text;
                        } else {
                                console.error("Invalid Gemini API response for triggerInactiveGroupAiAction:", data);
                                throw new Error("Invalid Gemini API response structure.");
                        }
                } else {
                        rawContent = data.choices[0].message.content;
                }

                const parsedObject = extractAndParseJson(rawContent);

                // Check if parsing was successful and if the object contains the "actions" array.
                if (!parsedObject || !Array.isArray(parsedObject.actions)) {
                        console.error(`角色 "${chat.name}" 的独立行动失败: AI返回的内容不是预期的 { "actions": [...] } 格式。`, {
                                originalResponse: rawContent,
                                parsedResult: parsedObject
                        });
                        return; // Safely exit if the format is wrong.
                }

                // Correctly reference the actions array within the parsed object.
                const responseArray = parsedObject.actions;

                for (const action of responseArray) {
                        // 因为这是后台活动，我们只处理几种简单的主动行为
                        switch (action.type) {
                                case 'do_nothing':
                                        console.log(`后台群聊活动: "${actor.name}" 在 "${group.name}" 中决定保持沉默。`);
                                        break;
                                case 'text':
                                case 'send_sticker':
                                case 'red_packet':
                                case 'waimai_request':
                                        { 
                                                let messageContent = {};
                                                let messageType = action.type;

                                                if (action.type === 'send_sticker') {
                                                        const sticker = stickers.find(s => s.name === action.stickerName);
                                                        if (sticker) {
                                                                messageContent = { content: sticker.url, meaning: sticker.name };
                                                        } else {
                                                                // 找不到表情，则作为文本发送
                                                                messageType = 'text';
                                                                messageContent = { content: `[表情: ${action.stickerName}]` };
                                                        }
                                                } else if (action.type === 'text') {
                                                        messageContent = { content: action.content };
                                                } else if (action.type === 'red_packet') {
                                                        messageContent = { ...action };
                                                } else if (action.type === 'waimai_request') {
                                                        messageContent = { ...action, status: 'pending' };
                                                }

                                                const message = {
                                                        role: 'assistant',
                                                        senderName: actor.name,
                                                        senderId: actor.id, // 别忘了加上 senderId
                                                        type: messageType,
                                                        timestamp: Date.now(),
                                                        ...messageContent
                                                };

                                        const groupToUpdate = await db.chats.get(group.id);
                                        groupToUpdate.history.push(message);
                                        groupToUpdate.lastMessageTimestamp = message.timestamp;
                                        groupToUpdate.lastMessageContent = message;
                                        groupToUpdate.unreadCount = (groupToUpdate.unreadCount || 0) + 1;
                                        await db.chats.put(groupToUpdate);
                                        notificationChannel.postMessage({ type: 'new_message' });

                                        console.log(`后台群聊活动: "${actor.name}" 在 "${group.name}" 中执行了 ${action.type} 动作。`);
                                        break;
                                }
                        }
                }
        } catch (error) {
                console.error(`角色 "${actor.name}" 在群聊 "${group.name}" 的独立行动失败:`, error);
        }
}

/**
 * 从可能包含 markdown 或其他文本的字符串中提取并解析JSON。
 * 此版本能正确处理对象（{}）和数组（[]）。
 * @param {string} raw - The raw string from the AI.
 * @returns {object|array|null} - The parsed JSON object/array or null if parsing fails.
 */
function extractAndParseJson(raw) {
    if (typeof raw !== 'string' || !raw.trim()) {
        return null;
    }

    // 1. 优先处理被 markdown 代码块包裹的 JSON
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
    let s = jsonMatch ? jsonMatch[1].trim() : raw.trim();

    // 2. 寻找JSON结构的起始位置 (寻找第一个 '{' 或 '[')
    const startIndex = s.search(/[\{\[]/);
    if (startIndex === -1) {
        console.error('extractJson() failed: No JSON start character found.', { originalString: raw });
        return null;
    }

    // 3. 根据起始符号，确定对应的结束符号
    const startChar = s[startIndex];
    const endChar = startChar === '{' ? '}' : ']';
    
    // 4. 寻找最后一个匹配的结束符号
    const endIndex = s.lastIndexOf(endChar);
    if (endIndex === -1 || endIndex < startIndex) {
        console.error('extractJson() failed: No matching JSON end character found.', { originalString: raw });
        return null;
    }

    // 5. 截取有效的JSON子串
    s = s.substring(startIndex, endIndex + 1);

    // 6. 尝试解析
    try {
        return JSON.parse(s);
    } catch (e) {
        console.error('extractJson() failed: JSON.parse error after cleanup.', {
            error: e.message,
            stringAttemptedToParse: s,
            originalString: raw
        });
        return null;
    }
}

/**
 * 格式化时间戳为相对时间字符串
 * @param {Date | string | number} timestamp - 要格式化的时间戳
 * @returns {string} - 格式化后的字符串 (例如 "刚刚", "5分钟前", "昨天")
 */
function formatRelativeTime(timestamp) {
        const now = new Date();
        const date = new Date(timestamp);
        const diffMs = now - date;
        const diffSeconds = Math.round(diffMs / 1000);
        const diffMinutes = Math.round(diffSeconds / 60);
        const diffHours = Math.round(diffMinutes / 60);
        const diffDays = Math.round(diffHours / 24);

        if (diffMinutes < 1) return '刚刚';
        if (diffMinutes < 60) return `${diffMinutes}分钟前`;
        if (diffHours < 24) return `${diffHours}小时前`;
        if (diffDays === 1) return '昨天';
        if (diffDays < 7) return `${diffDays}天前`;
        return date.toLocaleDateString('zh-CN'); // 超过一周则显示具体日期
}

/**
 * 统一处理AI生成的后台消息：保存到数据库、更新状态并发送通知。
 * @param {object} chat - 需要更新的聊天对象。
 * @param {object} message - 要添加的消息对象。
 * @param {Map<string, object>} allChatsMap - 用于快速查找头像的聊天对象Map。
 */
async function processAndNotify(chat, message, allChatsMap) {
        chat.history.push(message);
        chat.lastMessageTimestamp = message.timestamp;
        chat.lastMessageContent = message; // 存储完整消息对象以供预览
        chat.unreadCount = (chat.unreadCount || 0) + 1;
        await db.chats.put(chat);

        // 发送跨页面通知
        const notificationChannel = new BroadcastChannel('xphone_notifications');
        notificationChannel.postMessage({ type: 'new_message' });

        // 触发桌面通知
        if (Notification.permission === 'granted') {
                const senderChat = allChatsMap.get(chat.id); // 使用传入的Map
                let notificationBody = '';

                // 根据消息类型生成不同的通知内容
                switch (message.type) {
                        case 'sticker':
                                notificationBody = `[表情] ${message.meaning}`;
                                break;
                        case 'voice_message':
                                notificationBody = `[语音] ${message.content}`;
                                break;

                        case 'text_photo':
                                notificationBody = `[图片] ${message.content}`;
                                break;
                        default: // 'text' and others
                                notificationBody = message.content;
                }

                const notificationOptions = {
                        body: notificationBody,
                        icon: senderChat?.settings?.aiAvatar || 'https://files.catbox.moe/kkll8p.svg',
                        tag: `xphone-message-${chat.id}` // 使用tag可以防止同一角色的消息产生过多重复通知
                };
                new Notification(`${message.senderName}给你发来一条新消息`, notificationOptions);
        }
        console.log(`后台活动: 角色 "${message.senderName}" 主动发送了 ${message.type || 'text'} 消息。`);
}