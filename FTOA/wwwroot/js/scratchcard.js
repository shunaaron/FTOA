// js/scratchcard.js

// 初始設定
let config = {
    pItems: "1", pScratches: 1, total: 80, cols: 10,
    gNums: ["8"], nNums: ["18", "28", "38", "48", "58", "68", "78"],
    sequence: []
};

function openModal() { document.getElementById('modalSettings').style.display = 'flex'; }
function closeModal() { document.getElementById('modalSettings').style.display = 'none'; }

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function render() {
    document.getElementById('v-p-items').innerText = config.pItems;
    document.getElementById('v-p-scratches').innerText = config.pScratches;
    document.getElementById('v-total').innerText = config.total;

    const grid = document.getElementById('scratch-grid');
    if (!grid) return;

    grid.innerHTML = '';
    const rows = Math.ceil(config.total / config.cols);
    grid.style.gridTemplateColumns = `repeat(${config.cols}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

    const historyData = JSON.parse(localStorage.getItem('FT_HISTORY_V6') || "[]");
    const padLen = config.total.toString().length;

    config.sequence.forEach(val => {
        const spotWrapper = document.createElement('div');
        spotWrapper.className = 'spot-wrapper';

        const spot = document.createElement('div');
        spot.className = 'spot';
        spot.innerText = val.toString().padStart(padLen, '0');

        // 如果已經在紀錄中（包含剛刮 1% 的），渲染時直接顯示黃底數字，不放畫布
        const isDone = historyData.some(h => h.id === val);

        if (!isDone) {
            const cvs = document.createElement('canvas');
            cvs.setAttribute('data-id', val);
            spot.appendChild(cvs);
            setTimeout(() => initCanvas(cvs, val), 0);
        } else {
            spot.style.background = '#ffd54f';
        }
        spotWrapper.appendChild(spot);
        grid.appendChild(spotWrapper);
    });
    updateUI();
}

function initCanvas(canvas, realId) {
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    ctx.fillStyle = '#1c2331';
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
    ctx.fill();

    let active = false;
    const scratch = (e) => {
        if (!active) return;
        const r = canvas.getBoundingClientRect();
        const x = ((e.clientX || (e.touches ? e.touches[0].clientX : 0)) - r.left);
        const y = ((e.clientY || (e.touches ? e.touches[0].clientY : 0)) - r.top);

        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(x, y, 18, 0, Math.PI * 2);
        ctx.fill();
        checkThreshold(canvas, ctx, realId);
    };

    function checkThreshold(cvs, context, spotId) {
        const pix = context.getImageData(0, 0, cvs.width, cvs.height).data;
        let t = 0;
        for (let i = 3; i < pix.length; i += 4) if (pix[i] === 0) t++;

        const scratchedPercent = t / (cvs.width * cvs.height);

        // --- 核心修改：只要刮開超過 1%，立即紀錄為已刮 ---
        if (scratchedPercent > 0.01) {
            recordScratch(spotId);
        }

        // 超過 45% 執行揭曉動畫
        if (scratchedPercent > 0.45) {
            revealItem(cvs, spotId);
        }
    }

    canvas.addEventListener('mousedown', () => active = true);
    canvas.addEventListener('touchstart', (e) => { active = true; e.preventDefault(); }, { passive: false });
    window.addEventListener('mouseup', () => active = false);
    window.addEventListener('touchend', () => active = false);
    canvas.addEventListener('mousemove', scratch);
    canvas.addEventListener('touchmove', scratch, { passive: false });
}

function revealItem(cvs, spotId) {
    cvs.style.transition = 'opacity 0.4s';
    cvs.style.opacity = '0';
    setTimeout(() => {
        if (cvs.parentNode) {
            cvs.remove();
            // 這裡不再呼叫 recordScratch，因為 1% 時已經呼叫過了
        }
    }, 400);
}

function recordScratch(id) {
    let history = JSON.parse(localStorage.getItem('FT_HISTORY_V6') || "[]");
    if (!history.some(h => h.id === id)) {
        const time = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        history.unshift({ id, time });
        localStorage.setItem('FT_HISTORY_V6', JSON.stringify(history.slice(0, 300)));
        updateUI(); // 立即更新畫面上的「已刮數」
    }
}

function updateUI() {
    const history = JSON.parse(localStorage.getItem('FT_HISTORY_V6') || "[]");
    const padLen = config.total.toString().length;
    document.getElementById('c-remain').innerText = config.total - history.length;
    document.getElementById('c-scratched').innerText = history.length;

    const hList = document.getElementById('scratch-history-list');
    if (hList) {
        hList.innerHTML = '';
        history.slice(0, 8).forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `<span class="hist-num">#${item.id.toString().padStart(padLen, '0')}</span><span class="hist-time">${item.time}</span>`;
            hList.appendChild(div);
        });
    }

    const hIds = history.map(h => h.id);
    const renderList = (nums, containerId, color) => {
        const container = document.getElementById(containerId);
        if (!container) return; container.innerHTML = '';
        nums.forEach(n => {
            const val = parseInt(n); if (isNaN(val)) return;
            const isDone = hIds.includes(val);
            container.innerHTML += `<span class="prize-tag" style="background:${isDone ? '#4caf50' : color};">
                ${val.toString().padStart(padLen, '0')} ${isDone ? '<i class="fas fa-check"></i>' : ''}
            </span>`;
        });
    };
    renderList(config.gNums, 'list-grand', '#f44336');
    renderList(config.nNums, 'list-general', '#ff9800');
}

function saveSettings() {
    const total = parseInt(document.getElementById('i-total').value);
    const gNums = document.getElementById('i-g-nums').value.split(',').map(s => s.trim());
    const nNums = document.getElementById('i-n-nums').value.split(',').map(s => s.trim());
    if (gNums.some(n => parseInt(n) > total) || nNums.some(n => parseInt(n) > total)) { alert("號碼不可超過總數！"); return; }
    let seq = []; for (let i = 1; i <= total; i++) seq.push(i);
    config = { pItems: document.getElementById('i-p-items').value, pScratches: document.getElementById('i-p-scratches').value, total, cols: parseInt(document.getElementById('i-cols').value), gNums, nNums, sequence: shuffleArray(seq) };
    localStorage.setItem('FT_CONFIG_V6', JSON.stringify(config));
    localStorage.removeItem('FT_HISTORY_V6');
    render(); closeModal();
}

// --- 新增：一鍵揭曉已刮但未全開的格子 ---
function revealPartials() {
    // 1. 取得目前已經登記為「已刮」的號碼紀錄
    const history = JSON.parse(localStorage.getItem('FT_HISTORY_V6') || "[]");
    const historyIds = history.map(h => h.id);

    // 2. 抓取畫面上「所有還活著的黑色遮蓋層 (canvas)」
    const canvases = document.querySelectorAll('canvas');

    // 3. 逐一檢查
    canvases.forEach(cvs => {
        const id = parseInt(cvs.getAttribute('data-id'));

        // 如果這個畫布的號碼，已經存在於已刮紀錄中
        // 代表它是「被刮了 >1% 產生了紀錄，但還沒達到 55% 消失門檻」的半成品
        if (historyIds.includes(id)) {
            // 強制呼叫揭曉動畫，讓黑色圖層消失
            revealItem(cvs, id);
        }
    });
}
function resetGame() { if (confirm("確定要重置進度嗎？")) { localStorage.removeItem('FT_HISTORY_V6'); render(); } }

window.onload = () => {
    const saved = localStorage.getItem('FT_CONFIG_V6');
    if (saved) config = JSON.parse(saved);
    else { let s = []; for (let i = 1; i <= 80; i++) s.push(i); config.sequence = shuffleArray(s); }
    document.getElementById('i-p-items').value = config.pItems;
    document.getElementById('i-p-scratches').value = config.pScratches;
    document.getElementById('i-total').value = config.total;
    document.getElementById('i-cols').value = config.cols;
    document.getElementById('i-g-nums').value = config.gNums.join(',');
    document.getElementById('i-n-nums').value = config.nNums.join(',');
    render();

};

