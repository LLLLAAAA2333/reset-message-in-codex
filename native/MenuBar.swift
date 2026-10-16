import AppKit
import SwiftUI
import UserNotifications
import Darwin

final class MenuStore: ObservableObject {
    @Published var panelSize = MenuPanelLayout.preferredSize
    @Published var snapshot = ResetSnapshot()
    @Published var backendError = ""
    @Published var launchAtLogin = false
    @Published var notifications = UserDefaults.standard.bool(forKey: "notifyNewPosts")
    var action: (String) -> Void = { _ in }
    var login: (Bool) -> Void = { _ in }
    var notify: (Bool) -> Void = { _ in }
    var quit: () -> Void = {}
}

private final class PanelRegionView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

private struct PanelRegion: NSViewRepresentable {
    let name: String
    func makeNSView(context: Context) -> NSView {
        let view = PanelRegionView(); view.identifier = NSUserInterfaceItemIdentifier("tibo-panel-" + name); return view
    }
    func updateNSView(_ view: NSView, context: Context) {}
}

private struct AnnouncementCard: View {
    let post: ResetPost, zone: String
    @State private var expanded = false
    private var color: Color { post.status == "completed" ? .green : .primary }
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Label(post.statusTitle, systemImage: post.symbol)
                .font(.system(size: 12, weight: .semibold)).foregroundStyle(color)
            if let timing = post.timing(zone: zone) {
                Text(timing).font(.system(size: 12, weight: .medium)).fixedSize(horizontal: false, vertical: true).help(post.timeHelp)
            }
            VStack(alignment: .leading, spacing: 7) {
                quote(post.text, label: "原文")
                ForEach(Array(post.parents.enumerated()), id: \.offset) { _, text in quote(text, label: "前文") }
            }
            .padding(.leading, 10)
            .overlay(alignment: .leading) { Rectangle().fill(.primary.opacity(0.14)).frame(width: 2) }
            if post.text.count > 200 || !post.parents.isEmpty {
                Button(expanded ? "收起原文" : "展开原文与前文") { expanded.toggle() }
                    .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(.secondary)
            }
            HStack(alignment: .firstTextBaseline) {
                if let url = URL(string: post.url) {
                    Link(destination: url) { Label("查看原帖", systemImage: "arrow.up.right").font(.system(size: 11, weight: .medium)) }
                        .help(post.url)
                }
                Spacer(minLength: 4)
                if let published = ResetPost.date(post.publishedAt) {
                    Text(ResetPost.clock(published, zone: zone)).font(.system(size: 10)).foregroundStyle(.secondary)
                        .help("发布于 \(ResetPost.clock(published, zone: zone))（\(ResetPost.zoneLabel(zone))）\n\(post.publishedAt)")
                }
            }
            if post.parserState == "failed" {
                Text("解释暂不可用，点击刷新可重试").font(.system(size: 10)).foregroundStyle(.secondary)
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 10))
        .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(.primary.opacity(0.07), lineWidth: 0.5) }
    }
    private func quote(_ text: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 9, weight: .medium)).foregroundStyle(.tertiary)
            Text(text).font(.custom("Georgia-Italic", size: 12)).lineSpacing(2)
                .lineLimit(expanded ? nil : 3).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct ResetMenuView: View {
    @ObservedObject var store: MenuStore
    @State private var all = false
    private var snapshot: ResetSnapshot { store.snapshot }
    private var statusColor: Color { snapshot.state == "ready" ? .green : snapshot.state == "loading" ? .secondary : .orange }
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 9) {
                Image(systemName: "arrow.clockwise.circle").font(.system(size: 24, weight: .light))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Tibo Reset").font(.system(size: 14, weight: .semibold))
                    Text("@thsottiaux · 重置公告").font(.system(size: 10)).foregroundStyle(.secondary)
                }
                Spacer()
                if !snapshot.unread.isEmpty {
                    Text("\(snapshot.unread.count) 条未读").font(.system(size: 10, weight: .medium))
                        .padding(.horizontal, 7).padding(.vertical, 4).background(.primary.opacity(0.06), in: Capsule())
                }
                Button { store.action("refresh") } label: { Image(systemName: "arrow.clockwise").font(.system(size: 12)) }
                    .buttonStyle(.borderless).help("立即检查（⌘R）").keyboardShortcut("r")
                    .accessibilityLabel("立即检查")
            }.padding(.horizontal, 16).padding(.vertical, 14)
                .fixedSize(horizontal: false, vertical: true).layoutPriority(1)
                .background(PanelRegion(name: "header"))
            Divider()
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Circle().fill(statusColor).frame(width: 6, height: 6)
                    Text(store.backendError.isEmpty ? snapshot.stateTitle : "后台正在恢复").font(.system(size: 11, weight: .medium))
                    Spacer()
                    Text("每 \(snapshot.pollSeconds) 秒检查").font(.system(size: 10)).foregroundStyle(.secondary)
                }
                if let checked = snapshot.checkedAt {
                    Text("上次成功检查 \(ResetPost.clock(checked, zone: snapshot.zone))")
                        .font(.system(size: 10)).foregroundStyle(.secondary)
                }
                if !store.backendError.isEmpty || !snapshot.error.isEmpty {
                    Text(store.backendError.isEmpty ? snapshot.error : store.backendError)
                        .font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(3)
                        .help(store.backendError.isEmpty ? snapshot.error : store.backendError)
                }
                if snapshot.state == "error", let retry = snapshot.retryAt {
                    Text("将于 \(ResetPost.clock(retry, zone: snapshot.zone)) 自动重试 · 已保留登录与消息")
                        .font(.system(size: 10)).foregroundStyle(.secondary)
                }
                if snapshot.state == "login-required" {
                    Text("打开专用窗口完成登录，之后可以关闭窗口。")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }.padding(.horizontal, 16).padding(.vertical, 11)
                .fixedSize(horizontal: false, vertical: true).layoutPriority(1)
                .background(PanelRegion(name: "connection"))
            if snapshot.records.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "text.bubble").font(.system(size: 27, weight: .ultraLight)).foregroundStyle(.secondary)
                    Text(snapshot.state == "ready" ? "最近 14 天暂无重置公告" : "等候下一条重置公告")
                        .font(.system(size: 12, weight: .medium))
                    Text("主帖与相关回复会显示在这里").font(.system(size: 11)).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 9) {
                        if snapshot.state != "ready" {
                            Text("显示上次保存的公告").font(.system(size: 10)).foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        ForEach(Array(snapshot.records.prefix(all ? 60 : 5))) { post in AnnouncementCard(post: post, zone: snapshot.zone) }
                        if snapshot.records.count > 5 {
                            Button(all ? "仅显示最近 5 条" : "查看全部 \(snapshot.records.count) 条公告") { all.toggle() }
                                .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(.secondary).padding(5)
                        }
                    }.padding(.horizontal, 12).padding(.bottom, 12)
                }.frame(minHeight: 0, maxHeight: .infinity)
                    .background(PanelRegion(name: "announcements"))
            }
            Divider()
            HStack {
                Button { store.action("connect") } label: {
                    Label(snapshot.state == "login-required" || snapshot.state == "disconnected" ? "连接 X…" : "查看 X 连接…", systemImage: "link")
                        .font(.system(size: 11))
                }.buttonStyle(.plain).disabled(snapshot.state == "disconnecting")
                Spacer()
                Menu {
                    Toggle("登录时启动", isOn: Binding(get: { store.launchAtLogin }, set: { store.login($0) }))
                    Toggle("新公告系统通知", isOn: Binding(get: { store.notifications }, set: { store.notify($0) }))
                    Button("全部标为已读") { store.action("read") }
                    Divider()
                    Button("断开 X 并清除登录…") { store.action("disconnect") }
                    Divider()
                    Text("Tibo Reset 0.3.0 · \(ResetPost.zoneLabel(snapshot.zone))")
                    Button("退出 Tibo Reset", action: store.quit).keyboardShortcut("q")
                } label: { Image(systemName: "ellipsis.circle").font(.system(size: 14)) }
                    .menuStyle(.borderlessButton).fixedSize().help("设置与退出").accessibilityLabel("设置与退出")
            }.padding(.horizontal, 16).padding(.vertical, 11)
                .fixedSize(horizontal: false, vertical: true).layoutPriority(1)
                .background(PanelRegion(name: "footer"))
        }
        .frame(width: store.panelSize.width, height: store.panelSize.height)
        .clipped().background(.regularMaterial)
    }
}

private final class MenuPanelController: NSViewController {
    let host: NSHostingView<ResetMenuView>
    init(store: MenuStore) {
        host = NSHostingView(rootView: ResetMenuView(store: store))
        super.init(nibName: nil, bundle: nil)
        // A plain AppKit viewport isolates NSPopover from SwiftUI's intrinsic
        // content sizing, including changes in its lazy scroll content.
        view = NSView(frame: NSRect(origin: .zero, size: store.panelSize))
        host.sizingOptions = []; host.safeAreaRegions = []
        host.frame = view.bounds; host.autoresizingMask = [.width, .height]
        view.addSubview(host)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

final class ResetMenuApp: NSObject, NSApplicationDelegate, NSPopoverDelegate, UNUserNotificationCenterDelegate {
    let store = MenuStore()
    let data: URL
    let resources = Bundle.main.resourceURL!
    var item: NSStatusItem!, popover = NSPopover()
    private var panelController: MenuPanelController?
    var child: Process?, input: Pipe?, output: Pipe?, buffer = Data()
    var timer: Timer?, signals: [DispatchSourceSignal] = []
    var lock: Int32 = -1, ownsLock = false, legacyRunning = false, stopping = false, failures = 0
    var lastSnapshot = Date(), lastNotice: String?, readSent: [String] = []
    override init() {
        data = ProcessInfo.processInfo.environment["TIBO_RESET_DATA_DIR"].map { URL(fileURLWithPath: $0) } ??
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/TiboReset")
        super.init()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        if CommandLine.arguments.contains("--preview") { preview(); return }
        if CommandLine.arguments.contains("--layout-test") { testPopoverLayout(); return }
        do {
            try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            lock = Darwin.open(data.appendingPathComponent("menubar.lock").path, O_CREAT | O_RDWR, 0o600)
            guard lock >= 0, flock(lock, LOCK_EX | LOCK_NB) == 0 else { NSApp.terminate(nil); return }
            ownsLock = true
            let pidFile = data.appendingPathComponent("menubar.pid")
            try Data(String(getpid()).utf8).write(to: pidFile, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: pidFile.path)
            // Refuse to contend for the named X store with an old monitor.
            // The installer performs the graceful migration before launching us.
            if legacyMonitorRunning() {
                legacyRunning = true
                store.backendError = "旧后台仍在运行。请运行此版本的安装.command 完成菜单栏迁移。"
            }
            item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
            item.autosaveName = "TiboResetStatusItem"
            item.button?.target = self; item.button?.action = #selector(toggle)
            configurePopover()
            store.action = { [weak self] action in self?.action(action) }
            store.login = { [weak self] enabled in self?.setLogin(enabled) }
            store.notify = { [weak self] enabled in self?.setNotifications(enabled) }
            store.quit = { NSApp.terminate(nil) }
            store.launchAtLogin = FileManager.default.fileExists(atPath: agentURL.path)
            UNUserNotificationCenter.current().delegate = self
            NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(wake), name: NSWorkspace.didWakeNotification, object: nil)
            NotificationCenter.default.addObserver(self, selector: #selector(screenLayoutChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
            for code in [SIGTERM, SIGINT] {
                signal(code, SIG_IGN)
                let source = DispatchSource.makeSignalSource(signal: code, queue: .main)
                source.setEventHandler { NSApp.terminate(nil) }; source.resume(); signals.append(source)
            }
            updateItem()
            if store.backendError.isEmpty { launchBackend() }
            timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.checkBackend() }
        } catch { showFailure("无法准备本地数据目录"); NSApp.terminate(nil) }
    }
    func legacyMonitorRunning() -> Bool {
        // Inspect the service, not the age of a receipt left by a stopped app.
        for label in ["com.tiboreset.monitor", "com.codexusagebadge.agent"] {
            let task = Process(), pipe = Pipe()
            task.executableURL = URL(fileURLWithPath: "/bin/launchctl")
            task.arguments = ["print", "gui/\(getuid())/\(label)"]
            task.standardOutput = pipe; task.standardError = FileHandle.nullDevice
            do {
                try task.run()
                let bytes = pipe.fileHandleForReading.readDataToEndOfFile(); task.waitUntilExit()
                let text = String(data: bytes, encoding: .utf8) ?? ""
                if task.terminationStatus == 0, text.contains("state = running"),
                   label != "com.tiboreset.monitor" || text.contains(data.appendingPathComponent("app.cjs").path) { return true }
            } catch {}
        }
        return false
    }
    func pinnedNode() throws -> URL {
        let manager = FileManager.default, runtime = data.appendingPathComponent("runtime"), node = runtime.appendingPathComponent("node")
        if manager.isExecutableFile(atPath: node.path) { return node }
        let apps = ["/Applications/Codex.app", "/Applications/ChatGPT.app",
                    manager.homeDirectoryForCurrentUser.appendingPathComponent("Applications/Codex.app").path,
                    manager.homeDirectoryForCurrentUser.appendingPathComponent("Applications/ChatGPT.app").path]
        let candidates = apps.map { URL(fileURLWithPath: $0).appendingPathComponent("Contents/Resources/cua_node/bin/node") }
        guard let source = candidates.first(where: { manager.isExecutableFile(atPath: $0.path) }) else {
            throw NSError(domain: "node-not-found", code: 1)
        }
        try manager.createDirectory(at: runtime, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let temp = runtime.appendingPathComponent(UUID().uuidString)
        defer { try? manager.removeItem(at: temp) }
        try manager.copyItem(at: source, to: temp)
        try manager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: temp.path)
        try manager.moveItem(at: temp, to: node)
        return node
    }
    func launchBackend() {
        guard !stopping, !legacyRunning, child == nil else { return }
        do {
            let process = Process(), stdinPipe = Pipe(), stdoutPipe = Pipe()
            process.executableURL = try pinnedNode()
            process.arguments = [resources.appendingPathComponent("app.cjs").path, "--stdio"]
            process.currentDirectoryURL = data
            var env = ProcessInfo.processInfo.environment; env["TIBO_RESET_DATA_DIR"] = data.path; process.environment = env
            process.standardInput = stdinPipe; process.standardOutput = stdoutPipe; process.standardError = FileHandle.nullDevice
            child = process; input = stdinPipe; output = stdoutPipe; buffer = Data(); lastSnapshot = Date()
            stdoutPipe.fileHandleForReading.readabilityHandler = { [weak self, weak process] handle in
                let bytes = handle.availableData
                DispatchQueue.main.async {
                    guard let self, self.child === process, !self.stopping else { return }
                    self.buffer.append(bytes)
                    guard self.buffer.count < 4 * 1024 * 1024 else { process?.terminate(); return }
                    while let end = self.buffer.firstIndex(of: 10) {
                        let line = self.buffer.prefix(upTo: end); self.buffer.removeSubrange(...end)
                        if let payload = try? JSONSerialization.jsonObject(with: line) as? [String: Any], payload["type"] as? String == "snapshot" { self.receive(payload) }
                    }
                }
            }
            process.terminationHandler = { [weak self] ended in
                DispatchQueue.main.async {
                    guard let self, self.child === ended else { return }
                    self.output?.fileHandleForReading.readabilityHandler = nil; self.child = nil; self.input = nil; self.output = nil
                    guard !self.stopping else { return }
                    self.failures += 1; self.store.backendError = "后台已暂停，正在自动重新启动；登录与消息仍保留。"; self.updateItem()
                    DispatchQueue.main.asyncAfter(deadline: .now() + min(pow(2, Double(self.failures)), 60)) { self.launchBackend() }
                }
            }
            try process.run()
        } catch {
            child = nil; store.backendError = "无法启动后台。首次启动需要已安装的 Codex/ChatGPT 内置运行环境。"; updateItem()
        }
    }
    func receive(_ payload: [String: Any]) {
        store.snapshot = ResetSnapshot(payload); store.backendError = ""; lastSnapshot = Date(); failures = 0
        updateItem()
        if popover.isShown && !store.snapshot.unread.isEmpty && readSent != store.snapshot.unread {
            readSent = store.snapshot.unread; send("read")
        }
        if store.snapshot.unread.isEmpty { readSent = [] }
        if let notice = store.snapshot.notification, let key = notice["key"] as? String, key != lastNotice {
            lastNotice = key
            if store.notifications && !popover.isShown, let at = notice["at"] as? Double, abs(Date().timeIntervalSince1970 * 1000 - at) < 60000 {
                let content = UNMutableNotificationContent(); content.title = "Tibo 有新的重置消息"
                content.body = notice["text"] as? String ?? "点击菜单栏查看原文"; content.sound = .default
                UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: key, content: content, trigger: nil))
            }
        }
    }
    func send(_ action: String) {
        guard let process = child, process.isRunning, let bytes = try? JSONSerialization.data(withJSONObject: ["action": action]) else { return }
        try? input?.fileHandleForWriting.write(contentsOf: bytes + Data([10]))
    }
    func action(_ action: String) {
        if action == "disconnect" {
            popover.performClose(nil)
            let alert = NSAlert(); alert.messageText = "断开 X 并清除此 App 的登录？"
            alert.informativeText = "以后需要重新登录。已保存的公开公告会保留。网络故障可以先尝试“立即检查”。"
            alert.addButton(withTitle: "保留连接"); alert.addButton(withTitle: "断开并清除")
            NSApp.activate(ignoringOtherApps: true)
            guard alert.runModal() == .alertSecondButtonReturn else { return }
        }
        if child == nil && action != "disconnect" { launchBackend() }
        if action == "connect" { popover.performClose(nil) }
        send(action)
    }
    @objc func wake() { lastSnapshot = Date(); send("wake") }
    func checkBackend() {
        if FileManager.default.fileExists(atPath: data.appendingPathComponent("stop.request").path) { NSApp.terminate(nil); return }
        if child != nil && Date().timeIntervalSince(lastSnapshot) > 30 {
            store.backendError = "后台暂未响应，正在恢复；下方为已保存的公告。"; updateItem()
            child?.terminate()
        }
    }
    func updateItem() {
        let value = store.snapshot
        let symbol = !store.backendError.isEmpty || value.state == "error" || value.state == "login-required" ? "exclamationmark.arrow.circlepath" : "arrow.clockwise.circle"
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: "Tibo Reset，\(value.stateTitle)") ?? NSImage(systemSymbolName: "arrow.clockwise.circle", accessibilityDescription: "Tibo Reset")
        image?.isTemplate = true; item?.button?.image = image
        item?.button?.imagePosition = .imageLeading
        item?.button?.title = value.unread.isEmpty ? "" : " \(value.unread.count)"
        item?.button?.font = .monospacedDigitSystemFont(ofSize: 11, weight: .medium)
        item?.button?.toolTip = "Tibo Reset · \(value.stateTitle)\(value.unread.isEmpty ? "" : " · \(value.unread.count) 条未读")"
    }
    func configurePopover() {
        let controller = MenuPanelController(store: store)
        panelController = controller
        popover.behavior = .transient; popover.animates = false; popover.delegate = self
        popover.contentViewController = controller
        resizePopover()
    }
    func resizePopover(visibleFrame: NSRect? = nil) {
        let screen = item?.button?.window?.screen ?? NSScreen.main
        let frame = visibleFrame ?? screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1024, height: 768)
        let size = MenuPanelLayout.size(in: frame)
        if store.panelSize != size { store.panelSize = size }
        // Resize the popup before its content view; doing this in the opposite
        // order can leave AppKit's window at the previous, larger height.
        popover.contentSize = size
        panelController?.preferredContentSize = size
        panelController?.view.setFrameSize(size)
        panelController?.view.layoutSubtreeIfNeeded()
        popover.contentSize = size
        if popover.isShown {
            DispatchQueue.main.async {
                guard self.store.panelSize == size else { return }
                self.panelController?.view.layoutSubtreeIfNeeded()
                self.popover.contentSize = size
                self.keepPopoverOnScreen()
            }
        }
    }
    func keepPopoverOnScreen() {
        guard popover.isShown, let window = panelController?.view.window,
              let screen = item?.button?.window?.screen ?? window.screen else { return }
        let visible = screen.visibleFrame
        let frame = window.frame
        let origin = NSPoint(x: min(max(frame.minX, visible.minX), visible.maxX - frame.width),
                             y: min(max(frame.minY, visible.minY), visible.maxY - frame.height))
        if abs(frame.minX - origin.x) > 0.5 || abs(frame.minY - origin.y) > 0.5 { window.setFrameOrigin(origin) }
    }
    func popoverDidShow(_ notification: Notification) {
        keepPopoverOnScreen()
        // AppKit may perform its final anchor placement on the next turn.
        DispatchQueue.main.async { self.keepPopoverOnScreen() }
    }
    @objc func screenLayoutChanged() { resizePopover() }
    @objc func toggle() {
        guard let button = item.button else { return }
        if popover.isShown { popover.performClose(nil) }
        else {
            resizePopover()
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            NSApp.activate(ignoringOtherApps: true)
            if !store.snapshot.unread.isEmpty { readSent = store.snapshot.unread; send("read") }
        }
    }
    var agentURL: URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/com.tiboreset.monitor.plist") }
    func setLogin(_ enabled: Bool) {
        do {
            if enabled {
                let job: [String: Any] = ["Label": "com.tiboreset.monitor", "ProgramArguments": [Bundle.main.executableURL!.path],
                    "RunAtLoad": true, "KeepAlive": ["SuccessfulExit": false], "ThrottleInterval": 10,
                    "EnvironmentVariables": ["TIBO_RESET_DATA_DIR": data.path]]
                try FileManager.default.createDirectory(at: agentURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                try PropertyListSerialization.data(fromPropertyList: job, format: .xml, options: 0).write(to: agentURL, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: agentURL.path)
            } else if FileManager.default.fileExists(atPath: agentURL.path) { try FileManager.default.removeItem(at: agentURL) }
            let task = Process(); task.executableURL = URL(fileURLWithPath: "/bin/launchctl")
            task.arguments = [enabled ? "enable" : "disable", "gui/\(getuid())/com.tiboreset.monitor"]
            task.standardOutput = FileHandle.nullDevice; task.standardError = FileHandle.nullDevice; try task.run()
            store.launchAtLogin = enabled
        } catch { store.backendError = "无法更改登录时启动设置，请重试。" }
    }
    func setNotifications(_ enabled: Bool) {
        if !enabled { store.notifications = false; UserDefaults.standard.set(false, forKey: "notifyNewPosts"); return }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { allowed, _ in
            DispatchQueue.main.async { self.store.notifications = allowed; UserDefaults.standard.set(allowed, forKey: "notifyNewPosts") }
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async { if !self.popover.isShown { self.toggle() } }; completionHandler()
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if stopping { return .terminateNow }
        stopping = true; timer?.invalidate(); popover.performClose(nil)
        if let item { NSStatusBar.system.removeStatusItem(item) }
        guard let child, child.isRunning else { return .terminateNow }
        output?.fileHandleForReading.readabilityHandler = nil
        send("stop"); try? input?.fileHandleForWriting.close(); child.terminate()
        DispatchQueue.global().async {
            child.waitUntilExit()
            DispatchQueue.main.async { NSApp.reply(toApplicationShouldTerminate: true) }
        }
        return .terminateLater
    }
    func applicationWillTerminate(_ notification: Notification) {
        if ownsLock { try? FileManager.default.removeItem(at: data.appendingPathComponent("menubar.pid")) }
    }
    func showFailure(_ text: String) { let alert = NSAlert(); alert.messageText = text; alert.runModal() }
    func testPopoverLayout() {
        let args = CommandLine.arguments
        guard let index = args.firstIndex(of: "--layout-test"), args.count > index + 1 else { exit(2) }
        let destination = URL(fileURLWithPath: args[index + 1])
        let text = String(repeating: "Public fixture: a long reset announcement with quoted context. ", count: 30)
        let records: [[String: Any]] = (0..<11).map { number in
            ["id": "\(1000 + number)", "url": "https://x.com/thsottiaux/status/\(1000 + number)", "text": text,
             "publishedAt": "2026-10-16T06:20:00Z", "status": "scheduled", "parserState": "done", "timePhrase": "Later today",
             "threadContext": [["text": text], ["text": text]]]
        }
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = NSImage(systemSymbolName: "arrow.clockwise.circle", accessibilityDescription: "Layout test")
        configurePopover()
        var reports: [[String: Any]] = []
        func region(_ name: String, in root: NSView) -> NSView? {
            if root.identifier?.rawValue == "tibo-panel-" + name { return root }
            return root.subviews.lazy.compactMap { region(name, in: $0) }.first
        }
        func check(_ name: String, cap: CGFloat?, then next: @escaping () -> Void) {
            if let cap, let frame = item.button?.window?.screen?.visibleFrame {
                resizePopover(visibleFrame: NSRect(x: frame.minX, y: frame.minY, width: frame.width, height: min(cap, frame.height)))
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                guard let root = self.panelController?.view, let window = root.window,
                      let screen = self.item.button?.window?.screen,
                      let header = region("header", in: root), let footer = region("footer", in: root),
                      let connection = region("connection", in: root) else { fputs("Missing popover layout regions\n", stderr); exit(1) }
                root.layoutSubtreeIfNeeded()
                let viewport = window.convertToScreen(root.convert(root.bounds, to: nil))
                let visible = screen.visibleFrame.insetBy(dx: -1, dy: -1)
                let bounds = root.bounds.insetBy(dx: -1, dy: -1)
                let pinned = [header, connection, footer].allSatisfy { view in
                    let rect = view.convert(view.bounds, to: root)
                    return rect.height > 1 && bounds.contains(rect)
                }
                guard visible.contains(viewport), pinned, root.bounds.height <= self.store.panelSize.height + 1,
                      window.frame.height <= self.store.panelSize.height + 40 else {
                    fputs("Clipped popover in \(name): window=\(window.frame), viewport=\(viewport), screen=\(visible), target=\(self.store.panelSize), content=\(self.popover.contentSize), min=\(window.minSize), contentMin=\(window.contentMinSize), pinned=\(pinned), anchor=\(String(describing: self.item.button?.window?.frame))\n", stderr); exit(1)
                }
                reports.append(["case": name, "height": root.bounds.height, "windowHeight": window.frame.height,
                                "headerVisible": true, "connectionVisible": true, "footerVisible": true, "insideScreen": true])
                next()
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            self.store.snapshot = ResetSnapshot(["xState": "ready", "records": records])
            self.toggle()
            check("11-long-announcements", cap: nil) {
                // Update the same open popup, exercising the path a refresh
                // follows rather than rendering a fixed offscreen preview.
                self.store.snapshot = ResetSnapshot(["xState": "error", "records": records,
                    "xError": String(repeating: "网络故障，正在等待重试。", count: 20), "xRetryAt": 1792153111426.0])
                check("open-menu-error-update", cap: nil) {
                    check("short-screen", cap: 380) {
                        self.store.snapshot = ResetSnapshot(["xState": "ready", "records": []])
                        check("short-screen-empty-state", cap: 380) {
                            do { try JSONSerialization.data(withJSONObject: reports).write(to: destination) }
                            catch { exit(1) }
                            NSApp.terminate(nil)
                        }
                    }
                }
            }
        }
    }
    func preview() {
        let args = CommandLine.arguments
        guard let index = args.firstIndex(of: "--preview"), args.count > index + 2 else { NSApp.terminate(nil); return }
        let theme = args[index + 1], destination = args[index + 2]
        store.snapshot = ResetSnapshot(["xState": "ready", "xCheckedAt": 1792134300000.0, "displayTimezone": "Asia/Shanghai", "unreadIds": ["102"], "records": [
            ["id": "102", "url": "https://x.com/thsottiaux/status/102", "text": "Put the reset in the bag. All propagated.", "publishedAt": "2026-10-16T06:20:00Z", "status": "completed", "parserState": "done", "threadContext": [["text": "Day 8/ Reset"]]],
            ["id": "101", "url": "https://x.com/thsottiaux/status/101", "text": "Global reset landing by EOD PST time. Enjoy", "publishedAt": "2026-10-16T01:03:59Z", "status": "scheduled", "parserState": "done", "timeKind": "deadline", "timePhrase": "by EOD PST time", "precision": "day", "resetDate": "2026-10-15", "timezone": "PST"]]])
        NSApp.appearance = NSAppearance(named: theme == "dark" ? .darkAqua : .aqua)
        let view = NSHostingView(rootView: ResetMenuView(store: store))
        // NSHostingView can report a 1×1 fitting size before it has a window.
        // Give this two-card fixture a deterministic canvas for visual QA.
        let size = NSSize(width: 380, height: 554)
        view.frame = NSRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = view; window.orderFront(nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            view.setFrameSize(size)
            view.layoutSubtreeIfNeeded()
            if let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                view.cacheDisplay(in: view.bounds, to: bitmap)
                if let bytes = bitmap.representation(using: .png, properties: [:]) { try? bytes.write(to: URL(fileURLWithPath: destination)) }
            }
            NSApp.terminate(nil)
        }
    }
}

@main
enum MenuBarMain {
    static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        let delegate = ResetMenuApp()
        application.delegate = delegate
        application.run()
    }
}
