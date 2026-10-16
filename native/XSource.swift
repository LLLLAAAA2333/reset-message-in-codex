import AppKit
import WebKit
import Network

// Dedicated persistent WebKit store; no credentials are sent to the Node process.
@available(macOS 14.0, *)
final class XSource: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    var web: WKWebView!
    var window: NSWindow!
    var timer: Timer?
    var loggedIn = false
    var loading = false
    var lastLoad = Date.distantPast
    var lastBatch = Date.distantPast
    var scrolls = 0
    var cycle = 0
    var phase = ""
    var repliesScheduled = false
    var refreshRequested = false
    var stopped = false
    var sessionMisses = 0
    var input = Data()
    let timeline = URL(string: "https://x.com/thsottiaux")!
    func emit(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
        FileHandle.standardOutput.write(data + Data([10]))
    }
    @objc func hideWindow(_ sender: Any?) { window?.orderOut(nil) }
    func installMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem(); menu.addItem(appItem)
        let appMenu = NSMenu(title: "Tibo Reset")
        let close = NSMenuItem(title: "关闭登录窗口", action: #selector(hideWindow(_:)), keyEquivalent: "w")
        close.target = self; appMenu.addItem(close); appItem.submenu = appMenu
        let editItem = NSMenuItem(); menu.addItem(editItem)
        let edit = NSMenu(title: "编辑")
        for (title, action, key) in [("撤销", "undo:", "z"), ("重做", "redo:", "Z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            edit.addItem(NSMenuItem(title: title, action: Selector(action), keyEquivalent: key))
        }
        editItem.submenu = edit; NSApp.mainMenu = menu
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        installMenu()
        let args = CommandLine.arguments
        if args.count > 1 && args[1] == "--clear-session" {
            let store = WKWebsiteDataStore(forIdentifier: UUID(uuidString: "93D47882-298A-4B10-AC5A-E536172906C8")!)
            store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {
                self.emit(["type": "state", "state": "disconnected"]); NSApp.terminate(nil)
            }
            return
        }
        guard args.count >= 2, let script = try? String(contentsOfFile: args[1], encoding: .utf8) else { exit(2) }
        let configuration = WKWebViewConfiguration()
        let store = WKWebsiteDataStore(forIdentifier: UUID(uuidString: "93D47882-298A-4B10-AC5A-E536172906C8")!)
        if args.count > 2, let url = URL(string: args[2]), let host = url.host,
           let port = NWEndpoint.Port(rawValue: UInt16(url.port ?? (url.scheme == "https" ? 443 : 80))) {
            store.proxyConfigurations = [ProxyConfiguration(httpCONNECTProxy: .hostPort(host: NWEndpoint.Host(host), port: port), tlsOptions: url.scheme == "https" ? NWProtocolTLS.Options() : nil)]
        }
        configuration.websiteDataStore = store
        configuration.userContentController.add(self, name: "tiboX")
        configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 960, height: 760), configuration: configuration)
        web.navigationDelegate = self
        window = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Tibo Reset · 连接 X（登录信息仅保存在本机）"
        window.contentView = web
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()
        FileHandle.standardInput.readabilityHandler = { handle in
            let bytes = handle.availableData
            DispatchQueue.main.async {
                if bytes.isEmpty { NSApp.terminate(nil); return }
                self.input.append(bytes)
                if self.input.count > 8192 { NSApp.terminate(nil); return }
                while let end = self.input.firstIndex(of: 10) {
                    let line = self.input.prefix(upTo: end)
                    self.input.removeSubrange(...end)
                    if let command = try? JSONSerialization.jsonObject(with: line) as? [String: String] { self.command(command) }
                }
            }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { _ in self.checkSession() }
        emit(["type": "started"])
        checkSession()
    }
    func checkSession() {
        guard !stopped else { return }
        emit(["type": "heartbeat"])
        web.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
            guard !self.stopped else { return }
            let hasSession = cookies.contains { $0.name == "auth_token" && ["x.com", ".x.com", "twitter.com", ".twitter.com"].contains($0.domain) }
            if hasSession { self.sessionMisses = 0 }
            if hasSession && !self.loggedIn {
                self.loggedIn = true
                self.emit(["type": "state", "state": "loading"])
                self.loadTimeline()
            } else if !hasSession {
                // WebKit can return an empty cookie list while its network
                // process is recovering. Do not report logout on one miss.
                self.sessionMisses += 1
                if self.sessionMisses < 3 { return }
                if self.loggedIn || self.lastLoad == .distantPast { self.emit(["type": "state", "state": "login-required"]) }
                self.loggedIn = false
                // Do not open or load a login page until the user clicks Connect.
                if self.lastLoad == .distantPast { self.lastLoad = Date() }
            }
            if self.loading && Date().timeIntervalSince(self.lastLoad) > 45 {
                self.loading = false
                self.emit(["type": "failure", "status": 0])
            }
            if self.loggedIn && !self.loading && self.refreshRequested && self.phase != "posts" {
                self.refreshRequested = false; self.loadTimeline(); return
            }
            if self.loggedIn && !self.loading && self.scrolls < 4 && Date().timeIntervalSince(self.lastBatch) > 3 && Date().timeIntervalSince(self.lastBatch) < 25 {
                self.scrolls += 1
                self.web.evaluateJavaScript("window.scrollBy(0, window.innerHeight * 2)", completionHandler: nil)
            }
        }
    }
    func loadTimeline() {
        guard !stopped else { return }
        cycle += 1; phase = "posts"; repliesScheduled = false; refreshRequested = false
        emit(["type": "cycle", "cycle": cycle])
        loading = true; scrolls = 0; lastLoad = Date()
        web.load(URLRequest(url: timeline, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 35))
    }
    func command(_ message: [String: String]) {
        switch message["action"] {
        case "connect":
            stopped = false
            window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
            if !loggedIn {
                emit(["type": "state", "state": "login-required"])
                web.load(URLRequest(url: URL(string: "https://x.com/i/flow/login")!))
            } else { loadTimeline() }
        case "refresh":
            if loggedIn && !loading { loadTimeline() } else { refreshRequested = loggedIn; checkSession() }
        case "wake":
            cycle += 1; phase = ""; loading = false; refreshRequested = true; web.stopLoading(); checkSession()
        case "thread":
            if loggedIn, !loading, let id = message["id"], id.range(of: "^[0-9]{1,25}$", options: .regularExpression) != nil {
                loading = true; scrolls = 4; lastLoad = Date()
                web.load(URLRequest(url: URL(string: "https://x.com/thsottiaux/status/" + id)!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 35))
            }
        case "disconnect":
            cycle += 1; stopped = true; loggedIn = false; web.stopLoading(); window.orderOut(nil)
            let store = web.configuration.websiteDataStore
            store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {
                self.emit(["type": "state", "state": "disconnected"])
            }
        case "stop": NSApp.terminate(nil)
        default: break
        }
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard !stopped, message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "https",
              message.frameInfo.securityOrigin.host == "x.com", let body = message.body as? [String: Any] else { return }
        if body["type"] as? String == "diagnostic" {
            if let op = body["operation"] as? String, op.range(of: "^[A-Za-z0-9_]{1,80}$", options: .regularExpression) != nil {
                emit(["type": "diagnostic", "operation": op, "status": body["status"] as? Int ?? 0])
            }
        } else if body["type"] as? String == "posts" {
            guard let posts = body["posts"] as? [[String: Any]], !posts.isEmpty, posts.count <= 200 else { return }
            loading = false; lastBatch = Date()
            // Ignore late responses from the previous page/phase.
            let endpoint = body["endpoint"] as? String ?? ""
            if phase == "posts" && ["UserTweetsAndReplies", "UserRepliesTimeline"].contains(endpoint) { return }
            if phase == "replies" && ["UserTweets", "UserOriginalsTimeline"].contains(endpoint) { return }
            var payload = body; payload["cycle"] = cycle; emit(payload)
            if phase == "posts", ["UserTweets", "UserOriginalsTimeline"].contains(body["endpoint"] as? String ?? ""), !repliesScheduled {
                repliesScheduled = true
                let current = cycle
                DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
                    guard !self.stopped, self.cycle == current else { return }
                    self.phase = "replies"; self.loading = true; self.scrolls = 0; self.lastLoad = Date()
                    self.web.load(URLRequest(url: URL(string: "https://x.com/thsottiaux/with_replies")!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 35))
                }
            }
            // Keep the window available to inspect; closing it keeps collection running.
        } else if body["type"] as? String == "failure" {
            loading = false
            emit(["type": "failure", "status": body["status"] as? Int ?? 0])
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, url.scheme == "https", let host = url.host,
              ["x.com", "twitter.com", "accounts.x.com"].contains(host) else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        emit(["type": "diagnostic", "operation": "pageLoaded", "page": webView.url?.path ?? ""])
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { loading = false; emit(["type": "failure", "status": 0]) }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        cycle += 1; loading = false; phase = ""; refreshRequested = false
        emit(["type": "failure", "status": 0])
        // The monitor controls retry/backoff. Its next refresh reloads this
        // view using the same named store, rather than clearing the login.
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { sender.orderOut(nil); return false }
    func applicationWillTerminate(_ notification: Notification) { timer?.invalidate(); FileHandle.standardInput.readabilityHandler = nil }
}
if #available(macOS 14.0, *) {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = XSource()
    app.delegate = delegate
    app.run()
} else { print("{\"type\":\"unsupported\"}") }
