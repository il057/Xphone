// settings.js
// Import the shared database instance from db.js
import { db } from './db.js';
import { runActiveSimulationTick } from './simulationEngine.js';
import { displayToastFromSession } from './ui-helpers.js';

// 在模块作用域内声明一个变量来持有 Vanta.js 实例
let vantaEffect = null;

/**
 * 将十六进制颜色转换为RGB值，用于设置带透明度的背景。
 * @param {string} hex - The hex color string.
 * @returns {string} - 'r, g, b' string.
 */
function hexToRgb(hex) {
        let c;
        if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
                c = hex.substring(1).split('');
                if (c.length === 3) {
                        c = [c[0], c[0], c[1], c[1], c[2], c[2]];
                }
                c = '0x' + c.join('');
                return [(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',');
        }
        return '255, 255, 255'; // 无效 hex 的回退
}

/**
 * 应用主题模式（浅色/深色/自动）
 */
export async function applyThemeMode() {
        const settings = await db.globalSettings.get('main');
        const mode = settings?.themeMode || 'auto'; // 默认为 'auto'

        const apply = (theme) => {
                if (theme === 'dark') {
                        document.documentElement.classList.add('dark');
                } else {
                        document.documentElement.classList.remove('dark');
                }
        };

        if (mode === 'auto') {
                const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                apply(systemPrefersDark ? 'dark' : 'light');

                // 监听系统颜色模式变化
                window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
                        // 确保只有在自动模式下才切换
                        db.globalSettings.get('main').then(currentSettings => {
                                if (currentSettings?.themeMode === 'auto') {
                                        apply(event.matches ? 'dark' : 'light');
                                }
                        });
                });

        } else {
                apply(mode);
        }
}


/**
 * 全局样式应用函数
 * 该函数会连接到数据库，读取并应用壁纸、主题色和字体。
 */
async function applyGlobalStyles() {
        try {
                await applyThemeMode(); // 应用浅色/深色主题

                const settings = await db.globalSettings.get('main');

                if (!settings) {
                        console.log("未找到全局设置，使用默认样式。");
                        return;
                }

                const contentBgColor = getComputedStyle(document.documentElement).getPropertyValue('--content-bg-color').trim();
                document.documentElement.style.setProperty('--content-bg-color-rgb', hexToRgb(contentBgColor));

                // --- 1. 应用壁纸 ---
                const wallpaperValue = settings.wallpaper;
                const wallpaperTarget = document.querySelector('.wallpaper-bg');

                // 停止并清理任何正在运行的 Vanta 动画，清理旧样式
                if (vantaEffect) {
                        vantaEffect.destroy();
                        vantaEffect = null;
                }
                if (wallpaperTarget) {
                        wallpaperTarget.style.backgroundImage = 'none';
                        wallpaperTarget.style.backgroundColor = 'transparent';
                }

                if (wallpaperTarget && wallpaperValue) {
                        // 检查是否是新的拓扑壁纸
                        if (wallpaperValue.startsWith('topology(')) {
                                if (typeof VANTA !== 'undefined') {
                                        const colors = wallpaperValue.match(/#([0-9a-f]{6}|[0-9a-f]{3})/gi);
                                        if (colors && colors.length === 2) {
                                                // 在背景元素上初始化 Vanta Topology
                                                vantaEffect = VANTA.TOPOLOGY({
                                                        el: '.wallpaper-bg', // 或者更具体的选择器如 '#phone-screen'
                                                        mouseControls: false, // 主屏幕上通常禁用鼠标交互
                                                        touchControls: false,
                                                        gyroControls: false,
                                                        minHeight: 200.00,
                                                        minWidth: 200.00,
                                                        scale: 1.00,
                                                        scaleMobile: 1.00,
                                                        backgroundColor: colors[0],
                                                        color: colors[1]
                                                });
                                        }
                                } else {
                                        console.error("Vanta.js 未加载，无法应用拓扑壁纸。");
                                }
                        } else if (wallpaperValue.startsWith('url(') || wallpaperValue.startsWith('linear-gradient')) {
                                // 处理图片或渐变壁纸
                                wallpaperTarget.style.backgroundImage = wallpaperValue;
                        } else {
                                // 处理纯色背景
                                wallpaperTarget.style.backgroundColor = wallpaperValue;
                        }
                }

                // --- 2. 应用主题色 ---
                const themeColor = settings.themeColor || '#3b82f6';
                const root = document.documentElement;
                root.style.setProperty('--theme-color', themeColor);
                root.style.setProperty('--theme-color-hover', shadeColor(themeColor, -15));

                // --- 3. 应用字体 ---
                const fontUrl = settings.fontUrl;
                const existingStyleTag = document.getElementById('global-styles-tag');
                if (fontUrl && fontUrl.trim() !== '') {
                        const fontName = 'global-user-font';
                        let styleTag = existingStyleTag;
                        if (!styleTag) {
                                styleTag = document.createElement('style');
                                styleTag.id = 'global-styles-tag';
                                document.head.appendChild(styleTag);
                        }
                        styleTag.textContent = `
                @font-face {
                    font-family: '${fontName}';
                    src: url('${fontUrl}');
                    font-display: swap;
                }
                body {
                    font-family: '${fontName}', 'Inter', sans-serif !important;
                }
            `;
                } else if (existingStyleTag) {
                        // 如果字体URL为空，则移除样式
                        existingStyleTag.remove();
                }

        } catch (error) {
                console.error("应用全局样式失败:", error);
        }
}


function shadeColor(color, percent) {
        if (!color || !color.startsWith('#')) return color;
        let R = parseInt(color.substring(1, 3), 16);
        let G = parseInt(color.substring(3, 5), 16);
        let B = parseInt(color.substring(5, 7), 16);
        R = parseInt(R * (100 + percent) / 100);
        G = parseInt(G * (100 + percent) / 100);
        B = parseInt(B * (100 + percent) / 100);
        R = (R < 255) ? R : 255;
        G = (G < 255) ? G : 255;
        B = (B < 255) ? B : 255;
        const RR = ((R.toString(16).length === 1) ? "0" + R.toString(16) : R.toString(16));
        const GG = ((G.toString(16).length === 1) ? "0" + G.toString(16) : G.toString(16));
        const BB = ((B.toString(16).length === 1) ? "0" + B.toString(16) : B.toString(16));
        return "#" + RR + GG + BB;
}

async function checkAndRunBackgroundSimulation() {
    try {
        const settings = await db.globalSettings.get('main');
        if (!settings || !settings.enableBackgroundActivity) {
            return; // 功能未开启则直接返回
        }

        const now = Date.now();
        const lock = parseInt(localStorage.getItem('simulation_lock') || '0');
        const lockTTL = 30 * 1000; // 锁的有效期为30秒

        if (lock && (now - lock < lockTTL)) {
            // console.log("模拟任务被锁定，本次跳过。");
            return;
        }

        const lastTick = settings.lastActiveSimTick || 0;
        const interval = (settings.backgroundActivityInterval || 60) * 1000;

        if (now - lastTick > interval) {
            localStorage.setItem('simulation_lock', now.toString());
            console.log("成功获取模拟锁，开始执行后台活动...");

            try {
                await db.globalSettings.update('main', { lastActiveSimTick: now });
                await runActiveSimulationTick();
            } finally {
                localStorage.removeItem('simulation_lock');
                console.log("模拟任务完成，释放锁。");
            }
        }
    } catch (error) {
        console.error("后台模拟检查执行失败:", error);
        localStorage.removeItem('simulation_lock'); // 确保异常时也释放锁
    }
}


async function checkFooterNotifications() {
    const lastView = parseInt(localStorage.getItem('lastMomentsViewTimestamp') || '0');
    const newMomentsCount = await db.xzonePosts.where('timestamp').above(lastView).count();

    const unreadChatsCount = await db.chats.where('unreadCount').above(0).count();
    const chatDockItem = document.querySelector('.dock-item[href="chat.html"]');
    if (chatDockItem) {
        chatDockItem.classList.toggle('has-unread-glow', unreadChatsCount > 0);
    }

    const momentsDockItem = document.querySelector('.dock-item[href="moments.html"]');
    if (momentsDockItem) {
        momentsDockItem.classList.toggle('has-unread-glow', newMomentsCount > 0);
    }

    const chatIconLink = document.querySelector('a.app-icon-link[href="chat.html"]');
    if (chatIconLink) {
        chatIconLink.classList.toggle('has-unread-glow', unreadChatsCount > 0);
    }
    const settings = await db.globalSettings.get('main');
    const lastViewTime = settings?.lastSummaryViewTime || 0; // 如果从未看过，则为0

    // 查找时间戳晚于上次查看时间的所有简报
    const unreadSummaryCount = await db.offlineSummary.where('timestamp').above(lastViewTime).count();

    const summaryIconLink = document.querySelector('a.app-icon-link[href="summary.html"]');
    if (summaryIconLink) {
        // 使用新的未读数量来决定是否发光
        summaryIconLink.classList.toggle('has-unread-glow', unreadSummaryCount > 0);
    }
    
}



// 在页面加载时，同时执行样式应用和后台模拟启动
document.addEventListener('DOMContentLoaded', async () => {
        await applyGlobalStyles();
        checkFooterNotifications();
        displayToastFromSession();
        await checkAndRunBackgroundSimulation();
});

// 2. 当标签页从后台恢复时检查一次
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        checkAndRunBackgroundSimulation();
    }
});

// 3. 设置一个定时器，定期检查
// 我们将间隔设置为15秒，这样可以比较及时地触发，
// 同时具体的模拟频率还是由数据库中的 `backgroundActivityInterval` 控制。
setInterval(checkAndRunBackgroundSimulation, 15000); // 每15秒尝试检查一次

function calcHeaderHeight(){
  const h = document.querySelector('.app-header')?.offsetHeight||56;
  document.documentElement.style.setProperty('--header-height',`${h}px`);
}
window.addEventListener('resize',calcHeaderHeight);
document.addEventListener('DOMContentLoaded',calcHeaderHeight);


