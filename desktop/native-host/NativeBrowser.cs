using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NexusHost;

/// <summary>
/// Headless/offscreen native Edge WebView2 inspector and DOM automation helper invoked via:
///   NEXUS.exe --browser-inspect &lt;base64JsonPayload&gt;
/// Executes real JavaScript, waits for dynamic SPA frameworks or selectors, optionally performs
/// scripted DOM actions (click/type/select/scroll/wait/eval), captures screenshots, and extracts
/// structured page content + interactive element selectors without Electron or external drivers.
/// </summary>
internal static class NativeBrowser
{
    private const string DefaultUserAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0";

    private static string ValidateProxyUrl(string? proxyUrl)
    {
        string trimmed = (proxyUrl ?? "").Trim();
        if (string.IsNullOrEmpty(trimmed)) return "";
        if (trimmed.IndexOfAny(['"', '\'', ' ', '\t', '\r', '\n', ';']) >= 0)
            throw new InvalidOperationException("Proxy URL contains disallowed characters.");
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri))
            throw new InvalidOperationException("Invalid proxy URL.");
        string scheme = uri.Scheme.ToLowerInvariant();
        if (scheme is not ("http" or "https" or "socks4" or "socks5" or "socks5h"))
            throw new InvalidOperationException("Unsupported proxy scheme: " + scheme);
        return uri.AbsoluteUri.TrimEnd('/');
    }

    public static int RunBrowserInspect(string base64Payload)
    {
        try
        {
            string json = Encoding.UTF8.GetString(Convert.FromBase64String(base64Payload));
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            string url = root.TryGetProperty("url", out var uEl) ? (uEl.GetString() ?? "").Trim() : "";
            if (!Uri.TryCreate(url, UriKind.Absolute, out var parsedUrl)
                || (parsedUrl.Scheme != Uri.UriSchemeHttp && parsedUrl.Scheme != Uri.UriSchemeHttps))
            {
                throw new InvalidOperationException("browser_inspect requires a valid HTTP or HTTPS URL.");
            }

            int waitMs = root.TryGetProperty("waitMs", out var wEl) && wEl.ValueKind == JsonValueKind.Number
                ? Math.Clamp(wEl.GetInt32(), 0, 15000)
                : 1200;
            int timeoutMs = root.TryGetProperty("timeoutMs", out var toEl) && toEl.ValueKind == JsonValueKind.Number
                ? Math.Clamp(toEl.GetInt32(), 5000, 60000)
                : 35000;
            string waitForSelector = root.TryGetProperty("waitForSelector", out var wsEl) && wsEl.ValueKind == JsonValueKind.String
                ? (wsEl.GetString() ?? "").Trim()
                : "";
            string proxyUrl = ValidateProxyUrl(
                root.TryGetProperty("proxyUrl", out var pEl) && pEl.ValueKind == JsonValueKind.String ? pEl.GetString() : ""
            );
            string userAgent = root.TryGetProperty("userAgent", out var uaEl) && uaEl.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(uaEl.GetString())
                ? uaEl.GetString()!.Trim()
                : DefaultUserAgent;
            bool useAccountSession = root.TryGetProperty("useAccountSession", out var accEl) && accEl.ValueKind == JsonValueKind.True;
            string dataDir = root.TryGetProperty("dataDir", out var ddEl) && ddEl.ValueKind == JsonValueKind.String
                ? (ddEl.GetString() ?? "").Trim()
                : "";
            bool extractLinks = !root.TryGetProperty("extractLinks", out var elEl) || elEl.ValueKind != JsonValueKind.False;
            bool extractForms = !root.TryGetProperty("extractForms", out var efEl) || efEl.ValueKind != JsonValueKind.False;
            string screenshotPath = root.TryGetProperty("screenshotPath", out var spEl) && spEl.ValueKind == JsonValueKind.String
                ? (spEl.GetString() ?? "").Trim()
                : "";
            JsonElement actionsEl = root.TryGetProperty("actions", out var actEl) && actEl.ValueKind == JsonValueKind.Array
                ? actEl.Clone()
                : default;

            ApplicationConfiguration.Initialize();

            string? outputJson = null;
            Exception? fatalError = null;
            bool tempProfile = !useAccountSession || string.IsNullOrWhiteSpace(dataDir);
            string profileDir = tempProfile
                ? Path.Combine(Path.GetTempPath(), "nexus-inspect-" + Guid.NewGuid().ToString("N")[..10])
                : Path.Combine(dataDir, "browser-account-profile");
            Directory.CreateDirectory(profileDir);

            using var form = new Form
            {
                Text = "NEXUS Headless Inspector",
                ShowInTaskbar = false,
                FormBorderStyle = FormBorderStyle.None,
                StartPosition = FormStartPosition.Manual,
                Location = new Point(-32000, -32000),
                Size = new Size(1280, 900),
                Opacity = 0,
            };

            var webView = new WebView2 { Dock = DockStyle.Fill };
            form.Controls.Add(webView);

            using var guardTimer = new System.Windows.Forms.Timer { Interval = timeoutMs };
            guardTimer.Tick += (_, _) =>
            {
                fatalError ??= new TimeoutException($"WebView2 browser inspection timed out after {timeoutMs} ms.");
                guardTimer.Stop();
                form.Close();
            };

            form.Load += async (_, _) =>
            {
                guardTimer.Start();
                try
                {
                    var argsList = new List<string>
                    {
                        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                        "--disable-features=msEdgeAccountConsistency,msEdgeSmartScreen",
                    };
                    if (!string.IsNullOrWhiteSpace(proxyUrl))
                    {
                        argsList.Add($"--proxy-server=\"{proxyUrl}\"");
                        if (proxyUrl.StartsWith("socks", StringComparison.OrdinalIgnoreCase))
                        {
                            argsList.Add("--host-resolver-rules=\"MAP * ~NOTFOUND , EXCLUDE 127.0.0.1\"");
                        }
                    }

                    var envOptions = new CoreWebView2EnvironmentOptions(string.Join(" ", argsList));
                    var env = await CoreWebView2Environment.CreateAsync(null, profileDir, envOptions);
                    var ctrlOptions = env.CreateCoreWebView2ControllerOptions();
                    ctrlOptions.IsInPrivateModeEnabled = tempProfile;
                    await webView.EnsureCoreWebView2Async(env, ctrlOptions);

                    var core = webView.CoreWebView2;
                    core.Settings.UserAgent = userAgent;
                    core.Settings.AreDevToolsEnabled = false;
                    core.Settings.IsStatusBarEnabled = false;
                    core.Settings.AreDefaultScriptDialogsEnabled = false;

                    await core.AddScriptToExecuteOnDocumentCreatedAsync(
                        "try { Object.defineProperty(navigator, 'webdriver', { get: () => false }); } catch {}"
                    );

                    var navTcs = new TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs>(TaskCreationOptions.RunContinuationsAsynchronously);
                    core.NavigationCompleted += (_, navArgs) => navTcs.TrySetResult(navArgs);
                    core.Navigate(parsedUrl.AbsoluteUri);

                    var navResult = await navTcs.Task;
                    if (!navResult.IsSuccess && navResult.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                    {
                        throw new InvalidOperationException($"WebView2 navigation failed ({navResult.WebErrorStatus}, HTTP {navResult.HttpStatusCode}).");
                    }

                    if (waitMs > 0) await Task.Delay(waitMs);

                    if (!string.IsNullOrWhiteSpace(waitForSelector))
                    {
                        await WaitForSelectorAsync(core, waitForSelector, Math.Min(12000, timeoutMs / 2));
                    }

                    var actionsLog = new List<object>();
                    JsonElement? lastEvalResult = null;
                    if (actionsEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var act in actionsEl.EnumerateArray())
                        {
                            string actType = act.TryGetProperty("type", out var tEl) ? (tEl.GetString() ?? "").Trim().ToLowerInvariant() : "";
                            string selector = act.TryGetProperty("selector", out var sEl) ? (sEl.GetString() ?? "").Trim() : "";
                            string textVal = act.TryGetProperty("text", out var txEl) ? (txEl.GetString() ?? "") : "";
                            string valStr = act.TryGetProperty("value", out var vEl) ? (vEl.GetString() ?? "") : textVal;

                            if (actType == "wait")
                            {
                                if (!string.IsNullOrWhiteSpace(selector))
                                {
                                    bool found = await WaitForSelectorAsync(core, selector, act.TryGetProperty("ms", out var msEl) && msEl.ValueKind == JsonValueKind.Number ? Math.Clamp(msEl.GetInt32(), 200, 12000) : 6000);
                                    actionsLog.Add(new { type = "wait", selector, found });
                                }
                                else
                                {
                                    int ms = act.TryGetProperty("ms", out var msEl) && msEl.ValueKind == JsonValueKind.Number ? Math.Clamp(msEl.GetInt32(), 50, 10000) : 800;
                                    await Task.Delay(ms);
                                    actionsLog.Add(new { type = "wait", ms });
                                }
                            }
                            else if (actType == "click" && !string.IsNullOrWhiteSpace(selector))
                            {
                                string script = $$"""
                                    (() => {
                                      const el = document.querySelector({{JsonSerializer.Serialize(selector)}});
                                      if (!el) return { ok: false, error: 'Selector not found' };
                                      el.scrollIntoView({ block: 'center' });
                                      el.click();
                                      return { ok: true, tag: el.tagName.toLowerCase(), text: (el.innerText || '').trim().slice(0, 80) };
                                    })()
                                    """;
                                string res = await core.ExecuteScriptAsync(script);
                                actionsLog.Add(new { type = "click", selector, result = JsonSerializer.Deserialize<JsonElement>(res) });
                                await Task.Delay(450);
                            }
                            else if (actType == "type" && !string.IsNullOrWhiteSpace(selector))
                            {
                                string script = $$"""
                                    (() => {
                                      const el = document.querySelector({{JsonSerializer.Serialize(selector)}});
                                      if (!el) return { ok: false, error: 'Selector not found' };
                                      el.focus();
                                      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                                      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                                      if (setter) setter.call(el, {{JsonSerializer.Serialize(textVal)}});
                                      else el.value = {{JsonSerializer.Serialize(textVal)}};
                                      el.dispatchEvent(new Event('input', { bubbles: true }));
                                      el.dispatchEvent(new Event('change', { bubbles: true }));
                                      return { ok: true, tag: el.tagName.toLowerCase(), length: {{textVal.Length}} };
                                    })()
                                    """;
                                string res = await core.ExecuteScriptAsync(script);
                                actionsLog.Add(new { type = "type", selector, result = JsonSerializer.Deserialize<JsonElement>(res) });
                                await Task.Delay(200);
                            }
                            else if (actType == "select" && !string.IsNullOrWhiteSpace(selector))
                            {
                                string script = $$"""
                                    (() => {
                                      const el = document.querySelector({{JsonSerializer.Serialize(selector)}});
                                      if (!el) return { ok: false, error: 'Selector not found' };
                                      el.value = {{JsonSerializer.Serialize(valStr)}};
                                      el.dispatchEvent(new Event('change', { bubbles: true }));
                                      return { ok: true, value: el.value };
                                    })()
                                    """;
                                string res = await core.ExecuteScriptAsync(script);
                                actionsLog.Add(new { type = "select", selector, result = JsonSerializer.Deserialize<JsonElement>(res) });
                                await Task.Delay(200);
                            }
                            else if (actType == "scroll")
                            {
                                int dy = act.TryGetProperty("y", out var yEl) && yEl.ValueKind == JsonValueKind.Number ? yEl.GetInt32() : 700;
                                await core.ExecuteScriptAsync($"window.scrollBy(0, {dy});");
                                actionsLog.Add(new { type = "scroll", y = dy });
                                await Task.Delay(300);
                            }
                            else if (actType == "eval")
                            {
                                string code = act.TryGetProperty("script", out var scEl) ? (scEl.GetString() ?? "") : "";
                                if (!string.IsNullOrWhiteSpace(code))
                                {
                                    string wrapped = $"(() => {{ try {{ return {{ ok: true, value: (function(){{ {code} }})() }}; }} catch (e) {{ return {{ ok: false, error: String(e && e.message || e) }}; }} }})()";
                                    string res = await core.ExecuteScriptAsync(wrapped);
                                    lastEvalResult = JsonSerializer.Deserialize<JsonElement>(res);
                                    actionsLog.Add(new { type = "eval", result = lastEvalResult });
                                }
                            }
                        }
                    }

                    string extractScript = $$"""
                        (() => {
                          const cssPath = el => {
                            if (!el || el.nodeType !== 1) return '';
                            if (el.id) return '#' + CSS.escape(el.id);
                            const name = el.getAttribute('name');
                            if (name) return `${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`;
                            const aria = el.getAttribute('aria-label');
                            if (aria) return `${el.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, '\\"')}"]`;
                            const cls = [...(el.classList || [])].slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
                            return el.tagName.toLowerCase() + cls;
                          };
                          const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0, 30).map(h => ({
                            level: h.tagName.toLowerCase(),
                            text: (h.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 180)
                          })).filter(h => h.text);
                          const links = {{(extractLinks ? "true" : "false")}}
                            ? [...document.querySelectorAll('a[href]')].slice(0, 60).map(a => ({
                                text: (a.innerText || a.getAttribute('aria-label') || a.href).replace(/\s+/g, ' ').trim().slice(0, 120),
                                url: a.href,
                                selector: cssPath(a)
                              })).filter(l => /^https?:\/\//i.test(l.url))
                            : [];
                          const forms = {{(extractForms ? "true" : "false")}}
                            ? [...document.querySelectorAll('form')].slice(0, 20).map(f => ({
                                action: f.getAttribute('action') || location.pathname,
                                method: (f.getAttribute('method') || 'GET').toUpperCase(),
                                fields: [...f.querySelectorAll('input,textarea,select,button')].slice(0, 30).map(i => ({
                                  tag: i.tagName.toLowerCase(),
                                  type: i.getAttribute('type') || '',
                                  name: i.getAttribute('name') || '',
                                  placeholder: i.getAttribute('placeholder') || '',
                                  selector: cssPath(i)
                                }))
                              }))
                            : [];
                          const interactiveElements = [...document.querySelectorAll('button,input,textarea,select,[role="button"],a[href]')].slice(0, 60).map(el => ({
                            tag: el.tagName.toLowerCase(),
                            role: el.getAttribute('role') || el.getAttribute('type') || '',
                            text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 100),
                            selector: cssPath(el)
                          })).filter(x => x.selector);
                          const text = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
                          return {
                            url: location.href,
                            title: document.title || location.hostname,
                            status: {{navResult.HttpStatusCode}},
                            renderedJs: true,
                            engine: 'webview2',
                            text,
                            headings,
                            links,
                            forms,
                            interactiveElements
                          };
                        })()
                        """;

                    string extractedRaw = await core.ExecuteScriptAsync(extractScript);
                    using var extractedDoc = JsonDocument.Parse(extractedRaw);

                    bool screenshotCaptured = false;
                    if (!string.IsNullOrWhiteSpace(screenshotPath))
                    {
                        using var fs = new FileStream(screenshotPath, FileMode.Create, FileAccess.Write);
                        await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);
                        screenshotCaptured = true;
                    }

                    var payloadOut = new Dictionary<string, object?>();
                    foreach (var prop in extractedDoc.RootElement.EnumerateObject())
                    {
                        payloadOut[prop.Name] = prop.Value.Clone();
                    }
                    if (actionsLog.Count > 0) payloadOut["actionsLog"] = actionsLog;
                    if (lastEvalResult.HasValue) payloadOut["evalResult"] = lastEvalResult.Value;
                    if (screenshotCaptured) payloadOut["screenshotCaptured"] = true;
                    payloadOut["accountSession"] = useAccountSession;

                    outputJson = JsonSerializer.Serialize(payloadOut);
                }
                catch (Exception ex)
                {
                    fatalError = ex;
                }
                finally
                {
                    guardTimer.Stop();
                    form.Close();
                }
            };

            Application.Run(form);

            if (tempProfile)
            {
                try { if (Directory.Exists(profileDir)) Directory.Delete(profileDir, recursive: true); } catch { }
            }

            if (fatalError != null)
            {
                Console.Error.Write(fatalError.Message);
                return 1;
            }
            Console.Out.Write(outputJson ?? "{}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.Write(ex.Message);
            return 1;
        }
    }

    private static async Task<bool> WaitForSelectorAsync(CoreWebView2 core, string selector, int maxMs)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(maxMs);
        string checkScript = $"Boolean(document.querySelector({JsonSerializer.Serialize(selector)}))";
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                string res = await core.ExecuteScriptAsync(checkScript);
                if (res.Trim() == "true") return true;
            }
            catch { }
            await Task.Delay(180);
        }
        return false;
    }
}
