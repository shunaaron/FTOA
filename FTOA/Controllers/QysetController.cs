using FTOA.Models;
using Microsoft.AspNetCore.Mvc;
using System.Diagnostics;
using System.Text;                // 用於 Encoding
using System.Text.Json;           // 用於 JsonSerializer
using System.Net.Http;            // 用於 HttpClient

namespace FTOA.Controllers
{
    [SessionCheck]
    public class QysetController : Controller
    {
        private readonly ILogger<HomeController> _logger;
        // 1. 宣告 HttpClientFactory
        private readonly IHttpClientFactory _clientFactory;

        // 2. 在建構子注入 IHttpClientFactory
        public QysetController(ILogger<HomeController> logger, IHttpClientFactory clientFactory)
        {
            _logger = logger;
            _clientFactory = clientFactory;
        }
     

        public IActionResult TMS_PL_TIME()
        {
            return View();
        }
         
    }
}