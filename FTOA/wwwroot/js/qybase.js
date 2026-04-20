/* --- wwwroot/js/qybase.js --- */

// 1. 全域變數與狀態
var GRID_STATE = {};
var HAS_SEARCHED = false;
var TIMER_INTERVAL = null;
var RESIZE_STATE = { resizing: false, startX: 0, startWidth: 0, th: null };
var GLOBAL_GRID_CONFIGS = typeof GLOBAL_GRID_CONFIGS !== 'undefined' ? GLOBAL_GRID_CONFIGS : {};

// ★★★ 新增：編輯模式狀態與下拉快取 ★★★
var IS_EDIT_MODE = false;
var COLUMN_DROPDOWN_CACHE = {}; // Key: SQL_ID||WHERE, Value: HTML String of options

// 2. 計時器與資料處理
function startTimer() {
    var startTime = Date.now();
    var timerElement = $('#loadingTimer');
    if (timerElement.length === 0) return;
    timerElement.text("用時: 0.00 秒");
    if (TIMER_INTERVAL) clearInterval(TIMER_INTERVAL);
    TIMER_INTERVAL = setInterval(function () {
        var elapsedTime = (Date.now() - startTime) / 1000;
        timerElement.text("用時: " + elapsedTime.toFixed(2) + " 秒");
    }, 50);
}

function stopTimer() {
    if (TIMER_INTERVAL) {
        clearInterval(TIMER_INTERVAL);
        TIMER_INTERVAL = null;
    }
}

function processCustomData(toolId, resData, defaultGdna) {
    if (resData && !Array.isArray(resData) && typeof resData === 'object') {
        return resData;
    }
    var result = {};
    result[defaultGdna] = resData;
    return result;
}

// 3. 初始化與事件綁定
$(document).ready(() => {
    ScannerController.init();
    // ★★★ 新增：注入隱形下拉選單樣式 (讓 Select 失去焦點時像純文字) ★★★
    $('<style>').prop('type', 'text/css').html(`
        .stealth-select {
            -webkit-appearance: none; -moz-appearance: none; appearance: none;
            border: 1px solid transparent !important;
            background-color: transparent !important;
            padding-left: 2px;
            cursor: pointer;
        }
        /* 當被選取或滑鼠移過時，恢復原本樣式 */
        .stealth-select:focus, .stealth-select:active, .stealth-select:hover {
            -webkit-appearance: menulist; -moz-appearance: menulist; appearance: menulist;
            border: 1px solid #ced4da !important;
            background-color: #fff !important;
        }
    `).appendTo('head');

    console.log("JS Loaded");

    // ======== 按鈕事件綁定 ========
    $('#btnSearch').on('click', openQueryModal);

    // 重置按鈕邏輯
    $('#btnReset').off('click').on('click', function () {
        if (confirm("確定要重置畫面嗎？\n(將清除所有查詢條件與結果)")) {
            // 使用 reload 重新載入頁面，達到完全重置的效果
            window.location.reload();
        }
    });

    // ★★★ 補上：掃碼按鈕的點擊動作 ★★★
    $('#btnScan').off('click').on('click', function () {
        // 這裡放入您按下去後想執行的掃碼邏輯
        alert("掃碼功能啟動！(請在此處實作您的掃碼邏輯)");
        // 如果您有寫好的掃碼函數，可以直接呼叫，例如：
        // if (typeof CT_OpenScan === 'function') CT_OpenScan();
    });

    // Modal 導航與功能事件
    $('#btnModalPrev, #btnModalNext, #btnModalFirst, #btnModalLast').on('click', function () {
        navModal(this.id.replace('btnModal', '').toLowerCase());
    });
    $('#btnModalGo').on('click', jumpToModalPage);
    $('#inputModalCurrentPage').on('keyup', e => (e.key === 'Enter') && jumpToModalPage());
    $('#btnModalCopy').on('click', copyModalContent);
    // ======== 狀態初始化 ========
    if (CURRENT_TOOL_CONFIG?.GDNA_LT) {
        // ★★★ 依據 SN_IG 設定決定是否顯示掃碼按鈕，並確保它解鎖 ★★★
        if (CURRENT_TOOL_CONFIG.SN_IG === 1) {
            $('#btnScan').show().prop('disabled', false).removeClass('disabled');
        } else {
            $('#btnScan').hide();
        }
        preloadAllDropdowns(CURRENT_TOOL_CONFIG);
        initLayout(CURRENT_TOOL_CONFIG);
        if (SEARCH_RESULT && Object.keys(SEARCH_RESULT).length > 0) {
            HAS_SEARCHED = true;
            Object.entries(SEARCH_RESULT).forEach(([gdna, data]) => {
                // ★★★ 補上 _rowId，否則全選功能會找不到 ID ★★★
                if (Array.isArray(data)) {
                    data.forEach((row, index) => {
                        row._rowId = index;
                    });
                }
                if (!GRID_STATE[gdna]) initGridState(gdna);
                Object.assign(GRID_STATE[gdna], {
                    allData: data, filteredData: data, hasLoaded: true
                });
                autoFitColumnWidths(gdna);
                renderGridWithPagination(gdna);
            });
        }
        switchTabUI(SERVER_ACTIVE_GDNA || CURRENT_TOOL_CONFIG.GDNA_LT[0].GDNA);
    }
});

var ScannerController = {
    html5QrCode: null,
    $currentTarget: null,
    isMemoMode: false,
    scannedSet: new Set(),

    init: function () {
        this.injectStyles();

        // 【關鍵修正】確保 Modal 完全展開「並穩定」後才啟動相機
        $(document).off('shown.bs.modal', '#barcodeScannerModal').on('shown.bs.modal', '#barcodeScannerModal', () => {
            console.log("Scanner Modal fully shown, preparing camera...");
            // 給予 100ms 的緩衝，確保 DOM 寬高已經計算完畢
            setTimeout(() => {
                this.startCamera();
            }, 100);
        });

        // 當視窗開始隱藏時執行清理
        $(document).off('hidden.bs.modal', '#barcodeScannerModal').on('hidden.bs.modal', '#barcodeScannerModal', () => {
            console.log("Scanner Modal closing, cleaning up...");
            this.stopScanner();

            // 恢復 UI 初始狀態
            $('#qr-reader').empty().html(`
                <div class="text-white-50">
                    <i class="fas fa-circle-notch fa-spin fa-2x mb-2"></i><br>
                    <small>正在擷取相機訊號...</small>
                </div>
            `);
            $('body').css('cursor', 'default');
            if (this.$currentTarget) this.$currentTarget.focus();

            // 確保多層 Modal 的捲軸不會消失
            if ($('.modal.show').length > 0) {
                $('body').addClass('modal-open');
            }
        });
    },

    injectStyles: function () {
        if ($('#scanner-custom-style').length === 0) {
            $('<style id="scanner-custom-style">').prop('type', 'text/css').html(`
                .btn-scan-inline { padding: 0px 6px; font-size: 11px; margin-left: 5px; vertical-align: text-top; border-radius: 4px; line-height: 1.4; }
                .scan-log-item { padding: 5px 10px; border-bottom: 1px inset #eee; font-size: 13px; margin-bottom: 2px; border-left: 4px solid transparent; }
                .scan-log-item.new { background-color: #e8f5e9; border-left-color: #28a745; animation: scanFade 1.2s ease-out; }
                @keyframes scanFade { from { background: #fff3cd; } to { background: #e8f5e9; } }
                #barcodeScannerModal { z-index: 10060 !important; }
                #qr-reader video { object-fit: cover !important; width: 100% !important; height: 100% !important; border-radius: 8px; }
            `).appendTo('head');
        }
    },

    // 負責為查詢介面注入按鈕
    injectButtonsToQuery: function () {
        var self = this;
        $('#queryModalBody label').each(function () {
            var $label = $(this);
            var $input = $label.closest('div').find('input[type="text"], input[type="number"], textarea');
            if ($input.length > 0 && !$input.prop('readonly') && $label.find('.btn-scan-inline').length === 0) {
                var $btn = $(`
                    <button type="button" class="btn btn-outline-primary btn-scan-inline" title="掃碼輸入">
                        <i class="fas fa-qrcode"></i>
                    </button>
                `);
                $btn.on('click', function (e) {
                    e.preventDefault();
                    self.openScanner($input);
                });
                $label.append($btn);
            }
        });
    },

    openScanner: function ($input) {
        this.$currentTarget = $input;
        this.isMemoMode = $input.is('textarea');
        this.scannedSet.clear();

        $('#scanned-items-list').html('<div class="text-muted text-center py-2">等待掃描...</div>');
        $('#scanner-hint').html(this.isMemoMode ?
            '<i class="fas fa-clone mr-1"></i> 多筆連續掃描模式' :
            '<i class="fas fa-mouse-pointer mr-1"></i> 單筆掃描模式');

        // 打開視窗
        $('#barcodeScannerModal').modal({
            backdrop: 'static',
            keyboard: false,
            show: true
        });
    },

    // 啟動相機
    startCamera: function () {
        const self = this;

        // 1. 確保容器乾淨且可以看到
        $('#qr-reader').empty();

        // 2. 實例化
        self.html5QrCode = new Html5Qrcode("qr-reader");

        // 3. 設定啟動參數
        // 注意：qrbox 不要設太大，建議設為動態寬度的 70%
        const qrWidth = $('#qr-reader').width() * 0.7 || 250;

        const config = {
            fps: 20,
            qrbox: { width: qrWidth, height: qrWidth * 0.7 },
            aspectRatio: 1.0,
            videoConstraints: {
                facingMode: "environment" // 強制後鏡頭
            }
        };

        // 4. 開始掃描
        self.html5QrCode.start(
            { facingMode: "environment" },
            config,
            (text) => self.onScanSuccess(text)
        ).then(() => {
            $('#scanner-hint').html('<span class="text-success"><i class="fas fa-check-circle"></i> 相機已就緒</span>');
        }).catch(err => {
            console.error("Camera activation failed:", err);
            $('#qr-reader').html(`
                <div class="p-4 text-warning">
                    <i class="fas fa-exclamation-triangle fa-2x mb-2"></i><br>
                    相機啟動失敗<br>
                    <small>${err}</small>
                </div>
            `);
            $('#scanner-hint').html('<span class="text-danger">啟動失敗: 可能無權限或設備忙碌</span>');
        });
    },

    onScanSuccess: function (decodedText) {
        const text = decodedText.trim();
        if (!text) return;

        if (this.isMemoMode) {
            if (!this.scannedSet.has(text)) {
                this.scannedSet.add(text);
                const currentVal = this.$currentTarget.val();
                this.$currentTarget.val(currentVal ? (currentVal + '\n' + text) : text).trigger('change');

                if (this.scannedSet.size === 1) $('#scanned-items-list').empty();
                $('#scanned-items-list').prepend(`<div class="scan-log-item new">${text}</div>`);
                this.playBeep();
            }
        } else {
            this.$currentTarget.val(text).trigger('change');
            this.playBeep();
            $('#barcodeScannerModal').modal('hide');
        }
    },

    stopScanner: function () {
        if (!this.html5QrCode) return;

        try {
            const state = this.html5QrCode.getState();
            // 只有正在執行時才呼叫 stop()
            if (state === 2 || state === 3) {
                this.html5QrCode.stop().then(() => {
                    this.html5QrCode.clear();
                    this.html5QrCode = null;
                }).catch(err => {
                    console.warn("Cleanup error:", err);
                    this.html5QrCode = null;
                });
            } else {
                // 若只是 IDLE，直接清理
                this.html5QrCode.clear();
                this.html5QrCode = null;
            }
        } catch (e) {
            this.html5QrCode = null;
        }
    },

    playBeep: function () {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value = 850;
            gain.gain.setValueAtTime(1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
            osc.start(); osc.stop(ctx.currentTime + 0.1);
        } catch (e) { }
    }
};

// 4. 下拉選單預載邏輯 (修改：支援複合 Key)
function preloadAllDropdowns(config) {
    if (!config.GDNA_LT) return;
    $.each(config.GDNA_LT, function (i, item) {
        var gdna = item.GDNA;
        var cols = GLOBAL_GRID_CONFIGS[gdna];
        if (cols) {
            $.each(cols, function (j, col) {
                if ((col.Type === 6 || col.Type === 9) && col.Hint) {
                    loadColumnDropdownData(col.Hint, "");
                }
            });
        }
    });
}

// 3. 下拉選單載入 (修正版：加入欄位自動對應與除錯)
function loadColumnDropdownData(sqlId, inWhere, valueField, textField) {
    // 確保參數不為 undefined
    inWhere = inWhere || "";
    valueField = valueField || "";
    textField = textField || "";
    // ★★★ 修正：Cache Key 必須包含 valueField 和 textField，才能跟 checkDropdownLoaded 對應 ★★★
    const cacheKey = sqlId + "||" + inWhere + "||" + valueField + "||" + textField;
    if (COLUMN_DROPDOWN_CACHE[cacheKey] && !COLUMN_DROPDOWN_CACHE[cacheKey].includes('載入中')) return;
    COLUMN_DROPDOWN_CACHE[cacheKey] = '<option value="">載入中...</option>';
    console.log(`[LoadDropdown] 開始載入: ${sqlId}, 條件: ${inWhere}, Val: ${valueField}, Txt: ${textField}`);
    $.ajax({
        url: '/Basic/GetDropdownData',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ SQL_ID: sqlId, IN_WHERE: inWhere }),
        success: function (res) {
            const data = (res && res.R_RCT > 0 && Array.isArray(res.ROWLIST)) ? res.ROWLIST : [];
            let html = "";
            if (data.length === 0) {
                html = '<option value="">無資料 (Check SQL/Where)</option>';
            } else {
                if (data.length > 1) {
                    html = '<option value="">請選擇</option>';
                }
                // ★★★ 自動偵測 Key (如果沒傳入 valueField/textField 則自動猜測) ★★★
                const keys = Object.keys(data[0]);
                // 1. 決定 Value Key
                let valKey = valueField;
                if (!valKey || data[0][valKey] === undefined) {
                    valKey = keys.find(k => k.toLowerCase() === 'x_userno') ||
                        keys.find(k => k.toLowerCase() === 'sys_id') ||
                        keys.find(k => k.toLowerCase().includes('id') || k.toLowerCase().includes('no')) ||
                        keys[0];
                }
                // 2. 決定 Text Key
                let txtKey = textField;
                if (!txtKey || data[0][txtKey] === undefined) {
                    txtKey = keys.find(k => k.toLowerCase() === 'sw_name') ||
                        keys.find(k => k.toLowerCase() === 'sys_name') ||
                        keys.find(k => k.toLowerCase().includes('name') || k.toLowerCase().includes('desc')) ||
                        keys[1] || keys[0];
                }
                data.forEach(item => {
                    const val = (item[valKey] !== undefined && item[valKey] !== null) ? item[valKey] : "";
                    const txt = (item[txtKey] !== undefined && item[txtKey] !== null) ? item[txtKey] : val;
                    const selectedAttr = (data.length === 1) ? "selected" : "";
                    html += `<option value="${val}" ${selectedAttr}>${txt}</option>`;
                });
            }
            COLUMN_DROPDOWN_CACHE[cacheKey] = html;
            console.log(`[LoadDropdown] 載入完成: ${cacheKey}`);
        },
        error: function (xhr, status, error) {
            console.error(`[LoadDropdown] 失敗: ${error}`);
            COLUMN_DROPDOWN_CACHE[cacheKey] = '<option value="">載入失敗</option>';
        }
    });
}

function preloadAllDropdowns(config) {
    if (!config.GDNA_LT) return;
    config.GDNA_LT.forEach(item => {
        const cols = GLOBAL_GRID_CONFIGS[item.GDNA];
        if (cols) {
            cols.forEach(col => col.Type === 6 && col.Hint && loadColumnDropdownData(col.Hint, ""));
        }
    });
}

function initGridState(gdna) {
    if (!GRID_STATE[gdna]) {
        GRID_STATE[gdna] = {
            allData: [],
            filteredData: [],
            currentPage: 1,
            pageSize: 100,
            selectedIds: new Set(),
            hasLoaded: false,
            filterText: "",
            // ★★★ 新增：排序狀態 ★★★
            sortField: null,
            sortOrder: 'asc' // 'asc' 或 'desc'
        };
    }
}

// 5. 佈局初始化
function initLayout(config) {
    const $container = $("#dynamicGridContainer").empty();
    const grids = config.GDNA_LT;
    if (!grids?.length) return;
    const swCk = config.SW_CK ?? 1;
    const canEd = config.CAN_ED === 1;
    const gdTl = config.GD_TL || 0;
    const showImport = config.IM_BT === 1; // 匯入模式標記
    if (showImport) {
        // 匯入模式：顯示匯入鈕，顯示按鈕群組但隱藏新增/修改，僅留刪除
        $('#btnImport').show();
        $('#edit-action-group').show();
        $('#btnAdd, #btnEdit').hide();
        $('#btnDel').show();
    } else {
        $('#btnImport').hide();
        if (canEd) {
            $('#edit-action-group').show();
            $('#btnAdd, #btnEdit, #btnDel').show();
        } else {
            $('#edit-action-group').hide();
        }
    }
    // 準備容器
    // 1. 頁籤導航列 (Tab Nav)
    const $tabNav = $('<ul class="nav nav-tabs" id="mainTab" role="tablist"></ul>');
    // 2. 頁籤內容區 (Tab Content)
    const $tabContent = $('<div class="tab-content"></div>');
    // 3. (主從模式專用) 表頭區塊容器
    const $masterArea = $('<div class="master-grid-area mb-3 border-bottom pb-3"></div>');

    grids.forEach((item, index) => {
        // --- A. 判斷邏輯 ---
        // 是否為「主從模式下的明細檔」(即 GD_TL=1 且不是第1個)
        const isMasterDetailDetail = (gdTl === 1 && index > 0);

        // --- B. 生成工具列 (Toolbar) - 最終除錯版 ---

        // 1. 取得設定 (支援大小寫容錯)
        var configs = (typeof GLOBAL_GRID_CONFIGS !== 'undefined') ? GLOBAL_GRID_CONFIGS : {};
        var targetKey = Object.keys(configs).find(k => k.toUpperCase() === item.GDNA.toUpperCase());
        var gridCols = targetKey ? configs[targetKey] : [];

        // Debug: 檢查是否讀取到 Grid 設定
        if (!targetKey) {
            console.error(`[錯誤] GDNA: ${item.GDNA} 找不到對應的 Grid 設定！請檢查 GLOBAL_GRID_CONFIGS 是否包含此 Key。`);
        }

        // 2. 生成選項 (加入 FdSw 判斷)
        var optionHtmlList = gridCols.map(function (col) {
            var f = col.Field || col.field;
            var t = col.Title || col.title || f;
            // 預設顯示 (如果沒設定 FdSw 則視為 1)
            var fdSw = (col.FdSw !== undefined) ? col.FdSw : 1;

            // 只有當「有欄位代號」且「FdSw 不為 0」時才生成
            if (f && fdSw !== 0) {
                return `<a class="dropdown-item" href="#" data-field-name="${f}">${t}</a>`;
            }
            return "";
        });

        // 3. 組合 HTML
        var dropdownInnerHtml = optionHtmlList.join('');
        var dropdownItems = `<a class="dropdown-item active" href="#" data-field-name="ALL">全部欄位</a>` + dropdownInnerHtml;

        // Debug: 印出實際生成的內容 (請在 F12 Console 查看這行)
        console.log(`[Toolbar] GDNA:${item.GDNA} 下拉清單內容預覽:`, dropdownInnerHtml ? dropdownInnerHtml.substring(0, 100) + "..." : "(無額外欄位)");

        // --- 下拉選單生成結束 ---

        // 決定是否顯示「全部全選/全部取消」按鈕
        // 規則：開啟勾選功能(swCk=1) 且 (不是主從模式的明細檔)
        let buttonsHtml = '';
        if (swCk === 1 && !isMasterDetailDetail) {
            buttonsHtml = `
            <div class="btn-group mr-3">
                <button class="btn btn-sm btn-outline-success btn-select-global-all" data-gdna="${item.GDNA}">全部全選</button>
                <button class="btn btn-sm btn-outline-danger btn-select-global-none" data-gdna="${item.GDNA}">全部取消</button>
            </div>`;
        }

        // 組合勾選資訊區塊
        const selectionHtml = swCk === 1 ? `
            <span class="mr-3 text-info font-weight-bold" id="selection-info-${item.GDNA}" style="white-space:nowrap;">
                <i class="fas fa-check-circle mr-1"></i>已勾選 0 筆
            </span>
            ${buttonsHtml}` : '';

        let detailAddBtnHtml = '';
        if (gdTl === 1 && index > 0) {
            detailAddBtnHtml = `
        <button class="btn btn-sm btn-success mr-2 btn-add-detail" data-gdna="${item.GDNA}">
            <i class="fas fa-plus-circle mr-1"></i>新增明細
        </button>`;
        }

        const toolbarHtml = `
            <div class="grid-toolbar mb-2 p-2 bg-light border rounded">
                <div class="d-flex align-items-center w-100 flex-wrap">
                    <div class="d-flex align-items-center flex-wrap flex-grow-1">
                        ${selectionHtml}
                        ${detailAddBtnHtml}
                        <div class="input-group input-group-sm" style="width:250px">
                            <div class="input-group-prepend">
                                <button class="btn btn-sm btn-outline-secondary dropdown-toggle quick-filter-column-select" 
                                        data-toggle="dropdown" data-field-name="ALL" data-gdna="${item.GDNA}">全部欄位</button>
                                <div class="dropdown-menu quick-filter-columns-menu" style="max-height:300px;overflow-y:auto">
                                    ${dropdownItems}
                                </div>
                            </div>
                            <input type="text" class="form-control quick-filter" data-gdna="${item.GDNA}" placeholder="快篩...">
                        </div>
                    </div>
                    <div class="d-flex align-items-center ml-auto pl-3">
                        <label class="mr-2 mb-0 text-muted" style="white-space:nowrap;">每頁:</label>
                        <select class="form-control form-control-sm page-size-selector" data-gdna="${item.GDNA}" style="width:auto">
                            <option value="25">25</option>
                            <option value="50">50</option>
                            <option value="100" selected>100</option>
                            <option value="200">200</option>
                            <option value="ALL">全部</option>
                        </select>
                    </div>
                </div>
            </div>`;

        // --- C. 組合 Grid 本體 HTML ---
        const gridHtml = `
            <div class="grid-wrapper">
                ${toolbarHtml}
                <div class="grid-table-scroll-area">
                    ${generateTableHtml(item.GDNA)}
                    <div id="loading-${item.GDNA}" style="display:none;text-align:center;padding:50px">
                        <i class="fas fa-spinner fa-spin fa-3x text-primary"></i>
                        <div class="mt-2 font-weight-bold text-muted">資料載入中...</div>
                    </div>
                </div>
                <div class="pagination-container" id="pagination-${item.GDNA}" style="display:none;margin-top:10px">
                    <div class="pagination-left"><span id="page-info-${item.GDNA}"></span></div>
                    <div class="pagination-buttons" id="page-btns-${item.GDNA}"></div>
                </div>
            </div>`;

        // 判斷是否為「表頭」(主從模式下的第1筆)
        const isMaster = (gdTl === 1 && index === 0);
        if (isMaster) {
            const $masterBlock = $(`<div class="master-grid-block" data-gdna="${item.GDNA}">${gridHtml}</div>`);
            $masterBlock.on('click', function () {
                $('#currentGdnaInput').val(item.GDNA);
                $('.grid-wrapper').removeClass('border-primary');
                $(this).find('.grid-wrapper').addClass('border-primary');
            });
            $masterArea.append($masterBlock);
        } else {
            $tabNav.append(`
                <li class="nav-item">
                    <a class="nav-link" id="tab-${item.GDNA}" data-toggle="tab" href="#content-${item.GDNA}" 
                       data-gdna="${item.GDNA}"><i class="fas fa-table mr-2"></i>${item.GDSNA}</a>
                </li>
            `);
            $tabContent.append(`
                <div class="tab-pane fade" id="content-${item.GDNA}" role="tabpanel">
                    ${gridHtml}
                </div>
            `);
        }
        initGridState(item.GDNA);
        setTimeout(() => {
            autoFitColumnWidths(item.GDNA);
        }, 0);
    });

    // --- E. 將容器加入 DOM ---
    if (gdTl === 1) {
        $container.append($masterArea);
        if (grids.length > 1) {
            const $detailContainer = $('<div class="detail-grid-container"></div>');
            $detailContainer.append($tabNav, $tabContent);
            $container.append($detailContainer);
            setTimeout(() => {
                const masterGdna = grids[0].GDNA;
                const firstDetailGdna = grids[1].GDNA;
                $(`#tab-${firstDetailGdna}`).tab('show');
                $('#currentGdnaInput').val(masterGdna);
                $('.master-grid-block .grid-wrapper').addClass('border-primary shadow-sm');
            }, 100);
        } else {
            $('#currentGdnaInput').val(grids[0].GDNA);
        }
    } else {
        $container.append($tabNav, $tabContent);
    }
    setupEventDelegation();
}

// 事件委派 (修正所有語法錯誤)
function setupEventDelegation() {
    // 先解除所有先前的綁定，避免重複執行
    $(document).off('click', '#mainTab .nav-link');
    $(document).off('click', '.master-grid-block tbody tr');
    $(document).off('click', '.btn-add-detail');
    $(document).off('click', '#btnAdd');
    $(document).off('click', '#btnEdit');
    $(document).off('click', '#btnDel');
    $(document).on('change', '.page-size-selector', function () {
        var gdna = $(this).data('gdna');
        var val = $(this).val();
        changePageSize(gdna, val);
    });
    // 1. 快篩欄位下拉選單點擊事件
    $(document).on('click', '.quick-filter-columns-menu .dropdown-item', function (e) {
        e.preventDefault();
        var $item = $(this);
        var fieldName = $item.data('field-name'); // 取得欄位名稱 (ALL 或 特定欄位)
        var fieldText = $item.text();              // 取得顯示文字

        // 找到對應的按鈕並更新文字與狀態
        var $container = $item.closest('.input-group');
        var $btn = $container.find('.quick-filter-column-select');
        var $input = $container.find('.quick-filter');
        var gdna = $btn.data('gdna');

        // 更新按鈕顯示
        $btn.text(fieldText);
        $btn.data('field-name', fieldName);

        // 立即觸發篩選 (帶入目前輸入框的值)
        applyQuickFilter(gdna, $input.val(), fieldName);
    });

    // 2. 快篩輸入框打字事件
    $(document).on('keyup', '.quick-filter', function () {
        var $input = $(this);
        var gdna = $input.data('gdna');
        var val = $input.val();

        // 取得目前選定的篩選欄位 (從旁邊的按鈕拿)
        var $btn = $input.closest('.input-group').find('.quick-filter-column-select');
        var fieldName = $btn.data('field-name') || 'ALL';

        applyQuickFilter(gdna, val, fieldName);
    });
    $(document).on('change keyup', '#detailModalContent .editable-field', function () {
        var $el = $(this);
        var newVal = String($el.val() || "").trim();
        var origVal = String($el.attr('data-orig') || "").trim();

        if (newVal !== origVal) {
            $el.addClass('field-dirty');
            // 同步回 Grid 格子 (視覺連動)
            var gdna = $('#detailModal').data('gdna');
            var index = $('#detailModal').data('index');
            if (index !== 'new') {
                var $gridInput = $(`#table_${gdna} tr[data-index="${index}"] [data-field="${$el.data('field')}"]`);
                $gridInput.addClass('field-dirty');
                $gridInput.closest('tr').addClass('row-dirty');
            }
        } else {
            $el.removeClass('field-dirty');
        }
    });

    $(document).on('change', '.grid-editable-select', function () {
        var $sel = $(this);
        var $container = $sel.closest('.lazy-select-container');
        var newVal = $sel.val();
        var newText = $sel.find('option:selected').text();
        var rowIdx = $sel.closest('tr').data('index');
        var field = $sel.data('field');
        var gdna = $sel.data('gdna');
        // 更新資料狀態
        if (GRID_STATE[gdna] && GRID_STATE[gdna].filteredData[rowIdx]) {
            GRID_STATE[gdna].filteredData[rowIdx][field] = newVal;
            if (typeof CT_STATE !== 'undefined') CT_STATE.isDirty = true;
        }
        // 結束編輯狀態：將容器還原為文字顯示（避免過多 Select2 佔用記憶體）
        setTimeout(function () {
            $container.data('val', newVal).html(newText).addClass('bg-light-success');
        }, 100);
    });

    // ★ 新增：點擊 Grid 單元格才載入下拉選單
    $(document).off('click', '.lazy-select-container').on('click', '.lazy-select-container', function (e) {
        e.stopPropagation();
        var $container = $(this);
        if ($container.find('select').length > 0) return;
        var gdna = $container.data('gdna');
        var field = $container.data('field');
        var type = parseInt($container.data('type'));
        var originalVal = String($container.data('val') || "").trim(); // 這是 ID (不準沒關係，我們主要用下面的 text)
        // ★ 關鍵：直接抓取使用者目前看到的文字
        var currentText = $container.text().trim();
        var col = GLOBAL_GRID_CONFIGS[gdna].find(c => c.Field === field);
        if (!col) return;
        var useSqlId = col.Hint || "", useWhere = "", vKey = "", tKey = "";
        if (col.CbJs) { try { var cb = JSON.parse(col.CbJs); useSqlId = cb.SQL_ID || useSqlId; useWhere = cb.IN_WHERE || ""; vKey = cb.sa_fd || ""; tKey = cb.sw_name || cb.sa_name || ""; } catch (e) { } }
        var createSelect = function (optionsHtml) {
            var searchableClass = (type === 9) ? "searchable-select" : "";
            var $select = $(`<select class="form-control grid-editable-select ${searchableClass}" 
                            data-gdna="${gdna}" data-field="${field}" 
                            data-orig="${originalVal}" data-original-value="${originalVal}">
                            ${optionsHtml}
                         </select>`);
            $container.empty().append($select);

            // ★ 呼叫修正後的函式，傳入 currentText (中文名稱)
            forceSetSelectValue($select, originalVal, currentText);

            if (type === 9) {
                $select.select2({
                    theme: "bootstrap4",
                    width: '100%',
                    dropdownAutoWidth: true,
                    matcher: function (params, data) {
                        if ($.trim(params.term) === '') return data;
                        if (typeof data.text === 'undefined') return null;
                        return (data.text.toUpperCase().indexOf(params.term.toUpperCase()) > -1) ? data : null;
                    }
                });
                // Select2 初始化後再設定一次，確保萬無一失
                forceSetSelectValue($select, originalVal, currentText);
                setTimeout(() => { $select.select2('open'); }, 50);
            } else {
                $select.focus();
            }
        };

        // ... (Ajax 載入邏輯保持不變) ...
        var cacheKey = useSqlId + "||" + useWhere + "||" + vKey + "||" + tKey;
        if (COLUMN_DROPDOWN_CACHE[cacheKey] && !COLUMN_DROPDOWN_CACHE[cacheKey].includes('載入中')) {
            createSelect(COLUMN_DROPDOWN_CACHE[cacheKey]);
        } else {
            $container.append(' <i class="fas fa-spinner fa-spin ml-1"></i>');
            $.ajax({
                url: '/Basic/GetDropdownData',
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ SQL_ID: useSqlId, IN_WHERE: useWhere }),
                success: function (res) {
                    var html = buildDropdownHtml(res, vKey, tKey);
                    COLUMN_DROPDOWN_CACHE[cacheKey] = html;
                    createSelect(html);
                }
            });
        }
    });
    $(document).on('blur', '.grid-editable-select', function () {

    });

    $(document).on('click', '#btnAdd', function () {
        var gdna = $('#currentGdnaInput').val();
        if (gdna) openAddModal(gdna);
    });

    $(document).on('click', '#btnEdit', function () {
        var gdna = $('#currentGdnaInput').val();
        var state = GRID_STATE[gdna];
        if (!state) return;

        // --- 情況 A：結束編輯模式 ---
        if (state.isInlineEditing) {
            var $dirtyRows = $(`#tbody_${gdna} tr.row-dirty`);
            if ($dirtyRows.length > 0) {
                if (confirm(`偵測到 ${$dirtyRows.length} 筆資料有異動，確定要儲存並結束編輯嗎？`)) {
                    if (typeof CT_BatchSave === 'function') { CT_BatchSave(gdna); return; }
                } else {
                    if (confirm("是否要「放棄修改」並強制結束編輯模式？\n(異動資料將會還原為修改前狀態)")) {
                        state.isInlineEditing = false;
                        if (state._backupData) {
                            state.allData = JSON.parse(state._backupData);
                            delete state._backupData;
                        }
                        $(this).removeClass('btn-warning').addClass('btn-primary').html('<i class="fas fa-edit mr-1"></i> 修改');
                        applyQuickFilter(gdna, state.filterText);
                        return;
                    } else { return; }
                }
            }
            state.isInlineEditing = false;
            $(this).removeClass('btn-warning').addClass('btn-primary').html('<i class="fas fa-edit mr-1"></i> 修改');
            renderGridWithPagination(gdna);
        }
        // --- 情況 B：進入編輯模式 (加入動畫與延遲處理) ---
        else {
            if (state.filteredData.length === 0) { alert("目前無資料可編輯"); return; }
            // 1. 開啟動畫
            setGlobalLoadingState(true);
            $('#dataLoadingOverlay').fadeIn(100);
            // 2. 使用 setTimeout 讓瀏覽器有時間渲染動畫，再執行耗時的資料操作
            setTimeout(function () {
                state._backupData = JSON.stringify(state.allData);
                state.isInlineEditing = true;
                $('#btnEdit').removeClass('btn-primary').addClass('btn-warning')
                    .html('<i class="fas fa-save mr-1"></i> 結束編輯');
                renderGridWithPagination(gdna);
                // 3. 關閉動畫
                $('#dataLoadingOverlay').fadeOut(200);
                setGlobalLoadingState(false);
            }, 50);
        }
    });

    // ★ 新增：按鈕類型 (Type 7) 的事件委派
    $(document).on('click', '.btn-grid-action', function (e) {
        e.stopPropagation();
        var $btn = $(this);
        var gdna = $btn.data('gdna');
        var field = $btn.data('field');
        var index = $btn.data('index');

        // 呼叫 gridbt.js 的核心派發器
        if (typeof HandleGridAction === 'function') {
            HandleGridAction(gdna, field, index);
        } else {
            console.error("尚未載入 gridbt.js");
        }
    });
    // [刪除] 按鈕
    $(document).on('click', '#btnDel', function () {
        var gdna = $('#currentGdnaInput').val();
        if (gdna) deleteSelectedRows(gdna);
    });
    // [頁籤切換]
    $(document).on('click', '#mainTab .nav-link', function (e) {
        e.preventDefault();
        var gdna = $(this).data('gdna');
        updateCurrentGdna(gdna);
    });
    // [主從模式 - 點擊主檔列連動明細]
    $(document).on('click', '.master-grid-block tbody tr', function () {
        var $tr = $(this);
        var gdna = $tr.closest('table').attr('id').replace('table_', '');
        var idx = $tr.data('index');
        var rowData = GRID_STATE[gdna].filteredData[idx];
        // 視覺回饋
        $tr.addClass('table-primary').siblings().removeClass('table-primary');
        // 執行連動
        filterDetailGrids(gdna, rowData);
    });
    // [主從模式 - 新增明細]
    $(document).on('click', '.btn-add-detail', function () {
        var gdna = $(this).data('gdna');
        openAddModal(gdna);
    });
    // --- 6. 其他功能 (保持您原本的代碼) ---
    $(document)
        .on('change', '.check-all-page', function () {
            togglePageSelection($(this).data('gdna'), $(this).prop('checked'));
        })
        .on('change', '.row-checkbox', function (e) {
            e.stopPropagation();
            toggleRowSelection($(this).data('gdna'), parseInt($(this).data('rowid')), this);
        })
        .on('click', '.btn-use-hint', function (e) {
            e.preventDefault();
            var $input = $(this).closest('div').find('input:not([type="checkbox"]), textarea, select');
            $input.val($(this).attr('data-hint')).addClass('bg-warning');
            setTimeout(() => $input.removeClass('bg-warning'), 300);
            $input.trigger('change');
        })
        .on('click', '.sortable-col', function (e) {
            if (!$(e.target).hasClass('col-resizer')) executeGridSort($(this).data('gdna'), $(this).data('field'));
        })
        .on('mousedown', '.col-resizer', function (e) {
            e.preventDefault(); e.stopPropagation();
            var $th = $(this).closest('th');
            RESIZE_STATE = { resizing: true, startX: e.pageX, startWidth: $th.width(), th: $th };
            $('body').css('cursor', 'col-resize');
        });
    // 補上滑鼠移動監聽
    $(document).on('mousemove', function (e) {
        if (RESIZE_STATE.resizing && RESIZE_STATE.th) {
            e.preventDefault();
            var diff = e.pageX - RESIZE_STATE.startX;
            var newWidth = RESIZE_STATE.startWidth + diff;
            if (newWidth > 50) RESIZE_STATE.th.css('width', newWidth + 'px');
        }
    }).on('mouseup', function () {
        if (RESIZE_STATE.resizing) {
            RESIZE_STATE = { resizing: false, startX: 0, startWidth: 0, th: null };
            $('body').css('cursor', 'default');
        }
    });
}

// ★★★ 新增：Grid 排序邏輯 ★★★
function executeGridSort(gdna, field) {
    var state = GRID_STATE[gdna];
    // 防呆
    if (!state || !state.filteredData || state.filteredData.length === 0) return;
    // 1. 決定排序方向
    if (state.sortField === field) {
        // 如果原本就是這個欄位，切換方向 (asc -> desc -> asc)
        state.sortOrder = (state.sortOrder === 'asc') ? 'desc' : 'asc';
    } else {
        // 如果是新欄位，預設為 asc
        state.sortField = field;
        state.sortOrder = 'asc';
    }
    // 2. 取得欄位型態 (用於正確比較數字或字串)
    var cols = GLOBAL_GRID_CONFIGS[gdna];
    var colConfig = cols ? cols.find(c => c.Field === field) : null;
    var colType = colConfig ? colConfig.Type : 0;
    // 3. 執行排序 (針對 filteredData 排序)
    state.filteredData.sort(function (a, b) {
        // 取得值 (處理大小寫 Key 容錯)
        var valA = a[field] || a[field.toUpperCase()] || a[field.toLowerCase()];
        var valB = b[field] || b[field.toUpperCase()] || b[field.toLowerCase()];
        // 處理 null / undefined (視為空字串或最小值)
        if (valA === null || valA === undefined) valA = "";
        if (valB === null || valB === undefined) valB = "";
        var result = 0;
        // 針對數字類型 (Type 1=整數, 2=小數) 進行數值比較
        if (colType === 1 || colType === 2) {
            // 移除千分位符號再轉數字
            var numA = parseFloat(String(valA).replace(/,/g, ''));
            var numB = parseFloat(String(valB).replace(/,/g, ''));

            // 如果非數字，回退到字串比較
            if (isNaN(numA) || isNaN(numB)) {
                result = String(valA).localeCompare(String(valB));
            } else {
                result = numA - numB;
            }
        }
        // 針對日期/字串類型
        else {
            result = String(valA).localeCompare(String(valB), 'zh-Hant');
        }
        return (state.sortOrder === 'asc') ? result : -result;
    });
    // 4. 重置分頁並重新渲染
    state.currentPage = 1;
    // state.selectedIds.clear(); // 選項：排序後是否清除勾選？通常保留比較好，若要清除可取消註解
    renderGridWithPagination(gdna);
}

// 更新表頭圖示 (顯示箭頭)
function updateSortIcons(gdna) {
    var state = GRID_STATE[gdna];
    if (!state) return;
    var $table = $(`#table_${gdna}`);
    // 1. 重置所有圖示為預設灰色雙向箭頭
    $table.find('.sort-icon')
        .attr('class', 'fas fa-sort text-muted ml-1 sort-icon')
        .css('opacity', '0.3');
    // 2. 設定當前排序欄位的圖示
    if (state.sortField) {
        // 找到對應欄位的 th
        var $th = $table.find(`th[data-field="${state.sortField}"]`);
        var $icon = $th.find('.sort-icon');
        // 變色並更換圖示
        $icon.css('opacity', '1').removeClass('text-muted').addClass('text-primary');
        if (state.sortOrder === 'asc') {
            $icon.removeClass('fa-sort fa-sort-down').addClass('fa-sort-up');
        } else {
            $icon.removeClass('fa-sort fa-sort-up').addClass('fa-sort-down');
        }
    }
}

// 6. 其他核心函數 (保持原有邏輯，修正語法)
function switchTabUI(gdna) {
    $('#mainTab .nav-link').removeClass('active');
    $('.tab-content .tab-pane').removeClass('show active');
    $(`#tab-${gdna}`).addClass('active');
    $(`#content-${gdna}`).addClass('show active');
    $('#currentGdnaInput').val(gdna);
}
function updateCurrentGdna(gdna) {
    // 切換 UI
    switchTabUI(gdna);
    if (!GRID_STATE[gdna]) initGridState(gdna);
    // 判斷邏輯：
    // 1. 如果執行過搜尋 (HAS_SEARCHED) 且 該頁籤還沒載入過 (hasLoaded 為 false)
    if (HAS_SEARCHED && !GRID_STATE[gdna].hasLoaded) {
        loadGridDataAjax(gdna);
    } else {
        // 2. 如果已經有資料了，直接渲染即可
        renderGridWithPagination(gdna);
    }
}

function openQueryModal() {
    console.log("--- 執行查詢視窗開啟邏輯 (修正：優化 QYNA 尋找路徑) ---");
    var toolId = $('#toolIdInput').val();
    var qyna = "";
    var targetGdna = "";

    // 1. 優先權一：從全域 Tool 配置拿 QYNA (最穩定)
    if (typeof CURRENT_TOOL_CONFIG !== 'undefined' && CURRENT_TOOL_CONFIG.QYNA && CURRENT_TOOL_CONFIG.QYNA !== "undefined") {
        qyna = CURRENT_TOOL_CONFIG.QYNA;
    }

    // 2. 優先權二：如果全域沒設定，則從頁籤清單中找第一個有值的
    if (!qyna || qyna === "") {
        if (CURRENT_TOOL_CONFIG?.GDNA_LT?.length > 0) {
            $.each(CURRENT_TOOL_CONFIG.GDNA_LT, function (i, item) {
                if (item.QYNA && item.QYNA.trim() !== "" && item.QYNA !== "undefined") {
                    qyna = item.QYNA;
                    return false; // 找到就跳出
                }
            });
        }
    }

    // 3. 優先權三：保底使用 ToolId
    if (!qyna || qyna === "") qyna = toolId;

    // 4. 決定要使用的 GDNA 背景 (用於讀取欄位設定)
    // 如果是分頁模式 (GD_TL=0)，通常用第一頁；如果是主從 (GD_TL=1)，用最後一頁(明細)
    if (CURRENT_TOOL_CONFIG?.GDNA_LT?.length > 0) {
        if (CURRENT_TOOL_CONFIG.GD_TL === 1) {
            targetGdna = CURRENT_TOOL_CONFIG.GDNA_LT[CURRENT_TOOL_CONFIG.GDNA_LT.length - 1].GDNA;
        } else {
            targetGdna = CURRENT_TOOL_CONFIG.GDNA_LT[0].GDNA;
        }
    }

    console.log(`[搜尋啟動] QYNA: ${qyna}, 參考 GDNA: ${targetGdna}`);

    // 背景 Context 切換
    var originalGdna = $('#currentGdnaInput').val();
    if (targetGdna && targetGdna !== originalGdna) {
        $('#currentGdnaInput').val(targetGdna);
        $('#queryModal').one('hidden.bs.modal', function () {
            $('#currentGdnaInput').val(originalGdna);
        });
    }

    $('#queryModalLabel').text("查詢條件設定");
    $('#queryModal').modal('show');
    $('#queryModalBody').html('<div class="p-5 text-center"><i class="fas fa-spinner fa-spin fa-2x text-primary"></i><br>查詢頁面載入中...</div>');

    $.ajax({
        url: '/Basic/GetQueryForm/' + qyna,
        type: 'GET',
        cache: false,
        success: function (html) {
            if (!html || html.trim() === "") {
                $('#queryModalBody').html(`<div class="alert alert-warning m-3">找不到查詢頁面內容 (QYNA: ${qyna})</div>`);
                return;
            }
            $('#queryModalBody').html(html);
            // ★★★ 核心修改：載入畫面後，自動為 Label 注入掃碼按鈕 ★★★
            setTimeout(function () {
                if (typeof TMS_WEBTL_QY_CB === 'function') TMS_WEBTL_QY_CB();

                // 執行注入按鈕
                ScannerController.injectButtonsToQuery();

            }, 100);
        },
        error: function () {
            $('#queryModalBody').html(`
                <div class="p-5 text-center">
                    <i class="fas fa-exclamation-triangle fa-3x text-warning mb-3"></i>
                    <p class="h5">此功能未設定查詢條件設定頁</p>
                    <hr>
                    <button class="btn btn-primary" onclick="executeCustomSearch({}, '')">直接執行查詢 (不帶條件)</button>
                    <button class="btn btn-secondary" data-dismiss="modal">取消</button>
                </div>
            `);
        }
    });
}

function executeCustomSearch(queryParams, sqlCondition) {
    // === 加入 QY_ND 邏輯檢查 ===
    var isMandatory = (typeof CURRENT_TOOL_CONFIG !== 'undefined' && CURRENT_TOOL_CONFIG.QY_ND === 1);
    if (isMandatory) {
        // 檢查是否有實質的查詢條件 (sqlCondition 是否為空，或是 queryParams 是否有值)
        var hasSqlCond = sqlCondition && sqlCondition.trim() !== "" && sqlCondition.trim().toUpperCase() !== "AND";
        var hasParamCond = queryParams && Object.keys(queryParams).length > 0;
        if (!hasSqlCond && !hasParamCond) {
            alert("此功能設定為「必要查詢」，請至少輸入一項查詢條件後再執行。");
            // 如果是在 Modal 內，通常不關閉視窗讓使用者繼續輸入
            // 但如果已經關了，就重新打開它
            if (!$('#queryModal').hasClass('show')) {
                openQueryModal();
            }
            return; // 攔截，不執行後續 AJAX
        }
    }
    // === 檢查結束 ===
    HAS_SEARCHED = true;
    var $form = $('#actionForm');
    // 清除並重新注入自訂 SQL
    $form.find('input[name="cust_conditions"]').remove();
    if (sqlCondition) {
        $('<input>').attr({ type: 'hidden', name: 'cust_conditions', value: sqlCondition }).appendTo($form);
    }
    // 取得當前畫面停在哪個分頁
    var currentGdna = $('#currentGdnaInput').val() || (CURRENT_TOOL_CONFIG.GDNA_LT && CURRENT_TOOL_CONFIG.GDNA_LT[0].GDNA);
    // ★ 關鍵：將「所有」Grid 的載入標記都設為 false
    // 這樣不論切換到哪一頁，都會強迫它去檢查資料
    $.each(GRID_STATE, function (key, state) {
        state.hasLoaded = false;
        state.allData = [];
        state.filteredData = [];
        state.selectedIds.clear();
        state.currentPage = 1;
        state.isInlineEditing = false;
    });
    // 執行 AJAX 載入目前頁面
    // 如果是 qy_03，loadGridDataAjax 會在成功後把明細跟統計的 hasLoaded 都改回 true
    updateCurrentGdna(currentGdna);
}

function loadGridDataAjax(gdna) {
    // 讓 function 回傳這個 fetch promise
    return new Promise((resolve, reject) => {
        var toolId = $('#toolIdInput').val();

        $(`#loading-${gdna}`).show();
        $(`#tbody_${gdna}`).empty();
        $('#dataLoadingOverlay').fadeIn(200);
        setGlobalLoadingState(true);
        startTimer(); 
        var params = new URLSearchParams();
        $('#actionForm').serializeArray().forEach(item => {
            if (item.name !== 'currentGdna') params.append(item.name, item.value);
        });
        params.append("currentGdna", gdna);

        fetch('/Basic/GetGridData/' + toolId, {
            method: 'POST',
            body: params,
            headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' }
        })
            .then(res => res.json())
            .then(res => {
                $(`#loading-${gdna}`).hide();
                if (res.success) {
                    var processedDataMap = processCustomData(toolId, res.data || [], gdna);
                    Object.keys(processedDataMap).forEach(targetGdna => {
                        var rawData = processedDataMap[targetGdna];
                        if (Array.isArray(rawData)) {
                            rawData.forEach((row, index) => { row._rowId = index; });
                        }
                        if (!GRID_STATE[targetGdna]) initGridState(targetGdna);
                        GRID_STATE[targetGdna].allData = rawData;
                        GRID_STATE[targetGdna].filteredData = [...rawData]; // 強制同步篩選資料
                        GRID_STATE[targetGdna].hasLoaded = true;

                        renderGridWithPagination(targetGdna);
                    });
                    resolve(res); // 成功回傳
                } else {
                    reject("資料載入失敗");
                }
            })
            .catch(err => {
                reject(err);
            })
            .finally(() => {
                $('#dataLoadingOverlay').fadeOut(300);
                setGlobalLoadingState(false);
                stopTimer(); 
            });
    });
}

// 生成表格 HTML (修改：加入 SW_STA、強制高度與凍結樣式)
function generateTableHtml(gdna) {
    var cols = (GLOBAL_GRID_CONFIGS && GLOBAL_GRID_CONFIGS[gdna]) ? GLOBAL_GRID_CONFIGS[gdna] : [];
    if (!cols || cols.length === 0) return `<div class="p-3 text-center">無 Grid 設定 (${gdna})</div>`;
    // 讀取全域配置
    var swCk = (typeof CURRENT_TOOL_CONFIG !== 'undefined' && CURRENT_TOOL_CONFIG.SW_CK !== undefined) ? CURRENT_TOOL_CONFIG.SW_CK : 1;
    var swSta = (typeof CURRENT_TOOL_CONFIG !== 'undefined' && CURRENT_TOOL_CONFIG.SW_STA !== undefined) ? CURRENT_TOOL_CONFIG.SW_STA : 1;
    var canEdit = (typeof CURRENT_TOOL_CONFIG !== 'undefined' && CURRENT_TOOL_CONFIG.CAN_ED === 1);
    // ★ 核心邏輯：判斷是否為必要查詢 (QY_ND)
    var qyNd = (typeof CURRENT_TOOL_CONFIG !== 'undefined' && CURRENT_TOOL_CONFIG.QY_ND !== undefined) ? CURRENT_TOOL_CONFIG.QY_ND : 0;
    var tableId = "table_" + gdna;
    var tbodyId = "tbody_" + gdna;
    var tfootId = "tfoot_" + gdna;
    // 設定固定的行高 (用於 Sticky Footer 計算)
    var footerRowHeight = 32;
    // 動態注入 CSS 樣式 (包含凍結表頭、凍結表尾、與捲軸區設定)
    var stickyStyle = "";
    if (swSta == 1) {
        stickyStyle = `
            <style>
                .grid-table-scroll-area { 
                    position: relative; 
                    max-height: 50vh; 
                    overflow: auto; 
                }
                #${tfootId} td {
                    box-sizing: border-box !important;
                    height: ${footerRowHeight}px !important;      
                    line-height: ${footerRowHeight - 10}px !important; 
                    padding: 5px !important;
                    white-space: nowrap;
                    vertical-align: middle;
                    font-size: 0.9em;
                }
                #${tfootId} tr.footer-row-page td {
                    position: sticky;
                    bottom: ${footerRowHeight}px !important;
                    z-index: 10;
                    background-color: #e6f7ff !important;
                    border-top: 1px solid #1890ff;
                    font-weight: bold;
                    color: #0050b3;
                }
                #${tfootId} tr.footer-row-total td {
                    position: sticky;
                    bottom: 0 !important;
                    z-index: 11;
                    background-color: #fff0f6 !important;
                    border-top: 1px solid #eb2f96;
                    font-weight: bold;
                    color: #c41d7f;
                }
            </style>
        `;
    } else {
        stickyStyle = `<style>.grid-table-scroll-area { position: relative; max-height: 70vh; overflow: auto; }</style>`;
    }
    var html = stickyStyle + `<table id="${tableId}" class="custom-table table table-bordered table-hover" style="table-layout:fixed; border-collapse: separate; border-spacing: 0;">
        <thead class="thead-light"><tr>`;
    // 1. 勾選欄
    if (swCk == 1) {
        html += `<th class="check-col sticky-header" style="width:50px; text-align:center; position:sticky; top:0; z-index:20;"><input type="checkbox" class="check-all-page" data-gdna="${gdna}"></th>`;
    }

    // 2. 資料欄表頭
    $.each(cols, function (i, col) {
        if (col.FdSw == 0) return;
        var widthStyle = col.Width && col.Width > 0 ? `width:${col.Width}px;` : "width:150px;";
        widthStyle += " min-width: 100px;";
        var displayTitle = col.Title;
        if (canEdit) {
            if (col.NdVl === 1) {
                displayTitle = `<span class="text-danger font-weight-bold">${col.Title}</span>`;
            } else if (col.NdVl === 0) {
                displayTitle = `<span class="text-primary font-weight-bold">${col.Title}</span>`;
            }
        }
        html += `<th style="text-align:${col.Align || 'center'}; ${widthStyle} position:sticky; top:0; z-index:20; cursor:pointer;" 
                     class="resizable-th sortable-col" 
                     data-gdna="${gdna}" 
                     data-field="${col.Field}" 
                     title="點擊排序: ${col.Title}">
                    <div class="th-content" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right: 15px;">
                        ${displayTitle}
                        <i class="fas fa-sort text-muted ml-1 sort-icon" style="font-size: 0.8em; opacity: 0.3;"></i>
                    </div>
                    <div class="col-resizer" style="position:absolute; right:0; top:0; bottom:0; width:8px; cursor:col-resize; z-index:21;"></div>
                 </th>`;
    });
    html += '</tr></thead>';
    var totalCols = cols.length + (swCk == 1 ? 1 : 0);
    // ★ 根據 QY_ND 決定提示內容
    var promptMsg = (qyNd === 1) ? "此功能設定為「必要查詢」，請點擊查詢按鈕輸入條件後執行" : "請執行查詢";
    var promptColor = (qyNd === 1) ? "#e67e22" : "blue"; // 必要時使用橘色提醒
    var promptIcon = (qyNd === 1) ? "fas fa-exclamation-circle" : "fas fa-search";
    html += `<tbody id="${tbodyId}">
              <tr>
                <td colspan="${totalCols}" class="text-center p-5">
                  <div style="color: ${promptColor}; font-size: 16px; font-weight: bold; margin-bottom: 8px;">
                    <i class="${promptIcon} mr-2"></i>${promptMsg}
                  </div>
                </td>
              </tr>
            </tbody>`;
    // 3. 統計欄 (如果開啟)
    if (swSta == 1) {
        html += `<tfoot id="${tfootId}"></tfoot>`;
    }
    html += `</table>`;
    /*
    // 綁定全選按鈕一次性事件
    setTimeout(function () {
        $(document).off('change', `.check-all-page[data-gdna="${gdna}"]`).on('change', `.check-all-page[data-gdna="${gdna}"]`, function () {
            togglePageSelection(gdna, this.checked);
        });
    }, 100);
    */
    return html;
}

// ★★★ 修改：欄位寬度自動調整 (優化：時間保底顯示 & 文字長度適應) ★★★
function autoFitColumnWidths(gdna) {
    var state = GRID_STATE[gdna];
    // ★★★ 修改處：移除 state.allData.length === 0 的判斷 ★★★
    // 讓程式即使沒有資料，也能往下執行去計算「標題長度」與「預設最小寬度」
    if (!state) return;
    var hasData = state.allData && state.allData.length > 0;
    var cols = GLOBAL_GRID_CONFIGS[gdna];
    if (!cols) return;
    var $table = $('#table_' + gdna);
    var $container = $table.parent();
    var containerWidth = $container.width() - 15;
    var swCk = (typeof CURRENT_TOOL_CONFIG !== 'undefined' && CURRENT_TOOL_CONFIG.SW_CK !== undefined) ? CURRENT_TOOL_CONFIG.SW_CK : 1;
    var checkboxWidth = (swCk == 1) ? 50 : 0;
    var availableWidth = containerWidth - checkboxWidth;
    // 如果有資料才取樣，沒資料就空陣列
    var sampleData = hasData ? state.allData.slice(0, 500) : [];
    var calculatedWidths = [];
    var totalCalculatedWidth = 0;
    $.each(cols, function (index, col) {
        if (col.FdSw == 0) return;
        var minWidth = 80;
        if (col.Type === 3) minWidth = 110;
        else if (col.Type === 4) minWidth = 90;
        else if (col.Type === 5) minWidth = 170;
        else if (col.Type === 1 || col.Type === 2) minWidth = 100;
        // 2. 依照標題長度計算 (這行在沒資料時特別重要)
        var maxLen = calcVisualLength(col.Title);
        // 3. 依照資料內容長度計算 (有 sampleData 才會跑迴圈)
        $.each(sampleData, function (i, row) {
            var val = "";
            // ... (原本的取值邏輯保持不變) ...
            if (row[col.Field] !== undefined) val = row[col.Field];
            else if (row[col.Field.toUpperCase()] !== undefined) val = row[col.Field.toUpperCase()];
            else if (row[col.Field.toLowerCase()] !== undefined) val = row[col.Field.toLowerCase()];
            if ((col.Type === 3 || col.Type === 5) && val) {
                val = String(val).replace("T", " ");
            }
            var len = calcVisualLength(val);
            if (len > maxLen) maxLen = len;
        });
        // 4. 寬度公式
        var newWidth = Math.ceil(maxLen * 9) + 24;
        // 5. 套用限制
        if (newWidth < minWidth) newWidth = minWidth;
        if (newWidth > 600) newWidth = 600;
        calculatedWidths.push(newWidth);
        totalCalculatedWidth += newWidth;
    });
    // ... (後續最大化邏輯與套用寬度保持不變) ...
    // 6. 畫面最大化邏輯
    if (totalCalculatedWidth > 0 && totalCalculatedWidth < availableWidth) {
        var ratio = availableWidth / totalCalculatedWidth;
        for (var i = 0; i < calculatedWidths.length; i++) {
            calculatedWidths[i] = Math.floor(calculatedWidths[i] * ratio);
        }
    }

    // 7. 套用寬度
    $.each(cols, function (index, col) {
        var thIndex = index + (swCk == 1 ? 1 : 0);
        $table.find(`thead th:eq(${thIndex})`).css('width', calculatedWidths[index] + 'px');
    });
}

function calcVisualLength(str) {
    if (!str) return 0;
    const text = String(str).replace(/<[^>]*>/g, '');
    return Array.from(text).reduce((len, char) => len + (char.charCodeAt(0) > 255 ? 2 : 1.1), 0);
}

function applyQuickFilter(gdna, text, fieldName) {
    var state = GRID_STATE[gdna];
    if (!state) return;

    // 1. 更新狀態中的篩選條件
    // 如果沒有傳入 text，則使用 state 記憶的 (用於切換分頁後的還原)
    // 但如果有傳入 (包含空字串)，則更新 state
    if (text !== undefined) {
        state.filterText = (text || "").toLowerCase().trim();
    }

    // 2. 記憶目前選擇的欄位 (新增此屬性以便狀態保留)
    if (fieldName) {
        state.filterField = fieldName;
    }
    // 如果沒傳 fieldName，試著從 state 拿，再沒有就預設 ALL
    var target = fieldName || state.filterField || 'ALL';

    // 3. 執行篩選
    if (!state.filterText) {
        // 沒有文字 -> 顯示全部 (複製一份 allData)
        state.filteredData = [...state.allData];
    } else {
        state.filteredData = state.allData.filter(row => {
            // A. 全欄位搜尋
            if (target === 'ALL') {
                return Object.values(row).some(v =>
                    v !== null && v !== undefined && String(v).toLowerCase().includes(state.filterText)
                );
            }
            // B. 指定欄位搜尋
            var v = row[target] || row[target.toUpperCase()] || row[target.toLowerCase()];
            return v !== null && v !== undefined && String(v).toLowerCase().includes(state.filterText);
        });
    }

    // 4. 重置分頁並渲染
    state.currentPage = 1;
    renderGridWithPagination(gdna);
}
// 6. Grid 渲染 (修改：修復語法錯誤、單頁隱藏小計、格式調整)
function renderGridWithPagination(gdna) {
    var state = GRID_STATE[gdna];
    var tbody = $("#tbody_" + gdna);
    var tfoot = $("#tfoot_" + gdna);
    var cols = GLOBAL_GRID_CONFIGS[gdna];
    tbody.empty();
    if (tfoot.length > 0) tfoot.empty();

    var swCk = (CURRENT_TOOL_CONFIG && CURRENT_TOOL_CONFIG.SW_CK !== undefined) ? CURRENT_TOOL_CONFIG.SW_CK : 1;
    var swSta = (CURRENT_TOOL_CONFIG && CURRENT_TOOL_CONFIG.SW_STA !== undefined) ? CURRENT_TOOL_CONFIG.SW_STA : 1;

    var dataSource = state.filteredData || [];
    var totalData = dataSource.length;
    var totalColSpan = cols.length + (swCk == 1 ? 1 : 0);

    if (totalData === 0) {
        tbody.html(`<tr><td colspan="${totalColSpan}" class="text-center text-muted p-5">查無資料</td></tr>`);
        $("#pagination-" + gdna).hide();
        return;
    }

    $("#pagination-" + gdna).css('display', 'flex');

    var start = (state.currentPage - 1) * state.pageSize;
    if (start >= totalData && state.currentPage > 1) { state.currentPage = 1; start = 0; }
    var end = Math.min(start + state.pageSize, totalData);
    var pageData = dataSource.slice(start, end);

    $("#page-info-" + gdna).html(`<span style="font-size: 12pt;">顯示 <b>${start + 1}</b> - <b>${end}</b> 筆, 共 <b>${totalData}</b> 筆</span>`);

    var rowsHtml = "";
    $.each(pageData, function (i, row) {
        var realIndex = start + i;
        var uniqueId = row._rowId;
        var isChecked = state.selectedIds.has(uniqueId);
        var isInlineEdit = state.isInlineEditing === true;

        rowsHtml += `<tr class='${isChecked ? "table-active" : ""} grid-row' data-gdna="${gdna}" data-index="${realIndex}" data-rowid="${uniqueId}">`;
        if (swCk == 1) rowsHtml += `<td class="text-center"><input type="checkbox" class="row-checkbox" data-gdna="${gdna}" data-rowid="${uniqueId}" ${isChecked ? "checked" : ""}></td>`;

        $.each(cols, function (j, col) {
            if (col.FdSw == 0) return;
            var fieldName = col.Field;
            var val = row[fieldName] || row[fieldName.toUpperCase()] || row[fieldName.toLowerCase()];
            if (fieldName.toLowerCase() === 'seq_no') val = realIndex + 1;
            if (val === undefined || val === null) val = "";

            var cellStyle = `text-align:${col.Align || 'left'}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`;
            var displayVal = "";

            // --- 判斷單元格內容 ---
            if (isInlineEdit && col.Editable) {
                var inputVal = formatValueForInput(val, col.Type);
                var safeRawVal = safeEscape(String(val));

                if (col.Type === 6 || col.Type === 9) {
                    // ★ 關鍵：直接從 row 物件拿原始值，不經過格式化
                    var rawId = row[fieldName] || row[fieldName.toUpperCase()] || row[fieldName.toLowerCase()] || "";
                    var displayStr = formatCellValue(rawId, col.Type); // 這是顯示用的 (ID-名稱)

                    displayVal = `<div class="lazy-select-container form-control stealth-select" 
        data-gdna="${gdna}" data-field="${fieldName}" data-type="${col.Type}" 
        data-val="${safeEscape(String(rawId))}" 
        style="cursor: pointer; height: 35px; min-width: 80px; overflow: hidden;">
        ${safeEscape(String(displayStr))}
      </div>`;
                } else if (col.Type === 8) {
                    displayVal = `<textarea class="form-control editable-field" data-gdna="${gdna}" data-field="${fieldName}" data-orig="${safeEscape(String(inputVal))}" rows="1" style="font-size: 14pt; min-height:38px;">${inputVal}</textarea>`;
                } else if (col.Type === 7) {
                    // ★ 修正：Type 7 是按鈕，即使在編輯模式也不應變成 Input
                    displayVal = `<button class="btn btn-sm btn-info btn-grid-action shadow-sm" data-gdna="${gdna}" data-field="${fieldName}" data-index="${realIndex}" style="width: 100%;"><i class="fas fa-external-link-alt mr-1"></i>${col.Title}</button>`;
                } else if (col.Type === 10) {
                    // ★ 新增 Type 10 的日期選擇器
                    displayVal = `<input type="date" class="form-control editable-field" 
                            data-gdna="${gdna}" data-field="${fieldName}" 
                            data-orig="${safeEscape(String(inputVal))}" 
                            value="${safeEscape(String(inputVal))}" 
                            style="font-size: 14pt; height: 38px;">`;
                }
                else {
                    displayVal = `<input type="text" class="form-control editable-field" data-gdna="${gdna}" data-field="${fieldName}" data-orig="${safeEscape(String(inputVal))}" value="${safeEscape(String(inputVal))}" style="font-size: 14pt;">`;
                }
            } else {
                // 非編輯模式或不可編輯欄位
                if (col.Type === 7) {
                    displayVal = `<button class="btn btn-sm btn-info btn-grid-action shadow-sm" data-gdna="${gdna}" data-field="${fieldName}" data-index="${realIndex}" style="width: 100%;"><i class="fas fa-external-link-alt mr-1"></i>${col.Title}</button>`;
                } else {
                    displayVal = formatCellValue(val, col.Type);
                }
            }
            rowsHtml += `<td style="${cellStyle}" title="${safeEscape(String(val))}">${displayVal}</td>`;
        });
        rowsHtml += "</tr>";
    });

    tbody.append(rowsHtml);
    renderPaginationButtons(gdna, totalData, state.pageSize, state.currentPage);
    bindDynamicEvents(gdna);
    updateSortIcons(gdna);
    checkToolbarStatus(gdna);
}

// ★★★ Grid 專用：設定下拉選單的值 ★★★
function updateGridDropdownValues(gdna, specificField) {
    // 選擇器：找到該 Grid 內所有正在編輯的下拉選單
    var selector = `#tbody_${gdna} .grid-editable-select`;
    if (specificField) {
        selector += `[data-field="${specificField}"]`;
    }

    $(selector).each(function () {
        var $sel = $(this);
        // 從我們剛才在 HTML 注入的屬性抓取原始值
        var originalVal = String($sel.attr('data-original-value') || "").trim();

        if (originalVal === "") {
            $sel.val("");
        } else {
            // 1. 直接嘗試設定 Value (ID 匹配)
            $sel.val(originalVal);

            // 2. 如果設定失敗 (代表原本資料存的是中文名稱，或者是格式不符)
            if ($sel.val() === null || $sel.val() === "") {
                $sel.find('option').each(function () {
                    var $opt = $(this);
                    var optText = $opt.text().trim();
                    var optVal = $opt.val().trim();

                    // 模糊比對：文字完全相同，或是 "ID - Name" 格式包含該 ID
                    if (optText === originalVal || optVal === originalVal || optText.startsWith(originalVal + " -")) {
                        $sel.val(optVal);
                        return false; // 找到就跳出
                    }
                });
            }
        }

        // 3. 重要：如果該欄位已經初始化過 Select2，必須通知 Select2 更新 UI
        if ($sel.hasClass("select2-hidden-accessible")) {
            $sel.trigger('change.select2');
        }
    });
}

// ★★★ Grid 專用：觸發下拉資料載入 ★★★
function loadColumnDropdownDataForGrid(gdna, fieldName, sqlId, inWhere, valField, txtField) {
    // 關鍵修正：這裡的 Key 組合必須與 loadColumnDropdownData 完全相同
    var cacheKey = sqlId + "||" + (inWhere || "") + "||" + (valField || "") + "||" + (txtField || "");
    // 1. 如果快取已有資料，直接套用並結束
    if (COLUMN_DROPDOWN_CACHE[cacheKey] && !COLUMN_DROPDOWN_CACHE[cacheKey].includes('載入中')) {
        applyDropdownToGrid(gdna, fieldName, COLUMN_DROPDOWN_CACHE[cacheKey]);
        return;
    }
    // 2. 防止重複請求
    if (COLUMN_DROPDOWN_CACHE[cacheKey] && COLUMN_DROPDOWN_CACHE[cacheKey].includes('載入中')) return;
    COLUMN_DROPDOWN_CACHE[cacheKey] = '<option value="">載入中...</option>';
    $.ajax({
        url: '/Basic/GetDropdownData',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ SQL_ID: sqlId, IN_WHERE: inWhere }),
        success: function (res) {
            // 使用共用的 HTML 產生器
            var html = buildDropdownHtml(res, valField, txtField);
            COLUMN_DROPDOWN_CACHE[cacheKey] = html;
            // 更新 Grid 上所有該欄位的 Select
            applyDropdownToGrid(gdna, fieldName, html);
        }
    });
}

// 輔助函式：將 HTML 塞入 Grid 並自動選中正確項
function applyDropdownToGrid(gdna, fieldName, html) {
    var $selects = $(`#tbody_${gdna} select[data-field="${fieldName}"]`);
    $selects.each(function () {
        var $el = $(this);
        $el.html(html);
        // 取得該列原始資料 (可能是 ID 或 中文)
        var originalVal = String($el.data('original-value') || "").trim();
        if (originalVal !== "") {
            $el.val(originalVal); // 先嘗試 ID 匹配
            // 如果 ID 匹配失敗，嘗試「文字內容」匹配
            if ($el.val() === null || $el.val() === "") {
                $el.find('option').each(function () {
                    if ($(this).text().trim() === originalVal) {
                        $(this).prop('selected', true);
                        return false;
                    }
                });
            }
        }
    });
}

// 輔助：將 API 結果轉為 HTML Options
function buildDropdownHtml(res, valueField, textField) {
    var data = (res && res.R_RCT > 0 && Array.isArray(res.ROWLIST)) ? res.ROWLIST : [];
    if (data.length === 0) return '<option value="">無資料</option>';

    var html = (data.length > 1) ? '<option value="">請選擇</option>' : '';
    var keys = Object.keys(data[0]);
    var vKey = valueField || keys.find(k => k.toLowerCase().match(/(_id|_no|userno|sys_id)$/)) || keys[0];
    var tKey = textField || keys.find(k => k.toLowerCase().match(/(name|desc)$/)) || keys[1] || keys[0];

    data.forEach(function (item) {
        var v = String((item[vKey] !== undefined) ? item[vKey] : "").trim();
        var t = String((item[tKey] !== undefined) ? item[tKey] : v).trim();

        // ★ 核心改進：如果文字部分已經包含了 ID，就不再重複拼接
        var displayLabel = t;
        if (t !== v && !t.startsWith(v)) {
            displayLabel = v + " - " + t;
        }

        html += `<option value="${v}">${safeEscape(displayLabel)}</option>`;
    });
    return html;
}
// 7. Modal 顯示 (修正版：支援多頁編輯模式)
function showDetailModal(gdna, index) {
    var state = GRID_STATE[gdna];
    if (!state || !state.filteredData) return;

    var isMultiTabEnv = (CURRENT_TOOL_CONFIG.GD_TL === 0 && CURRENT_TOOL_CONFIG.GDNA_LT && CURRENT_TOOL_CONFIG.GDNA_LT.length > 1);
    var isNewMode = (index === 'new');
    var rowData = isNewMode ? {} : (state.filteredData[index] || {});
    var isImportMode = (typeof CURRENT_TOOL_CONFIG !== 'undefined' && CURRENT_TOOL_CONFIG.IM_BT === 1);
    // 如果是匯入模式，強制將 canEdit 設為 false
    var canEdit = (typeof CURRENT_TOOL_CONFIG !== 'undefined' && CURRENT_TOOL_CONFIG.CAN_ED === 1) && !isImportMode;

    var $modal = $('#detailModal');
    var $gridRow = isNewMode ? null : $(`#table_${gdna} tr[data-index="${index}"]`);

    $modal.data('gdna', gdna);
    $modal.data('index', index);

    // --- 設定標題 ---
    var titleHtml = "";
    if (isNewMode) {
        titleHtml = `<i class="fas fa-plus-circle mr-1"></i> 新增資料`;
        $('#btnModalPrev, #btnModalNext, #btnModalFirst, #btnModalLast, #btnModalGo, #inputModalCurrentPage').prop('disabled', true);
        if (canEdit) {
            $('#action-buttons-area').show();
            $('#btnModalDelete').hide();
            $('#btnModalPaste').show();
            $('#btnModalEdit').prop('disabled', false).removeClass('btn-warning').addClass('btn-primary').html('<i class="fas fa-plus mr-1"></i> 新增存檔');
        }
    } else {
        var total = state.filteredData.length;
        var currentNum = (typeof index === 'number') ? index + 1 : 0;
        $('#inputModalCurrentPage').val(currentNum);
        titleHtml = `<i class="fas fa-list-alt mr-1"></i> 詳細資料 <small class="ml-2 text-white-50">(第 ${currentNum} / ${total} 筆)</small>`;

        // 圖二：多頁編輯模式字樣
        if (isMultiTabEnv) titleHtml += ` <span class="badge badge-info ml-1">多頁編輯模式</span>`;

        $('#btnModalPrev, #btnModalFirst').prop('disabled', index <= 0);
        $('#btnModalNext, #btnModalLast').prop('disabled', index >= total - 1);
        $('#btnModalGo, #inputModalCurrentPage').prop('disabled', false);

        if (canEdit) {
            $('#action-buttons-area').show();
            $('#btnModalDelete').show();
            $('#btnModalPaste').show();
            $('#btnModalEdit').prop('disabled', false).removeClass('btn-primary').addClass('btn-warning').html('<i class="fas fa-save mr-1"></i> 修改存檔');
        } else {
            $('#action-buttons-area').hide();
            $('#btnModalPaste').hide();
        }
    }
    $('#detailModalLabel').html(titleHtml);

    var html = "";

    // --- 注入圖二頁籤列 (僅在多頁環境顯示) ---
    if (isMultiTabEnv) {
        html += '<ul class="nav nav-tabs mb-3" id="modalInternalTabs" role="tablist" style="background:#f8f9fa; border-bottom:1px solid #dee2e6;">';
        $.each(CURRENT_TOOL_CONFIG.GDNA_LT, function (i, item) {
            var isActive = (item.GDNA === gdna);
            html += `<li class="nav-item">
                        <a class="nav-link ${isActive ? 'active' : ''} py-2" href="javascript:void(0);" 
                           onclick="switchModalDetailTab('${item.GDNA}', '${index}')" 
                           style="font-weight:bold; color:${isActive ? '#007bff' : '#6c757d'}">
                           <i class="fas fa-table mr-1"></i>${item.GDSNA}
                        </a>
                     </li>`;
        });
        html += '</ul>';
    }

    // --- 以下維持原 CODE 欄位生成邏輯，不改動元件數量與排列 ---
    var cols = GLOBAL_GRID_CONFIGS[gdna];
    html += '<div id="detailModalContentInner" class="detail-form-grid">';

    $.each(cols, function (i, col) {
        if (col.FdSw === 0) return;
        var fieldName = col.Field;
        var val = "";
        var isDirtyOnGrid = false;
        if (!isNewMode) {
            var $gridInput = $gridRow ? $gridRow.find(`[data-field="${fieldName}"]`) : null;
            if ($gridInput && $gridInput.length > 0) {
                val = ($gridInput.is('div')) ? $gridInput.data('val') : $gridInput.val();
                if ($gridInput.hasClass('field-dirty') || $gridInput.closest('.lazy-select-container').hasClass('bg-light-success')) {
                    isDirtyOnGrid = true;
                }
            } else {
                val = rowData[fieldName] || rowData[fieldName.toUpperCase()] || "";
            }
        } else {
            if ($('#toolIdInput').val() === 'dep_02' && fieldName === 'fd_seq') {
                if (typeof window.DEP02_NEXT_SEQ !== 'undefined') val = window.DEP02_NEXT_SEQ;
            }
        }

        var safeHint = col.Hint ? safeEscape(col.Hint) : "";
        var placeholderAttr = (col.Type !== 6 && safeHint && !safeHint.includes("SELECT")) ? `placeholder="${safeHint}"` : "";
        var isEditable = canEdit && col.Editable;
        var maxLenAttr = (col.Width && col.Width > 0) ? `maxlength="${col.Width}"` : "";
        var dirtyClass = isDirtyOnGrid ? "field-dirty" : "";
        var labelClass = (col.NdVl === 1) ? "text-danger" : (col.NdVl === 0 ? "text-primary" : "text-dark");
        var inputHtml = "";
        var useHintBtn = "";
        if (isEditable) {
            var inputVal = formatValueForInput(val, col.Type);
            var safeRawVal = safeEscape(String(val));
            var baseStyle = "font-size: 14pt;";

            if (col.Type === 6 || col.Type === 9) {
                var useSqlId = col.Hint || "", useWhere = "", valKey = "", txtKey = "";
                if (col.CbJs) { try { var cb = JSON.parse(col.CbJs); useSqlId = cb.SQL_ID || useSqlId; useWhere = cb.IN_WHERE || ""; valKey = cb.sa_fd || ""; txtKey = cb.sw_name || cb.sa_name || ""; } catch (e) { } }
                var cacheKey = useSqlId + "||" + useWhere + "||" + valKey + "||" + txtKey;
                var optHtml = COLUMN_DROPDOWN_CACHE[cacheKey] || '<option value="">載入中...</option>';
                var inputClass = (col.Type === 9) ? "form-control editable-field searchable-select" : "form-control editable-field";
                inputHtml = `<select class="${inputClass} ${dirtyClass}" data-gdna="${gdna}" data-field="${fieldName}" data-orig="${safeRawVal}" style="${baseStyle}">${optHtml}</select>`;
                (function (f, s, w, v, n, vk, tk) { setTimeout(() => { if (n) { loadColumnDropdownData(s, w, vk, tk); checkDropdownLoaded(gdna, f, s, w, v, vk, tk); } else { forceSetSelectValue($(`#detailModal select[data-field="${f}"]`), v); } }, 50); })(fieldName, useSqlId, useWhere, val, (!COLUMN_DROPDOWN_CACHE[cacheKey]), valKey, txtKey);
            }
            else if (col.Type === 10) {
                inputHtml = `<input type="date" class="form-control editable-field ${dirtyClass}" data-gdna="${gdna}" data-field="${fieldName}" data-orig="${safeEscape(String(inputVal))}" value="${safeEscape(String(inputVal))}" style="${baseStyle}">`;
            }
            else if (col.Type === 8) {
                inputHtml = `<textarea class="form-control editable-field ${dirtyClass}" data-gdna="${gdna}" data-field="${fieldName}" data-orig="${safeEscape(String(inputVal))}" rows="4" style="font-size: 14pt; min-height: 120px; line-height: 1.6;" ${maxLenAttr} ${placeholderAttr}>${inputVal}</textarea>`;
            } else if (col.Type === 7) {
                inputHtml = `<button type="button" class="btn btn-block btn-outline-info btn-grid-action mt-1" data-gdna="${gdna}" data-field="${fieldName}" data-index="${index}"><i class="fas fa-play-circle mr-1"></i> 執行 ${col.Title}</button>`;
            } else {
                inputHtml = `<input type="text" class="form-control editable-field ${dirtyClass}" data-gdna="${gdna}" data-field="${fieldName}" data-orig="${safeEscape(String(inputVal))}" value="${safeEscape(String(inputVal))}" style="${baseStyle};"${maxLenAttr} ${placeholderAttr}>`;
            }
            if (maxLenAttr && (col.Type === 0 || col.Type === 8)) inputHtml += `<small class="text-muted">最大長度: ${col.Width}</small>`;
            if (isEditable && safeHint && safeHint.trim() !== "" && !safeHint.includes("SELECT") && col.BTHINT === 1) {
                useHintBtn = `<span class="ml-2 badge badge-info btn-use-hint" style="cursor:pointer; opacity: 0.8;" title="點擊帶入內容" data-hint="${safeHint}"><i class="fas fa-paste mr-1"></i>範例</span>`;
            }
        } else {
            var safeRawVal = safeEscape(String(val));
            var displayVal = formatCellValue(val, col.Type);
            if (col.Type === 8) {
                inputHtml = `<textarea class="form-control" data-field="${fieldName}" data-val="${safeRawVal}" readonly rows="10" style="font-size: 14pt; background:#e9ecef; min-height: 250px;">${displayVal}</textarea>`;
            } else {
                inputHtml = `<input type="text" class="form-control" data-field="${fieldName}" data-val="${safeRawVal}" value="${safeEscape(displayVal)}" readonly style="font-size: 14pt; background:#e9ecef;">`;
            }
        }

        html += `<div class="${(col.Type === 8 || (col.Width || 0) >= 200) ? 'detail-field-full' : 'detail-field-item'}">
                    <label class="${labelClass} font-weight-bold mb-1" style="font-size: 12pt;">${col.Title} ${useHintBtn}</label>
                    ${inputHtml}
                 </div>`;
    });

    $('#detailModalContent').html(html + '</div>');
    if (!$modal.hasClass('show')) $modal.modal('show');
    setTimeout(() => { initSearchableDropdowns('#detailModal'); if (typeof CT_InitEditMode === 'function') CT_InitEditMode(gdna, index); }, 150);
}

// 輔助函式：切換彈窗內的子頁籤
async function switchModalDetailTab(newGdna, index) {
    // 1. 檢查是否有未儲存異動
    if (typeof CT_STATE !== 'undefined' && CT_STATE.isDirty) {
        if (!confirm("此頁籤有未儲存的異動，切換將會遺失資料，確定切換嗎？")) return;
    }

    // 2. 核心處理：檢查目標 GDNA 是否已有資料
    if (!GRID_STATE[newGdna]) initGridState(newGdna);

    // 如果從未載入過，或是資料長度為 0 (且曾經搜尋過)，則啟動自動載入
    if (HAS_SEARCHED && (!GRID_STATE[newGdna].hasLoaded || GRID_STATE[newGdna].allData.length === 0)) {
        console.log(`[Modal] 自動為頁籤 ${newGdna} 載入背景資料...`);
        try {
            await loadGridDataAjax(newGdna);
        } catch (e) {
            alert("切換分頁載入資料失敗，請稍後再試。");
            return;
        }
    } else if (GRID_STATE[newGdna].filteredData.length === 0 && GRID_STATE[newGdna].allData.length > 0) {
        // 如果有原始資料但還沒篩選過，手動同步一次
        GRID_STATE[newGdna].filteredData = [...GRID_STATE[newGdna].allData];
    }

    // 3. 執行顯示 (此時資料已保證存在)
    showDetailModal(newGdna, index === 'new' ? 'new' : parseInt(index));
}

// 輔助函式：切換 Modal 內的頁籤
function switchModalTab(newGdna, index) {
    // 檢查是否有未儲存異動 (利用 ctbase.js 的狀態)
    if (typeof CT_STATE !== 'undefined' && CT_STATE.isDirty) {
        if (!confirm("此頁籤有未儲存的異動，切換將會遺失資料，確定切換嗎？")) {
            return;
        }
    }
    showDetailModal(newGdna, index === 'new' ? 'new' : parseInt(index));
}

function checkDropdownLoaded(gdna, field, sqlId, inWhere, targetVal, valueField, textField) {
    var safeWhere = inWhere || "";
    var cacheKey = sqlId + "||" + safeWhere + "||" + (valueField || "") + "||" + (textField || "");
    var checks = 0;

    var interval = setInterval(function () {
        checks++;
        var html = COLUMN_DROPDOWN_CACHE[cacheKey];

        if (html && !html.includes('載入中...')) {
            clearInterval(interval);
            var $select = $(`#detailModal select[data-field="${field}"]`);
            if ($select.length > 0) {
                // 1. 塞入資料
                $select.html(html);
                $select.data('original-value', targetVal);

                // 2. ★ 關鍵：如果是 Type 9，在這裡啟動 Select2
                if ($select.hasClass('searchable-select')) {
                    initSearchableDropdowns('#detailModal');
                } else {
                    forceSetSelectValue($select, targetVal);
                }
            }
        }
        if (checks > 25) clearInterval(interval);
    }, 200);
}

// 8. 輔助函式
function openAddModal(gdna) { showDetailModal(gdna, 'new'); }

function formatValueForInput(val, type) {
    if (val === null || val === undefined) return "";
    var str = String(val).trim();
    if (type === 3 && str.length >= 10) return str.substring(0, 10).replace(/\//g, "-");
    if (type === 5) { var t = str.replace(/\//g, "-").replace(" ", "T"); return t.length > 16 ? t.substring(0, 16) : t; }
    if (type === 4 && str.length >= 5) return str.substring(0, 5);
    if (type === 10 && str.length === 8) { return str.substring(0, 4) + "-" + str.substring(4, 6) + "-" + str.substring(6, 8); }
    return str;
}

function formatCellValue(val, type) {
    if (val == null) return "";
    var s = String(val);
    if ((type === 1 || type === 2) && !isNaN(parseFloat(s))) return parseFloat(s).toLocaleString();
    if (type === 3 || type === 5) return s.replace("T", " ");
    if (type === 10 && s.length === 8) { return s.substring(0, 4) + "/" + s.substring(4, 6) + "/" + s.substring(6, 8); }
    return s;
}

// 2. 工具函數
function safeEscape(str) {
    return str ? str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;") : "";
}

function toggleRowSelection(gdna, index, chk) {
    var s = GRID_STATE[gdna]; if (chk.checked) s.selectedIds.add(index); else s.selectedIds.delete(index);
    $("#selection-info-" + gdna).text(`已勾選 ${s.selectedIds.size} 筆`);
    checkToolbarStatus(gdna);
    if (chk.checked) $(chk).closest('tr').addClass('table-active'); else $(chk).closest('tr').removeClass('table-active');
}

// 1. 單頁全選 / 取消
function togglePageSelection(gdna, checked) {
    if (!gdna || !GRID_STATE[gdna]) return;
    var s = GRID_STATE[gdna];
    if (!s.filteredData) return;
    var start = (s.currentPage - 1) * s.pageSize;
    var end = Math.min(start + s.pageSize, s.filteredData.length);
    // ★★★ 關鍵修改：遍歷資料物件，取得 _rowId ★★★
    for (var i = start; i < end; i++) {
        var row = s.filteredData[i];
        if (row && row._rowId !== undefined) {
            if (checked) s.selectedIds.add(row._rowId);
            else s.selectedIds.delete(row._rowId);
        }
    }
    renderGridWithPagination(gdna);
    checkToolbarStatus(gdna); // 更新按鈕狀態
}

// 2. 全部全選 / 取消
function toggleGlobalSelection(gdna, checked) {
    if (!gdna || !GRID_STATE[gdna]) return;
    var s = GRID_STATE[gdna];
    if (!s.filteredData) return;

    if (!checked) {
        // 取消全選：清空所有勾選 (包含不在目前篩選範圍內的)
        s.selectedIds.clear();
    } else {
        // 全部全選：將目前篩選結果的所有 _rowId 加入
        s.filteredData.forEach(function (row) {
            if (row && row._rowId !== undefined) {
                s.selectedIds.add(row._rowId);
            }
        });
    }
    renderGridWithPagination(gdna);
    checkToolbarStatus(gdna);
}

function renderPaginationButtons(gdna, total, size, current) {
    var totalPages = Math.ceil(total / size); var container = $("#page-btns-" + gdna); container.empty();
    if (totalPages <= 1) return;
    var html = `<div class="btn-group btn-group-sm"><button type="button" class="btn btn-light btn-page-nav" data-gdna="${gdna}" data-page="${current - 1}" ${current === 1 ? 'disabled' : ''}>&lt;</button>`;
    var start = Math.max(1, current - 2); var end = Math.min(totalPages, current + 2);
    if (start > 1) html += `<button type="button" class="btn btn-light btn-page-nav" data-gdna="${gdna}" data-page="1">1</button>` + (start > 2 ? '<span class="btn disabled">...</span>' : '');
    for (var p = start; p <= end; p++) html += `<button type="button" class="btn ${p === current ? "btn-primary" : "btn-light"} btn-page-nav" data-gdna="${gdna}" data-page="${p}">${p}</button>`;
    if (end < totalPages) html += (end < totalPages - 1 ? '<span class="btn disabled">...</span>' : '') + `<button type="button" class="btn btn-light btn-page-nav" data-gdna="${gdna}" data-page="${totalPages}">${totalPages}</button>`;
    html += `<button type="button" class="btn btn-light btn-page-nav" data-gdna="${gdna}" data-page="${current + 1}" ${current === totalPages ? 'disabled' : ''}>&gt;</button></div>`;
    container.html(html);
    container.find('.btn-page-nav').on('click', function () { if (!$(this).prop('disabled')) { GRID_STATE[gdna].currentPage = parseInt($(this).data('page')); renderGridWithPagination(gdna); } });
}

// 切換每頁筆數 (修改：支援 ALL 選項)
function changePageSize(gdna, size) {
    var state = GRID_STATE[gdna];
    if (!state) return;
    if (size === 'ALL') {
        // 設定為一個極大值 (例如 1000 萬)，確保能顯示所有資料
        // 因為是前端分頁，資料已全部在 filteredData 中
        state.pageSize = 9999999;
    } else {
        state.pageSize = parseInt(size);
    }
    // 切換筆數後，重置回第一頁並重新渲染
    state.currentPage = 1;
    renderGridWithPagination(gdna);
}

function bindDynamicEvents(gdna) {
    // ★★★ 修正：讀取 data-rowid 而非 data-index ★★★
    $(`#tbody_${gdna} .row-checkbox`).off('change').on('change', function (e) {
        e.stopPropagation();
        var rowId = parseInt($(this).data('rowid')); // 確保讀取的是唯一 ID
        toggleRowSelection(gdna, rowId, this);
    });
    $(`#tbody_${gdna} .grid-row`).off('dblclick').on('dblclick', function () {
        showDetailModal(gdna, $(this).data('index'));
    });
}

// Modal 導航功能 (修正版：加入異動檢查)
function navModal(dir) {
    // ★★★ 新增：檢查是否有未儲存的異動 ★★★
    // 必須先確認 CT_STATE 存在 (已載入 ctbase.js) 且 isDirty 為 true
    if (typeof CT_STATE !== 'undefined' && CT_STATE.isDirty) {
        if (!confirm("您有修改的資料尚未儲存，確定要切換資料嗎？\n(未儲存的資料將會遺失)")) {
            return; // 使用者按「取消」，中止切換
        }
        // 使用者按「確定」，繼續執行 (後續的 showDetailModal 會自動重置髒狀態)
    }
    var m = $('#detailModal');
    var g = m.data('gdna');
    var idx = parseInt(m.data('index'));
    // 如果是新增模式 (index 為 NaN)，不執行導航
    if (isNaN(idx)) return;
    var state = GRID_STATE[g];
    if (!state || !state.filteredData) return;
    var total = state.filteredData.length;
    var n = idx;
    // 根據指令計算新的索引
    if (dir === 'first') n = 0;
    else if (dir === 'last') n = total - 1;
    else if (dir === 'prev') n = idx - 1;
    else if (dir === 'next') n = idx + 1;
    // 確保索引在合法範圍內才跳轉
    if (n >= 0 && n < total) {
        showDetailModal(g, n);
    }
}

// Modal 指定頁跳轉 (修正版：加入異動檢查)
function jumpToModalPage() {
    // ★★★ 新增：檢查是否有未儲存的異動 ★★★
    if (typeof CT_STATE !== 'undefined' && CT_STATE.isDirty) {
        if (!confirm("您有修改的資料尚未儲存，確定要切換資料嗎？\n(未儲存的資料將會遺失)")) {
            return;
        }
    }
    var v = parseInt($('#inputModalCurrentPage').val());
    var m = $('#detailModal');
    var g = m.data('gdna');
    if (GRID_STATE[g] && !isNaN(v)) {
        var t = v - 1; // 轉為 0-based 索引
        if (t >= 0 && t < GRID_STATE[g].filteredData.length) {
            showDetailModal(g, t);
        }
    }
}

function copyModalContent() {
    // 1. 準備要複製的文字 (給外部貼上用，如 Line/Excel)
    var txt = "";
    // 2. 準備要儲存的物件 (給內部貼上用)
    var jsonPayload = {};
    var hasData = false;

    $(document).on('change', '#detailModalContent .editable-field', function () {
        var $el = $(this);
        var newVal = String($el.val() || "").trim();
        var origVal = String($el.attr('data-orig') || "").trim();

        // 1. 比對數值
        if (newVal !== origVal) {
            $el.addClass('field-dirty');
            if (typeof CT_STATE !== 'undefined') CT_STATE.isDirty = true;

            // 2. 同步回 Grid (選用：如果您希望 Modal 改，Grid 立刻變色)
            var gdna = $('#detailModal').data('gdna');
            var index = $('#detailModal').data('index');
            if (index !== 'new') {
                var $gridInput = $(`#table_${gdna} tr[data-index="${index}"] [data-field="${$el.data('field')}"]`);
                $gridInput.addClass('field-dirty');
                $gridInput.closest('tr').addClass('row-dirty');
            }
        } else {
            // 還原原值則移除顏色
            $el.removeClass('field-dirty');

            // 檢查 Modal 是否還有其他髒欄位
            if ($('#detailModalContent .field-dirty').length === 0) {
                // 如果全部都還原了，可以考慮把全域 isDirty 設為 false (視您的 CT 邏輯而定)
            }
        }

        // 3. 如果是 Select2，變色後需要觸發重繪 (針對自訂 CSS)
        if ($el.hasClass("select2-hidden-accessible")) {
            // Select2 會自動跟隨原始 select 的 class，但有時需要手動輔助
            var $s2Selection = $el.next('.select2-container').find('.select2-selection');
            if (newVal !== origVal) $s2Selection.css('background-color', '#fff3cd');
            else $s2Selection.css('background-color', '');
        }
    });

    $('#detailModalContent .form-control').each(function () {
        var $el = $(this);
        var label = $el.closest('div').find('label').text().replace(/\s+/g, '').replace(':', '').trim();
        var val = $el.val();
        var field = $el.data('field'); // 取得欄位名稱
        // 處理下拉選單文字
        if ($el.is('select')) {
            var selectedText = $el.find("option:selected").text();
            if (selectedText && !selectedText.includes("請選擇")) {
                // 文字複製顯示名稱
                txt += label + " : " + selectedText + "\n";
            } else {
                txt += label + " : \n";
            }
        } else {
            txt += label + " : " + val + "\n";
        }
        // ★★★ 儲存 JSON 資料 (只存有欄位名稱的有效輸入框) ★★★
        if (field) {
            jsonPayload[field] = val;
            hasData = true;
        }
    });
    // 3. 將 JSON 存入 LocalStorage (瀏覽器暫存)
    if (hasData) {
        localStorage.setItem("INTERNAL_CLIPBOARD", JSON.stringify(jsonPayload));
    }
    // 4. 執行文字複製
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(txt)
            .then(function () { alert("已複製 (可至其他系統貼上文字，或在 Grid 編輯模式按「貼上內容」)"); })
            .catch(function (err) { fallbackCopyTextToClipboard(txt); });
    } else {
        fallbackCopyTextToClipboard(txt);
    }
}

// 輔助函式：傳統複製方法 (建立隱藏的 textarea 來執行複製)
function fallbackCopyTextToClipboard(text) {
    var textArea = document.createElement("textarea");
    textArea.value = text;
    // 設定樣式讓它隱藏，但仍存在於畫面中以便選取
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        var successful = document.execCommand('copy');
        if (successful) {
            alert("已複製");
        } else {
            alert("複製失敗，請手動選取複製");
        }
    } catch (err) {
        console.error('複製錯誤', err);
        alert("瀏覽器不支援複製功能");
    }
    document.body.removeChild(textArea);
}

// ★★★ 匯出按鈕邏輯 (支援勾選、多頁、Loading等待) ★★★
$(document).on('click', '#btnExport', function (e) {
    e.preventDefault();
    var toolId = $('#toolIdInput').val();
    if (!toolId) { alert("無法識別功能代號"); return; }
    var swCk = CURRENT_TOOL_CONFIG?.SW_CK ?? 1;
    var exportPayload = {};
    var totalSelectedCount = 0;
    // 1. 先收集「明確勾選」的資料
    $.each(GRID_STATE, function (gdna, state) {
        if (state.selectedIds && state.selectedIds.size > 0) {
            var selectedRows = [];
            // 注意：這裡改用 allData 來找，因為明細檔的 filteredData 可能會隨點擊變動
            state.selectedIds.forEach(rowId => {
                var row = state.allData.find(r => r._rowId === rowId);
                if (row) selectedRows.push(row);
            });
            if (selectedRows.length > 0) {
                exportPayload[gdna] = selectedRows;
                totalSelectedCount += selectedRows.length;
            }
        }
    });

    // 2. ★★★ 主從模式特殊邏輯：如果選了表頭但沒選明細，自動幫忙抓關聯明細 ★★★
    if (CURRENT_TOOL_CONFIG?.GD_TL === 1 && CURRENT_TOOL_CONFIG.GDNA_LT.length > 1) {
        var masterGdna = CURRENT_TOOL_CONFIG.GDNA_LT[0].GDNA;
        var masterSelected = exportPayload[masterGdna];
        // 如果「表頭」有選，但後續的「明細」沒選
        if (masterSelected && masterSelected.length > 0) {
            // 找出 PK 欄位
            var pkFields = (GLOBAL_GRID_CONFIGS[masterGdna] || []).filter(c => c.IsPk === 1).map(c => c.Field);
            if (pkFields.length > 0) {
                // 遍歷所有後續的明細 Grid
                for (var i = 1; i < CURRENT_TOOL_CONFIG.GDNA_LT.length; i++) {
                    var detailGdna = CURRENT_TOOL_CONFIG.GDNA_LT[i].GDNA;
                    // 如果這個明細 Grid 目前沒勾選任何東西
                    if (!exportPayload[detailGdna]) {
                        var detailState = GRID_STATE[detailGdna];
                        if (detailState && detailState.allData) {
                            // 從「全部明細資料」中篩選出 PK 相符的列
                            var matchedDetails = detailState.allData.filter(dRow => {
                                return masterSelected.some(mRow => {
                                    return pkFields.every(pk => {
                                        var mv = mRow[pk] || mRow[pk.toUpperCase()] || mRow[pk.toLowerCase()];
                                        var dv = dRow[pk] || dRow[pk.toUpperCase()] || dRow[pk.toLowerCase()];
                                        return String(mv) === String(dv);
                                    });
                                });
                            });
                            if (matchedDetails.length > 0) {
                                exportPayload[detailGdna] = matchedDetails;
                                console.log(`[Export] 自動關聯匯出明細: ${detailGdna}, 共 ${matchedDetails.length} 筆`);
                            }
                        }
                    }
                }
            }
        }
    }
    // 3. 判斷是否有資料要匯出 (維持原有邏輯)
    if (swCk === 1) {
        var finalCheckCount = 0;
        $.each(exportPayload, (k, v) => finalCheckCount += v.length);
        if (finalCheckCount === 0) { alert("請先勾選要匯出的資料！"); return; }
        if (!confirm(`確定要匯出已選取的資料嗎？`)) return;
    } else {
        if (!confirm("確定要匯出所有資料嗎？")) return;
    }
    // 4. 執行匯出 (維持原有 AJAX/Form 提交邏輯)
    setGlobalLoadingState(true);
    $('.loading-text-truck').text('資料匯出中，請稍候...');
    $('#dataLoadingOverlay').fadeIn(200);
    startTimer();
    var $form = $('#actionForm');
    $form.find('input[name="selectedDataJson"]').remove();
    $form.find('input[name="downloadToken"]').remove();
    // 將整理好的 Payload 轉為 JSON 送出
    $form.append($('<input>').attr({ type: 'hidden', name: 'selectedDataJson', value: JSON.stringify(exportPayload) }));
    var token = new Date().getTime();
    $form.append($('<input>').attr({ type: 'hidden', name: 'downloadToken', value: token }));
    var originalAction = $form.attr('action');
    $form.attr('action', '/Basic/Export/' + toolId).attr('method', 'post').submit();
    checkDownloadCookie(token, originalAction);
});

$(document).on('click', '#btnModalPaste', function () {
    var savedData = localStorage.getItem("INTERNAL_CLIPBOARD");
    if (!savedData) {
        alert("快取區無資料可供貼上");
        return;
    }
    try {
        var data = JSON.parse(savedData);
        var $modal = $('#detailModal');
        var gdna = $modal.data('gdna');
        // 遍歷所有欄位並填入值
        $.each(data, function (field, val) {
            var $el = $modal.find(`.editable-field[data-field="${field}"]`);
            if ($el.length > 0) {
                if ($el.is('select')) {
                    // 下拉選單呼叫現有的 setDropdownValue
                    setDropdownValue(field, val);
                } else {
                    $el.val(val);
                }
                // 視覺回饋
                $el.addClass('bg-info text-white');
                setTimeout(() => $el.removeClass('bg-info text-white'), 500);
            }
        });
        alert("已套用快取內容");
    } catch (e) {
        alert("貼上失敗，快取資料格式錯誤");
    }
});

// ★★★ 檢查下載 Cookie 的輔助函數 ★★★
function checkDownloadCookie(token, originalAction) {
    var attempts = 0;
    var maxAttempts = 600; // 最多等 5 分鐘 (600 * 500ms)
    var cookieTimer = setInterval(function () {
        attempts++;
        var cookieValue = getCookie("downloadToken");
        // 檢查 Cookie 是否存在且等於我們送出的 Token
        if (cookieValue == token || attempts > maxAttempts) {
            finishExport(cookieTimer, originalAction);
        }
    }, 500);
}

function finishExport(timer, originalAction) {
    clearInterval(timer);
    // 停止前端計時與 Loading
    stopTimer();
    $('#dataLoadingOverlay').fadeOut(300);
    // 清除 Cookie (避免下次誤判)
    document.cookie = "downloadToken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    // 恢復 Form 的 Action (避免影響後續查詢按鈕)
    var $form = $('#actionForm');
    if (originalAction) $form.attr('action', originalAction);
    else $form.removeAttr('action');
    // 移除暫存的 input
    $form.find('input[name="selectedDataJson"]').remove();
    $form.find('input[name="downloadToken"]').remove();
    // ★★★ 加入這一行：解鎖按鈕並恢復狀態 ★★★
    setGlobalLoadingState(false);
    // 還原 Loading 文字 (下次查詢用)
    setTimeout(() => {
        $('.loading-text-truck').text('資料查詢中，請稍候...');
    }, 500);
}

function getCookie(name) {
    var value = "; " + document.cookie;
    var parts = value.split("; " + name + "=");
    if (parts.length == 2) return parts.pop().split(";").shift();
}

// 9. 自訂查詢與輔助整合
function loadDropdownData(elementId, sqlId, inWhere, textField, valueField) {
    var $select = $('#' + elementId);
    if ($select.length === 0) return;

    // 初始化狀態
    $select.empty().append('<option value="">(載入中...)</option>').prop('disabled', true);

    $.ajax({
        url: '/Basic/GetDropdownData',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ SQL_ID: sqlId, IN_WHERE: inWhere }),
        success: function (res) {

            $select.empty();
            var data = (res && res.R_RCT > 0 && Array.isArray(res.ROWLIST)) ? res.ROWLIST : [];

            if (data.length === 0) {
                $select.append('<option value="">無資料</option>');
            } else {
                // ★★★ 修正點 1：使用 parseInt 確保類型正確，並增加保底判定 ★★★
                var qyNd = 0;
                if (typeof CURRENT_TOOL_CONFIG !== 'undefined' && CURRENT_TOOL_CONFIG.QY_ND !== undefined) {
                    qyNd = parseInt(CURRENT_TOOL_CONFIG.QY_ND);
                }

                var isMandatory = (qyNd === 1);
                var firstOptionText = isMandatory ? "(請選擇)" : "(全部)";

                // ★★★ 修正點 2：只要是必要查詢模式，一律加入首項提示 (不論筆數) ★★★
                if (data.length > 1 || isMandatory) {
                    $select.append(`<option value="">${firstOptionText}</option>`);
                }

                $.each(data, function (index, item) {
                    var text = item[textField] || item[textField.toUpperCase()] || item[textField.toLowerCase()] || "";
                    var val = item[valueField] || item[valueField.toUpperCase()] || item[valueField.toLowerCase()] || "";

                    // ★★★ 修正點 3：在必要查詢模式下，除非只有一筆，否則不自動預選，強迫使用者選取 ★★★
                    var isSelected = (data.length === 1 && !isMandatory) ? 'selected' : '';
                    $select.append(`<option value="${val}" ${isSelected}>${text}</option>`);
                });
            }
        },
        error: function () {
            $select.empty().append('<option value="">載入失敗</option>');
        },
        complete: function () {
            $select.prop('disabled', false);
        }
    });
}

// 輔助：設定下拉選單的值 (修正版：加強除錯與型別轉換)
function setDropdownValue(fieldName, targetVal) {
    var $sel = $(`#detailModal select[data-field="${fieldName}"]`);
    if ($sel.length === 0) return;
    var safeTarget = String(targetVal || "").trim();
    if (safeTarget === "") {
        $sel.val(""); return;
    }
    // 1. 嘗試完全匹配 ID
    $sel.val(safeTarget);
    // 2. 如果失敗，嘗試比對「Text」或是「ID 包含在 Text 內」
    if ($sel.val() === null || $sel.val() === "") {
        var $matchingOption = $sel.find('option').filter(function () {
            var optText = $(this).text().trim();
            var optVal = $(this).val().trim();
            return optText === safeTarget || optVal === safeTarget || optText.startsWith(safeTarget);
        });
        if ($matchingOption.length > 0) {
            $sel.val($matchingOption.first().val());
        }
    }
}

// 輔助：檢查下拉資料是否載入完成 (修正版：確保順序)
$(document).on('keydown', '.grid-editable-input', function (e) {
    var $input = $(this);
    var keyCode = e.keyCode;
    var cursorPosition = this.selectionStart;
    var textLength = $input.val().length;

    // --- 處理「左鍵 (37)」：游標在最左邊時，跳到前一格 ---
    if (keyCode === 37 && cursorPosition === 0) {
        e.preventDefault();
        var $prevTd = $input.closest('td').prevAll('td:has(input, .lazy-select-container)').first();

        if ($prevTd.length > 0) {
            // 1. 同一行往前一格
            activateCell($prevTd, 'end');
        } else {
            // 2. 游標已在該行最前面 -> 跳到上一行的最後一格
            var $prevTr = $input.closest('tr').prev('.grid-row');
            if ($prevTr.length > 0) {
                var $lastTdOfPrevRow = $prevTr.find('td:has(input, .lazy-select-container)').last();
                activateCell($lastTdOfPrevRow, 'end');
            }
        }
    }

    // --- 處理「右鍵 (39)」：游標在最右邊時，跳到後一格 ---
    if (keyCode === 39 && cursorPosition === textLength) {
        e.preventDefault();
        var $nextTd = $input.closest('td').nextAll('td:has(input, .lazy-select-container)').first();

        if ($nextTd.length > 0) {
            // 1. 同一行往後一格
            activateCell($nextTd, 'start');
        } else {
            // 2. 游標已在該行最後面 -> 跳到下一行的第一格
            var $nextTr = $input.closest('tr').next('.grid-row');
            if ($nextTr.length > 0) {
                var $firstTdOfNextRow = $nextTr.find('td:has(input, .lazy-select-container)').first();
                activateCell($firstTdOfNextRow, 'start');
            }
        }
    }

    // --- 處理「向上鍵 (38)」：跳到上一行同欄位 ---
    if (keyCode === 38) {
        e.preventDefault();
        var colIdx = $input.closest('td').index();
        var $prevTr = $input.closest('tr').prev('.grid-row');
        if ($prevTr.length > 0) {
            activateCell($prevTr.find('td').eq(colIdx), 'keep');
        }
    }

    // --- 處理「向下鍵 (40)」：跳到下一行同欄位 ---
    if (keyCode === 40) {
        e.preventDefault();
        var colIdx = $input.closest('td').index();
        var $nextTr = $input.closest('tr').next('.grid-row');
        if ($nextTr.length > 0) {
            activateCell($nextTr.find('td').eq(colIdx), 'keep');
        }
    }
});

function TMS_WEBTL_QY_CB() {
    loadDropdownData('qry_sys_id', 'SYSID_MSG', " and use_ty = 1 ", 'sys_name', 'sys_id');
    loadDropdownData('qry_do_ty', 'GET_DS_X_TABLE', " and x_id_no ='WEBDP' and table_type = 1", 'sw_name', 'x_userno');
    loadDropdownData('qry_tool_open', 'GET_DS_X_TABLE', " and x_id_no ='WEBOPEN' and table_type = 1", 'sw_name', 'x_userno');
}

function validateAndSubmit() {
    var conditions = [];
    var sysId = $('#qry_sys_id').val(); if (sysId) conditions.push(`(a.sys_id = '${sysId.replace(/'/g, "''")}')`);
    var gdNo = $('#qry_gd_no').val(); if (gdNo && gdNo.trim() !== "") conditions.push(`(a.gd_no LIKE '%${gdNo.trim().replace(/'/g, "''")}%')`);
    var toolOpen = $('#qry_do_ty').val(); if (toolOpen) conditions.push(`(a.tool_open = '${toolOpen.replace(/'/g, "''")}')`);
    var swName = $('#qry_sw_name').val(); if (swName && swName.trim() !== "") conditions.push(`(a.sw_name LIKE '%${swName.trim().replace(/'/g, "''")}%')`);
    $('#queryModal').modal('hide');
    executeCustomSearch({}, conditions.length > 0 ? " AND " + conditions.join(" AND ") : "");
}

/**
 * [新增] 檢查並更新上方功能列按鈕狀態
 * 規則：
 * 1. 修改 (Edit): 當 Grid 有資料 (filteredData.length > 0) 時啟用。
 * 2. 刪除 (Del) & 匯出 (Export): 當有勾選 (selectedIds.size > 0) 時啟用。
 */
function checkToolbarStatus(gdna) {
    if (!gdna) gdna = $('#currentGdnaInput').val();
    var state = GRID_STATE[gdna];
    var hasData = (state && state.filteredData && state.filteredData.length > 0);
    var hasSelection = (state && state.selectedIds && state.selectedIds.size > 0);

    var swCk = (typeof CURRENT_TOOL_CONFIG !== 'undefined' && CURRENT_TOOL_CONFIG.SW_CK !== undefined)
        ? CURRENT_TOOL_CONFIG.SW_CK : 1;
    var isImportMode = (typeof CURRENT_TOOL_CONFIG !== 'undefined' && CURRENT_TOOL_CONFIG.IM_BT === 1);

    // 修改按鈕：若為匯入模式，維持隱藏
    if (isImportMode) {
        $('#btnEdit').hide();
        $('#btnAdd').hide();
    } else {
        $('#btnEdit').prop('disabled', !hasData);
    }

    // 刪除按鈕：匯入模式下依然可以依據勾選狀態啟用/禁用
    $('#btnDel').prop('disabled', !hasSelection);

    if (swCk === 0) {
        $('#btnExport').prop('disabled', !hasData);
    } else {
        $('#btnExport').prop('disabled', !hasSelection);
    }
}

// ★★★ 新增：全域介面鎖定控制 (防止重複操作) ★★★
function setGlobalLoadingState(isLoading) {
    // 鎖定主要功能按鈕
    $('#btnSearch, #btnExport, #btnReset, #btnAdd, #btnEdit, #btnDel').prop('disabled', isLoading);

    // 鎖定分頁與按鈕，但排除掃碼 Modal 內的按鈕
    if (isLoading) {
        // 這裡改為更精確的選擇器
        $('#actionForm button, #dynamicGridContainer button, #queryModal button').prop('disabled', true);
        $('body').css('cursor', 'wait');
    } else {
        $('button').prop('disabled', false); // 解開所有按鈕
        $('body').css('cursor', 'default');
    }
}


// ★★★ Master-Detail 核心連動函式 ★★★
function filterDetailGrids(masterGdna, masterRowData) {
    window.CURRENT_MASTER_DATA = masterRowData;
    if (!CURRENT_TOOL_CONFIG || !CURRENT_TOOL_CONFIG.GDNA_LT) return;
    // 1. 找出所有的明細 Grid (除了主檔以外的)
    var grids = CURRENT_TOOL_CONFIG.GDNA_LT;
    if (grids.length < 2) return; // 沒有明細
    // 2. 找出主檔的 PK 欄位設定
    var masterCols = GLOBAL_GRID_CONFIGS[masterGdna];
    var pkFields = masterCols.filter(col => col.IsPk === 1).map(col => col.Field);

    if (pkFields.length === 0) {
        console.warn("主檔未設定 PK 欄位 (IsPk=1)，無法執行連動篩選");
        return;
    }
    // 3. 遍歷每一個明細 Grid 進行篩選
    for (var i = 1; i < grids.length; i++) {
        var detailGdna = grids[i].GDNA;
        var detailState = GRID_STATE[detailGdna];
        if (!detailState || !detailState.allData) continue;

        var filtered = detailState.allData.filter(dRow => {
            return pkFields.every(pk => {
                var mVal = masterRowData[pk] || masterRowData[pk.toUpperCase()] || masterRowData[pk.toLowerCase()];
                var dVal = dRow[pk] || dRow[pk.toUpperCase()] || dRow[pk.toLowerCase()];
                return String(mVal) === String(dVal);
            });
        });
        detailState.filteredData = filtered;
        detailState.currentPage = 1;
        detailState.selectedIds.clear();
        renderGridWithPagination(detailGdna);
        // ★ 新增：如果篩選後沒資料，給予更友善的文字提示
        if (filtered.length === 0) {
            $(`#tbody_${detailGdna}`).html(`
                <tr>
                    <td colspan="100" class="text-center p-4 text-muted">
                        <i class="fas fa-info-circle mr-1"></i> 此表頭尚無明細資料
                    </td>
                </tr>
            `);
            $(`#pagination-${detailGdna}`).hide(); // 隱藏分頁
        }
    }
}

// ★★★ 新增：初始化可搜尋下拉選單 (Select2) ★★★
function initSearchableDropdowns(containerSelector) {
    if (typeof $.fn.select2 !== 'function') return;

    $(containerSelector).find('.searchable-select').each(function () {
        var $el = $(this);

        // 1. 如果裡面還在「載入中」，先跳過，等 checkDropdownLoaded 處理
        if ($el.html().includes("載入中")) return;

        // 2. 如果已經初始化過，先銷毀重來 (避免重複掛載)
        if ($el.hasClass("select2-hidden-accessible"))
        {
            $el.select2('destroy');
        }

        var $parentModal = $el.closest('.modal');

        $el.select2(
            {
            theme: "bootstrap4",
            width: '100%',
            placeholder: "請搜尋...",
            allowClear: true,
            dropdownParent: $parentModal.length > 0 ? $parentModal : $(document.body),
            matcher: function (params, data)
            {
                if ($.trim(params.term) === '') return data;
                if (typeof data.text === 'undefined') return null;
                var term = params.term.toUpperCase();
                var text = data.text.toUpperCase();
                var val = (data.id || "").toUpperCase();
                return (text.indexOf(term) > -1 || val.indexOf(term) > -1) ? data : null;
            }
        });

        // 3. ★ 重要：初始化後立刻帶入數值並移除 stealth 類別 (讓箭頭出現)
        var origVal = $el.data('original-value');
        if (origVal)
        {
            forceSetSelectValue($el, origVal);
        }
        $el.removeClass('stealth-select'); // 顯示出下拉箭頭
    });
}

// 強效型下拉值設定工具 (支援 ID 或 文字比對)
function forceSetSelectValue($el, targetVal, targetText) {
    if (!$el || $el.length === 0) return;

    // 1. 取得目標文字 (優先使用傳入的 targetText，如果沒有則用 targetVal 當文字找)
    var textToFind = String(targetText || "").trim();
    if (textToFind === "" && targetVal) {
        textToFind = String(targetVal).trim();
    }

    // 防呆：如果完全沒字，就選第一個或空白
    if (textToFind === "") {
        $el.val("");
        return;
    }

    // 2. ★ 核心邏輯：遍歷所有 Option，只比對「文字」
    var found = false;
    $el.find('option').each(function () {
        if (found) return; // 找到就停

        var $opt = $(this);
        var optText = $opt.text().trim(); // 下拉選單顯示的字 (例如: "01 - FTOA系統")
        var optVal = $opt.val().trim();

        // 比對規則：
        // A. 完全一樣 (例如: "FTOA系統" == "FTOA系統")
        // B. 選項文字包含格子文字 (例如: "01 - FTOA系統" 包含 "FTOA系統")
        if (optText === textToFind || optText.indexOf(textToFind) > -1) {
            $el.val(optVal); // 設定 Value
            found = true;
        }
    });

    // 3. (備案) 如果用文字真的找不到，才死馬當活馬醫，試試看用 ID 直接設定
    if (!found && targetVal) {
        $el.val(targetVal);
    }

    // 4. 觸發 Select2 更新畫面
    if ($el.hasClass("select2-hidden-accessible")) {
        $el.trigger('change.select2');
    }
}

$(document).on('keydown', 'table tbody input, table tbody select, table tbody textarea', function (e) {
    var key = e.which || e.keyCode;
    // 只處理 Enter(13), Left(37), Up(38), Right(39), Down(40)
    if ([13, 37, 38, 39, 40].indexOf(key) === -1) return;

    var $currentInput = $(this);
    var isSelect = $currentInput.is('select'); // 判斷是否為下拉選單 (FD_TY 6 or 9)

    // --- 規則 1：下拉選單 (Select) 的特殊處理 ---
    if (isSelect) {
        // 如果是下拉選單，且按「上」或「下」
        if (key === 38 || key === 40) {
            // ★ 回傳 (return) -> 不執行 preventDefault
            // 讓瀏覽器執行預設動作：變更選單的選項 (更改內容)
            // 且程式碼會在此中斷，不會執行下方的換格邏輯
            return;
        }
        // 如果是按 左、右、Enter，則繼續往下執行 (準備換格)
    }

    // --- 規則 2：阻擋預設行為 (接管導航) ---
    // 除了上面的 Select 上下鍵外，其他情況都要阻擋 (例如阻止游標移動，改為整格跳轉)
    e.preventDefault();

    var $tr = $currentInput.closest('tr');
    var $td = $currentInput.closest('td');

    // 定義可編輯欄位 (排除 checkbox 避免報錯)
    var editableSelector = 'input:visible:not([readonly]):not([disabled]):not([type="checkbox"]), select:visible:not([readonly]):not([disabled]), textarea:visible:not([readonly]):not([disabled])';

    // 安全聚焦函式 (防止 InvalidStateError)
    function safeFocus($el) {
        if ($el.length === 0) return;
        $el.focus();
        // 只有文字類型的輸入框才執行全選
        if ($el.is('input[type="text"], input[type="number"], input[type="search"], input[type="password"], textarea')) {
            try { $el.select(); } catch (err) { }
        }
    }

    // --- 導航邏輯 ---

    // 1. Enter (13) 或 右 (39) -> 往右 / 下一個
    if (key === 13 || key === 39) {
        var $rowInputs = $tr.find(editableSelector);
        var idx = $rowInputs.index($currentInput);

        // 如果這列還有右邊的欄位
        if (idx >= 0 && idx < $rowInputs.length - 1) {
            safeFocus($rowInputs.eq(idx + 1));
        }
        else {
            // 這列沒了，找下一列的第一個
            var $nextTr = $tr.nextAll('tr:visible').first();
            if ($nextTr.length > 0) {
                var $nextInput = $nextTr.find(editableSelector).first();
                safeFocus($nextInput);
            }
        }
    }

    // 2. 左 (37) -> 往左 / 上一個
    else if (key === 37) {
        var $rowInputs = $tr.find(editableSelector);
        var idx = $rowInputs.index($currentInput);

        // 如果這列還有左邊的欄位
        if (idx > 0) {
            safeFocus($rowInputs.eq(idx - 1));
        }
        else {
            // 這列沒了，找上一列的最後一個
            var $prevTr = $tr.prevAll('tr:visible').first();
            if ($prevTr.length > 0) {
                var $prevInputs = $prevTr.find(editableSelector);
                if ($prevInputs.length > 0) {
                    safeFocus($prevInputs.last());
                }
            }
        }
    }

    // 3. 上 (38) / 下 (40) -> 垂直換格 (僅對 非Select 有效)
    // 程式碼能跑到這裡，代表一定不是 Select，因為 Select 的上下鍵在最上面已經 return 了
    else if (key === 38 || key === 40) {
        var colIndex = $td.index(); // 鎖定欄位位置
        var $targetRows = (key === 38) ? $tr.prevAll('tr:visible') : $tr.nextAll('tr:visible');

        var found = false;
        $targetRows.each(function () {
            if (found) return;

            var $targetCell = $(this).children('td').eq(colIndex);
            var $targetInput = $targetCell.find(editableSelector);

            if ($targetInput.length > 0) {
                safeFocus($targetInput);
                found = true;
            }
        });
    }
});

$(document).on('change', 'table tbody input, table tbody select, table tbody textarea', function () {
    var $el = $(this);
    var $tr = $el.closest('tr');

    // 1. 取得新值與原始值
    var newVal = String($el.val() || "").trim();
    var origVal = String($el.attr('data-orig') || "").trim();

    // 特殊處理：Checkbox 的值判斷
    if ($el.attr('type') === 'checkbox') {
        newVal = $el.prop('checked') ? "true" : "false";
        // 假設 data-orig 存的是 "true"/"false" 或 "1"/"0"
        // 需視您後端資料格式調整，這裡做個簡單轉換防呆
        if (origVal === "1") origVal = "true";
        if (origVal === "0") origVal = "false";
    }

    // 2. 比對是否有異動
    if (newVal !== origVal) {
        // --- 有異動 ---
        $el.addClass('field-dirty'); // 欄位變紅
        $tr.addClass('row-dirty');   // 整行變黃

        // (選用) 更新 Grid 狀態物件，標記此資料已髒
        var gdna = $el.data('gdna');
        var rowIdx = $tr.data('index');
        var field = $el.data('field');
        if (typeof GRID_STATE !== 'undefined' && GRID_STATE[gdna]) {
            // 更新記憶體中的資料
            if (GRID_STATE[gdna].filteredData[rowIdx]) {
                GRID_STATE[gdna].filteredData[rowIdx][field] = newVal;
                // 標記此行有被修改 (可供存檔時辨識)
                GRID_STATE[gdna].filteredData[rowIdx]._isDirty = true;
            }
        }
    } else {
        // --- 改回原值 (復原) ---
        $el.removeClass('field-dirty');

        // 檢查這一行是否還有其他「紅字」的欄位
        // 如果沒有其他欄位被改，就把整行的黃色背景拿掉
        if ($tr.find('.field-dirty').length === 0) {
            $tr.removeClass('row-dirty');

            // (選用) 清除髒狀態
            var gdna = $el.data('gdna');
            var rowIdx = $tr.data('index');
            if (typeof GRID_STATE !== 'undefined' && GRID_STATE[gdna] && GRID_STATE[gdna].filteredData[rowIdx]) {
                delete GRID_STATE[gdna].filteredData[rowIdx]._isDirty;
            }
        }
    }
});

// 輔助：自動啟動目標儲存格的編輯狀態
function activateCell($td, cursorMode) {
    if (!$td || $td.length === 0) return;
    // 1. 如果是延遲載入容器 (Select)，觸發點擊讓它生出 Select
    var $lazy = $td.find('.lazy-select-container');
    if ($lazy.length > 0) {
        $lazy.trigger('click');
        return;
    }
    // 2. 如果是一般輸入框 (多抓 textarea 比較保險)
    var $input = $td.find('input, textarea');
    if ($input.length > 0) {
        $input.focus(); // Focus 動作對所有類型都有效，先執行
        // ★★★ 修正點：排除不支援游標控制的類型 ★★★
        // HTML5 規範：setSelectionRange 僅適用於 text, search, url, tel, password
        // Checkbox, Radio, Number, Date, Email 等呼叫此r函數會報錯 InvalidStateError
        var type = ($input.attr('type') || 'text').toLowerCase();
        var safeTypes = ['text', 'search', 'password', 'url', 'tel'];
        // 判斷條件：是 textarea 或者是安全類型的 input
        var canSetCursor = $input.is('textarea') || safeTypes.indexOf(type) !== -1;
        if (canSetCursor) {
            try {
                var len = $input.val().length;
                if (cursorMode === 'end') {
                    $input[0].setSelectionRange(len, len);
                } else if (cursorMode === 'start') {
                    $input[0].setSelectionRange(0, 0);
                }
            } catch (e) {
                // 萬一瀏覽器版本特殊仍報錯，用 try-catch 包住確保程式不中斷
                console.warn('無法設定游標位置', e);
            }
        }
        // 如果是 Number 類型，雖然不能 setSelectionRange，但可以 select() 全選方便輸入
        else if (type === 'number') {
            $input.select();
        }
    }
}

/**
 * 存檔成功後，在地提交變更：將目前的數值設為「原始值」，並清除變色
 */
function commitRowChanges(gdna, index) {
    var state = GRID_STATE[gdna];
    if (!state) return;
    var targetRowData = (index === 'new') ? {} : state.filteredData[index];
    if (!targetRowData && index !== 'new') return;
    var $gridRow = $(`#table_${gdna} tr[data-index="${index}"]`);
    // 1. 更新 Modal 內的元素狀態
    $('#detailModalContent [data-field]').each(function () {
        var $input = $(this);
        var field = $input.data('field');
        if (!field) return;
        var newVal = $input.val();
        // 如果是下拉選單，val() 通常已經是 ID，但我們做個防呆
        if (newVal && newVal.includes(' - ')) newVal = newVal.split(' - ')[0].trim();
        // 更新記憶體資料
        targetRowData[field] = newVal;
        if (targetRowData[field.toUpperCase()] !== undefined) targetRowData[field.toUpperCase()] = newVal;
        // ★ 重要：將目前的值寫入 data-orig，這會讓黃色變色消失
        $input.attr('data-orig', newVal);
        $input.removeClass('field-dirty');
        // 針對 Select2 清除視覺顏色
        if ($input.hasClass("select2-hidden-accessible")) {
            $input.next('.select2-container').find('.select2-selection').css('background-color', '');
        }
    });

    // 2. 更新 Grid 畫面顯示
    if ($gridRow.length > 0) {
        $gridRow.removeClass('row-dirty');
        $gridRow.find('[data-field]').each(function () {
            var $cell = $(this);
            var field = $cell.data('field');
            var newVal = targetRowData[field];
            if ($cell.hasClass('lazy-select-container')) {
                // 更新延遲載入容器的原始值與顯示
                $cell.data('val', newVal).attr('data-val', newVal);
                // 暫時顯示 ID，待 loadGridDataAjax 回來會變更美觀
                $cell.text(newVal);
                $cell.removeClass('bg-light-success');
            } else {
                $cell.val(newVal).attr('data-orig', newVal);
            }
            $cell.removeClass('field-dirty');
        });
    }

    if (typeof CT_STATE !== 'undefined') CT_STATE.isDirty = false;
    console.log(`[Commit成功] Row:${index} 已同步為原始資料`);
}

// 解析欄位值：支援單一欄位或複合欄位 (e.g. "field1 + '-' + field2")
function resolveFieldValue(row, fieldName) {
    if (!fieldName) return "";
    // 如果不含 '+' 號，走標準取值流程
    if (fieldName.indexOf('+') === -1) {
        return (row[fieldName] !== undefined) ? row[fieldName] :
            (row[fieldName.toUpperCase()] !== undefined) ? row[fieldName.toUpperCase()] :
                (row[fieldName.toLowerCase()] !== undefined) ? row[fieldName.toLowerCase()] : "";
    }
    // 處理複合欄位邏輯
    var parts = fieldName.split('+');
    var result = "";
    parts.forEach(function (part) {
        part = part.trim();
        // 判斷是否為常數字串 (用單引號包圍的，如 '-')
        if ((part.startsWith("'") && part.endsWith("'")) || (part.startsWith('"') && part.endsWith('"'))) {
            result += part.substring(1, part.length - 1);
        } else {
            // 視為欄位名稱取值
            var val = (row[part] !== undefined) ? row[part] :
                (row[part.toUpperCase()] !== undefined) ? row[part.toUpperCase()] :
                    (row[part.toLowerCase()] !== undefined) ? row[part.toLowerCase()] : "";
            result += String(val === null ? "" : val);
        }
    });

    return result;
}