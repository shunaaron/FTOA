using FTOA.Models;
using Microsoft.AspNetCore.Mvc;
using System.Diagnostics;
using System.Text;                // 用於 Encoding
using System.Text.Json;           // 用於 JsonSerializer
using System.Net.Http;            // 用於 HttpClient
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace FTOA.Controllers
{
    public class HomeController : Controller
    {
        private readonly ILogger<HomeController> _logger;
        // 1. 宣告 HttpClientFactory
        private readonly IHttpClientFactory _clientFactory;
        private readonly string _baseMdUrl;
        private readonly string _TestUrl;

        // 2. 在建構子注入 IHttpClientFactory
        public HomeController(ILogger<HomeController> logger, IHttpClientFactory clientFactory, IConfiguration configuration)
        {
            _logger = logger;
            _clientFactory = clientFactory;
            // 檢查 2：直接抓取網址
            _baseMdUrl = configuration["ApiSettings:FTAPI"];
            _TestUrl = configuration["ApiSettings:TESTAPI"];
        }

        // 定義前端傳來的資料結構 (只要帳密即可)
        public class LoginRequest
        {
            public string Username { get; set; }
            public string Password { get; set; }
        }

        // 定義外部 API 回傳的格式
        public class ApiResultModel
        {
            public int R_RCT { get; set; }
            public string R_MSG { get; set; }
            public List<ApiUserData> ROWLIST { get; set; }
        }

        public class ApiUserData
        {
            public string id_no { get; set; }
            public string sys_id { get; set; }
            public string power_lv { get; set; }
            public string power_ty { get; set; }
            public string user_pr_name { get; set; }
            public string df_station { get; set; }
        }

        // web_tool_msg 資料表對應的類別
        public class WebToolMsg
        {
            public string sys_id { get; set; }      // 系統代碼
            public string tool_no { get; set; }     // 功能編號 (父層)
            public string tool_id { get; set; }     // 功能代碼 (唯一識別)
            public string tool_name { get; set; }   // 功能名稱
            public int tool_seq { get; set; }       // 排序序號
            public string tool_ty { get; set; }     // 功能類型 (P=父層, C=子項)
            public string tool_lv { get; set; }     // 權限等級
            public string tool_open { get; set; }   // 是否開放 (Y/N)
            public string tool_icon { get; set; }   // 圖示 class
            public string tool_url { get; set; }    // 連結網址
            public string tool_memo { get; set; }   // 備註
            public string tool_js { get; set; } //設定JS內容
        }

        // 給 View 使用的選單結構
        public class MenuItem
        {
            public string Id { get; set; }
            public string Title { get; set; }
            public string Icon { get; set; }
            public int Seq { get; set; }
            public List<SubMenuItem> SubItems { get; set; } = new List<SubMenuItem>();
        }

        public class SubMenuItem
        {
            public string Id { get; set; }
            public string Title { get; set; }
            public string Url { get; set; }
            public int Seq { get; set; }

            public string Icon { get; set; } // ★ 新增這一行
        }

        // 3. 新增後端轉發 Action (解決 CORS 與隱藏 SQL 細節)
        [HttpPost]
        public async Task<IActionResult> LoginProxy([FromBody] LoginRequest request)
        {
            if (request == null || string.IsNullOrEmpty(request.Username) || string.IsNullOrEmpty(request.Password))
            {
                return BadRequest(new { success = false, message = "請輸入帳號與密碼" });
            }

            try
            {
                // A. 在後端進行 Base64 加密
                var plainTextBytes = Encoding.UTF8.GetBytes(request.Password);
                var base64Password = Convert.ToBase64String(plainTextBytes);

                // B. 組裝 IN_WHERE
                string inWhereClause = $"and a.sys_id = 'FTWEB' and a.log_id = '{request.Username}' and b.log_pw = '{base64Password}'";

                // C. 準備傳送給外部 API 的資料
                var apiPayload = new
                {
                    SQL_ID = "FTWEBLOGIN",
                    IN_WHERE = inWhereClause
                };

                // D. 建立 HttpClient
                var client = _clientFactory.CreateClient();

                var jsonContent = new StringContent(
                    JsonSerializer.Serialize(apiPayload),
                    Encoding.UTF8,
                    "application/json");

                // E. 發送 POST 到外部 API
                var response = await client.PostAsync(_baseMdUrl, jsonContent);

                // F. 讀取結果
                var resultString = await response.Content.ReadAsStringAsync();

                if (response.IsSuccessStatusCode)
                {
                    // ✅ 將 JSON 反序列化為物件
                    var apiResult = JsonSerializer.Deserialize<ApiResultModel>(resultString, new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });

                    if (apiResult != null)
                    {
                        // 情況 1: 成功 (R_RCT == 1)
                        if (apiResult.R_RCT == 1)
                        {
                            var userInfo = apiResult.ROWLIST?.FirstOrDefault();

                            if (userInfo != null)
                            {
                                // 將使用者資料存入 Session
                                HttpContext.Session.SetString("id_no", userInfo.id_no ?? "");
                                HttpContext.Session.SetString("user_name", userInfo.user_pr_name ?? "");
                                HttpContext.Session.SetString("power_lv", userInfo.power_lv ?? "");
                                HttpContext.Session.SetString("power_ty", userInfo.power_ty ?? "");
                                HttpContext.Session.SetString("sys_id", userInfo.sys_id ?? "");
                                HttpContext.Session.SetString("df_station", userInfo.df_station ?? "");
                                HttpContext.Session.SetString("old_pw", base64Password ?? "");
                                HttpContext.Session.SetString("UserInfo", JsonSerializer.Serialize(userInfo));


                                // ✅ 取得功能列表
                                string toolWhereClause = $" and sys_id = 'FTWEB' and table_type = '1' ";
                                if (userInfo.power_ty != "P9")
                                {
                                    toolWhereClause += " and do_ok = 1 ";
                                }

                                // 如果需要根據使用者權限等級過濾，可以加上這行：
                                // toolWhereClause += $" and a.tool_lv <= '{userInfo.power_lv}'";

                                var toolPayload = new
                                {
                                    SQL_ID = "GETWEBTOOL",
                                    IN_WHERE = toolWhereClause
                                };

                                var toolJsonContent = new StringContent(
                                    JsonSerializer.Serialize(toolPayload),
                                    Encoding.UTF8,
                                    "application/json");

                                var toolResponse = await client.PostAsync(_baseMdUrl, toolJsonContent);
                                var toolResultString = await toolResponse.Content.ReadAsStringAsync();

                                if (toolResponse.IsSuccessStatusCode)
                                {
                                    var apiResultX = JsonSerializer.Deserialize<ApiResultModel>(resultString, new JsonSerializerOptions
                                    {
                                        PropertyNameCaseInsensitive = true
                                    });
                                    if (apiResultX.R_RCT > 0)
                                    {
                                        // 將功能列表存入 Session
                                        HttpContext.Session.SetString("UserTools", toolResultString);
                                        _logger.LogInformation($"使用者 {userInfo.user_pr_name} 登入成功，已載入功能列表");
                                    }
                                    else
                                    {
                                        _logger.LogWarning("無取得功能列表");
                                    }

                                }
                                else
                                {
                                    _logger.LogWarning("功能列表載入失敗");
                                }

                                return Ok(new { success = true, message = "登入成功" });
                            }
                            else
                            {
                                return Ok(new { success = false, message = "登入異常：查無詳細資料" });
                            }
 
 
                        }
                        // 情況 2: 帳密錯誤或無權限 (R_RCT == 0)
                        else if (apiResult.R_RCT == 0)
                        {
                            return Ok(new { success = false, message = "帳號或密碼錯誤或無開啟權限" });
                        }
                        // 情況 3: 其他異常 (R_RCT < 0)
                        else
                        {
                            string errorMsg = string.IsNullOrEmpty(apiResult.R_MSG) ? "未知錯誤" : apiResult.R_MSG;
                            return Ok(new { success = false, message = errorMsg });
                        }
                    }

                    return Ok(new { success = false, message = "API 回傳格式無法解析" });
                }
                else
                {
                    return StatusCode((int)response.StatusCode, new { success = false, message = "外部系統連線錯誤" });
                }
            }
            catch (JsonException jsonEx)
            {
                _logger.LogError(jsonEx, "JSON 解析錯誤");
                return StatusCode(500, new { success = false, message = "資料格式錯誤" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Login Proxy Error");
                return StatusCode(500, new { success = false, message = "系統內部錯誤：" + ex.Message });
            }
        }

        public async Task<IActionResult> Index()
        {
            // 預設訊息 (若無公告則留空，或顯示預設歡迎詞)
            string announcement = "";

            try
            {
                // 1. 取得現在時間 (用於 SQL 過濾)
                string nowStr = DateTime.Now.ToString("yyyy/MM/dd HH:mm:ss");

                // 2. 組裝 IN_WHERE (篩選目前有效的公告)
                // start_time <= 現在 且 end_time >= 現在
                string inWhereClause = $" and sys_id = 'FTWEB' and table_type = '1' and start_time <= '{nowStr}' and end_time >= '{nowStr}'";

                var apiPayload = new
                {
                    SQL_ID = "FTOAANNMSG",
                    IN_WHERE = inWhereClause
                };

                var client = _clientFactory.CreateClient();
                var jsonContent = new StringContent(JsonSerializer.Serialize(apiPayload), Encoding.UTF8, "application/json");

                // 3. 呼叫 API
                var response = await client.PostAsync(_baseMdUrl, jsonContent);

                if (response.IsSuccessStatusCode)
                {
                    var resultString = await response.Content.ReadAsStringAsync();

                    // 4. 解析 JSON
                    using (JsonDocument doc = JsonDocument.Parse(resultString))
                    {
                        var root = doc.RootElement;

                        // 檢查 R_RCT 是否大於 0 (表示有資料)
                        if (root.TryGetProperty("R_RCT", out JsonElement rct) && rct.GetInt32() > 0)
                        {
                            if (root.TryGetProperty("ROWLIST", out JsonElement rowList) && rowList.ValueKind == JsonValueKind.Array)
                            {
                                var msgList = new List<string>();

                                // 遍歷每一筆資料
                                foreach (var row in rowList.EnumerateArray())
                                {
                                    // ★★★ 關鍵修改：讀取 msg_text 欄位 ★★★
                                    if (row.TryGetProperty("msg_text", out JsonElement msgEl) && !string.IsNullOrEmpty(msgEl.GetString()))
                                    {
                                        msgList.Add(msgEl.GetString());
                                    }
                                }

                                // 5. 根據筆數組裝字串
                                if (msgList.Count > 0)
                                {
                                    if (msgList.Count == 1)
                                    {
                                        // 只有一筆，直接顯示內容
                                        announcement = msgList[0];
                                    }
                                    else
                                    {
                                        // 兩筆以上，加入序號 (1)... (2)...
                                        var sb = new StringBuilder();
                                        for (int i = 0; i < msgList.Count; i++)
                                        {
                                            // 加入 (1) 內容 (間隔空格)
                                            sb.Append($"({i + 1}){msgList[i]}   ");
                                        }
                                        announcement = sb.ToString();
                                    }
                                }
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "取得公告失敗");
                // 錯誤時保持 announcement 為空，前台就不會顯示跑馬燈
            }
            // 將結果傳給 View
            ViewBag.Announcement = announcement;
            return View();
        }

        public IActionResult Privacy()
        {
            return View();
        }

        [HttpPost]
        public IActionResult Logout()
        {
            // 清除 Session
            HttpContext.Session.Clear();
            return Ok(new { success = true });
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
        {
            return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        }
    }

    public class SessionCheckAttribute : ActionFilterAttribute
    {
        public override void OnActionExecuting(ActionExecutingContext context)
        {
            var userId = context.HttpContext.Session.GetString("id_no");
            if (string.IsNullOrEmpty(userId))
            {
                var request = context.HttpContext.Request;
                // 檢查是否為 AJAX 請求 (fetch 或 jQuery)
                bool isAjax = request.Headers["X-Requested-With"] == "XMLHttpRequest" ||
                              request.Headers["Accept"].ToString().Contains("application/json");

                if (isAjax)
                {
                    // AJAX 過期：回傳 401 狀態碼
                    context.Result = new UnauthorizedResult();
                }
                else
                {
                    // 一般頁面(iframe)過期：導向登入頁
                    context.Result = new RedirectToRouteResult(new RouteValueDictionary {
                        { "controller", "Home" }, { "action", "Index" }
                    });
                }
            }
            base.OnActionExecuting(context);
        }
    }


}