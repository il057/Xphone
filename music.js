// phone/music.js (已修改)
import * as spotifyManager from './spotifyManager.js';

document.addEventListener('DOMContentLoaded', () => {
    const musicContainer = document.getElementById('music-container');

    async function renderStatus() {
        if (spotifyManager.isLoggedIn()) {
            const token = localStorage.getItem('spotify_access_token');
            const response = await fetch("https://api.spotify.com/v1/me", {
                headers: { Authorization: `Bearer ${token}` }
            });
            const profile = await response.json();
            musicContainer.innerHTML = `
                <div class="text-center">
                    <img src="${profile.images?.[0]?.url || ''}" class="w-24 h-24 rounded-full mx-auto mb-4 shadow-lg">
                    <p class="font-semibold text-lg">已作为 ${profile.display_name} 登录</p>
                    <p class="text-gray-500 mt-2">现在可以前往任意聊天室<br>发起“一起听”功能了</p>
                </div>
            `;
        } else {
            musicContainer.innerHTML = `
                <div id="login-view" class="text-center py-16">
                    <button id="login-btn" class="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-full inline-flex items-center">
                        <svg class="w-6 h-6 mr-2" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.19 14.37c-.24.37-.76.49-1.13.24-2.82-1.72-6.38-2.1-10.57-.98-.46.06-.85-.29-.9-.75s.29-.85.75-.9c4.5-1.18 8.35-.69 11.45 1.18.38.24.49.76.25 1.13zm.88-2.32c-.3.46-1.02.6-1.48.3-3.23-1.98-7.85-2.5-11.53-1.37-.55.17-.98-.29-.81-.84s.29-.98.84-.81c4.13-1.23 9.11-.6 12.68 1.6.46.29.6 1.01.3 1.48zm.3-2.5c-.35.53-1.18.72-1.73.37-3.7-2.3-9.75-2.8-13.43-1.53-.63.22-1.28-.2-1.06-.83s.2-1.28.83-1.06c4.14-1.4 10.65-.82 14.85 1.78.55.35.73 1.18.38 1.73z"/></svg>
                        使用 Spotify 登录
                    </button>
                </div>
            `;
            document.getElementById('login-btn').addEventListener('click', spotifyManager.login);
        }
    }

    renderStatus();
});