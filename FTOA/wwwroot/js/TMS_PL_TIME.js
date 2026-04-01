/* 
 * 檔案名稱：TMS_PL_TIME.js
 * 用途：TMS 系統共用查詢邏輯 (包含站所、原廠、日期、類型、權限判斷)
 * 修改重點：支援不同 tool_id 的預設值設定 (如 qy_01 預設配送)
 */

var TMS_Query = {
    // 當前功能 ID
    currentToolId: '',

    // 儲存廠商群組對應表 (Group ID -> Vendor IDs)
    vendorGroupMap: {},

    /**
     * 初始化函式 (由 View 呼叫)
     * @param {string} toolId - 功能代號 (例如 'qy_01')
     */
    init: function (toolId) {
        // debugger; // 需要除錯時可打開
        this.currentToolId = toolId || '';
        console.log("TMS_Query initialized. Tool ID:", this.currentToolId);

        // 1. 載入站所 (依權限)
        this.loadStationData();

        // 2. 載入原廠 (如果有該下拉欄位)
        if ($('#VD_GPID').length > 0) {
            this.loadVendorData();
        } else {
            console.log("頁面上無 VD_GPID 欄位，跳過載入原廠資料");
        }

        // 3. 套用個別功能設定
        this.applyToolSettings();
    },

    /**
     * 針對不同 tool_id 套用特殊預設值
     */
    applyToolSettings: function () {
        var $txTySelect = $('#TX_TY');
    //    debugger; 
        // 確保元素存在才設定
        if ($txTySelect.length > 0) {
            if (this.currentToolId === 'qy_01') {
                // qy_01: 預設選取 "配送 (A)"
                $txTySelect.val('A');
                console.log("Apply Settings: [" + this.currentToolId + "] Default TX_TY = A");
            } else {
                // 其他: 預設選取 "全部" (空值)
                $txTySelect.val('');
                console.log("Apply Settings: [Default] TX_TY = All");
            }
        }
    },

    /**
     * 載入站所資料 (API: GET_TMS_STATION_MSG)
     */
    loadStationData: function () {
        var $select = $('#STATION_ID');
        if ($select.length === 0) {
            console.error("找不到 #STATION_ID 元素，無法載入站所");
            return;
        }

        // 取得權限變數 (防呆)
        var userLv = (typeof window.USER_POWER_LV !== 'undefined') ? window.USER_POWER_LV : 0;
        var userStation = (typeof window.USER_DF_STATION !== 'undefined') ? window.USER_DF_STATION : "";

        console.log("開始載入站所... 權限:", userLv, "預設站:", userStation);

        $select.prop('disabled', true);

        $.ajax({
            url: '/Basic/GetDropdownData',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ "SQL_ID": "GET_TMS_STATION_MSG" }),
            success: function (res) {
                // console.log("站所 API 回傳:", res); // 除錯用
                if (res && res.R_RCT > 0 && res.ROWLIST) {
                    var html = '';

                    // ★ 權限判斷
                    if (userLv >= 7) {
                        // 高權限：顯示全部
                        html += '<option value="">全部站所</option>';
                        $.each(res.ROWLIST, function (i, item) {
                            var text = item.station_id + ' - ' + item.station_name;
                            html += '<option value="' + item.station_id + '">' + text + '</option>';
                        });
                    } else {
                        // 低權限：只顯示預設站所
                        var hasMatch = false;
                        $.each(res.ROWLIST, function (i, item) {
                            if (item.station_id === userStation) {
                                var text = item.station_id + ' - ' + item.station_name;
                                html += '<option value="' + item.station_id + '" selected>' + text + '</option>';
                                hasMatch = true;
                            }
                        });
                        // 防呆：API 沒回傳該站所，手動補上
                        if (!hasMatch) {
                            html = '<option value="' + userStation + '" selected>' + userStation + '</option>';
                        }
                    }
                    $select.html(html);
                } else {
                    console.error("站所 API 回傳無資料");
                    $select.html('<option value="">無資料</option>');
                }
            },
            error: function (xhr, status, error) {
                console.error("站所 API 呼叫失敗:", error);
                $select.html('<option value="">載入失敗</option>');
            },
            complete: function () {
                $select.prop('disabled', false);
            }
        });
    },

    /**
     * 載入原廠資料 (API: DSMG_VDKPISET)
     */
    loadVendorData: function () {
        var self = this;
        var $select = $('#VD_GPID');

        console.log("開始載入原廠資料...");

        $select.prop('disabled', true);

        $.ajax({
            url: '/Basic/GetDropdownData',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ "SQL_ID": "DSMG_VDKPISET" }),
            success: function (res) {
                if (res && res.R_RCT > 0 && res.ROWLIST) {
                    var html = '<option value="">全部設定原廠</option>';
                    var uniqueGroups = {};

                    // 重置對應表
                    self.vendorGroupMap = {};

                    $.each(res.ROWLIST, function (i, item) {
                        // 1. 建立對應表 (Group ID -> Array of Vendor IDs)
                        if (!item.vd_gpid) return; // 防呆

                        if (!self.vendorGroupMap[item.vd_gpid]) {
                            self.vendorGroupMap[item.vd_gpid] = [];
                        }
                        self.vendorGroupMap[item.vd_gpid].push(item.vender_id);

                        // 2. 建立下拉選單 (去重)
                        if (!uniqueGroups[item.vd_gpid]) {
                            uniqueGroups[item.vd_gpid] = true;
                            html += '<option value="' + item.vd_gpid + '">' + item.gp_name + '</option>';
                        }
                    });

                    $select.html(html);
                }
            },
            complete: function () {
                $select.prop('disabled', false);
            }
        });
    },

    /**
     * 提交查詢 (組裝 SQL)
     */
    submit: function () {
     //    debugger; 
        var userLv = (typeof window.USER_POWER_LV !== 'undefined') ? window.USER_POWER_LV : 0;
        var userStation = (typeof window.USER_DF_STATION !== 'undefined') ? window.USER_DF_STATION : "";

        // 1. 權限防呆
        if (userLv < 7 && !userStation) {
            alert("帳號權限設定異常：無預設站所資料，請聯繫管理員。");
            return;
        }

        // 關閉 Modal 並顯示 Loading
        $('#queryModal').modal('hide');
        this.showLoading();

        // --- 讀取前端欄位值 ---
        var pickDate = $('#PICK_DATE').val();
        var selectedStation = $('#STATION_ID').val();
        var selectedTxTy = $('#TX_TY').val();
        var selectedGroup = $('#VD_GPID').val();
        var driverName = $('#DRIVER_NAME').val();
        var driverId = $('#DRIVER_ID').val(); // ★ 補上這行，解決 ReferenceError
        var dlcarnno = $('#DL_CAR_NO').val();
        var timeStart = $('#TIME_START').val();
        var timeEnd = $('#TIME_END').val();
        var memo = $('#MEMO').val();

        // ==========================================
        // ★★★ 核心修改：定義欄位名稱變數 (Mapping) ★★★
        // ==========================================

        // 1. 設定預設值 (適用於 qy_01 與其他功能)
        var colDL_Date = "a.dl_date";
        var colTX_TY = "a.TX_TY";
        var colDriverName = "driver_name";
        var colDriverId = "driver_id";
        var colBarTime = "a.bar_date";
        var colST_ID = "a.station_id";
        var colVD_ID = "a.vender_id"; 
        var colDL_CAR_NO = "a.dl_car_no";
        if (this.currentToolId === 'qy_01') {
            colDL_Date = "dl_date";
            colTX_TY = "TX_TY";
            colST_ID = "station_id";
            colVD_ID = "vender_id";
        } else if (this.currentToolId === 'qy_02') {
            colDL_Date = "substring(a.bar_date,1,8)"; // 修正為 a.bar_time
            colDriverName = 'g.user_pr_name';
            colDriverId = 'a.driver_id';
            colBarTime = 'a.bar_date';
            console.log("SQL Mapping: 切換為 qy_02 特殊欄位");
        }

        var sqlCondition = "";
        var queryParams = {};

        // A. 日期 (格式: YYYY-MM-DD -> YYYYMMDD)
        if (pickDate) {
            // 將 2025-01-01 轉為 20250101
            var dateYMD = pickDate.replace(/-/g, '');

            // 判斷是否 TimeStart 或 TimeEnd 有值
            if (timeStart || timeEnd) {
                // --- 模式 1: 有時間輸入 (比對前 12 碼) ---
                // 條件: substring(a.bar_date, 1, 12)
                var targetCol = "substring(a.bar_date, 1, 12)";

                if (timeStart && timeEnd) {
                    // 區間: date + start ~ date + end
                    var valStart = dateYMD + timeStart;
                    var valEnd = dateYMD + timeEnd;
                    sqlCondition += " AND " + targetCol + " BETWEEN '" + valStart + "' AND '" + valEnd + "' ";
                }
                else if (timeStart) {
                    // 起始: >= date + start
                    var valStart = dateYMD + timeStart;
                    sqlCondition += " AND " + targetCol + " >= '" + valStart + "' ";
                }
                else if (timeEnd) {
                    // 結束: <= date + end
                    var valEnd = dateYMD + timeEnd;
                    sqlCondition += " AND " + targetCol + " <= '" + valEnd + "' ";
                }
            } else {
                // --- 模式 2: 只有日期沒有時間 (比對前 8 碼) ---
                // 條件: substring(a.bar_date, 1, 8)
                if (this.currentToolId === 'qy_01') {
                    sqlCondition += " AND REPLACE(dl_date, '/', '')  = '" + dateYMD  + "'";
                } else if (this.currentToolId === 'qy_02') {
                    var targetCol = "substring(a.bar_date, 1, 8)";
                    sqlCondition += " AND " + targetCol + " = '" + dateYMD + "' ";
                }

            }
            // 設定參數供後端參考 (選擇性)
            queryParams.PICK_DATE = dateYMD;
        }

        // B. 類型
        if (selectedTxTy) {
            // ★★★ 修正這裡的引號拼接 ★★★
            sqlCondition += " AND " + colTX_TY + " = '" + selectedTxTy + "' ";
            queryParams.TX_TY = selectedTxTy;
        }

        // C. 站所 (權限控制)
        if (userLv >= 7) {
            if (selectedStation) {
                sqlCondition += " AND " + colST_ID + " = '" + selectedStation + "' ";
                queryParams.STATION_ID = selectedStation;
            }
        } else {
            // 低權限強制鎖定
            sqlCondition += " AND " + colST_ID + " = '" + userStation + "' ";
            queryParams.STATION_ID = userStation;
        }

        // D. 原廠群組 (若 colVD_ID 有值且 HTML 有該欄位)
        if ($('#VD_GPID').length > 0 && colVD_ID !== "") {
            if (selectedGroup) {
                var vendorList = this.vendorGroupMap[selectedGroup];
                if (vendorList && vendorList.length > 0) {
                    var inClause = vendorList.map(function (id) { return "'" + id + "'"; }).join(",");
                    // ★★★ 修正這裡的拼接錯誤 ★★★
                    sqlCondition += " AND " + colVD_ID + " IN (" + inClause + ") ";
                }
            } else {
                var allVendorIds = [];
                $.each(this.vendorGroupMap, function (groupId, vendorArray) {
                    if (vendorArray) allVendorIds = allVendorIds.concat(vendorArray);
                });
                var uniqueVendorIds = allVendorIds.filter(function (item, pos) {
                    return allVendorIds.indexOf(item) == pos;
                });
                if (uniqueVendorIds.length > 0) {
                    var inClause = uniqueVendorIds.map(function (id) { return "'" + id + "'"; }).join(",");
                    // ★★★ 修正這裡的拼接錯誤 ★★★
                    sqlCondition += " AND " + colVD_ID + " IN (" + inClause + ") ";
                }
            }
        }

        // ==========================================
        // ★★★ 使用動態欄位變數組裝 SQL ★★★
        // ==========================================

        // E. 配送人員 (支援多行輸入 OR 查詢)
        if (driverName) {
            var names = driverName.split(/\n/);
            var nameConds = [];
            $.each(names, function (i, val) {
                var v = val.trim();
                if (v) nameConds.push(colDriverName + " LIKE '%" + v + "%'");
            });

            if (nameConds.length > 0) {
                sqlCondition += " AND (" + nameConds.join(" OR ") + ") ";
            }
        }

        // F. 配送員編 (支援多行輸入 OR 查詢)
        if (driverId) {
            var ids = driverId.split(/\n/);
            var idConds = [];
            $.each(ids, function (i, val) {
                var v = val.trim();
                if (v) idConds.push(colDriverId + " LIKE '%" + v + "%'");
            });

            if (idConds.length > 0) {
                sqlCondition += " AND (" + idConds.join(" OR ") + ") ";
            }
        }

        // G. 備註 (通常只有一個欄位名，不需要變數，除非您也要動態)
        if (memo) {
            sqlCondition += " AND memo LIKE '%" + memo + "%' ";
        }

        // H. 到離時間 (使用變數 colBarTime)
        if (timeStart && timeEnd) {
            sqlCondition += " AND " + colBarTime + " BETWEEN '" + timeStart + "' AND '" + timeEnd + "' ";
        } else if (timeStart) {
            sqlCondition += " AND " + colBarTime + " >= '" + timeStart + "' ";
        } else if (timeEnd) {
            sqlCondition += " AND " + colBarTime + " <= '" + timeEnd + "' ";
        }

        // H. 任務編號 (支援多行輸入 OR 查詢)
        if (dlcarnno) {
            var ids1 = dlcarnno.split(/\n/);
            var idList = [];

            $.each(ids1, function (i, val) {
                var v = val.trim().replace(/'/g, "''"); // 去除兩端空白，並將單引號轉義防止 SQL 錯誤
                if (v) {
                    idList.push("'" + v + "'"); // 包裝成 SQL 字串格式
                }
            });

            if (idList.length > 0) {
                // 使用 IN 語法，效率較高且精準匹配
                sqlCondition += " AND " + colDL_CAR_NO + " IN (" + idList.join(",") + ") ";
            }
        }

        console.log("SQL Condition:", sqlCondition);

        // I. 回呼主頁面函式
        setTimeout(function () {
            if (typeof executeCustomSearch === 'function') {
                executeCustomSearch(queryParams, sqlCondition);
            } else {
                console.error("錯誤: 找不到 executeCustomSearch 函式");
                $('#dataLoadingOverlay').fadeOut();
            }
        }, 500);
    },

    /**
     * 顯示 Loading 遮罩
     */
    showLoading: function () {
        var $overlay = $('#dataLoadingOverlay');
        if ($overlay.length === 0) {
            var overlayHtml = `
                <div id="dataLoadingOverlay" class="style-cube" style="display:none;">
                    <div class="cube-spinner">
                        <div class="cube-face"></div><div class="cube-face"></div>
                        <div class="cube-face"></div><div class="cube-face"></div>
                        <div class="cube-face"></div><div class="cube-face"></div>
                    </div>
                    <div class="loading-text-cube">資料查詢中...</div>
                </div>`;
            $('body').append(overlayHtml);
            $overlay = $('#dataLoadingOverlay');
        }
        $overlay.fadeIn(300);
    }
};

/* 
 * ========================================================
 * 全域函式對應 (Backward Compatibility)
 * 讓原本 HTML 中的 onclick="validateAndSubmit()" 依然有效
 * ========================================================
 */
window.validateAndSubmit = function () {
    TMS_Query.submit();
};

/* 
 * 自動執行：若 View 沒有特別呼叫 init，這裡會做一個基本的載入。
 * 但建議在 View 中呼叫 TMS_Query.init('qy_01') 以啟用特定邏輯。
 */
$(document).ready(function () {
    console.log("TMS_PL_TIME.js loaded.");

    // 嘗試從頁面的隱藏欄位或 Model 傳入的標記取得 ToolId
    var autoToolId = $('#toolIdInput').val() || '';

    // 如果找不到隱藏欄位，也可以檢查全域變數（由 View 先行定義）
    if (!autoToolId && window.CURRENT_TOOL_ID) {
        autoToolId = window.CURRENT_TOOL_ID;
    }

    if (autoToolId) {
        TMS_Query.init(autoToolId);
    } else {
        // 如果都抓不到，執行不帶 ID 的初始化（走預設邏輯）
        TMS_Query.init('');
    }
});

//# sourceURL=TMS_PL_TIME.js