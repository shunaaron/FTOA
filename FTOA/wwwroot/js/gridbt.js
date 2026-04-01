/* --- wwwroot/js/gridbt.js --- */

/**
 * Grid 按鈕動作核心派發器
 */
function HandleGridAction(gdna, field, index) {
    var state = GRID_STATE[gdna];
    if (!state || !state.filteredData) return;

    var toolId = $('#toolIdInput').val() || "";
    var rowData = state.filteredData[index];

    // 取得內容值 (大小寫容錯)
    var val = rowData[field] || rowData[field.toUpperCase()] || rowData[field.toLowerCase()] || "";

    console.log(`[Action執行] 功能: ${toolId}, 欄位: ${field}, 索引: ${index}`);

    // ★★★ 1. 強制指定邏輯：如果是 df_pw，直接執行 g02_02_action ★★★
    if (field === 'df_pw') {
        if (typeof window.g02_02_action === 'function') {
            window.g02_02_action(gdna, field, rowData, index);
            return; // 執行完畢後直接結束
        } else {
            console.error("找不到 g02_02_action 函式");
        }
    }

    // --- 2. 執行特定功能的客製化邏輯 (依 ToolID 動態尋找) ---
    var idLower = toolId.toLowerCase();
    var customFuncName = idLower + "_action";
    var customFunc = window[customFuncName] || window[idLower + "_Action"];

    if (typeof customFunc === 'function') {
        console.log(`[Dispatch] 進入客製化函數: ${customFuncName}`);
        // 傳入 rowData 讓客製化函式使用
        var handled = customFunc(gdna, field, rowData, index);
        if (handled) return; // 如果客製化邏輯回傳 true，中斷後續標準動作
    }

    // --- 3. 執行全系統標準化邏輯 (根據欄位名稱關鍵字) ---
    var fieldLower = field.toLowerCase();

    if (fieldLower.includes('photo') || fieldLower.includes('img')) {
        if (typeof OpenPhotoPreview === 'function') OpenPhotoPreview(val);
        return;
    }

    if (fieldLower.includes('upload')) {
        if (typeof OpenUploadModal === 'function') OpenUploadModal(toolId, gdna, field, rowData);
        return;
    }

    if (fieldLower.includes('download')) {
        window.open('/Basic/DownloadFile?path=' + encodeURIComponent(val));
        return;
    }

    if (fieldLower.includes('map')) {
        window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(val));
        return;
    }

    alert("按鈕尚未定義動作。\n功能: " + toolId + "\n欄位: " + field + "\n資料內容: " + val);
}

// --- 標準化功能範例 ---
function OpenPhotoPreview(url) {
    if (!url) { alert("無圖片路徑"); return; }
    // 實作燈箱或 Modal 顯示圖片
}

function g02_02_action(gdna, field, rowData, index) {
    // 判斷是否點擊了密碼重置欄位 (不分大小寫)
    if (field.toLowerCase() === 'df_pw') {
        var name = rowData.sw_name || rowData.SW_NAME || rowData.iduser || "該使用者";
        if (confirm("確定要將 [" + name + "] 的密碼重置為 123456 嗎？")) {
            // 1. Base64 轉換 (ToBase64String)
            // btoa("123456") 會得到 "MTIzNDU2"
            var encodedPw = btoa("123456");
            // 2. 準備 log_id 來源 (從 iduser 或 x_userno 抓取)
            var userId = rowData.log_id || "";
            if (String(userId).includes(' - ')) {
                userId = String(userId).split(' - ')[0].trim();
            }
            // 3. 準備符合後端接口的物件
            // PK_LIST 要求 Key 為 log_id
            var pkListObj = { "log_id": userId };
            // ROWLIST 要求 Key 為 log_pw
            var rowChangeObj = { "log_pw": encodedPw };
            // 4. 組合最終 Payload
            var payload = {
                SQL_ID: 'UPUSERPW', // 使用指定的專用更新 SQL_ID
                IUD: 1,             // 修改模式
                QORS: 1,
                ROWLIST: [rowChangeObj],
                PK_LIST: [pkListObj]
            };
            console.log("[重置密碼發送]", payload);
            // 5. 呼叫發送函數
            if (typeof sendRequest === 'function') {
                sendRequest(payload, "密碼重置", function (res) {
                    // 儲存成功後的 Callback：刷新資料
                    if (typeof loadGridDataAjax === 'function') {
                        loadGridDataAjax(gdna);
                    }
                });
            } else {
                alert("系統錯誤：找不到 sendRequest 函數");
            }
        }
        return true; // 已接管動作
    }
    return false; // 其他欄位交回給標準邏輯
}