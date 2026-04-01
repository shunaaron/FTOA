/* --- wwwroot/js/ctbase.js --- */

var CT_STATE = {
    originalData: {}, // 原始資料快照
    isDirty: false,   // 是否有變更
    gdna: null,       // 目前 Grid
    index: null       // 索引 (new 代表新增)
};

function toSafeString(val) {
    if (val === 0) return "0"; // 明確保留數字 0
    if (val === null || val === undefined) return "";
    return String(val).trim();
}

$(document).ready(function () {
    // 儲存/新增確認按鈕
    $('#btnModalEdit').off('click').on('click', function () {
        if (CT_STATE.isDirty || CT_STATE.index === 'new') {
            executeSave();
        }
    });

    // 刪除按鈕
    $('#btnModalDelete').off('click').on('click', function () {
        executeDelete();
    });

    // 監聽變更
    $('#detailModal').on('input change', '.editable-field', function () {
        checkDirtyStatus();
    });
});

// 初始化編輯狀態
function CT_InitEditMode(gdna, index) {
    CT_STATE.gdna = gdna;
    CT_STATE.index = index;
    CT_STATE.isDirty = false;

    setTimeout(function () {
        snapshotOriginalData();
        updateSaveButtonState();
    }, 600);
}

function snapshotOriginalData() {
    CT_STATE.originalData = {};
    $('#detailModal .editable-field').each(function () {
        var field = $(this).data('field');
        CT_STATE.originalData[field] = toSafeString($(this).val());
    });
}

function checkDirtyStatus() {
    var hasChange = false;
    if (CT_STATE.index === 'new') {
        // 新增模式下，只要有任何一個 IUDFD 欄位有值，就視為可儲存
        $('#detailModal [data-field]').each(function () {
            if (toSafeString($(this).val()) !== "") {
                hasChange = true;
                return false;
            }
        });
    } else {
        // 修改模式邏輯不變
        $('#detailModal [data-field]').each(function () {
            var field = $(this).data('field');
            if (toSafeString($(this).val()) !== CT_STATE.originalData[field]) {
                hasChange = true;
                return false;
            }
        });
    }
    CT_STATE.isDirty = hasChange;
    updateSaveButtonState();
}

function updateSaveButtonState() {
    var $btn = $('#btnModalEdit');
    var isNew = (CT_STATE.index === 'new');
    $btn.removeClass('btn-primary btn-success btn-warning btn-secondary');

    if (isNew) {
        $btn.prop('disabled', false).addClass('btn-primary').html('<i class="fas fa-plus mr-1"></i> 新增確認');
    } else if (CT_STATE.isDirty) {
        // ★ 有異動時變黃
        $btn.prop('disabled', false).addClass('btn-warning text-white').html('<i class="fas fa-save mr-1"></i> 儲存修改');
    } else {
        // ★ 無異動或提交完成時變灰
        $btn.prop('disabled', true).addClass('btn-secondary').html('<i class="fas fa-check mr-1"></i> 無異動');
    }
}

// 核心：執行儲存 (新增 IUD=0 / 修改 IUD=1)
function executeSave() {
    var gdna = CT_STATE.gdna, index = CT_STATE.index, isNew = (index === 'new');
    var cols = GLOBAL_GRID_CONFIGS[gdna], originalRow = isNew ? {} : GRID_STATE[gdna].filteredData[index];
    var rowListObj = {}, pkListObj = {}, hasError = false, changedCount = 0;

    $.each(cols, function (i, col) {
        if (col.ISIUD === 1) {
            var $el = $(`#detailModal [data-field="${col.Field}"]`);
            if ($el.length === 0) return true;

            var apiKey = col.IUDFD || col.Field;

            // 1. 取值
            var rawValueFromDom = $el.attr('data-val');
            var valueToResolve = (rawValueFromDom !== undefined && rawValueFromDom !== null)
                ? rawValueFromDom
                : $el.val();

            var currentId = CT_ResolveId(col, valueToResolve);

            // 2. 必填檢查
            if (col.NdVl === 1 && currentId === "") {
                alert(col.Title + " 為必填！");
                $el.focus();
                hasError = true;
                return false;
            }

            // 3. 處理 ROWLIST (變更的內容)
            if (isNew) {
                if (currentId !== "") rowListObj[apiKey] = escapeForSql(currentId);
            } else {
                var snapId = CT_ResolveId(col, CT_STATE.originalData[col.Field]);
                if (currentId !== snapId) {
                    rowListObj[apiKey] = escapeForSql(currentId);
                    changedCount++;
                }
            }

            // 4. 處理 PK_LIST (修正重點：使用 if 並確保邏輯完整)
            if (col.IsPk === 1) {
                var rawPk = "";
                if (isNew) {
                    // 新增時，PK 就是現在填的值
                    rawPk = currentId;
                } else {
                    // 修改時，PK 必須取「原始值」，後端才找得到資料
                    rawPk = originalRow[col.Field] || originalRow[col.Field.toUpperCase()];
                    if (rawPk === undefined || rawPk === null || rawPk === "") {
                        rawPk = CT_STATE.originalData[col.Field] || "";
                    }
                }
                pkListObj[apiKey] = CT_ResolveId(col, rawPk);
            }
        }
    });

    if (hasError) return;
    if (!isNew && changedCount === 0) { alert("無異動"); $('#detailModal').modal('hide'); return; }

    // 發送請求
    sendRequest({
        SQL_ID: CURRENT_TOOL_CONFIG.UP_ID || CURRENT_TOOL_CONFIG.SQL_ID,
        IUD: isNew ? 0 : 1,
        QORS: 1,
        ROWLIST: [rowListObj],
        PK_LIST: [pkListObj]
    }, isNew ? "新增" : "修改", function () {
        // 成功後的處理
        if (typeof commitRowChanges === 'function') commitRowChanges(gdna, index);
        loadGridDataAjax(gdna);

        // 特殊邏輯：dep_02 自動累計序號
        if (isNew && $('#toolIdInput').val() === 'dep_02') {
            var $seqInput = $(`#detailModal [data-field="fd_seq"]`);
            var nextSeq = (parseInt($seqInput.val()) || 0) + 1;
            window.DEP02_NEXT_SEQ = nextSeq;
            $seqInput.val(nextSeq).attr('data-orig', nextSeq);
            CT_STATE.originalData["fd_seq"] = String(nextSeq);
        }

        snapshotOriginalData();
        updateSaveButtonState();

        // 自動聚焦第一個可輸入欄位
        setTimeout(function () {
            var $firstField = $('#detailModalContent .editable-field:visible:not([disabled]):not([readonly])')
                .filter('input, textarea').first();
            if ($firstField.length > 0) {
                $firstField.focus();
                if ($firstField.is('textarea') || $firstField.attr('type') === 'text') {
                    $firstField.select();
                }
            }
        }, 300);
    });
}


// 核心：執行刪除 (IUD=2)
function executeDelete() {
    var gdna = CT_STATE.gdna, index = CT_STATE.index;
    if (index === 'new' || !confirm("確定刪除？")) return;
    var cols = GLOBAL_GRID_CONFIGS[gdna], row = GRID_STATE[gdna].filteredData[index], pkObj = {};

    $.each(cols, function (i, col) {
        if (col.IsPk === 1 && col.ISIUD === 1) {
            var apiKey = col.IUDFD || col.Field;
            pkObj[apiKey] = CT_ResolveId(col, row[col.Field] || row[col.Field.toUpperCase()] || "");
        }
    });

    sendRequest({ SQL_ID: CURRENT_TOOL_CONFIG.UP_ID || CURRENT_TOOL_CONFIG.SQL_ID, IUD: 2, QORS: 1, ROWLIST: [], PK_LIST: [pkObj] }, "刪除", function () {
        $('#detailModal').modal('hide'); loadGridDataAjax(gdna);
    });
}

// 統一 AJAX 發送
function sendRequest(payload, actionName, successCallback) {
    $('.loading-text-truck').text('儲存資料中，請稍候...');
    $('#dataLoadingOverlay').fadeIn(200);
    if (typeof startTimer === 'function') startTimer();
    $.ajax({
        url: '/Basic/UpdateData',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(payload),
        success: function (res) {
            var rct = res.r_RCT || res.R_RCT || res.r_rct || -1;
            var rmsg = res.r_MSG || res.R_MSG || res.r_msg || "未知錯誤";
            if (rct >= 1) {
                alert(actionName + "成功！");
                if (typeof successCallback === 'function') {
                    successCallback(res);
                } else {
                    loadGridDataAjax(CT_STATE.gdna || $('#currentGdnaInput').val());
                }
                if (typeof CT_STATE !== 'undefined') CT_STATE.isDirty = false;
            } else {
                alert(actionName + "失敗：" + (rmsg));
                var gdna = CT_STATE.gdna || $('#currentGdnaInput').val();
                if (gdna) renderGridWithPagination(gdna);
            }
        },
        error: function () {
            alert("伺服器連線失敗，請稍後再試。");
        },
        complete: function () {
            if (typeof stopTimer === 'function') stopTimer();
            $('#dataLoadingOverlay').fadeOut(300);
            setTimeout(() => {
                $('.loading-text-truck').text('資料查詢中，請稍候...');
            }, 500);
        }
    });
}

// 2. 強化：ID 轉換器 (解決 PK_LIST 轉換失敗的問題)
function CT_GetIdFromLabel(sqlId, label) {
    if (!label && label !== 0) return "";
    var searchLabel = toSafeString(label);
    var foundVal = null;
    var cleanSqlId = String(sqlId).trim();

    $.each(COLUMN_DROPDOWN_CACHE, function (cacheKey, html) {
        if (cacheKey.startsWith(cleanSqlId + "||")) {
            var $temp = $('<div>').append(html);
            $temp.find('option').each(function () {
                var $opt = $(this);
                var optVal = $opt.val().trim();
                var optText = $opt.text().trim();
                // 比對值或比對顯示文字
                if (searchLabel === optVal || searchLabel === optText || optText === (optVal + " - " + searchLabel) || optText.endsWith(" - " + searchLabel)) {
                    foundVal = optVal;
                    return false;
                }
            });
        }
        if (foundVal !== null) return false;
    });
    return (foundVal !== null) ? foundVal : searchLabel;
}



/**
 * 批次儲存行內編輯的資料
 */
function CT_BatchSave(gdna) {
    var cols = GLOBAL_GRID_CONFIGS[gdna], state = GRID_STATE[gdna];
    var batchRowList = [], batchPkList = [];
    var $dirtyRows = $(`#tbody_${gdna} tr.row-dirty`);

    $dirtyRows.each(function () {
        var $tr = $(this), rowIdx = $tr.data('index'), rowData = state.filteredData[rowIdx];
        var rowChangeObj = {}, pkObj = {}, hasChange = false;

        $.each(cols, function (i, col) {
            var apiKey = col.IUDFD || col.Field;

            // 處理 PK_LIST (永遠取原始 rowData 的值)
            if (col.IsPk === 1 && col.ISIUD === 1) {
                // 這裡確保抓的是 rowData[col.Field]，這是變更前存留在記憶體中的資料
                pkObj[apiKey] = CT_ResolveId(col, rowData[col.Field] || rowData[col.Field.toUpperCase()] || "");
            }

            // 處理 ROWLIST (比對是否有異動)
            if (col.ISIUD === 1) {
                var $el = $tr.find(`[data-field="${col.Field}"]`);
                if ($el.length > 0) {
                    var rawVal = $el.hasClass('lazy-select-container') ? ($el.find('select').val() || $el.data('val')) : $el.val();
                    var currentId = CT_ResolveId(col, rawVal);
                    var snapId = CT_ResolveId(col, $el.attr('data-orig')); // data-orig 存的是進入編輯狀態前的值

                    if (currentId !== snapId) {
                        rowChangeObj[apiKey] = escapeForSql(currentId);
                        hasChange = true;
                    }
                }
            }
        });
        if (hasChange) { batchRowList.push(rowChangeObj); batchPkList.push(pkObj); }
    });

    if (batchRowList.length === 0) { alert("未偵測到實質異動"); return; }
    sendRequest({ SQL_ID: CURRENT_TOOL_CONFIG.UP_ID || CURRENT_TOOL_CONFIG.SQL_ID, IUD: 1, QORS: 1, ROWLIST: batchRowList, PK_LIST: batchPkList }, "批次修改", function () {
        state.isInlineEditing = false; loadGridDataAjax(gdna);
    });
}

/**
 * 批次刪除勾選的資料
 */
function CT_BatchDelete(gdna) {
    var state = GRID_STATE[gdna], cols = GLOBAL_GRID_CONFIGS[gdna];
    if (!state.selectedIds || state.selectedIds.size === 0) { alert("請先勾選"); return; }

    var batchPkList = [];
    state.selectedIds.forEach(function (rowId) {
        var rowData = state.allData.find(r => r._rowId === rowId);
        if (rowData) {
            var pkObj = {};
            $.each(cols, function (i, col) {
                if (col.IsPk === 1 && col.ISIUD === 1) {
                    var apiKey = col.IUDFD || col.Field;
                    pkObj[apiKey] = CT_ResolveId(col, rowData[col.Field] || rowData[col.Field.toUpperCase()] || "");
                }
            });
            batchPkList.push(pkObj);
        }
    });

    if (batchPkList.length === 0 || !confirm("確定刪除 " + batchPkList.length + " 筆？")) return;
    sendRequest({ SQL_ID: CURRENT_TOOL_CONFIG.UP_ID || CURRENT_TOOL_CONFIG.SQL_ID, IUD: 2, QORS: 1, ROWLIST: [], PK_LIST: batchPkList }, "批次刪除", function () {
        state.selectedIds.clear(); loadGridDataAjax(gdna);
    });
}


function sendRequest(payload, actionName, successCallback) {
    $('.loading-text-truck').text('處理中...'); $('#dataLoadingOverlay').fadeIn(200);
    $.ajax({
        url: '/Basic/UpdateData', type: 'POST', contentType: 'application/json', data: JSON.stringify(payload),
        success: function (res) {
            var rct = res.r_RCT || res.R_RCT || 0;
            if (rct >= 1) {
                alert(actionName + "成功！");
                if (successCallback) successCallback(res);
                CT_STATE.isDirty = false;
            } else {
                alert(actionName + "失敗：" + (res.r_MSG || "未知錯誤"));
                loadGridDataAjax(CT_STATE.gdna || $('#currentGdnaInput').val());
            }
        },
        error: function () { alert("連線失敗"); },
        complete: function () { $('#dataLoadingOverlay').fadeOut(300); }
    });
}

function escapeForSql(value) {
    if (value === null || value === undefined) return "";
    var s = String(value);
    return s.replace(/'/g, "''");
}


// 1. 修正：將入口點放在這裡，並確保呼叫 CT_BatchDelete
function deleteSelectedRows(gdna) {
    if (typeof CT_BatchDelete === 'function') {
        CT_BatchDelete(gdna);
    } else {
        alert("刪除模組尚未載入");
    }
}

function CT_ResolveId(col, rawVal) {
    var val = toSafeString(rawVal);
    var type = parseInt(col.Type); // 強制轉數字判定，避免 "6" === 6 失敗
    // ★ 新增：Type 10 日期字串處理 (yyyy/MM/dd -> yyyyMMdd)
    if (type === 10) {
        // 使用正則表達式移除所有的 "/" 和 "-"
        // 例如: "2023/10/25" -> "20231025"
        // 例如: "2023-10-25" -> "20231025"
        return val.replace(/[\/\-]/g, '');
    }
    // 只針對 Type 6 或 9 執行轉換
    if (type === 6 || type === 9) {
        // 1. 如果已經有 " - " 格式，直接取前半段 (最高優先權，不需查快取)
        if (val.includes(' - ')) {
            return val.split(' - ')[0].trim();
        }

        // 2. 解析 SQL_ID
        var sqlId = col.Hint || "";
        if (col.CbJs) {
            try { sqlId = JSON.parse(col.CbJs).SQL_ID || sqlId; } catch (e) { }
        }

        // 3. 呼叫快取比對 (處理純名稱轉 ID)
        if (sqlId) {
            return CT_GetIdFromLabel(sqlId, val);
        }
    }
    return val;
}
