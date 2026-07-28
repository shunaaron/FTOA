$(document).ready(function () {
    // 1. 初始化 Select2
    if ($.fn.select2) {
        $('.select2').select2({
            theme: 'bootstrap4',
            width: '100%',
            dropdownCssClass: "big-font-dropdown"
        });
    }

    // 2. 啟動資料載入
    TMS_WEBTL_QY_CB();

    // 3. 初始化日期預設值
    initDefaultDates();

    // 4. 監聽下拉選單
    $(document).on('change', '#qry_perdata', function () {
        var x_ct = $(this).find(':selected').data('ct');
        if (x_ct == "1" || x_ct == 1) {
            $('#dateRangeGroup').stop().slideDown();
        } else {
            $('#dateRangeGroup').stop().slideUp();
        }
    });

    // 5. 確定按鈕點擊事件
    $(document).on('click', '#btnConfirm', function () {
        var $selected = $('#qry_perdata option:selected');
        var val = $('#qry_perdata').val();

        if (!val || val === "") {
            alert('請先選擇轉換項目');
            return;
        }

        var xUserNo = $selected.data('userno');
        var xMsgRaw = $selected.data('msg');
        var xCt = $selected.data('ct');

        var finalPayload;
        try {
            finalPayload = (typeof xMsgRaw === 'object') ? xMsgRaw : JSON.parse(xMsgRaw || "{}");
        } catch (e) {
            console.error("JSON 解析失敗:", e);
            finalPayload = {};
        }

        var sDate = $('#dateS').val().replace(/-/g, '');
        var eDate = $('#dateE').val().replace(/-/g, '');
        var inWhere = "";
        if (xCt == "1" || xCt == 1) {
            if (xUserNo === "P02") {
                inWhere = " and work_date >= '" + sDate + "' and work_date <= '" + eDate + "'";
            }
        }

        finalPayload.IN_WHERE = inWhere;
        finalPayload.DT1 = sDate;
        finalPayload.DT2 = eDate;

        if (!confirm("確定要執行「" + $selected.text() + "」嗎？")) return;

        // --- 記錄開始時間 ---
        var startTime = new Date();
        $('#startTime').text(formatTime(startTime)); // 呼叫 formatTime
        $('#endTime').text("執行中...");
        $('#duration').text("-");
        $('#resultInfo').slideDown();
        $('#dataLoadingOverlay').fadeIn();

        $.ajax({
            url: '/Basic/UpdateData',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(finalPayload),
            success: function (res) {
                // --- 記錄結束時間與計算耗時 ---
                var endTime = new Date();
                var diff = (endTime.getTime() - startTime.getTime()) / 1000;

                $('#endTime').text(formatTime(endTime)); // 呼叫 formatTime
                $('#duration').text(diff.toFixed(2) + " 秒");

                $('#dataLoadingOverlay').fadeOut();
                if (res.R_RCT >= 0) {
                    alert('執行成功！' + (res.R_MSG || ""));
                } else {
                    alert('執行失敗：' + res.R_MSG);
                }
            },
            error: function (xhr) {
                $('#dataLoadingOverlay').fadeOut();
                $('#endTime').text("連線異常");
                alert('系統連線異常，請檢查網路或登入狀態');
            }
        });
    });
});

/** 
 * 下列是輔助函數，請確保它們都在檔案中 
 */

// 格式化時間為 HH:mm:ss
function formatTime(date) {
    var h = date.getHours().toString().padStart(2, '0');
    var m = date.getMinutes().toString().padStart(2, '0');
    var s = date.getSeconds().toString().padStart(2, '0');
    return h + ":" + m + ":" + s;
}

// 載入下拉選單
function TMS_WEBTL_QY_CB() {
    loadDropdownData('qry_perdata', 'GET_DS_X_TABLE', " and x_id_no ='PERWEBTRAN' and table_type = 1", 'sw_name', 'x_userno');
}

function loadDropdownData(elementId, sqlId, inWhere, textField, valueField) {
    var $select = $('#' + elementId);
    if ($select.length === 0) return;
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
                $select.append('<option value="">-- 請選擇轉換項目 --</option>');
                $.each(data, function (index, item) {
                    var text = item[textField] || item["SW_NAME"] || "";
                    var val = item[valueField] || item["X_USERNO"] || "";
                    var xCt = item["x_ct"] || item["X_CT"] || 0;
                    var xMsg = item["x_load_msg"] || item["X_LOAD_MSG"] || "{}";
                    var xUserNo = item["x_userno"] || item["X_USERNO"] || "";
                    var $opt = $('<option></option>').val(val).text(text).attr('data-ct', xCt).attr('data-msg', xMsg).attr('data-userno', xUserNo);
                    $select.append($opt);
                });
            }
        },
        error: function () { $select.empty().append('<option value="">載入失敗</option>'); },
        complete: function () { $select.prop('disabled', false).trigger('change'); }
    });
}

function initDefaultDates() {
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();
    var dEnd = new Date(year, month, 25);
    var dStart = new Date(year, month - 1, 26);
    $('#dateS').val(formatDate(dStart));
    $('#dateE').val(formatDate(dEnd));
}

function formatDate(date) {
    var d = new Date(date), m = '' + (d.getMonth() + 1), day = '' + d.getDate(), y = d.getFullYear();
    if (m.length < 2) m = '0' + m;
    if (day.length < 2) day = '0' + day;
    return [y, m, day].join('-');
}