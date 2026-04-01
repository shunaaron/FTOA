// 等待網頁元素全部載入後再執行，避免找不到物件
document.addEventListener("DOMContentLoaded", function () {

    const togglePassword = document.querySelector('#togglePassword');
    const password = document.querySelector('#passwordInput');

    // 確保頁面上真的有這兩個元素才執行，避免報錯
    if (togglePassword && password) {
        togglePassword.addEventListener('click', function (e) {
            // 1. 切換 type 屬性 (password <-> text)
            const type = password.getAttribute('type') === 'password' ? 'text' : 'password';
            password.setAttribute('type', type);

            // 2. 切換眼睛圖示 (睜眼 <-> 閉眼)
            // 如果原本是 fa-eye，就換成 fa-eye-slash (斜線眼)，反之亦然
            this.classList.toggle('fa-eye-slash');
        });
    }
});