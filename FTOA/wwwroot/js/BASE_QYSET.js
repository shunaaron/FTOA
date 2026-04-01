/*BASE_QYSET.js - 完整修正版*/
var DynamicQuery = {
    currentGdna: '',

    init: function () {
        this.currentGdna = $('#currentGdnaInput').val() ||
            (window.CURRENT_TOOL_CONFIG && window.CURRENT_TOOL_CONFIG.GDNA_LT && window.CURRENT_TOOL_CONFIG.GDNA_LT[0].GDNA);

        if (!this.currentGdna) {
            $('#dynamicQueryContainer').html('<div class="col-12 text-danger">無法識別 Grid 設定</div>');
            return;
        }

        this.renderForm();

        $('#btnConfirm').off('click').on('click', function () {
            DynamicQuery.submit();
        });
    },

    renderForm: function () {
        var gdna = this.currentGdna;
        var cols = window.GLOBAL_GRID_CONFIGS[gdna];
        var $container = $('#dynamicQueryContainer');

        if (!cols) return;

        var queryCols = cols.filter(function (c) { return c.IsQy === 1; });
        if (queryCols.length === 0) {
            $container.html('<div class="col-12 text-center p-3">此功能未設定查詢條件</div>');
            return;
        }

        // 排序優先級：1.日期時間 2.下拉 3.一般 4.MEMO
        queryCols.sort(function (a, b) {
            function getPriority(col) {
                if (col.Type === 3 || col.Type === 4 || col.Type === 5) return 1;
                if (col.Type === 6) return 2;
                if (col.Type === 0 || col.Type === 8) return 4;
                return 3;
            }
            return getPriority(a) - getPriority(b);
        });

        var html = '';
        queryCols.forEach(function (col) {
            var inputHtml = DynamicQuery.buildInputHtml(col);
            var extraClass = '';
            if (col.QyXt == '2') {
                extraClass = 'is-range';
            } else if (col.Type === 0 || col.Type === 8) {
                extraClass = 'is-memo';
            }

            html += `
            <div class="dynamic-query-col ${extraClass}">
                <label class="query-label" title="${col.Title}">${col.Title}</label>
                ${inputHtml}
            </div>
            `;
        });

        $container.html(html);
        this.loadDropdowns(queryCols); // 呼叫載入下拉
    },

    buildInputHtml: function (col) {
        var fieldId = 'qry_' + col.Field;
        var type = col.Type;
        var now = new Date();
        var today = now.getFullYear() + "-" + ("0" + (now.getMonth() + 1)).slice(-2) + "-" + ("0" + now.getDate()).slice(-2);

        if (col.QyXt == '2') {
            var inputType = (type === 3 || type === 5) ? 'date' : 'text';
            var defaultVal = (inputType === 'date') ? `value="${today}"` : '';
            var pStart = "起", pEnd = "迄", extraAttr = "";

            if (type === 4) {
                pStart = "格式HHmm(起)";
                pEnd = "格式HHmm(迄)";
                extraAttr = 'maxlength="4" oninput="this.value=this.value.replace(/[^0-9]/g,\'\')"';
            }

            return `
            <div class="d-flex align-items-center">
                <input type="${inputType}" class="form-control form-control-sm qry-input" id="${fieldId}_start" data-field="${col.Field}" data-op=">=" placeholder="${pStart}" ${defaultVal} ${extraAttr}>
                <span class="mx-1">~</span>
                <input type="${inputType}" class="form-control form-control-sm qry-input" id="${fieldId}_end" data-field="${col.Field}" data-op="<=" placeholder="${pEnd}" ${defaultVal} ${extraAttr}>
            </div>`;
        }

        if (type === 6) {
            var isMandatory = (window.CURRENT_TOOL_CONFIG && parseInt(window.CURRENT_TOOL_CONFIG.QY_ND) === 1);
            var placeholder = isMandatory ? "(請選擇)" : "(全部)";

            return `<select class="form-control form-control-sm qry-input" id="${fieldId}" data-field="${col.Field}" data-type="6" data-cbjs='${col.CbJs || ""}'>
                        <option value="">${placeholder}</option>
                    </select>`;
        } else if (type === 3 || type === 5) {
            return `<input type="date" class="form-control form-control-sm qry-input" id="${fieldId}" data-field="${col.Field}" value="${today}">`;
        } else if (type === 0 || type === 8) {
            return `<textarea class="form-control form-control-sm qry-input" id="${fieldId}" data-field="${col.Field}" rows="3" placeholder="支援多筆查詢 (換行區隔)"></textarea>`;
        } else {
            var iType = (type === 1 || type === 2) ? 'number' : 'text';
            return `<input type="${iType}" class="form-control form-control-sm qry-input" id="${fieldId}" data-field="${col.Field}">`;
        }
    },

    // ★ 新增：修復 Missing Function 錯誤 ★
    loadDropdowns: function (cols) {
        var self = this;
        cols.forEach(function (col) {
            if (col.Type === 6) {
                var $select = $('#qry_' + col.Field);
                var cbConfig = {};
                try { if (col.CbJs) cbConfig = JSON.parse(col.CbJs); } catch (e) { }

                var sqlId = cbConfig.SQL_ID || col.Hint || "";
                var inWhere = cbConfig.IN_WHERE || "";
                var valField = cbConfig.sa_fd || "";
                var txtField = cbConfig.sw_name || cbConfig.sa_name || "";

                // 讀取 QYC，預設為 0
                var qyc = cbConfig.QYC !== undefined ? parseInt(cbConfig.QYC) : 0;

                if (sqlId === 'AUXDBTMSSTMSG' || sqlId === 'GET_TMS_STATION_MSG') {
                    var userLv = (typeof window.USER_POWER_LV !== 'undefined') ? window.USER_POWER_LV : 0;
                    var userStation = (typeof window.USER_DF_STATION !== 'undefined') ? window.USER_DF_STATION : "";
                    if (userLv < 8 && userStation) inWhere += " AND station_id = '" + userStation + "' ";
                }

                if (sqlId) self.fetchDropdown($select, sqlId, inWhere, txtField, valField, qyc);
            }
        });
    },

    // ★ 修正：整合 QYC 邏輯的單一 fetchDropdown 函數 ★
    fetchDropdown: function ($select, sqlId, inWhere, textField, valueField, qyc) {
        if ($select.data('loaded')) return;
        $select.html('<option value="">載入中...</option>');

        $.ajax({
            url: '/Basic/GetDropdownData',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ SQL_ID: sqlId, IN_WHERE: inWhere }),
            success: function (res) {
                var html = '';
                if (res && res.R_RCT > 0 && res.ROWLIST) {
                    var data = res.ROWLIST;
                    var keys = Object.keys(data[0]);
                    var vKey = valueField || keys.find(k => k.toLowerCase() === 'sa_fd') || keys[0];
                    var tKey = textField || keys.find(k => k.toLowerCase() === 'sw_name') || keys[1] || vKey;

                    var getFormatText = function (item) {
                        var val = item[vKey] || "", name = item[tKey] || "";
                        return (val && name && val != name) ? (val + '-' + name) : (name || val);
                    };

                    var qyNd = (window.CURRENT_TOOL_CONFIG && window.CURRENT_TOOL_CONFIG.QY_ND) ? parseInt(window.CURRENT_TOOL_CONFIG.QY_ND) : 0;
                    var firstText = (qyNd === 1) ? "(請選擇)" : "(全部)";

                    // 建立首項 (HTML index 1)
                    html = `<option value="">${firstText}</option>`;

                    data.forEach((item, index) => {
                        var isSelected = "";

                        // ★ QYC 邏輯處理 ★
                        // QYC = 2 代表選中 data 的第 0 筆 (HTML 的第 2 個 option)
                        if (qyc >= 2) {
                            if (index === (qyc - 2)) {
                                isSelected = "selected";
                            }
                        }
                        // 預設保底：QYC=0 且只有一筆且非必要查詢時自動預選
                        else if (qyc === 0 && data.length === 1 && qyNd !== 1) {
                            isSelected = "selected";
                        }

                        html += `<option value="${item[vKey]}" ${isSelected}>${getFormatText(item)}</option>`;
                    });

                } else {
                    html = '<option value="">無資料</option>';
                }
                $select.html(html).data('loaded', true);
            }
        });
    },

    submit: function () {
        var conditions = [];
        var cols = window.GLOBAL_GRID_CONFIGS[this.currentGdna];
        $('.qry-input').each(function () {
            var $el = $(this), val = $el.val();
            if (!val && val !== 0) return;
            var fieldName = $el.data('field'), colDef = cols.find(c => c.Field === fieldName);
            var dbField = (colDef && colDef.QyFd) ? colDef.QyFd : fieldName, op = $el.data('op') || "=";
            if ((colDef.Type === 0 || colDef.Type === 8) && $el.is('textarea')) {
                var lines = val.split('\n').map(x => x.trim()).filter(x => x !== '');
                if (lines.length > 1) {
                    conditions.push(`(${dbField} IN (${lines.map(x => `'${x.replace(/'/g, "''")}'`).join(",")}))`);
                } else if (lines.length === 1) {
                    val = lines[0];
                    conditions.push(colDef.QyXt == '1' ? `(${dbField} LIKE '%${val.replace(/'/g, "''")}%')` : `(${dbField} = '${val.replace(/'/g, "''")}')`);
                }
            } else if (colDef && colDef.QyXt == '1' && !op.includes('<') && !op.includes('>')) {
                conditions.push(`(${dbField} LIKE '%${val.replace(/'/g, "''")}%')`);
            } else {
                if ($el.attr('type') === 'date') val = val.replace(/-/g, '');
                conditions.push(`(${dbField} ${op} '${val.replace(/'/g, "''")}')`);
            }
        });
        var sqlCondition = conditions.length > 0 ? " AND " + conditions.join(" AND ") : "";
        $('#queryModal').modal('hide');
        if (typeof executeCustomSearch === 'function') executeCustomSearch({}, sqlCondition);
    }
};
$(document).ready(function () { DynamicQuery.init(); });