// il057/xphone/Xphone-c707343078335a5c878ae579092241cbec4efe77/linkViewer.js

import { db, callApi } from './db.js';
import { showToast } from './ui-helpers.js';
import { getActiveUserPersonaForChat } from './simulationEngine.js';

document.addEventListener('DOMContentLoaded', async () => {

        const params = new URLSearchParams(window.location.search);
        const linkId = params.get('linkId');
        const chatId = params.get('chatId');
        const contentContainer = document.getElementById('content-container');
        const fakeUrlEl = document.getElementById('fake-url');
        const backBtn = document.querySelector('header a.header-btn');

        backBtn.href = `chatRoom.html?id=${chatId}`;

        if (!linkId || !chatId) {
                contentContainer.innerHTML = '<p class="text-center text-red-500">无效的链接参数</p>';
                return;
        }

        try {
                const [pageData, settings, chat] = await Promise.all([
                        db.linkPages.get(linkId),
                        db.globalSettings.get('main'),
                        db.chats.get(chatId)
                ]);

                if (!chat) throw new Error("找不到相关的聊天记录。");

                const message = chat.history.find(m => new Date(m.timestamp).getTime() == linkId);
                if (!message || message.type !== 'share_link') throw new Error("找不到原始链接信息。");

                const sourceName = (message.source_name || 'source').replace(/\s+/g, '-').toLowerCase();
                fakeUrlEl.textContent = `https://www.${sourceName}.com`;

                let htmlToRender = '';

                if (pageData?.html) {
                        htmlToRender = pageData.html;
                } else {
                        const enableIntelligentLinks = settings?.enableIntelligentLinks !== false;
                        if (!message.content || !enableIntelligentLinks) {
                                htmlToRender = `<h1>${message.title}</h1><p>${message.content.replace(/\n/g, '<br>')}</p>`;
                        } else {
                                contentContainer.innerHTML = '<p class="text-center text-gray-500 animate-pulse">正在生成页面内容...</p>';
                                const messageIndex = chat.history.findIndex(m => new Date(m.timestamp).getTime() == linkId);
                                const startIndex = Math.max(0, messageIndex - 20);
                                const conversationContext = chat.history.slice(startIndex, messageIndex + 1);
                                let senderInfo, senderAvatar = 'https://files.catbox.moe/kkll8p.svg';

                                if (message.role === 'user') {
                                        senderInfo = await getActiveUserPersonaForChat(chat);
                                        senderAvatar = senderInfo.avatar || senderAvatar;
                                } else {
                                        senderInfo = chat;
                                        senderAvatar = senderInfo.settings?.aiAvatar || senderAvatar;
                                }

                                const generatedData = await generateHtmlForLink(message, conversationContext, senderInfo, senderAvatar);
                                if (!generatedData || !generatedData.html_content) throw new Error("AI未能生成有效的页面内容。");

                                htmlToRender = generatedData.html_content;
                                await db.linkPages.put({ id: linkId, html: htmlToRender, submissions: [], createdAt: Date.now() });
                        }
                }

                contentContainer.innerHTML = htmlToRender;

                // --- UNIFIED KNOWLEDGE FEEDBACK LOGIC ---
                const submitBtn = document.getElementById('interactive-submit-btn');

                if (submitBtn) {
                        // This is an INTERACTIVE page.
                        // Render any previous submissions.
                        const latestSubmission = pageData?.submissions?.slice(-1)[0];
                        if (latestSubmission) {
                                renderSubmission(latestSubmission);
                        }
                        // Attach the event listener to handle form submission.
                        submitBtn.addEventListener('click', handleFormSubmit);
                } else {
                        // This is a STATIC page.
                        // Extract and save its text content for the AI immediately.
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = htmlToRender;
                        const fullTextContent = (tempDiv.textContent || "").split('\n').map(line => line.trim()).filter(Boolean).join('\n');

                        if (fullTextContent) {
                                await db.tempKnowledgeTransfer.put({
                                        id: chatId,
                                        content: fullTextContent
                                });
                        }
                }

        } catch (error) {
                console.error("生成或加载链接页面失败:", error);
                showToast(`页面处理失败: ${error.message}`, 'error');
                contentContainer.innerHTML = `<p class="text-center text-red-500">无法加载页面内容。</p>`;
        }
});

// The `renderSubmission` and `generateHtmlForLink` functions remain unchanged from the last version.
// They already support both static and interactive content generation.
// The `handleFormSubmit` function also remains unchanged.
function renderSubmission(submissionData) {
        const submitBtn = document.getElementById('interactive-submit-btn');
        if (submitBtn) {
                submitBtn.textContent = '已提交';
                submitBtn.disabled = true;
        }
        for (const key in submissionData.answers) {
                const answer = submissionData.answers[key];
                const elements = document.getElementsByName(key);
                if (elements.length > 0) {
                        if (elements[0].type === 'radio') {
                                for (const radio of elements) {
                                        radio.checked = (radio.value === answer);
                                        radio.disabled = true;
                                }
                        } else {
                                const inputEl = document.getElementById(key);
                                if (inputEl) {
                                        inputEl.value = answer;
                                        inputEl.disabled = true;
                                }
                        }
                }
        }
}

async function handleFormSubmit(event) {
        event.preventDefault();
        const contentContainer = document.getElementById('content-container');
        const formElements = contentContainer.querySelectorAll('textarea, input[type="text"], input[type="radio"]');
        const answers = {};
        const questionLabels = {};
        let allFilled = true;
        const answeredRadioGroups = new Set();
        const allRadioGroups = new Set(Array.from(formElements).filter(el => el.type === 'radio').map(el => el.name));

        formElements.forEach(el => {
                const labelEl = contentContainer.querySelector(`label[for="${el.id}"]`);
                // For radio buttons, the question is usually in a <p> tag before the group
                const questionTextParent = el.closest('.space-y-2');
                const questionP = questionTextParent ? questionTextParent.querySelector('p.font-semibold') : null;

                const question = labelEl ? labelEl.textContent : (questionP ? questionP.textContent : (el.name || el.id));

                if (el.type === 'radio') {
                        if (el.checked) {
                                answers[el.name] = el.value;
                                questionLabels[el.name] = question;
                                answeredRadioGroups.add(el.name);
                        }
                } else {
                        answers[el.id] = el.value.trim();
                        questionLabels[el.id] = question;
                        if (!el.value.trim()) {
                                allFilled = false;
                        }
                }
        });

        if (!allFilled || answeredRadioGroups.size !== allRadioGroups.size) {
                showToast("请回答所有问题后再提交哦！", "error");
                return;
        }

        const params = new URLSearchParams(window.location.search);
        const linkId = params.get('linkId');
        const chatId = params.get('chatId');

        const newSubmission = { timestamp: Date.now(), answers: answers };

        const currentPageData = await db.linkPages.get(linkId) || { submissions: [] };
        if (!currentPageData.submissions) currentPageData.submissions = []; // Ensure submissions array exists
        currentPageData.submissions.push(newSubmission);
        await db.linkPages.put(currentPageData);

        let feedbackText = `用户填写了你分享的问卷，回答如下：\n`;
        for (const key in answers) {
                const question = questionLabels[key] || key;
                const answer = answers[key];
                feedbackText += `- ${question}: ${answer}\n`;
        }

        await db.tempKnowledgeTransfer.put({ id: chatId, content: feedbackText });

        showToast("提交成功！", "success");
        renderSubmission(newSubmission);
}

async function generateHtmlForLink(message, conversationContext, senderInfo, senderAvatar) {
        // This function's prompt is already equipped to handle both static and interactive pages,
        // so no changes are needed here.
        const conversationText = conversationContext.map(m => {
                const senderName = m.role === 'user' ? (senderInfo.name || '我') : (m.senderName || senderInfo.name);
                return `${senderName}: ${m.content}`;
        }).join('\n');
        const senderPersona = senderInfo.settings?.aiPersona || senderInfo.persona || '一个普通人';

        const systemPrompt = `
You are a creative web page generator for an immersive chat simulation. Your task is to transform a "link sharing" event into a full, visually appealing, and potentially interactive HTML page.

# Provided Context
- **Sender's Name:** ${senderInfo.name}
- **Sender's Avatar URL:** ${senderAvatar}
- **Sender's Persona:** ${senderPersona}
- **Conversation Context:**
---
${conversationText}
---
- **Link Seed (The message you must expand upon):**
  - **Title:** ${message.title}
  - **Raw Content Idea:** ${message.content}

# CRITICAL TASK & OUTPUT FORMAT
Your entire response **MUST** be a single, valid JSON object with the key "html_content".

**"html_content" Generation Rules:**

1.  **Detect Interactivity**: If the link's title or content implies a quiz, questionnaire, or test (e.g., "情侣问答", "默契考验"), you **MUST** generate an interactive form. Otherwise, generate a static page.

2.  **Form Generation Rules (VERY IMPORTANT)**:
    - For open-ended questions, use \`<label for="q1">问题文本</label><textarea id="q1" ...></textarea>\`.
    - For multiple-choice questions, you **MUST** use this exact structure for each question group:
      <div class="space-y-2">
        <p class="font-semibold">1. 你最喜欢的季节是？</p>
        <label for="q1_opt1" class="flex items-center"><input type="radio" name="question1" id="q1_opt1" value="春天"> <span class="ml-2">春天</span></label>
        <label for="q1_opt2" class="flex items-center"><input type="radio" name="question1" id="q1_opt2" value="夏天"> <span class="ml-2">夏天</span></label>
      </div>
    - **Key rules for radio buttons**: All options for the **same question** MUST share the same \`name\` attribute. Each option's \`<input>\` and \`<label>\` MUST have a unique \`id\` and a corresponding \`for\` attribute.
    - All interactive forms **MUST** include a single submit button at the end: \`<button id="interactive-submit-btn" class="...">提交</button>\`.

3.  **General Rules**:
    - **Expand Content**: Always expand the "Raw Content Idea" into a full page.
    - **Persona-Driven Design**: The visual style MUST reflect the sender's persona.
    - **No Fake Links**: Do NOT invent \`<a>\` tags.
    - **HTML Structure**: Your output must be raw HTML starting with a container like \`<div>\`. Do NOT include \`<html>\`, \`<head>\`, \`<body>\`, or markdown. Do NOT repeat the page title. Use the provided avatar URL.
    - **Styling**: Use TailwindCSS classes extensively.
`;

        const generatedData = await callApi(systemPrompt, [], { temperature: 0.7 }, 'json');

        if (!generatedData || !generatedData.html_content) {
                throw new Error("AI did not return the required 'html_content' field.");
        }

        return generatedData;
}