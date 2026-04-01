// 等待網頁元素全部載入後再執行
document.addEventListener("DOMContentLoaded", function () {

    // --- 定義 DOM 元素變數 ---
    const loginForm = document.getElementById('loginForm');     // 抓取表單
    const btnLogin = document.querySelector('.btn-login');      // 抓取按鈕
    const togglePassword = document.querySelector('#togglePassword'); // 抓取眼睛圖示
    const passwordInput = document.querySelector('#passwordInput');   // 抓取密碼輸入框
    // -----------------------

    // 重置按鈕狀態函式 (移到最上層，確保全局可用)
    function resetButton(btn, originalHtml) {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            btn.classList.remove('loading');
        }
    }

    // 1. 密碼顯示/隱藏切換功能
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', function (e) {
            // 切換 type 屬性
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            // 切換圖示
            this.classList.toggle('fa-eye-slash');
        });
    }

    // 2. 登入表單送出處理
    if (loginForm && btnLogin) { // 確保兩個元素都存在
        loginForm.addEventListener('submit', async function (e) {
            e.preventDefault(); // 阻止表單直接刷新頁面

            // 取得輸入值
            const formData = new FormData(loginForm);
            const username = formData.get('username').trim();
            const password = formData.get('password');

            if (!username || !password) {
                alert("請輸入帳號與密碼");
                return;
            }

            // --- 開始 Loading 動畫 ---
            const originalBtnText = btnLogin.innerHTML; // 暫存原本按鈕內容
            btnLogin.disabled = true; // 鎖定按鈕
            btnLogin.classList.add('loading'); // 加入樣式

            // 替換按鈕內容為轉圈圈
            btnLogin.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 登入驗證中...';

            try {
                const payload = {
                    "Username": username,
                    "Password": password
                };

                // 呼叫自己的後端 Action (相對路徑)
                const response = await fetch('/Home/LoginProxy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                // --- 檢查 HTTP 狀態碼 ---
                if (!response.ok) {
                    // 處理後端回傳的非 200 錯誤 (例如 500 或 400)
                    let errorMsg = `HTTP 錯誤！狀態碼: ${response.status}`;
                    try {
                        // 嘗試解析錯誤訊息
                        const errData = await response.json();
                        if (errData && errData.message) errorMsg = errData.message;
                    } catch (e) {
                        // 如果無法解析 JSON，就使用預設的 HTTP 錯誤訊息
                    }
                    throw new Error(errorMsg);
                }

                // --- 解析我們自己的後端回傳 (假設回傳格式為 { success: bool, message: string }) ---
                const data = await response.json();

                if (data.success) {
                    // 1. 成功 (R_RCT = 1 的情況)
                    window.location.href = '/Basic/tool'; // 跳轉
                } else {
                    // 2. 失敗 (包含 R_RCT=0 或 R_RCT<0 的情況)
                    // data.message 應該包含後端處理好的錯誤文字
                    alert(data.message || '登入失敗，請檢查帳號密碼。');
                    // 失敗要重置按鈕
                    resetButton(btnLogin, originalBtnText);
                }

            } catch (error) {
                // 處理網路錯誤或程式拋出的錯誤
                console.error('Login Error:', error);
                alert('登入過程中發生錯誤：' + error.message);
                // 發生錯誤要重置按鈕
                resetButton(btnLogin, originalBtnText);
            }
        });
    }
});
