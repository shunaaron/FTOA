/* --- wwwroot/js/tool.js --- */

// 1. 切換 Tab (核心功能)
function switchTab(id) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    var targetTab = document.getElementById('tab-' + id);
    var targetFrame = document.getElementById('frame-' + id);

    if (targetTab && targetFrame) {
        targetTab.classList.add('active');
        targetFrame.classList.add('active');
    }
}

// 2. 新增 Tab (修改版：加入 tool_js 參數與驗證邏輯)
// 請確保呼叫此函式時傳入 tool_js 內容，例如: addTab('id', 'Title', 'url', 'jsonString')
function addTab(id, title, url, tool_js) {
    // 轉小寫並移除空白，確保比對正確
    var urlLower = (url || "").toLowerCase().trim();

    // 定義必須在新視窗開啟的關鍵字
    var externalDomains = ['gemini.google.com', 'google.com', 'youtube.com', 'microsoft.com'];

    // 檢查是否包含外部網域
    var isExternal = externalDomains.some(domain => urlLower.includes(domain));

    if (isExternal) {
        console.log(`外部網站 ${url} 將在新視窗開啟`);
        window.open(url, '_blank', 'noopener=yes,noreferrer=yes');
        return; // ★★★ 關鍵：直接結束函式，不執行下方的 iframe 建立程式碼 ★★★
    }

    var targetUrl = url;
    var isConfigError = false;

    // --- 驗證邏輯 ---
    if (!targetUrl || targetUrl.trim() === "" || targetUrl.trim() === "#") {
        console.warn('URL 為空，將導向 Nopage。功能 ID:', id);
        targetUrl = '/Basic/Nopage';
        isConfigError = true;
    } else {
        if (!tool_js || String(tool_js).trim() === "") {
            // tool_js 為空通常沒關係，有些純 URL 功能不需要 tool_js
            // console.warn('tool_js 為空...'); 
        } else {
            try {
                if (typeof tool_js === 'string') {
                    JSON.parse(tool_js);
                }
            } catch (e) {
                console.error('tool_js 格式錯誤', e);
                targetUrl = '/Basic/Nojspage';
                isConfigError = true;
            }
        }
    }

    var existingTab = document.getElementById('tab-' + id);

    if (existingTab) {
        switchTab(id);
        if (isConfigError) {
            var frame = document.getElementById('frame-' + id);
            if (frame && frame.contentWindow.location.pathname !== targetUrl) {
                frame.src = targetUrl;
            }
        }
    } else {
        createTabUI(id, title, targetUrl);
    }
}


// 2.1 建立 Tab UI 的輔助函式
function createTabUI(id, title, url) {
    showLoading(`正在載入 [${title}]...`);

    var tabContainer = document.getElementById('tabsHeader');
    var bodyContainer = document.getElementById('tabsBody');

    var newTab = document.createElement('li');
    newTab.className = 'tab';
    newTab.id = 'tab-' + id;
    newTab.innerHTML = `
        <span onclick="switchTab('${id}')">${title}</span>
        <span class="close-tab" onclick="closeTab(event, '${id}')">
            <i class="fas fa-times"></i>
        </span>
    `;
    tabContainer.appendChild(newTab);

    var newFrame = document.createElement('iframe');
    newFrame.className = 'tab-content';
    newFrame.id = 'frame-' + id;

    // ★★★ 修正重點：移除 sandbox 屬性 ★★★
    // 內網系統通常互相信任，sandbox 會導致 Permissions API、下載功能、彈出視窗等功能異常。
    // 如果您一定要用 sandbox，請務必拿掉，或是加上 'allow-presentation' 等更多權限，
    // 但這無法解決 Google 拒絕連線的問題。
    // newFrame.sandbox = ...; // 建議註解掉這行

    // 允許全螢幕 (某些報表或地圖需要)
    newFrame.allow = "fullscreen";

    newFrame.setAttribute('referrerpolicy', 'no-referrer');

    newFrame.onload = function () {
        try {
            var frameHref = newFrame.contentWindow.location.href;
            if (frameHref.indexOf("/Home/Index") > -1 || frameHref.endsWith(":7034/")) {
                alert("連線逾時，請重新登入");
                window.top.location.href = "/Home/Index";
                return;
            }
        } catch (e) {
            // 跨網域存取會報錯，忽略即可
        }
        hideLoading();
    };

    bodyContainer.appendChild(newFrame);
    newFrame.src = url;
    switchTab(id);
}

// ★★★ 新增：處理頁面載入錯誤 (Fallback) ★★★
function handlePageError(id, title, originalUrl) {
    hideLoading();

    var frame = document.getElementById('frame-' + id);
    var tab = document.getElementById('tab-' + id);

    if (frame) {
        // 導向標準 Nopage
        frame.src = '/Basic/Nopage';
    }

    // 更新 Tab 標題顯示錯誤狀態
    if (tab) {
        tab.innerHTML = `<span style="color: #ff6b6b;">⚠ ${title}</span> <span class="close-tab" onclick="closeTab(event, '${id}')"><i class="fas fa-times"></i></span>`;
    }
}

// ★★★ 新增：顯示通知訊息 ★★★
function showNotification(title, message, type = 'info') {
    // 檢查是否已有通知容器
    var container = document.getElementById('notificationContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notificationContainer';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
        `;
        document.body.appendChild(container);
    }

    // 建立通知元素
    var notification = document.createElement('div');
    notification.className = 'notification notification-' + type;
    notification.style.cssText = `
        background: ${type === 'error' ? '#ff6b6b' : '#51cf66'};
        color: white;
        padding: 15px 20px;
        border-radius: 5px;
        margin-bottom: 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideIn 0.3s ease-out;
        min-width: 300px;
    `;

    notification.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 5px;">${title}</div>
        <div style="font-size: 14px;">${message}</div>
    `;

    container.appendChild(notification);

    // 3秒後自動移除
    setTimeout(function () {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// 3. 關閉 Tab
function closeTab(event, id) {
    if (event) event.stopPropagation();

    var tab = document.getElementById('tab-' + id);
    var frame = document.getElementById('frame-' + id);

    // 如果關閉的是當前頁面，先切回前一個
    if (tab && tab.classList.contains('active')) {
        var allTabs = document.querySelectorAll('.tab');
        if (allTabs.length > 1) {
            // 找到前一個 Tab (length - 2 是因為最後一個是要被刪除的，倒數第二個是前一個)
            // 這裡簡單邏輯：找此 Tab 的上一個兄弟元素
            var prevTab = tab.previousElementSibling;
            if (prevTab) {
                var prevId = prevTab.id.replace('tab-', '');
                switchTab(prevId);
            } else {
                switchTab('home');
            }
        } else {
            switchTab('home');
        }
    }

    if (tab) tab.remove();
    if (frame) frame.remove();
}

// 4. 切換側邊欄收合 (Toggle Sidebar)
function toggleSidebar() {
    var sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
        if (sidebar.classList.contains('collapsed')) {
            closeAllSubmenus();
        }
    }
}

// 5. 切換子選單展開/收合
function toggleSubmenu(element) {
    var sidebar = document.getElementById('sidebar');

    if (sidebar && sidebar.classList.contains('collapsed')) {
        toggleSidebar();
        setTimeout(() => toggleSubmenuLogic(element), 150);
    } else {
        toggleSubmenuLogic(element);
    }
}
function toggleSubmenuLogic(element) {
    element.classList.toggle('open');
    var nextUl = element.nextElementSibling;
    if (nextUl && nextUl.classList.contains('submenu-list')) {
        nextUl.classList.toggle('open');
    }
}

function closeAllSubmenus() {
    document.querySelectorAll('.menu-category.open').forEach(el => el.classList.remove('open'));
    document.querySelectorAll('.submenu-list.open').forEach(ul => ul.classList.remove('open'));
}

// 6. 登出
function logout() {
    if (confirm('確定要登出系統嗎?')) {
        fetch('/Home/Logout', { method: 'POST' })
            .then(() => window.location.href = '/Home/Index')
            .catch(() => window.location.href = '/Home/Index');
    }
}

// 7. Loading 控制
function showLoading(message = "頁面資訊取得中...") {
    var overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.innerHTML = `
            <div class="loader-wave">
                <div></div><div></div><div></div><div></div><div></div>
            </div>
            <div class="loading-text">${message}</div>
        `;
        overlay.style.display = 'flex';
        setTimeout(() => overlay.classList.add('show'), 10);
    }
}

function hideLoading() {
    var overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        // 延遲 0.1 秒關閉，避免閃爍太快
        setTimeout(() => {
            overlay.classList.remove('show');
            setTimeout(() => {
                if (!overlay.classList.contains('show')) {
                    overlay.style.display = 'none';
                }
            }, 300); // 等待 CSS transition 結束
        }, 300);
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', function () {
    console.log('Tool.js 已載入');

    var homeTab = document.getElementById('tab-home');
    var homeFrame = document.getElementById('frame-home');

    if (homeTab && homeFrame) {
        homeTab.classList.add('active');
        homeFrame.classList.add('active');
    }
});