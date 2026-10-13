import AppKit
import Network
import Darwin

// Event counters/timing only. No keystrokes, accessibility access or window content.
private let inputEvents: [CGEventType] = [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel]
private func inputToken() -> [UInt32] {
    inputEvents.map { CGEventSource.counterForEventType(.combinedSessionState, eventType: $0) }
}
private func idleSeconds() -> Double {
    let value = inputEvents.map { CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: $0) }.min() ?? 0
    return value.isFinite ? value : 0
}
private func canonical(_ url: URL) -> URL { url.standardizedFileURL.resolvingSymlinksInPath() }
private func identity(_ app: NSRunningApplication) -> String {
    "\(app.processIdentifier):\(app.launchDate?.timeIntervalSince1970 ?? 0)"
}
private func processArguments(_ pid: pid_t) -> [String]? {
    var query: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
    var size = 0
    guard sysctl(&query, 3, nil, &size, nil, 0) == 0, size >= 4, size <= 4 * 1024 * 1024 else { return nil }
    var bytes = [UInt8](repeating: 0, count: size)
    guard sysctl(&query, 3, &bytes, &size, nil, 0) == 0 else { return nil }
    let count = bytes.withUnsafeBytes { Int($0.loadUnaligned(as: Int32.self)) }
    guard count > 0, count < 8192 else { return nil }
    var cursor = 4
    while cursor < size && bytes[cursor] != 0 { cursor += 1 }
    while cursor < size && bytes[cursor] == 0 { cursor += 1 }
    var result: [String] = []
    for _ in 0..<count {
        let start = cursor
        while cursor < size && bytes[cursor] != 0 { cursor += 1 }
        guard cursor < size, let text = String(bytes: bytes[start..<cursor], encoding: .utf8) else { return nil }
        result.append(text); cursor += 1
    }
    return result
}
private func hasDebugging(_ args: [String]) -> Bool {
    args.contains { $0 == "--remote-debugging-port" || $0.hasPrefix("--remote-debugging-port=") || $0 == "--remote-debugging-pipe" }
}

final class IconStartup {
    private let appURL: URL, receiptURL: URL, port: UInt16
    private var seen = Set<String>(), observers: [NSObjectProtocol] = []
    private var busy = false, lastAttempt: Double = 0
    private var lock: Int32 = -1
    init(app: URL, port: UInt16, receipt: URL) throws {
        appURL = canonical(app); self.port = port; receiptURL = receipt
        lock = Darwin.open(receipt.path + ".lock", O_CREAT | O_RDWR, 0o600)
        guard lock >= 0, flock(lock, LOCK_EX | LOCK_NB) == 0 else { throw NSError(domain: "startup-already-running", code: 1) }
        if FileManager.default.fileExists(atPath: receipt.path) {
            let data = try Data(contentsOf: receipt)
            guard let prior = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let value = prior["lastAttempt"] as? Double, value.isFinite, value >= 0 else {
                throw NSError(domain: "invalid-startup-receipt", code: 2)
            }
            lastAttempt = value
        }
        seen = Set(instances().map(identity)) // Existing work is never a launch candidate.
        try record("watching")
    }
    private func instances() -> [NSRunningApplication] {
        NSWorkspace.shared.runningApplications.filter { app in
            guard !app.isTerminated, let bundle = app.bundleURL, canonical(bundle) == appURL,
                  app.launchDate != nil, let expected = app.executableURL else { return false }
            var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
            guard proc_pidpath(app.processIdentifier, &buffer, UInt32(buffer.count)) > 0 else { return false }
            return canonical(URL(fileURLWithPath: String(cString: buffer))) == canonical(expected)
        }
    }
    private func safety(_ app: NSRunningApplication) -> LaunchSafety {
        let args = processArguments(app.processIdentifier)
        return LaunchSafety(age: Date().timeIntervalSince(app.launchDate ?? .distantPast), idle: idleSeconds(),
            argumentsKnown: args != nil, hasDebugging: args.map(hasDebugging) ?? true,
            ordinaryLaunch: args?.dropFirst().allSatisfy { $0.hasPrefix("-psn_") } ?? false,
            finished: app.isFinishedLaunching, foreground: NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
            instances: instances().count, sinceAttempt: Date().timeIntervalSince1970 - lastAttempt)
    }
    private func record(_ event: String) throws {
        let payload: [String: Any] = ["event": event, "lastAttempt": lastAttempt, "updatedAt": Date().timeIntervalSince1970 * 1000]
        try JSONSerialization.data(withJSONObject: payload).write(to: receiptURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: receiptURL.path)
    }
    private func finish(_ event: String) { busy = false; try? record(event) }
    func start() {
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification, NSWorkspace.didActivateApplicationNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.check() })
        }
        // Some desktop builds omit launch notifications. The native fallback does no process spawning.
        Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.check() }
    }
    private func check() {
        guard !busy else { return }
        let apps = instances()
        if seen.count > 256 { seen = Set(apps.map(identity)) }
        guard apps.count == 1, let app = apps.first else { seen.formUnion(apps.map(identity)); return }
        let key = identity(app)
        guard !seen.contains(key) else { return }
        let decision = safety(app).decision
        if decision == "wait" { return }
        seen.insert(key)
        guard decision == "connect" else { try? record(decision); return }
        busy = true
        let token = inputToken()
        let connection = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
        var resolved = false
        let resolve: (Bool) -> Void = { [weak self] free in
            guard !resolved else { return }; resolved = true; connection.cancel()
            guard let self else { return }
            guard free else { self.finish("port-in-use"); return }
            guard self.instances().contains(where: { identity($0) == key }), self.safety(app).decision == "connect", inputToken() == token else {
                self.finish("launch-changed"); return
            }
            self.lastAttempt = Date().timeIntervalSince1970
            // Persist before requesting a graceful exit, so restarts cannot form a relaunch loop.
            do { try self.record("connecting") } catch { self.finish("receipt-failed"); return }
            guard app.terminate() else { self.finish("quit-refused"); return }
            self.awaitExit(key, token, deadline: Date().addingTimeInterval(10))
        }
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready: resolve(false)
            case .failed(let error), .waiting(let error):
                if case .posix(.ECONNREFUSED) = error { resolve(true) } else { resolve(false) }
            default: break
            }
        }
        connection.start(queue: .main)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { resolve(false) }
    }
    private func awaitExit(_ key: String, _ token: [UInt32], deadline: Date) {
        let apps = instances()
        guard inputToken() == token else { finish("canceled-by-input"); return }
        guard !apps.contains(where: { identity($0) != key }) else { seen.formUnion(apps.map(identity)); finish("another-instance"); return }
        if apps.isEmpty {
            let foreground = NSWorkspace.shared.frontmostApplication?.processIdentifier
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.reopen(token, foreground) }
        } else if deadline.timeIntervalSinceNow > 0 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in self?.awaitExit(key, token, deadline: deadline) }
        } else { finish("quit-timeout") }
    }
    private func reopen(_ token: [UInt32], _ foreground: pid_t?) {
        guard instances().isEmpty, inputToken() == token, NSWorkspace.shared.frontmostApplication?.processIdentifier == foreground else {
            seen.formUnion(instances().map(identity)); finish("reopen-canceled"); return
        }
        let config = NSWorkspace.OpenConfiguration()
        config.arguments = ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=\(port)"]
        config.activates = false; config.hides = true; config.addsToRecentItems = false
        config.allowsRunningApplicationSubstitution = false
        config.promptsUserIfNeeded = false
        var completed = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard !completed else { return }; completed = true; self?.finish("open-timeout")
        }
        NSWorkspace.shared.openApplication(at: appURL, configuration: config) { [weak self] app, error in
            DispatchQueue.main.async {
                guard !completed else { return }; completed = true
                guard let self else { return }
                guard let app, error == nil else { self.finish("open-failed"); return }
                self.seen.insert(identity(app))
                let args = processArguments(app.processIdentifier) ?? []
                guard args.contains("--remote-debugging-port=\(self.port)") else { self.finish("open-raced"); return }
                if inputToken() == token, NSWorkspace.shared.frontmostApplication?.processIdentifier == foreground {
                    app.unhide(); app.activate(options: [.activateAllWindows])
                }
                self.finish("connected")
            }
        }
    }
}

@main struct StartupMain {
    static func main() {
        guard CommandLine.arguments.count == 4, let port = UInt16(CommandLine.arguments[2]), port >= 1024 else { exit(2) }
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)
        do {
            let watcher = try IconStartup(app: URL(fileURLWithPath: CommandLine.arguments[1]), port: port,
                receipt: URL(fileURLWithPath: CommandLine.arguments[3]))
            watcher.start()
            withExtendedLifetime(watcher) { application.run() }
        } catch { fputs("Tibo Reset: startup watcher unavailable\n", stderr); exit(1) }
    }
}
