/* BasicConroller.cs */

using FTOA.Models;
using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using System.Text;
using System.Net.Http;
using System.Linq;
using System.Text.Json.Serialization;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using System;
using Microsoft.AspNetCore.Mvc.ViewEngines;
using System.Data;
using ClosedXML.Excel; // ★ 務必引用此命名空間
using System.Text.RegularExpressions; // 用於去除 HTML
using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Configuration;


namespace FTOA.Controllers
{
    [SessionCheck]
    public class BasicController : Controller
    {
        private readonly ILogger<BasicController> _logger;
        private readonly IHttpClientFactory _clientFactory;
        private readonly ICompositeViewEngine _viewEngine;
        private readonly string _baseMdUrl;
        private readonly string _TestUrl;

        public BasicController(ILogger<BasicController> logger, IHttpClientFactory clientFactory, ICompositeViewEngine viewEngine, IConfiguration configuration)
        {
            _logger = logger;
            _clientFactory = clientFactory;
            _viewEngine = viewEngine;
            // 檢查 1：隨便讀一個頂層的值，看有沒有抓到 appsettings
            var version = configuration["ApplicationInfo:Version"];

            // 檢查 2：直接抓取網址
            _baseMdUrl = configuration["ApiSettings:FTAPI"];
            _TestUrl = configuration["ApiSettings:TESTAPI"];

            if (string.IsNullOrEmpty(_baseMdUrl))
            {
                // 如果進到這裡，代表 configuration 找不到對應的 Key
                _logger.LogError("無法從 appsettings.json 讀取 FTAPI 設定！");
            }
        }


        // 統計物件 (用於 QY03 暫存)
        private class Qy03StatItem
        {
            public string DlDate { get; set; }
            public string StationId { get; set; }
            public string StationName { get; set; }
            public string IdNo { get; set; }
            public string PeoName { get; set; }
            public int SumGetCt { get; set; }
            public decimal SumGetMo { get; set; }
            public int SumRlGetCt { get; set; }
            public decimal SumRlGetMo { get; set; }
        }

        // ================= Grid 設定與相關類別 =================

        public enum ColumnType
        {
            Text = 0,
            Integer = 1,
            Decimal = 2,
            Date = 3,
            Time = 4,
            DateTime = 5,
            Dropdown = 6,
            Button = 7,
            Memo = 8,
            SearchableDropdown = 9,
            DateString = 10
        }

        public class GridColumnDef
        {
            public string Field { get; set; }
            public string Title { get; set; }
            public string Align { get; set; }
            public ColumnType Type { get; set; }
            public int Width { get; set; }
            public bool Editable { get; set; }
            public string Hint { get; set; }
            public string CbJs { get; set; }
            public int NdVl { get; set; }
            public int BTHINT { get; set; }
            public int ISIUD { get; set; }
            public string IUDFD { get; set; }

            // ★★★ 新增查詢相關屬性 ★★★
            public int IsQy { get; set; } // 是否啟用查詢
            public string QyFd { get; set; } // 查詢欄位名稱 (若空則用 Field)
            public string QyXt { get; set; } // 查詢條件類型 (0:=, 1:Like, 2:區間)
            public int IsPk { get; set; } // 新增此行
            public int FdSw { get; set; }
            // ★★★ 修改建構函式，加入新參數 ★★★
            public GridColumnDef(string f, string t, ColumnType type, int width, bool editable, string hint, string cbJs, int ndVl, int btHint, int isQy, string qyFd, string qyXt, int isIUD, string IUDFd, int isPk,int fdissw)
            {
                Field = f; Title = t; Type = type; Width = width; Editable = editable; Hint = hint;
                CbJs = cbJs;  NdVl = ndVl;  BTHINT = btHint;

                // 新增賦值
                IsQy = isQy;
                QyFd = string.IsNullOrEmpty(qyFd) ? f : qyFd; // 如果未設定查詢欄位名，預設使用原欄位名
                QyXt = qyXt;
                ISIUD = isIUD;
                IUDFD = IUDFd;
                IsPk = isPk;
                FdSw = fdissw;
                if (type == ColumnType.Integer || type == ColumnType.Decimal) Align = "right";
                else if (type == ColumnType.Date || type == ColumnType.Time || type == ColumnType.DateTime || type == ColumnType.Button || type == ColumnType.Text) Align = "center";
                else Align = "left";
            }
        }

        public class GridSettingDto
        {
            [JsonPropertyName("gd_no")] public string GD_NO { get; set; }
            [JsonPropertyName("fd_name")] public string FD_NAME { get; set; }
            [JsonPropertyName("sw_name")] public string SW_NAME { get; set; }
            //FD_TY 欄位類型
            //0:文字Edit單行輸入,1:整數,2:單精數,3:日期(yyyy/MM/dd)
            //4:時間(HH:mm),5:日期時間(yyyy/MM/dd HH:mm:ss),6:下拉功能
            //7:Button,8:使用多行輸入,9下拉可輸入,10日期字串(yyyyMMdd)元件是日期,但存儲時要用成yyyyMMdda
            [JsonPropertyName("fd_ty")] public string FD_TY { get; set; }
            [JsonPropertyName("fd_size")] public string FD_SIZE { get; set; }
            [JsonPropertyName("fd_seq")] public string FD_SEQ { get; set; }
            [JsonPropertyName("can_edit")] public string CAN_EDIT { get; set; }
            //是否為PK值
            [JsonPropertyName("is_pk")] public string is_pk { get; set; }
            //是否要輸入資料
            [JsonPropertyName("nd_vl")] public string nd_vl { get; set; }
            //當欄位是下拉時使用其設定內容,其為JSON格式
            //{"SQL_ID":"GET_DS_X_TABLE","IN_WHERE":"","sw_name":"fd_name","sa_fd":"sa_name"}
            //SQL_ID為要呼叫API的編號,IN_WHERE為其條件,可能是空值或沒有
            //sa_name為API取得資料後,其要顯示於下拉的欄位名稱
            //sa_fd為API取得資料後,之後要回存的欄位內容
            //回傳內容為{"R_RCT":1,"R_MSG":"","ROWLIST":[{"...."}]}
            //R_RCT>=1表示有取得到資料
            [JsonPropertyName("cb_js")] public string cb_js { get; set; }
            [JsonPropertyName("fd_hint")] public string fd_hint { get; set; }
            [JsonPropertyName("bt_hint")] public string bt_hint { get; set; }
            //0不啟用查詢條件,1啟用
            [JsonPropertyName("is_qy")] public string is_qy { get; set; }
            //查詢時要轉換的欄名,如果是空白用fd_name
            [JsonPropertyName("qy_fd")] public string qy_fd { get; set; }
            //格式時yyyy/MM/dd轉成yyyyMMdd;yyyy/MM/dd HH:mm:ss轉成yyyyMMddHHmmss,HH:mm轉成HHmm
            //0使用=,1使用LIKE,2區期,例如時間時要用>=和<=要生成2個
            //當是2時為時間,自動生成2個查詢的區期第一個用>=第二個用<=

            [JsonPropertyName("qy_xt")] public string qy_xt { get; set; }
            //是否為新增修改刪除等使用欄位0否1是
            [JsonPropertyName("is_iud")] public string is_iud { get; set; }
            //新增修改刪除時,實際欄位名,空白的話使用fd_name
            [JsonPropertyName("iud_fd")] public string iud_fd { get; set; }
            [JsonPropertyName("fd_sw")] public string fd_sw { get; set; }//1顯示,0不顯示,也不會匯出內容,只是用來設置查詢條件用
        }

        public class ScratchSpot
        {
            public int Id { get; set; }
            public string PrizeName { get; set; }
            public string Type { get; set; } // grand, general, none
        }
        public class GridApiResultModel
        {
            public int R_RCT { get; set; }
            public string R_MSG { get; set; }
            [JsonPropertyName("ROW_LIST")] public List<GridSettingDto> ROW_LIST { get; set; }
            [JsonPropertyName("ROWLIST")] public List<GridSettingDto> ROWLIST_ALT { get; set; }
            public List<GridSettingDto> GetRows() => ROW_LIST ?? ROWLIST_ALT ?? new List<GridSettingDto>();
        }

        public class QybaseViewModel
        {
            public string CurrentToolId { get; set; }
            public string GridConfigsJson { get; set; }
            public string ToolJsJson { get; set; }
            public string SearchResultJson { get; set; }
        }

        public class ToolJsConfig
        {
            public string SQL_ID { get; set; }//查詢使用
            public string UP_ID { get; set; }//更新,新增便用
            public string QYNA { get; set; }//要使用的查詢設置網頁名
            public int CAN_ED { get; set; } = 0;//設定GRID是否開啟可EDIT,1時在看欄位設定
            public int SW_CK { get; set; } = 1;//是否顯示勾選按鈕
            public int SW_STA { get; set; } = 1;//是否顯示統計Foot
            public int GD_TL { get; set; } = 0;//0頁籤模式,1主從模式
            public int QY_ND { get; set; } = 0;//0不用有查詢條件,1必要有查詢條件
            public int SN_IG { get; set; } = 0;//0不用顯示顯像掃碼按鈕,1要顯示
            public int IM_BT { get; set; } = 0;//0不用顯示匯入按鈕,1要顯示
            public int ON_ED { get; set; } = 0;//0不動作.1只使用修改模式
            public List<GdnaItem> GDNA_LT { get; set; }
            [JsonPropertyName("UPX")]
            public List<UPXItem> UPX { get; set; }
        }
        public class UPXItem
        {
            [JsonPropertyName("UP_ID")]
            public string UP_ID { get; set; }
        }

        public class GdnaItem
        {

            public string GDNA { get; set; }

            public string GDSNA { get; set; }

            public string SQL_ID { get; set; }

            // ★ 關鍵：補上這個屬性，並同時支援大小寫對應
            [JsonPropertyName("qyna")]
            public string QYNA { get; set; }
        }
        public class ToolApiResultModel 
        { 
            public int R_RCT { get; set; } 
            public List<AC_Meun> ROWLIST { get; set; } 
        }

        public class AC_Meun
        {
            public string tool_id { get; set; }
            public string tool_name { get; set; }
            public string tool_js { get; set; }
            public string tool_no { get; set; }
            public string tool_seq { get; set; }
            public string tool_ty { get; set; }
            public string tool_lv { get; set; }
            public string tool_open { get; set; }
            public string tool_icon { get; set; }
            public string tool_url { get; set; }
            public string do_ok { get; set; }
        }

        public class ApiResultModel
        {
            public int R_RCT { get; set; }
            public string R_MSG { get; set; }
            public List<Dictionary<string, object>> ROWLIST { get; set; }
        }

        public class MenuItem
        {
            public string Id { get; set; }
            public string Title { get; set; }
            public string Icon { get; set; }
            public string Url { get; set; }
            public int Seq { get; set; }
            public int OpenMode { get; set; }
            public List<SubMenuItem> SubItems { get; set; } = new List<SubMenuItem>();
        }
        public class SubMenuItem
        {
            public string Id { get; set; }
            public string Title { get; set; }
            public string Url { get; set; }
            public int Seq { get; set; }
            public int OpenMode { get; set; }
            public string ToolJs { get; set; }
            public string Icon { get; set; } // ★ 新增這一行

        }
        public class VenderRule
        {
            public string VdTy { get; set; }
            public string CusId { get; set; }
            public string StTime { get; set; }
            public string EndTime { get; set; }
        }
        // 統計物件 (用於暫存累加數據)
        private class StatItem
        {
            public string Id { get; set; }
            public string Name { get; set; }
            public string Date { get; set; }
            public int AllCount { get; set; }
            public int AllAmount { get; set; }
            public int DoCount { get; set; }
            public int DoAmount { get; set; }
            public int TimeCount { get; set; }
            public int TimeAmount { get; set; }
        }


 

        [HttpGet]
        [Route("Basic/Qybase/{toolId?}")]
        public async Task<IActionResult> Qybase(string toolId)
            => await ProcessToolRequest("Qybase", toolId);

        // 核心邏輯提取
        private async Task<IActionResult> ProcessToolRequest(string viewName, string toolId)
        {
            // 1. 驗證 toolId
            if (string.IsNullOrEmpty(toolId)) return RedirectToAction("Nopage");
            // 2. 獲取 Tool 資料
            var toolMenu = GetToolFromSession(toolId);
            if (toolMenu == null) return RedirectToAction("Nopage");
            // 3. 驗證 URL 權限 (改用傳入的 viewName 做檢查)
            if (string.IsNullOrWhiteSpace(toolMenu.tool_url) ||
                toolMenu.tool_url == "#" ||
                !toolMenu.tool_url.Contains(viewName, StringComparison.OrdinalIgnoreCase))
            {
                return RedirectToAction("Nopage");
            }
            // 4. 解析 JS 配置
            if (string.IsNullOrWhiteSpace(toolMenu.tool_js)) return RedirectToAction("Nojspage");
            ToolJsConfig toolConfigObj;
            try
            {
                toolConfigObj = JsonSerializer.Deserialize<ToolJsConfig>(toolMenu.tool_js,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            }
            catch
            {
                // ★★★ 修改重點：當 JSON 格式錯誤 (例如放了教學文字) 時的容錯處理 ★★★

                // 不要跳轉到錯誤頁面 (Nojspage)，而是給予一個「預設配置」
                // 這樣即使 JSON 是錯的，程式也能繼續執行，並嘗試載入 Grid

                _logger.LogWarning($"ToolId: {toolId} 的 tool_js 格式非標準 JSON，啟用容錯模式。");

                toolConfigObj = new ToolJsConfig
                {
                    // 嘗試使用 toolId 作為預設的 SQL_ID 和 Grid 編號
                    // 這樣如果您的 Grid 編號剛好跟 Tool ID 一樣，畫面就能正常顯示
                    SQL_ID = toolId,
                    QYNA = toolId,
                    SW_CK = 1,
                    CAN_ED = 1, // 預設開啟編輯，讓您能進去把 JSON 改對
                    GDNA_LT = new List<GdnaItem>
        {
            new GdnaItem { GDNA = toolId, GDSNA = "預設資料區" }
        }
                };
            }
            if (toolConfigObj == null) return RedirectToAction("Nojspage");
            // 5. 獲取 Grid 配置
            var gridConfigs = await GetGridConfigsFromApi(toolConfigObj);
            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = null };
            // 6. 封裝 Model
            var model = new QybaseViewModel
            {
                CurrentToolId = toolId,
                GridConfigsJson = JsonSerializer.Serialize(gridConfigs, jsonOptions),
                ToolJsJson = JsonSerializer.Serialize(toolConfigObj, jsonOptions),
                SearchResultJson = "{}",
            };
            ViewBag.GridConfigsJson = model.GridConfigsJson;
            ViewBag.ToolJsJson = model.ToolJsJson;
            ViewBag.SearchResultJson = model.SearchResultJson;
            // 7. 動態回傳對應的 View 檔案
            return View(viewName, model);
        }

        [HttpPost]
        [Route("Basic/Search/{toolId}")]
        public async Task<IActionResult> Search(string toolId, string currentGdna)
        {
            var toolMenu = GetToolFromSession(toolId);
            if (toolMenu == null) return RedirectToAction("Nopage");

            var toolConfig = ParseToolJs(toolMenu.tool_js);
            if (toolConfig == null) return RedirectToAction("Nojspage");

            string targetGdna = !string.IsNullOrEmpty(currentGdna) ? currentGdna : (toolConfig.GDNA_LT != null && toolConfig.GDNA_LT.Count > 0 ? toolConfig.GDNA_LT[0].GDNA : "");

            // 注意：Search Action 通常是頁面刷新重載，這裡暫時只處理基本邏輯
            // 若 Search 也需要 QY_01 邏輯，建議前端統一走 AJAX (GetGridData)
            string inWhere = "";
            var apiData = await QueryApiData(toolConfig.SQL_ID, inWhere);

            var searchResult = new Dictionary<string, object>();
            if (!string.IsNullOrEmpty(targetGdna)) searchResult.Add(targetGdna, apiData);

            var gridConfigs = await GetGridConfigsFromApi(toolConfig);
            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = null };
            var model = new QybaseViewModel
            {
                CurrentToolId = toolId,
                ToolJsJson = JsonSerializer.Serialize(toolConfig, jsonOptions),
                GridConfigsJson = JsonSerializer.Serialize(gridConfigs, jsonOptions),
                SearchResultJson = JsonSerializer.Serialize(searchResult, jsonOptions),
            };

            ViewBag.GridConfigsJson = model.GridConfigsJson;
            ViewBag.ToolJsJson = model.ToolJsJson;
            ViewBag.SearchResultJson = model.SearchResultJson;
            ViewBag.CurrentGdna = targetGdna;

            return View("Qybase", model);
        }

        [HttpPost]
        [Route("Basic/GetDropdownData")]
        public async Task<IActionResult> GetDropdownData([FromBody] Dictionary<string, string> request)
        {
            try
            {
                string sqlId = request.ContainsKey("SQL_ID") ? request["SQL_ID"] : "";
                string lgId = HttpContext.Session.GetString("id_no") ?? "GUEST";
                string inWhere = request.ContainsKey("IN_WHERE") ? request["IN_WHERE"] : "";
                var apiPayload = new { SQL_ID = sqlId, LG_ID = lgId, IN_WHERE = inWhere };
                var client = _clientFactory.CreateClient();
                var jsonContent = new StringContent(JsonSerializer.Serialize(apiPayload), Encoding.UTF8, "application/json");
                var response = await client.PostAsync(_baseMdUrl, jsonContent);

                if (response.IsSuccessStatusCode) return Content(await response.Content.ReadAsStringAsync(), "application/json");
                return BadRequest("API 呼叫失敗");
            }
            catch (Exception ex) { _logger.LogError(ex, "GetDropdownData Error"); return StatusCode(500, "Error"); }
        }
        // =============================================================
        // ★★★ 修改後的 GetGridData：整合 QY_01 處理邏輯 ★★★
        // =============================================================
        [HttpPost]
        [Route("Basic/GetGridData/{toolId}")]
        public async Task<IActionResult> GetGridData(string toolId, string gdna)
        {
            // 1. 基礎檢核
            var toolMenu = GetToolFromSession(toolId);
            if (toolMenu == null) return Json(new { success = false, message = "無權限" });

            var toolConfig = ParseToolJs(toolMenu.tool_js);
            if (toolConfig == null) return Json(new { success = false, message = "設定錯誤" });

            // 2. 讀取前端 Form Data
            string inWhere = "";
            try
            {
                var form = await Request.ReadFormAsync();
                var sb = new StringBuilder();
                if (form.ContainsKey("cust_conditions") && !string.IsNullOrEmpty(form["cust_conditions"]))
                {
                    string customSql = form["cust_conditions"].ToString();
                    sb.Append(customSql.TrimStart().StartsWith("AND", StringComparison.OrdinalIgnoreCase) ? " " + customSql : " AND " + customSql);
                }
                else
                {
                    foreach (var key in form.Keys)
                    {
                        if (key != "currentGdna" && key != "cust_conditions" && key != "sort" && key != "page" && key != "pageSize" && key != "__RequestVerificationToken" && !string.IsNullOrEmpty(form[key]))
                        {
                            string val = form[key].ToString().Replace("'", "''");
                            sb.Append($" AND {key} = '{val}'");
                        }
                    }
                }
                inWhere = sb.ToString();
            }
            catch (Exception ex) { _logger.LogError(ex, "讀取 Form Data 失敗"); }

            // ... (保留 QY_01, QY_03 的特殊邏輯區塊) ...

            string cleanId = (toolId ?? "").Trim();

            // (略過 QY_01, QY_03 判斷...)
            if (cleanId.Equals("qy_01", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    // A. 取得原始資料
                    // 注意：這裡使用 toolConfig.SQL_ID (應該是 ARE_TB2 或類似的)
                    var rawData2 = await QueryApiData(toolConfig.SQL_ID, inWhere);

                    // B. 取得原廠設定
                    // 修正：如果 TMS_VD_RULE 查不到，給予空 List 避免當掉
                    List<Dictionary<string, object>> ruleData = new List<Dictionary<string, object>>();
                    try
                    {
                        ruleData = await QueryApiData("TMS_VD_RULE", "");
                    }
                    catch
                    {
                        // 若查無規則表，忽略錯誤，視為無規則
                        _logger.LogWarning("查無 TMS_VD_RULE，將使用預設規則");
                    }

                    var venderSettings = ParseVenderRules(ruleData);

                    // C. 執行邏輯處理 (您原本的統計邏輯)
                    var processedResult = ProcessQy01Logic(rawData2, venderSettings);

                    // D. 回傳 (前端會收到包含 3 個 Table 的物件)
                    return Json(new { success = true, data = processedResult });
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "QY01 處理失敗");
                    // 錯誤時回傳明確訊息
                    return Json(new { success = false, message = "資料處理發生錯誤: " + ex.Message });
                }
            }
            else if (cleanId.Equals("qy_03", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    var rawData3 = await QueryApiData(toolConfig.SQL_ID, inWhere);
                    // 執行 QY03 統計邏輯
                    var processedResult = ProcessQy03Logic(rawData3);
                    return Json(new { success = true, data = processedResult });
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "QY03 處理失敗");
                    return Json(new { success = false, message = "統計處理發生錯誤: " + ex.Message });
                }
            }
            // ========================================================
            // ★★★ 一般工具處理 (GD_TL=1 主從模式邏輯) ★★★
            // ========================================================

            var rawData = await QueryApiData(toolConfig.SQL_ID, inWhere);

            // 如果是主從模式 (GD_TL == 1) 且有設定 Grid
            // ★ 新增區塊：主從模式 (GD_TL == 1) 且有設定 Grid
            if (toolConfig.GD_TL == 1 && toolConfig.GDNA_LT != null && toolConfig.GDNA_LT.Count > 0)
            {
                // 1. 取得 Grid 設定 (為了辨識哪些欄位是 PK)
                var gridConfigs = await GetGridConfigsFromApi(toolConfig);
                var resultMap = new Dictionary<string, object>();

                // 2. 處理主檔 (第一個 Grid) - 進行去重複
                var masterGdna = toolConfig.GDNA_LT[0].GDNA;
                List<GridColumnDef> masterCols = gridConfigs.ContainsKey(masterGdna) ? gridConfigs[masterGdna] : new List<GridColumnDef>();

                // 找出 PK 欄位名稱
                var pkFields = masterCols.Where(c => c.IsPk == 1).Select(c => c.Field).ToList();

                List<Dictionary<string, object>> masterList;

                if (pkFields.Count > 0)
                {
                    // 使用 GroupBy 針對 PK 欄位去重複
                    masterList = rawData.GroupBy(row =>
                    {
                        var keyBuilder = new StringBuilder();
                        foreach (var field in pkFields)
                        {
                            string val = GetStr(row, field);
                            keyBuilder.Append(val + "||");
                        }
                        return keyBuilder.ToString();
                    })
                    .Select(g => {
                        // ★ 核心修正：建立新字典，並存入該群組的總筆數
                        var item = new Dictionary<string, object>(g.First());

                        // 取得該群組包含的筆數
                        int detailCount = g.Count();

                        // 存入筆數欄位 (建議大小寫都放，增加相容性)
                        item["xseq_ct"] = detailCount;
                        item["XSEQ_CT"] = detailCount;

                        return item;
                    })
                    .ToList();
                }
                else
                {
                    // 若未設定 PK，預設顯示全部 (或視需求只取第一筆)
                    masterList = rawData;
                }

                // 重編主檔 seq_no
                int mSeq = 1;
                masterList.ForEach(r => r["seq_no"] = mSeq++);
                resultMap.Add(masterGdna, masterList);
                // 3. 處理明細檔 (第二個以後的 Grid)
                var masterPkFields = masterCols.Where(c => c.IsPk == 1).Select(c => c.Field).ToList();
                // 3. 處理明細檔 (第二個以後的 Grid) - 保留全量資料供前端篩選
                for (int i = 1; i < toolConfig.GDNA_LT.Count; i++)
                {
                    var detailGdna = toolConfig.GDNA_LT[i].GDNA;
                    var detailCols = gridConfigs.ContainsKey(detailGdna) ? gridConfigs[detailGdna] : new List<GridColumnDef>();

                    // 找出明細設定中的所有 PK
                    var detailPkFields = detailCols.Where(c => c.IsPk == 1).Select(c => c.Field).ToList();

                    // ★ 關鍵修正：找出「只屬於明細」的 PK (排除掉跟主檔關連的單號/編號)
                    // 例如：流水號、序號等
                    var subDetailPks = detailPkFields.Where(f => !masterPkFields.Contains(f)).ToList();

                    // 如果沒有專屬 PK，就用全部 PK
                    var checkPks = subDetailPks.Count > 0 ? subDetailPks : detailPkFields;

                    var detailList = rawData
                        .Where(r => {
                            if (checkPks.Count == 0) return true;

                            // ★ 核心邏輯：檢查 Dictionary 裡面的原始值是否為 NULL 或空
                            // 只要明細專屬的 PK 是空的，表示這筆是 LEFT JOIN 出來的 Ghost Row，直接濾掉
                            return checkPks.Any(pk => {
                                if (!r.ContainsKey(pk) || r[pk] == null || r[pk] == DBNull.Value) return false;
                                return !string.IsNullOrEmpty(r[pk].ToString());
                            });
                        })
                        .Select(r => new Dictionary<string, object>(r))
                        .ToList();

                    int dSeq = 1;
                    detailList.ForEach(r => r["seq_no"] = dSeq++);
                    resultMap.Add(detailGdna, detailList);
                }

                return Json(new { success = true, data = resultMap });
            }

            // ========================================================
            // 原有的單頁模式 (GD_TL=0)
            // ========================================================
            int generalSeq = 1;
            foreach (var row in rawData)
            {
                row["seq_no"] = generalSeq++;
            }
            return Json(new { success = true, data = rawData, gdna = gdna });
        }


        // ==========================================
        // ★★★ QY01 核心邏輯實作 ★★★
        // ==========================================

        // 1. 解析原廠規則
        private Dictionary<string, List<VenderRule>> ParseVenderRules(List<Dictionary<string, object>> ruleData)
        {
            var result = new Dictionary<string, List<VenderRule>>();

            // 加入防呆檢核
            if (ruleData == null || ruleData.Count == 0) return result;

            foreach (var row in ruleData)
            {
                string vId = GetStr(row, "vender_id");

                // 如果沒有 vender_id 則跳過
                if (string.IsNullOrWhiteSpace(vId)) continue;

                var rule = new VenderRule
                {
                    VdTy = GetStr(row, "vd_ty"),
                    CusId = GetStr(row, "cus_id"),
                    StTime = GetStr(row, "st_time"),
                    EndTime = GetStr(row, "end_time")
                };

                if (!result.ContainsKey(vId)) result[vId] = new List<VenderRule>();
                result[vId].Add(rule);
            }
            return result;
        }

        // 2. 主處理邏輯：原始資料 -> 3個整理過的 Table
        private Dictionary<string, object> ProcessQy01Logic(List<Dictionary<string, object>> rawData, Dictionary<string, List<VenderRule>> venderSettings)
        {
            // --- 準備回傳結構 ---
            var resultLists = new Dictionary<string, List<Dictionary<string, object>>>();
            var listDetail = new List<Dictionary<string, object>>(); // TMS_TIME_LIST

            // --- 統計暫存容器 ---
            var stationStats = new Dictionary<string, StatItem>(); // Key: StationId_Date
            var venderStats = new Dictionary<string, StatItem>();  // Key: VenderId_Date
            int seqCounter = 1;

            // 定義異常代碼 (放在迴圈外避免重複宣告)
            string[] errorCodes = { "13", "19", "20", "29", "63", "64", "88" };

            // --- 第一遍迴圈：遍歷原始資料，生成明細並累加統計 ---
            foreach (var row in rawData)
            {
                // 1. 取值
                string stationId = GetStr(row, "station_id");
                string stationName = GetStr(row, "station_name");
                string venderId = GetStr(row, "vender_id");
                string venderName = GetStr(row, "vender_name");
                string dlDate = GetStr(row, "dl_date");
                string txTy = GetStr(row, "TX_TY");
                string barTime = GetStr(row, "bar_time");
                string tmsErty = GetStr(row, "tms_erty");
                string dlId = GetStr(row, "dl_id");

                int dlCt = GetIntVal(row, "dl_ct");
                int coldCt = GetIntVal(row, "cold_ct");
                int controlCt = GetIntVal(row, "control_ct");
                int allAmount = dlCt + coldCt + controlCt; // 應配件數

                int rlDlCt = GetIntVal(row, "rl_dl_ct");
                int rlColdCt = GetIntVal(row, "rl_cold_ct");
                int rlControlCt = GetIntVal(row, "rl_control_ct");
                int doAmount = rlDlCt + rlColdCt + rlControlCt; // 實配件數

                // ==========================================================
                // ★★★ 修正邏輯：實配數量補正 ★★★
                // ==========================================================

                // 判斷是否有刷件 (長度大於等於12表示有完整時間格式)
                bool hasScan = !string.IsNullOrWhiteSpace(barTime) && barTime.Length >= 12;

                // 判斷是否無異常 (異常代碼不在列表中)
                bool noError = Array.IndexOf(errorCodes, tmsErty) < 0;

                // 如果資料庫實配數量為 0，但有應配數量，且有刷件時間並無異常 -> 視為全數配達
                // 這解決了司機直接按確認但系統未寫入 rl_ 欄位導致配達率 0% 的問題
                if (doAmount == 0 && allAmount > 0 && hasScan && noError)
                {
                    doAmount = allAmount;
                }
                // ==========================================================


                // 2. 準時判斷
                bool isOnTime = false;
                string onTimeHtml = "<span style='color:red; font-weight:bold;'>否</span>";

                // 邏輯: 有異常 或 無刷件時間 -> 不準時
                if (!noError || !hasScan)
                {
                    isOnTime = false;
                }
                else
                {
                    string barTimeHHMM = barTime.Substring(8, 4);
                    bool timeCheck = false;

                    if (venderSettings.ContainsKey(venderId))
                    {
                        var rules = venderSettings[venderId];
                        var r1 = rules.FirstOrDefault(r => r.VdTy == "1" && r.CusId == dlId);
                        var r2 = rules.FirstOrDefault(r => r.VdTy == "2");
                        var r0 = rules.FirstOrDefault(r => r.VdTy == "0");

                        if (r1 != null) timeCheck = IsTimeInRange(barTimeHHMM, r1.StTime, r1.EndTime);
                        else if (r2 != null) timeCheck = IsTimeInRange(barTimeHHMM, r2.StTime, r2.EndTime);
                        else if (r0 != null)
                        {
                            string cutoff = string.IsNullOrWhiteSpace(r0.StTime) ? "1800" : r0.StTime;
                            timeCheck = string.Compare(barTimeHHMM, cutoff) <= 0;
                        }
                        else timeCheck = string.Compare(barTimeHHMM, "1800") <= 0;
                    }
                    else
                    {
                        // 無規則預設 18:00
                        timeCheck = string.Compare(barTimeHHMM, "1800") <= 0;
                    }

                    if (timeCheck)
                    {
                        isOnTime = true;
                        onTimeHtml = "<span style='color:green; font-weight:bold;'>是</span>";
                    }
                }

                // 3. 建立明細列 (TMS_TIME_LIST)
                var detailRow = new Dictionary<string, object>(row); // 複製原始欄位
                detailRow["seq_no"] = seqCounter++;
                detailRow["is_time"] = onTimeHtml; // 覆寫或新增 is_time
                detailRow["TX_TY"] = txTy == "A" ? "配送" : (txTy == "B" ? "取貨" : txTy);

                // 格式化刷件時間
                if (hasScan)
                    detailRow["bar_time"] = $"{barTime.Substring(0, 4)}/{barTime.Substring(4, 2)}/{barTime.Substring(6, 2)} {barTime.Substring(8, 2)}:{barTime.Substring(10, 2)}";

                // 如果我們有補正過實配數量，也要更新明細顯示，以免明細看到0但統計是對的
                if (doAmount > (rlDlCt + rlColdCt + rlControlCt))
                {
                    // 這裡可以選擇是否要反寫回明細的 rl_ 欄位，或者只影響統計
                    // 若要讓明細顯示一致，可以反推回 rl_dl_ct (假設全部補在常溫)
                    // detailRow["rl_dl_ct"] = doAmount; 
                }

                listDetail.Add(detailRow);

                // 4. 累加統計數據 (Station)
                string sKey = $"{stationId}_{dlDate}";
                if (!stationStats.ContainsKey(sKey)) stationStats[sKey] = new StatItem { Id = stationId, Name = stationName, Date = dlDate };
                var sS = stationStats[sKey];

                sS.AllCount++;          // 應配筆數 +1
                sS.AllAmount += allAmount; // 應配件數

                if (doAmount > 0)
                {
                    sS.DoCount++;       // 實配筆數 +1 (原本因為0沒加到，現在會加到了)
                    sS.DoAmount += doAmount;
                }

                if (isOnTime)
                {
                    sS.TimeCount++;     // 準時取筆數 +1
                    sS.TimeAmount += doAmount; // 準時取件數
                }

                // 5. 累加統計數據 (Vender)
                string vKey = $"{venderId}_{dlDate}";
                if (!venderStats.ContainsKey(vKey)) venderStats[vKey] = new StatItem { Id = venderId, Name = venderName, Date = dlDate };
                var vS = venderStats[vKey];

                vS.AllCount++;
                vS.AllAmount += allAmount;

                if (doAmount > 0)
                {
                    vS.DoCount++;
                    vS.DoAmount += doAmount;
                }

                if (isOnTime)
                {
                    vS.TimeCount++;
                    vS.TimeAmount += doAmount;
                }
            }

            // --- 第二階段：將統計資料轉換為 List，計算百分比並排名 ---

            // A. Station 列表製作 (TMS_TIME_GD)
            // 先依準時率排序
            var sortedStation = stationStats.Values.Select(x => new {
                Data = x,
                Rate = x.DoAmount == 0 ? 0 : (double)x.TimeAmount / x.DoAmount * 100
            }).OrderByDescending(x => x.Rate).ToList();

            var listStation = new List<Dictionary<string, object>>();
            // 排名邏輯變數初始化
            int currentRank = 1;
            double lastRate = -1;

            // 改用 for 迴圈以便利用索引 i 計算排名跳號 (1, 1, 1, 4...)
            for (int i = 0; i < sortedStation.Count; i++)
            {
                var item = sortedStation[i];
                var s = item.Data;

                // ★★★ 排名核心邏輯 ★★★
                // 如果是第一筆，或者跟上一筆的準時率不同 (使用 Epsilon 處理浮點數誤差)
                if (i == 0 || Math.Abs(item.Rate - lastRate) > 0.0001)
                {
                    currentRank = i + 1; // 排名 = 索引 + 1 (例如第4個元素，索引3，排名變成4)
                }
                // 如果相同，currentRank 維持不變 (同分同名)

                lastRate = item.Rate; // 更新上一筆分數

                double doPro = s.AllAmount == 0 ? 0 : (double)s.DoAmount / s.AllAmount * 100;

                var dr = new Dictionary<string, object>();
                dr["gd_no"] = "TMS_TIME_GD";
                dr["da_seq"] = currentRank; // ★ 使用計算後的排名
                dr["station_id"] = s.Id;
                dr["station_name"] = s.Name;
                dr["dl_date"] = s.Date;
                dr["all_count"] = s.AllCount;
                dr["all_amount"] = s.AllAmount;
                dr["do_count"] = s.DoCount;
                dr["do_amount"] = s.DoAmount;
                dr["time_count"] = s.TimeCount;
                dr["time_amount"] = s.TimeAmount;
                dr["time_pro"] = GetColorPercentageHtml(item.Rate);
                dr["do_pro"] = GetColorPercentageHtml(doPro);
                listStation.Add(dr);
            }

            // ==========================================================
            // ★★★ 修改 B. Vender 列表製作 (TMS_TIME_VD) ★★★
            // ==========================================================
            var sortedVender = venderStats.Values.Select(x => new {
                Data = x,
                Rate = x.DoAmount == 0 ? 0 : (double)x.TimeAmount / x.DoAmount * 100
            }).OrderByDescending(x => x.Rate).ToList();

            var listVender = new List<Dictionary<string, object>>();

            // 重置排名變數
            currentRank = 1;
            lastRate = -1;

            for (int i = 0; i < sortedVender.Count; i++)
            {
                var item = sortedVender[i];
                var v = item.Data;

                // ★★★ 排名核心邏輯 (同上) ★★★
                if (i == 0 || Math.Abs(item.Rate - lastRate) > 0.0001)
                {
                    currentRank = i + 1;
                }

                lastRate = item.Rate;

                double doPro = v.AllAmount == 0 ? 0 : (double)v.DoAmount / v.AllAmount * 100;

                var dr = new Dictionary<string, object>();
                dr["gd_no"] = "TMS_TIME_VD";
                dr["da_seq"] = currentRank; // ★ 使用計算後的排名
                dr["vender_id"] = v.Id;
                dr["vender_name"] = v.Name;
                dr["dl_date"] = v.Date;
                dr["all_count"] = v.AllCount;
                dr["all_amount"] = v.AllAmount;
                dr["do_count"] = v.DoCount;
                dr["do_amount"] = v.DoAmount;
                dr["time_count"] = v.TimeCount;
                dr["time_amount"] = v.TimeAmount;
                dr["time_pro"] = GetColorPercentageHtml(item.Rate);
                dr["do_pro"] = GetColorPercentageHtml(doPro);
                listVender.Add(dr);
            }

            // --- 最終打包 (保持不變) ---
            var finalResult = new Dictionary<string, object>();
            finalResult["TMS_TIME_GD"] = listStation;
            finalResult["TMS_TIME_VD"] = listVender;
            finalResult["TMS_TIME_LIST"] = listDetail;

            return finalResult;
        }

        // 輔助：取值
        private string GetStr(Dictionary<string, object> row, string key)
        {
            if (row.ContainsKey(key) && row[key] != null) return row[key].ToString();
            // 容錯: 嘗試全大寫或全小寫
            if (row.ContainsKey(key.ToUpper()) && row[key.ToUpper()] != null) return row[key.ToUpper()].ToString();
            if (row.ContainsKey(key.ToLower()) && row[key.ToLower()] != null) return row[key.ToLower()].ToString();
            return "";
        }
        private int GetIntVal(Dictionary<string, object> row, string key)
        {
            string s = GetStr(row, key);
            int.TryParse(s, out int v);
            return v;
        }

        // 輔助：時間判斷
        private bool IsTimeInRange(string current, string start, string end)
        {
            if (string.IsNullOrEmpty(current)) return false;
            bool afterStart = string.IsNullOrEmpty(start) || string.Compare(current, start) >= 0;
            bool beforeEnd = string.IsNullOrEmpty(end) || string.Compare(current, end) <= 0;
            return afterStart && beforeEnd;
        }


        [HttpPost]
        public async Task<JsonResult> ImportData(string id, IFormFile importFile)
        {
            // 1. 基本檢核 (保留 ID 判斷，但改為更彈性的方式)
            if (string.IsNullOrEmpty(id)) return Json(new { success = false, message = "功能代號缺失" });
            if (importFile == null || importFile.Length == 0) return Json(new { success = false, message = "請選擇檔案" });

            try
            {
                var toolMenu = GetToolFromSession(id);
                var toolConfig = ParseToolJs(toolMenu.tool_js);
                var allConfigs = await GetGridConfigsFromApi(toolConfig);

                string targetKey = allConfigs.Keys.FirstOrDefault(k => k.Equals(id, StringComparison.OrdinalIgnoreCase))
                                   ?? toolConfig.GDNA_LT?.FirstOrDefault()?.GDNA;

                if (targetKey == null) return Json(new { success = false, message = "找不到對應的 Grid 設定" });

                var activeCols = allConfigs[targetKey].Where(c => c.FdSw != 0 && c.Field.ToLower() != "seq_no").ToList();

                // --- 預載下拉選單資料庫 (用於驗證資料是否存在) ---
                var dropdownCache = new Dictionary<string, HashSet<string>>(); // Key: FieldName, Value: 有效的 ID 集合
                foreach (var col in activeCols.Where(c => c.Type == ColumnType.Dropdown || c.Type == ColumnType.SearchableDropdown))
                {
                    // 解析 cb_js 取得 SQL_ID
                    string sqlId = "", inWhere = "", valField = "";
                    try
                    {
                        using var jd = JsonDocument.Parse(col.CbJs);
                        sqlId = jd.RootElement.TryGetProperty("SQL_ID", out var s) ? s.GetString() : col.Hint;
                        inWhere = jd.RootElement.TryGetProperty("IN_WHERE", out var w) ? w.GetString() : "";
                        valField = jd.RootElement.TryGetProperty("sa_fd", out var f) ? f.GetString() : "";
                    }
                    catch { sqlId = col.Hint; }

                    if (!string.IsNullOrEmpty(sqlId))
                    {
                        var options = await QueryApiData(sqlId, inWhere);
                        var validIds = options.Select(o => GetStr(o, valField).Trim()).Where(v => v != "").ToHashSet();
                        dropdownCache[col.Field] = validIds;
                    }
                }

                var dataList = new List<Dictionary<string, object>>();
                bool hasGlobalError = false;

                using (var workbook = new XLWorkbook(importFile.OpenReadStream()))
                {
                    var worksheet = workbook.Worksheet(1);
                    var rows = worksheet.RangeUsed().RowsUsed().Skip(1);

                    foreach (var row in rows)
                    {
                        var dataRow = new Dictionary<string, object>();
                        bool rowHasError = false;
                        List<string> errorMsgs = new List<string>();

                        for (int i = 0; i < activeCols.Count; i++)
                        {
                            var colDef = activeCols[i];
                            var cell = row.Cell(i + 1);
                            string val = (cell.DataType == XLDataType.Number) ? cell.GetDouble().ToString("F0") : cell.GetValue<string>()?.Trim() ?? "";

                            // --- 驗證邏輯 ---
                            // A. PK 或 必填檢查
                            if ((colDef.IsPk == 1 || colDef.NdVl == 1) && string.IsNullOrEmpty(val))
                            {
                                rowHasError = true;
                                errorMsgs.Add($"[{colDef.Title}] 為必填(PK)");
                            }
                            // B. 數字格式檢查
                            if ((colDef.Type == ColumnType.Integer || colDef.Type == ColumnType.Decimal) && !string.IsNullOrEmpty(val))
                            {
                                if (!double.TryParse(val, out _))
                                {
                                    rowHasError = true;
                                    errorMsgs.Add($"[{colDef.Title}] 格式須為數字");
                                }
                            }
                            // C. 下拉選單存在性檢查
                            if (dropdownCache.ContainsKey(colDef.Field) && !string.IsNullOrEmpty(val))
                            {
                                if (!dropdownCache[colDef.Field].Contains(val))
                                {
                                    rowHasError = true;
                                    errorMsgs.Add($"[{colDef.Title}] 代碼 {val} 不存在於系統中");
                                }
                            }

                            dataRow[colDef.Field] = val;
                        }

                        if (rowHasError)
                        {
                            dataRow["_hasError"] = true;
                            dataRow["_errorMsg"] = string.Join(", ", errorMsgs);
                            hasGlobalError = true;
                        }
                        dataList.Add(dataRow);
                    }
                }

                // --- 如果有任何一行錯誤，就不執行資料庫存檔，直接把結果傳回前端顯示 ---
                if (hasGlobalError)
                {
                    return Json(new
                    {
                        success = false,
                        message = "匯入資料包含錯誤，請修正紅色標記行後再試",
                        data = dataList // 包含錯誤標記的資料
                    });
                }

                // --- 若無錯誤，執行 API 存檔 ---
                string upId = toolConfig?.UP_ID ?? $"UP_{id}";
                var apiPayload = new { SQL_ID = upId, IUD = 0, LG_ID = HttpContext.Session.GetString("id_no"), ROWLIST = dataList };
                var client = _clientFactory.CreateClient();
                var response = await client.PostAsync(_baseMdUrl, new StringContent(JsonSerializer.Serialize(apiPayload), Encoding.UTF8, "application/json"));

                if (response.IsSuccessStatusCode)
                    return Json(new { success = true, message = $"成功匯入 {dataList.Count} 筆資料", data = dataList });

                return Json(new { success = false, message = "API 儲存失敗" });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = "解析失敗：" + ex.Message });
            }
        }

        // 輔助：百分比上色 (HTML)
        private string GetColorPercentageHtml(double val)
        {
            string color = "LightPink"; // < 60%
            if (val == 100) color = "LightGreen";
            else if (val >= 90) color = "LightSkyBlue";
            else if (val >= 60) color = "Yellow";

            // 在前端顯示為帶背景色的區塊，保留小數點後兩位
            return $"<div style='background-color:{color}; width:100%; padding:2px; border-radius:4px; text-align:center;'>{val:F2}%</div>";
        }

        // ==========================================
        // 原有 Export 邏輯 (修正版)
        // ==========================================
        [HttpPost]
        [Route("Basic/Export/{toolId}")]
        // ★★★ 修正 1：加入 ValueLengthLimit = int.MaxValue 解除單一欄位 4MB 限制，避免多頁勾選時報錯 ★★★
        [RequestFormLimits(ValueCountLimit = 10000, ValueLengthLimit = int.MaxValue, MultipartBodyLengthLimit = 104857600)]
        [DisableRequestSizeLimit]
        public async Task<IActionResult> Export(string toolId, string selectedDataJson)
        {
            // 1. 基礎權限與設定檢查
            string cleanId = (toolId ?? "").Trim();

            // 優先檢查 Session，若為空代表 Request 太大或逾時導致 Session 遺失
            var userToolsJson = HttpContext.Session.GetString("UserTools");
            if (string.IsNullOrEmpty(userToolsJson))
            {
                _logger.LogWarning($"Export 失敗：Session 遺失。ToolId: {cleanId}");
                return Content("權限驗證逾時或請求資料過大，請縮小篩選範圍或重新登入。");
            }

            var toolMenu = GetToolFromSession(cleanId);
            if (toolMenu == null) return Content("無權限或找不到該功能。");

            var toolConfig = ParseToolJs(toolMenu.tool_js);
            if (toolConfig == null) return Content("功能設定檔解析失敗。");

            Dictionary<string, List<Dictionary<string, object>>> exportDataMap = new Dictionary<string, List<Dictionary<string, object>>>();

            // 2. 準備資料
            // 判斷是否使用前端傳來的「勾選資料」
            bool useSelectedJson = !string.IsNullOrEmpty(selectedDataJson) && selectedDataJson != "{}" && selectedDataJson != "[]";

            if (useSelectedJson)
            {
                try
                {
                    exportDataMap = JsonSerializer.Deserialize<Dictionary<string, List<Dictionary<string, object>>>>(selectedDataJson);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "解析匯出 JSON 失敗，切換全量模式");
                    useSelectedJson = false; // 解析失敗則強制走全量模式
                }
            }

            // 如果沒有勾選資料，或是資料解析失敗，則執行全量查詢
            if (!useSelectedJson)
            {
                // --- 重新讀取 Form 條件 ---
                var sb = new StringBuilder();
                try
                {
                    var form = await Request.ReadFormAsync();
                    if (form.ContainsKey("cust_conditions") && !string.IsNullOrEmpty(form["cust_conditions"]))
                    {
                        string customSql = form["cust_conditions"].ToString();
                        sb.Append(customSql.TrimStart().StartsWith("AND", StringComparison.OrdinalIgnoreCase) ? " " + customSql : " AND " + customSql);
                    }
                    else
                    {
                        // 過濾掉非資料庫欄位的 Key
                        var excludeKeys = new[] { "currentGdna", "cust_conditions", "sort", "page", "pageSize", "__RequestVerificationToken", "selectedDataJson", "downloadToken" };
                        foreach (var key in form.Keys)
                        {
                            if (!excludeKeys.Contains(key) && !string.IsNullOrEmpty(form[key]))
                            {
                                string val = form[key].ToString().Replace("'", "''");
                                sb.Append($" AND {key} = '{val}'");
                            }
                        }
                    }
                }
                catch (Exception ex) { _logger.LogError(ex, "Export 讀取 Form 失敗"); }

                string inWhere = sb.ToString();
                var rawData = await QueryApiData(toolConfig.SQL_ID, inWhere);

                // --- 根據工具 ID 處理資料邏輯 ---
                if (cleanId.Equals("qy_01", StringComparison.OrdinalIgnoreCase))
                {
                    // QY_01 特殊統計邏輯
                    List<Dictionary<string, object>> ruleData = new List<Dictionary<string, object>>();
                    try { ruleData = await QueryApiData("TMS_VD_RULE", ""); } catch { }
                    var venderSettings = ParseVenderRules(ruleData);
                    var processed = ProcessQy01Logic(rawData, venderSettings);

                    foreach (var key in processed.Keys)
                    {
                        if (processed[key] is List<Dictionary<string, object>> listData)
                            exportDataMap[key] = listData;
                    }
                }
                else if (cleanId.Equals("qy_03", StringComparison.OrdinalIgnoreCase))
                {
                    var processed = ProcessQy03Logic(rawData);
                    foreach (var key in processed.Keys)
                    {
                        if (processed[key] is List<Dictionary<string, object>> listData)
                            exportDataMap[key] = listData;
                    }
                }
                else
                {
                    // 一般工具 (包含 qy_02 或其他)
                    string targetGdna = (toolConfig.GDNA_LT != null && toolConfig.GDNA_LT.Count > 0) ? toolConfig.GDNA_LT[0].GDNA : "RESULT";
                    exportDataMap[targetGdna] = rawData;
                }
            }

            // 3. ★ 統一重編序號 (seq_no) ★
            foreach (var gdna in exportDataMap.Keys)
            {
                var list = exportDataMap[gdna];
                if (list == null) continue;
                int seq = 1;
                foreach (var row in list)
                {
                    row["seq_no"] = seq++;
                }
            }

            // 4. 取得 Grid 設定並產生 Excel
            var gridConfigs = await GetGridConfigsFromApi(toolConfig);

            using (var workbook = new XLWorkbook())
            {
                bool hasAnySheet = false;
                var orderedGdnas = toolConfig.GDNA_LT?.Select(x => x.GDNA).ToList() ?? new List<string>();
                //   foreach (var gdna in exportDataMap.Keys)
                foreach (var gdna in orderedGdnas)
                {
                    // 使用 TryGetValue 同時檢查 Key 是否存在並取出資料，避免重複定義變數
                    // 這行會自動宣告一個 dataList 變數，如果找不到 Key 或資料為空則跳過
                    if (!exportDataMap.TryGetValue(gdna, out var dataList) || dataList == null || dataList.Count == 0)
                        continue;

                    hasAnySheet = true;

                    var sheetName = toolConfig.GDNA_LT?.FirstOrDefault(x => x.GDNA == gdna)?.GDSNA ?? gdna;
                    sheetName = Regex.Replace(sheetName, @"[\\/?*\[\]]", "_");
                    if (sheetName.Length > 30) sheetName = sheetName.Substring(0, 30);

                    var worksheet = workbook.Worksheets.Add(sheetName);
                    var columns = gridConfigs.ContainsKey(gdna) ? gridConfigs[gdna] : new List<GridColumnDef>();

                    // 若無設定則從 Data 取 Header
                    if (columns.Count == 0 && dataList.Count > 0)
                    {
                        foreach (var key in dataList[0].Keys)
                            columns.Add(new GridColumnDef(key, key, ColumnType.Text, 100, false, "", "", 0, 0, 0, "", "", 0, "", 0,1));
                    }

                    // 寫入表頭
                    for (int i = 0; i < columns.Count; i++)
                    {
                        worksheet.Cell(1, i + 1).Value = columns[i].Title;
                        worksheet.Cell(1, i + 1).Style.Font.Bold = true;
                        worksheet.Cell(1, i + 1).Style.Fill.BackgroundColor = XLColor.LightGray;
                    }

                    // 寫入資料
                    for (int r = 0; r < dataList.Count; r++)
                    {
                        var rowData = dataList[r];
                        for (int c = 0; c < columns.Count; c++)
                        {
                            var cell = worksheet.Cell(r + 2, c + 1); // 取得當前儲存格
                            string field = columns[c].Field;
                            ColumnType colType = columns[c].Type;

                            // 取得字串值
                            string val = GetStr(rowData, field);

                            // 清理 HTML 標籤 (例如有上色的百分比)
                            if (!string.IsNullOrEmpty(val) && (val.Contains("<") || val.Contains(">")))
                            {
                                val = Regex.Replace(val, "<.*?>", string.Empty);
                            }

                            // 如果值為空，則保持預設 (空白)
                            if (string.IsNullOrWhiteSpace(val))
                            {
                                cell.Value = "";
                                continue;
                            }

                            // ★★★ 修正 2：依據欄位型態設定格式 ★★★
                            switch (colType)
                            {
                                case ColumnType.Integer: // Type 1: 整數
                                    // 嘗試移除千分位符號後轉型
                                    if (long.TryParse(val.Replace(",", ""), out long intVal))
                                    {
                                        cell.Value = intVal;
                                        cell.Style.NumberFormat.Format = "#,##0"; // Excel 格式：整數帶千分位
                                    }
                                    else
                                    {
                                        cell.Value = val;
                                    }
                                    break;

                                case ColumnType.Decimal: // Type 2: 小數
                                    if (double.TryParse(val.Replace(",", ""), out double dVal))
                                    {
                                        cell.Value = dVal;
                                        cell.Style.NumberFormat.Format = "#,##0.00"; // Excel 格式：兩位小數帶千分位
                                    }
                                    else
                                    {
                                        cell.Value = val;
                                    }
                                    break;

                                case ColumnType.Date: // Type 3: 日期
                                    if (DateTime.TryParse(val, out DateTime dtVal))
                                    {
                                        cell.Value = dtVal;
                                        cell.Style.NumberFormat.Format = "yyyy/MM/dd"; // Excel 格式：日期
                                    }
                                    else
                                    {
                                        cell.Value = val;
                                    }
                                    break;

                                case ColumnType.DateTime: // Type 5: 日期時間
                                    if (DateTime.TryParse(val, out DateTime dttVal))
                                    {
                                        cell.Value = dttVal;
                                        cell.Style.NumberFormat.Format = "yyyy/MM/dd HH:mm:ss"; // Excel 格式：日期時間
                                    }
                                    else
                                    {
                                        cell.Value = val;
                                    }
                                    break;

                                case ColumnType.Time: // Type 4: 時間
                                    cell.Value = val;
                                    // ★★★ 修正 3：新版 ClosedXML DataType 唯讀，改用 NumberFormat 設定文字格式 ★★★
                                    cell.Style.NumberFormat.Format = "@";
                                    break;

                                default: // Type 0 (Text), 6 (Dropdown), 8 (Memo) 等
                                    // 強制設為文字，避免 Excel 自動把 "00123" 轉成 "123"
                                    cell.Value = val;
                                    // ★★★ 修正 3：同上，改用 NumberFormat 設定文字格式 ★★★
                                    cell.Style.NumberFormat.Format = "@";
                                    break;
                            }
                        }
                    }
                    // ★★★ 新增：統計列邏輯 (SW_STA == 1) ★★★
                    if (toolConfig.SW_STA == 1)
                    {
                        int lastDataRow = dataList.Count + 1; // 資料最後一列
                        int totalRowIdx = dataList.Count + 2; // 統計列所在位置
                        var totalRow = worksheet.Row(totalRowIdx);

                        // 1. 樣式設定 (模擬網頁上的粉紅色背景)
                        totalRow.Style.Font.Bold = true;
                        totalRow.Style.Fill.BackgroundColor = XLColor.FromHtml("#fff0f6"); // 淺粉色
                        totalRow.Style.Border.TopBorder = XLBorderStyleValues.Thin;
                        totalRow.Style.Border.TopBorderColor = XLColor.FromHtml("#eb2f96"); // 深粉邊框

                        for (int c = 0; c < columns.Count; c++)
                        {
                            var cell = worksheet.Cell(totalRowIdx, c + 1);
                            string field = columns[c].Field;
                            ColumnType colType = columns[c].Type;

                            if (c == 0)
                            {
                                // 第一個欄位顯示：總計 : N 筆
                                cell.Value = $"總計 : {dataList.Count} 筆";
                            }
                            else if (colType == ColumnType.Integer || colType == ColumnType.Decimal)
                            {
                                // 針對數值欄位計算總和
                                double totalSum = 0;
                                foreach (var row in dataList)
                                {
                                    totalSum += (double)GetDecVal(row, field);
                                }

                                cell.Value = totalSum;

                                // 設定格式
                                if (colType == ColumnType.Integer)
                                    cell.Style.NumberFormat.Format = "#,##0";
                                else
                                    cell.Style.NumberFormat.Format = "#,##0.00";
                            }
                        }
                    }
                    worksheet.Columns().AdjustToContents(); // 自動調整欄寬
                }

                if (!hasAnySheet) workbook.Worksheets.Add("無資料");

                using (var stream = new MemoryStream())
                {
                    workbook.SaveAs(stream);
                    var content = stream.ToArray();
                    string toolName = Regex.Replace(toolMenu.tool_name ?? cleanId, @"[\\/:*?""<>|]", "_");
                    string fileName = $"{toolName}_{DateTime.Now:yyMMddHHmmss}.xlsx";

                    // 設定 Cookie 讓前端計時器停止
                    try
                    {
                        string token = Request.Form["downloadToken"];
                        if (!string.IsNullOrEmpty(token))
                            Response.Cookies.Append("downloadToken", token, new CookieOptions { HttpOnly = false, SameSite = SameSiteMode.Lax, Expires = DateTime.Now.AddMinutes(1) });
                    }
                    catch { }

                    return File(content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName);
                }
            }
        }
        // ================= Private Helper Methods (原封不動) =================
        private async Task<Dictionary<string, List<GridColumnDef>>> GetGridConfigsFromApi(ToolJsConfig toolConfig)
        {
            var resultConfigs = new Dictionary<string, List<GridColumnDef>>();
            if (toolConfig == null || toolConfig.GDNA_LT == null || toolConfig.GDNA_LT.Count == 0) return resultConfigs;

            try
            {
                var gdnaList = toolConfig.GDNA_LT.Select(x => x.GDNA).Where(x => !string.IsNullOrEmpty(x)).ToList();
                if (gdnaList.Count == 0) return resultConfigs;

                string gdNoListStr = string.Join("','", gdnaList);
                string gdNoWhere = $" and gd_no in ('{gdNoListStr}')";
                string inWhere = $" and sys_id = 'FTWEB' and table_type = '1' {gdNoWhere}";
                string lgId = HttpContext.Session.GetString("id_no") ?? "GUEST";

                var apiPayload = new { SQL_ID = "DSMG_WEBGD_SET", LG_ID = lgId, IN_WHERE = inWhere };
                var client = _clientFactory.CreateClient();
                var jsonContent = new StringContent(JsonSerializer.Serialize(apiPayload), Encoding.UTF8, "application/json");
                var response = await client.PostAsync(_baseMdUrl, jsonContent);

                if (response.IsSuccessStatusCode)
                {
                    var resultString = await response.Content.ReadAsStringAsync();
                    var apiResult = JsonSerializer.Deserialize<GridApiResultModel>(resultString, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

                    if (apiResult != null && apiResult.R_RCT > 0)
                    {
                        var rows = apiResult.GetRows();
                        var groupedRows = rows.GroupBy(x => x.GD_NO).ToDictionary(g => g.Key, g => g.OrderBy(x => { int.TryParse(x.FD_SEQ, out int seq); return seq; }).ToList());

                        foreach (var group in groupedRows)
                        {
                            var gdNo = group.Key;
                            var colDefs = new List<GridColumnDef>();
                            foreach (var row in group.Value)
                            {
                                int.TryParse(row.FD_TY, out int typeInt);
                                int.TryParse(row.FD_SIZE, out int sizeInt);
                                int.TryParse(row.CAN_EDIT, out int canEditInt);
                                int.TryParse(row.nd_vl, out int ndVlInt);
                                int.TryParse(row.bt_hint, out int btHintInt);
                                int.TryParse(row.is_iud, out int tt_iud);
                                int.TryParse(row.is_pk, out int tt_pk);
                                int.TryParse(row.fd_sw, out int fdSwInt);
                                // ★★★ 新增：解析查詢設定 ★★★
                                int.TryParse(row.is_qy, out int isQyInt); // 解析 is_qy
                                string qyFdStr = row.qy_fd ?? "";
                                string qyXtStr = row.qy_xt ?? "0";

                                string cbJsStr = row.cb_js ?? "";
                                string ttiudFD = row.iud_fd ?? "";
                                if (ttiudFD == "") { ttiudFD = row.FD_NAME; }

                                ColumnType colType = Enum.IsDefined(typeof(ColumnType), typeInt) ? (ColumnType)typeInt : ColumnType.Text;
                                bool isEditable = (toolConfig.CAN_ED == 1 && canEditInt == 1);

                                // ★★★ 修改：傳入新參數 ★★★
                                colDefs.Add(new GridColumnDef(row.FD_NAME, row.SW_NAME, colType, sizeInt, isEditable, row.fd_hint, cbJsStr, ndVlInt, btHintInt, isQyInt, qyFdStr, qyXtStr, tt_iud, ttiudFD, tt_pk, fdSwInt));
                            }
                            resultConfigs.Add(gdNo, colDefs);
                        }
                    }
                }
            }
            catch (Exception ex) { _logger.LogError(ex, "取得 Grid Config API 發生例外錯誤"); }
            return resultConfigs;
        }

        private AC_Meun GetToolFromSession(string toolId)
        {
            var userToolsJson = HttpContext.Session.GetString("UserTools");
            if (string.IsNullOrEmpty(userToolsJson)) return null;
            try
            {
                var toolResult = JsonSerializer.Deserialize<ToolApiResultModel>(userToolsJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                return toolResult?.ROWLIST?.FirstOrDefault(t => string.Equals(t.tool_id, toolId, StringComparison.OrdinalIgnoreCase));
            }
            catch { return null; }
        }

        private ToolJsConfig ParseToolJs(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            try { return JsonSerializer.Deserialize<ToolJsConfig>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }); }
            catch { return null; }
        }

        private async Task<List<Dictionary<string, object>>> QueryApiData(string sqlId, string inWhere)
        {
            try
            {
                string lgId = HttpContext.Session.GetString("id_no") ?? "GUEST";
                var payload = new { SQL_ID = sqlId, IN_WHERE = inWhere, LG_ID = lgId };
                var client = _clientFactory.CreateClient();
                var jsonContent = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                var response = await client.PostAsync(_baseMdUrl, jsonContent);

                if (response.IsSuccessStatusCode)
                {
                    var resultString = await response.Content.ReadAsStringAsync();
                    var apiResult = JsonSerializer.Deserialize<ApiResultModel>(resultString, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    return apiResult?.ROWLIST ?? new List<Dictionary<string, object>>();
                }
                _logger.LogWarning($"API 呼叫失敗: {response.StatusCode}");
                return new List<Dictionary<string, object>>();
            }
            catch (Exception ex) { _logger.LogError(ex, "QueryApiData 發生錯誤"); return new List<Dictionary<string, object>>(); }
        }

        public async Task<IActionResult> Tool()
        {
            var userId = HttpContext.Session.GetString("id_no");
            if (string.IsNullOrEmpty(userId)) return RedirectToAction("Index", "Home");

            List<MenuItem> menuItems = new List<MenuItem>();
            try
            {
                var userToolsJson = HttpContext.Session.GetString("UserTools");
                if (!string.IsNullOrEmpty(userToolsJson))
                {
                    var toolResult = JsonSerializer.Deserialize<ToolApiResultModel>(userToolsJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (toolResult?.ROWLIST != null)
                    {
                        var userPowerLv = HttpContext.Session.GetString("power_lv") ?? "0";
                        var userPowerTy = HttpContext.Session.GetString("power_ty") ?? "";
                        menuItems = BuildMenuTree(toolResult.ROWLIST, userPowerLv, userPowerTy);
                    }
                }
            }
            catch (Exception ex) { _logger.LogError(ex, "載入選單錯誤"); }

            // 公告邏輯
            string announcement = "";
            try
            {
                string nowStr = DateTime.Now.ToString("yyyy/MM/dd HH:mm:ss");
                string inWhereClause = $" and sys_id = 'FTWEB' and table_type = '1' and start_time <= '{nowStr}' and end_time >= '{nowStr}'";
                var apiPayload = new { SQL_ID = "FTOAANNMSG", IN_WHERE = inWhereClause };
                var client = _clientFactory.CreateClient();
                var jsonContent = new StringContent(JsonSerializer.Serialize(apiPayload), Encoding.UTF8, "application/json");
                var response = await client.PostAsync("https://dss.fengtien.com.tw:9786/api/BASE_MD/", jsonContent);

                if (response.IsSuccessStatusCode)
                {
                    var resultString = await response.Content.ReadAsStringAsync();
                    using (JsonDocument doc = JsonDocument.Parse(resultString))
                    {
                        var root = doc.RootElement;
                        JsonElement rct;
                        bool hasRct = root.TryGetProperty("R_RCT", out rct) || root.TryGetProperty("r_rct", out rct);
                        int rctValue = 0;
                        if (hasRct)
                        {
                            if (rct.ValueKind == JsonValueKind.Number) rct.TryGetInt32(out rctValue);
                            else if (rct.ValueKind == JsonValueKind.String) int.TryParse(rct.GetString(), out rctValue);
                        }
                        if (rctValue > 0)
                        {
                            JsonElement rowList;
                            if ((root.TryGetProperty("ROWLIST", out rowList) || root.TryGetProperty("rowlist", out rowList)) && rowList.ValueKind == JsonValueKind.Array)
                            {
                                var msgList = new List<string>();
                                foreach (var row in rowList.EnumerateArray())
                                {
                                    string txt = "";
                                    JsonElement msgEl;
                                    if (row.TryGetProperty("msg_text", out msgEl)) txt = msgEl.GetString();
                                    else if (row.TryGetProperty("MSG_TEXT", out msgEl)) txt = msgEl.GetString();
                                    if (!string.IsNullOrEmpty(txt)) msgList.Add(txt);
                                }
                                if (msgList.Count > 0)
                                {
                                    announcement = msgList.Count == 1 ? msgList[0] : string.Join("   ", msgList.Select((m, i) => $"({i + 1}){m}"));
                                }
                            }
                        }
                    }
                }
            }
            catch (Exception ex) { _logger.LogError(ex, "Tool頁面取得公告失敗"); }

            ViewBag.Announcement = announcement;
            return View(menuItems);
        }

        public IActionResult Nopage() { return View(); }
        public IActionResult Nojspage() { return View(); }
        public IActionResult Scratchcard() { return View(); }

        public IActionResult ScratchManager()
        {
            // 這裡只負責載入頁面，初始設定由前端 JavaScript 從 LocalStorage 讀取或給預設值
            return View();
        }

        [HttpGet]
        public IActionResult Cgpw()
        {
            return View(); // 這會自動去找 Views/Basic/Cgpw.cshtml
        }

        private List<MenuItem> BuildMenuTree(List<AC_Meun> tools, string userPowerLv, string userPowerTy)
        {
            // (略，與原檔相同)
            var menuItems = new List<MenuItem>();
            int.TryParse(userPowerLv, out int uLv);
            // 取得使用者權限清單 (先拆好，避免在迴圈內重複拆分)
            var userRoles = (userPowerTy ?? "").Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                                              .Select(r => r.Trim())
                                              .ToList();
            bool CheckPermission(AC_Meun tool)
            {
                // 1. 超級管理員判斷 (P9 或 -1 不受限)
                if (userPowerTy == "-1" || userPowerTy == "P9") return true;

                // 2. 等級判斷 (Lv)
                int.TryParse(tool.tool_lv, out int tLv);
                if (uLv < tLv) return false;

                // 3. 類型限制判斷 (Ty)
                // 如果功能本身沒有設定 tool_ty 限制，則只要等級夠就能看
                if (string.IsNullOrEmpty(tool.tool_ty)) return true;

                // 如果功能有設 tool_ty，但使用者 power_ty 是空的，則無權限
                if (userRoles.Count == 0) return false;

                // 將功能要求的類型拆開 (處理功能的 tool_ty 也可能是 "W7,P1" 的情況)
                var toolRequiredRoles = tool.tool_ty.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                                                    .Select(r => r.Trim());

                // 核心邏輯：檢查使用者的權限集合與功能要求的集合是否有「交集」
                // 只要使用者拥有的任何一個角色 存在於 功能要求的角色清單中，就回傳 true
                return userRoles.Any(role => toolRequiredRoles.Contains(role, StringComparer.OrdinalIgnoreCase));
            }
            var groups = tools.Where(t => !string.IsNullOrEmpty(t.tool_no)).GroupBy(t => t.tool_no).OrderBy(g => g.Key).ToList();
            foreach (var group in groups)
            {
                var parentData = group.FirstOrDefault(t => t.tool_seq == "0");
                if (parentData == null || !CheckPermission(parentData)) continue;
                int.TryParse(parentData.tool_open, out int parentOpen);
                var menuItem = new MenuItem { Id = parentData.tool_id, Title = parentData.tool_name, Icon = string.IsNullOrEmpty(parentData.tool_icon) ? "fas fa-folder" : parentData.tool_icon, Url = parentData.tool_url, Seq = 0, OpenMode = parentOpen };
                var children = group.Where(t => t.tool_seq != "0").OrderBy(t => int.TryParse(t.tool_seq, out int s) ? s : 999).ToList();
                int childItemIndex = 1;
                foreach (var child in children)
                {
                    if (!CheckPermission(child)) continue;

                    int.TryParse(child.tool_seq, out int childSeq);
                    int.TryParse(child.tool_open, out int childOpen);

                    // --- 圖標邏輯 (略) ---
                    string finalIcon = (child.tool_icon ?? "").Trim();
                    if (string.IsNullOrEmpty(finalIcon))
                    {
                        finalIcon = "fa-solid fa-" + childItemIndex.ToString();
                    }
                    // --- 圖標邏輯結束 ---

                    // ★★★ 修改這裡 (網址處理邏輯) ★★★
                    string finalUrl = child.tool_url;
                    if (!string.IsNullOrEmpty(finalUrl))
                    {
                        // 判斷是否為外部連結 (http 或 https 開頭)
                        if (finalUrl.Trim().StartsWith("http", StringComparison.OrdinalIgnoreCase))
                        {
                            // 如果是外部網址，保持原樣，不要串接 tool_id
                            // finalUrl = finalUrl; 
                        }
                        else
                        {
                            // 如果是內部網址 (例如 /Basic/Ctbase)，才串接 tool_id
                            finalUrl = finalUrl.TrimEnd('/') + "/" + child.tool_id;
                        }
                    }
                    // ★★★ 修改結束 ★★★

                    menuItem.SubItems.Add(new SubMenuItem
                    {
                        Id = child.tool_id,
                        Title = child.tool_name,
                        Url = finalUrl,
                        Seq = childSeq,
                        OpenMode = childOpen,
                        ToolJs = child.tool_js,
                        Icon = finalIcon
                    });
                    childItemIndex++;
                }
                if (menuItem.SubItems.Count > 0) menuItems.Add(menuItem);
            }
            return menuItems;
        }

        [HttpGet]
        [Route("Basic/GetQueryForm/{qyna}")]
        public IActionResult GetQueryForm(string qyna)
        {
            if (string.IsNullOrEmpty(qyna)) return NotFound("未設定 QYNA");
            string viewName = $"~/Views/Qyset/{qyna}.cshtml";
            var result = _viewEngine.GetView(null, viewName, false);
            if (!result.Success) return NotFound($"無找到 ({qyna}) 設定查詢頁面");
            return PartialView(viewName);
        }

        // POST: 處理修改密碼
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Cgpw(ChangePasswordViewModel model)
        {
            if (!ModelState.IsValid) return View(model);

            // 1. 比對 Session 中的舊密碼
            string sessionOldPw = HttpContext.Session.GetString("old_pw") ?? "";
            string keyold_pw = Convert.ToBase64String(Encoding.UTF8.GetBytes(model.OldPassword));
            if (keyold_pw != sessionOldPw)
            {
                ModelState.AddModelError("OldPassword", "目前密碼驗證錯誤。");
                return View(model);
            }

            try
            {
                string userId = HttpContext.Session.GetString("id_no") ?? "";
                string base64Password = Convert.ToBase64String(Encoding.UTF8.GetBytes(model.NewPassword));
                // 2. 構建符合規格的 API Payload
                // 格式：{"SQL_ID":"UPUSERPW","QORS":1,"IUD":2,"LG_ID":"shun","ROWLIST":[{"log_pw":"新密碼"}],"PK_LIST":[{"log_id":"shun"}]}
                var apiPayload = new
                {
                    SQL_ID = "UPUSERPW",
                    QORS = 1,
                    IUD = 1,//IUD = 0 僅新增,1 僅更新,2僅刪除,3新增或更新
                    LG_ID = userId,
                    ROWLIST = new[] { new { log_pw = base64Password } }, // 這裡建議放入加密後的密碼
                    PK_LIST = new[] { new { id_no = userId } }
                };

                var client = _clientFactory.CreateClient();
                var jsonContent = new StringContent(JsonSerializer.Serialize(apiPayload), Encoding.UTF8, "application/json");

                var response = await client.PostAsync(_baseMdUrl, jsonContent);

                if (response.IsSuccessStatusCode)
                {
                    var responseString = await response.Content.ReadAsStringAsync();
                    // 解析回傳內容：{"R_RCT":1, "R_MSG":""}
                    using var doc = JsonDocument.Parse(responseString);
                    int rRct = doc.RootElement.GetProperty("R_RCT").GetInt32();
                    string rMsg = doc.RootElement.TryGetProperty("R_MSG", out var msgElem) ? msgElem.GetString() : "";

                    if (rRct >= 1)
                    {
                        // 更新成功，同步更新 Session
                        HttpContext.Session.SetString("old_pw", model.NewPassword);
                        TempData["SuccessMsg"] = "密碼已成功修改！";
                        //   return RedirectToAction("Index", "Home");
                    }
                    else
                    {
                        ModelState.AddModelError("", $"修改失敗：{rMsg}");
                    }
                }
                else
                {
                    ModelState.AddModelError("", "連線至 API 伺服器失敗。");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Cgpw Error");
                ModelState.AddModelError("", "系統發生預外錯誤，請稍後再試。");
            }

            return View(model);
        }

        [HttpPost]
        [Route("Basic/UpdateData")]
        public async Task<IActionResult> UpdateData([FromBody] JsonElement payload)
        {
            try
            {
                // 1. 取得 Session 中的用戶 ID
                string lgId = HttpContext.Session.GetString("id_no") ?? "SYS";

                // 2. 解析原始 Payload 並轉為 Dictionary 方便操作
                var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
                var payloadDict = JsonSerializer.Deserialize<Dictionary<string, object>>(payload.GetRawText(), options);

                // 3. 注入 LG_ID
                if (payloadDict.ContainsKey("LG_ID")) payloadDict["LG_ID"] = lgId;
                else payloadDict.Add("LG_ID", lgId);

                // 4. 轉發至測試/正式 API (使用 正式:_baseMdUrl,測試:_TestUrl)
                var client = _clientFactory.CreateClient();
                var jsonContent = new StringContent(JsonSerializer.Serialize(payloadDict), Encoding.UTF8, "application/json");

                var response = await client.PostAsync(_baseMdUrl, jsonContent);

                if (response.IsSuccessStatusCode)
                {
                    var resultString = await response.Content.ReadAsStringAsync();
                    return Content(resultString, "application/json");
                }

                return Json(new { R_RCT = -20001, R_MSG = "遠端 API 連線失敗: " + response.StatusCode });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "UpdateData Error");
                return Json(new { R_RCT = -20000, R_MSG = "系統錯誤: " + ex.Message });
            }
        }

        private Dictionary<string, object> ProcessQy03Logic(List<Dictionary<string, object>> rawData)
        {
            var listDetail = new List<Dictionary<string, object>>(); // TMS_GX01
            var statMap = new Dictionary<string, Qy03StatItem>();    // Key: Date_Station_User

            int detailSeq = 1;

            foreach (var row in rawData)
            {
                // 1. 基本資料取值
                string dlDate = GetStr(row, "dl_date");
                string stationId = GetStr(row, "station_id");
                string stNa = GetStr(row, "st_na"); // 欄位名對應 sw_name:站所名稱
                string idNo = GetStr(row, "id_no");
                string peoName = GetStr(row, "peo_name");

                decimal getMoney = GetDecVal(row, "get_money");
                string srTy = GetStr(row, "sr_ty"); // 雖然沒在 grid，但 API 回傳應包含此欄位
                string tmsErty = GetStr(row, "tms_erty");

                // 2. 處理明細序號
                var detailRow = new Dictionary<string, object>(row);
                detailRow["seq_no"] = detailSeq++;
                listDetail.Add(detailRow);

                // 3. 累加統計邏輯
                string key = $"{dlDate}_{stationId}_{idNo}";
                if (!statMap.ContainsKey(key))
                {
                    statMap[key] = new Qy03StatItem
                    {
                        DlDate = dlDate,
                        StationId = stationId,
                        StationName = stNa,
                        IdNo = idNo,
                        PeoName = peoName
                    };
                }
                var s = statMap[key];

                // 條件 A: get_money > 0
                if (getMoney > 0)
                {
                    s.SumGetCt += 1;
                    s.SumGetMo += getMoney;

                    // 條件 B: get_money > 0 AND sr_ty = '60' AND (tms_erty = '' OR '60')
                    if (srTy == "60" && (string.IsNullOrEmpty(tmsErty) || tmsErty == "60"))
                    {
                        s.SumRlGetCt += 1;
                        s.SumRlGetMo += getMoney;
                    }
                }
            }

            // 4. 轉換為 TMS_GX02 列表
            var listSummary = new List<Dictionary<string, object>>();
            int summarySeq = 1;
            foreach (var s in statMap.Values.OrderBy(x => x.DlDate).ThenBy(x => x.StationId))
            {
                var dr = new Dictionary<string, object>();
                dr["seq_no"] = summarySeq++;
                dr["dl_date"] = s.DlDate;
                dr["station_id"] = s.StationId;
                dr["st_na"] = s.StationName;
                dr["id_no"] = s.IdNo;
                dr["peo_name"] = s.PeoName;
                dr["sum_get_ct"] = s.SumGetCt;
                dr["sum_get_mo"] = s.SumGetMo;
                dr["sum_rl_get_ct"] = s.SumRlGetCt;
                dr["sum_rl_get_mo"] = s.SumRlGetMo;
                listSummary.Add(dr);
            }

            return new Dictionary<string, object>
    {
        { "TMS_GX01", listDetail },
        { "TMS_GX02", listSummary }
    };
        }

        // 輔助：取 Decimal 值
        private decimal GetDecVal(Dictionary<string, object> row, string key)
        {
            string s = GetStr(row, key).Replace(",", "");
            if (decimal.TryParse(s, out decimal v)) return v;
            return 0;
        }
    }
}