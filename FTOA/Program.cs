var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllersWithViews();

// 註冊 HttpClient 服務
builder.Services.AddHttpClient();

// ✅ 【新增】啟用 Session 服務
builder.Services.AddDistributedMemoryCache(); // Session 需要的記憶體快取
builder.Services.AddSession(options =>
{
    options.IdleTimeout = TimeSpan.FromMinutes(30); // Session 過期時間 (30分鐘)
    options.Cookie.HttpOnly = true;                 // 防止 JavaScript 存取 Cookie (提高安全性)
    options.Cookie.IsEssential = true;              // 標記為必要 Cookie (GDPR 合規)
});

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();

app.UseRouting();

// ✅ 【新增】啟用 Session 中介軟體 (必須在 UseRouting 之後、UseAuthorization 之前)
app.UseSession();

app.UseAuthorization();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

app.Run();
