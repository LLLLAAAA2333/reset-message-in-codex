import Foundation
import CoreGraphics

enum MenuPanelLayout {
    static let preferredSize = CGSize(width: 380, height: 554)
    static func size(in visibleFrame: CGRect) -> CGSize {
        // Leave room for the popover's arrow, frame and screen edges.
        CGSize(width: max(1, min(preferredSize.width, visibleFrame.size.width - 24)),
               height: max(1, min(preferredSize.height, visibleFrame.size.height - 40)))
    }
}

struct ResetPost: Identifiable {
    let id: String, text: String, url: String, publishedAt: String
    let status: String, parserState: String, summary: String, precision: String
    let timeKind: String, timePhrase: String, resetDate: String, resetAt: String, timezone: String
    let parents: [String]
    init?(_ value: [String: Any]) {
        guard let id = value["id"] as? String, id.range(of: "^[0-9]{1,25}$", options: .regularExpression) != nil,
              let url = value["url"] as? String, url == "https://x.com/thsottiaux/status/" + id,
              let text = value["text"] as? String else { return nil }
        self.id = id; self.url = url; self.text = String(text.prefix(12000))
        func string(_ key: String) -> String { value[key] as? String ?? "" }
        publishedAt = string("publishedAt"); status = string("status"); parserState = string("parserState")
        summary = string("summary"); precision = string("precision"); timeKind = string("timeKind")
        timePhrase = string("timePhrase"); resetDate = string("resetDate"); resetAt = string("resetAt"); timezone = string("timezone")
        parents = (value["threadContext"] as? [[String: Any]] ?? []).prefix(2).compactMap { $0["text"] as? String }
    }
    var statusTitle: String {
        if parserState == "pending" { return "重置消息 · 正在解释" }
        if parserState == "failed" { return "重置消息 · 原文已保存" }
        return ["completed": "作者宣布已完成", "scheduled": "计划重置", "cancelled": "计划已取消"][status] ?? "重置相关消息"
    }
    var symbol: String {
        ["completed": "checkmark.circle.fill", "scheduled": "clock", "cancelled": "xmark.circle"][status] ?? "text.bubble"
    }
    func timing(zone: String) -> String? {
        if status == "completed" { return "个人账户状态请以客户端为准" }
        if status == "cancelled" { return nil }
        if timeKind == "deadline" && timePhrase.range(of: "\\bEOD\\b|end of (?:the )?day", options: [.regularExpression, .caseInsensitive]) != nil {
            // EOD is a day boundary estimate, never an exact announced clock.
            if let end = Self.dayBoundary(resetDate, zone: timezone, nextDay: true) {
                return "计划于 \(Self.clock(end, zone: zone)) 前完成（\(Self.zoneLabel(zone))，按日末估算）"
            }
            return "计划在所述当天结束前完成 · \(timePhrase)（无精确钟点）"
        }
        if precision == "exact", let date = Self.date(resetAt) {
            return "\(timeKind == "deadline" ? "预计最晚完成" : "预计重置")：\(Self.clock(date, zone: zone))（\(Self.zoneLabel(zone))）"
        }
        if !timePhrase.isEmpty { return "计划时间：\(timePhrase)" }
        if precision == "day", !resetDate.isEmpty { return "计划日期：\(resetDate) \(timezone)（具体时间待定）" }
        return nil
    }
    var timeHelp: String {
        "原文未提供精确钟点；日末换算仅为边界估算。" + (timezone == "PST" ? "PST 按 UTC−8；若作者泛指太平洋当地夏令时，结果会提前一小时。" : "")
    }
    static func zoneLabel(_ zone: String) -> String { zone == "Asia/Shanghai" ? "北京时间" : zone }
    static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]; return formatter.date(from: value)
    }
    static func clock(_ date: Date, zone: String) -> String {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = TimeZone(identifier: zone) ?? TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd HH:mm"; return formatter.string(from: date)
    }
    static func dayBoundary(_ value: String, zone: String, nextDay: Bool) -> Date? {
        guard value.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil else { return nil }
        let fixed = ["PST": -8 * 3600, "PDT": -7 * 3600, "UTC": 0, "GMT": 0]
        var tz = fixed[zone].flatMap { TimeZone(secondsFromGMT: $0) }
        if tz == nil, let match = zone.range(of: "^(?:UTC|GMT)[+-]\\d{1,2}(?::?\\d{2})?$", options: .regularExpression) {
            let offset = String(zone[match].dropFirst(3)), sign = offset.first == "-" ? -1 : 1
            let digits = String(offset.dropFirst()).replacingOccurrences(of: ":", with: "")
            let hours = Int(digits.count > 2 ? String(digits.dropLast(2)) : digits) ?? 99
            let minutes = digits.count > 2 ? Int(digits.suffix(2)) ?? 99 : 0
            guard hours * 60 + minutes <= 840, minutes < 60 else { return nil }
            tz = TimeZone(secondsFromGMT: sign * (hours * 3600 + minutes * 60))
        }
        if tz == nil { tz = TimeZone(identifier: zone == "PT" ? "America/Los_Angeles" : zone) }
        guard let tz else { return nil }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = tz; formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        guard let date = formatter.date(from: value), formatter.string(from: date) == value else { return nil }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = tz
        return nextDay ? calendar.date(byAdding: .day, value: 1, to: date) : date
    }
}

struct ResetSnapshot {
    var records: [ResetPost] = []
    var unread: [String] = []
    var state = "loading", error = "", zone = "Asia/Shanghai"
    var checkedAt: Date?, retryAt: Date?
    var pollSeconds = 60
    var notification: [String: Any]?
    init(_ value: [String: Any] = [:]) {
        records = (value["records"] as? [[String: Any]] ?? []).compactMap(ResetPost.init)
        unread = value["unreadIds"] as? [String] ?? []
        state = value["xState"] as? String ?? "loading"; error = value["xError"] as? String ?? ""
        zone = value["displayTimezone"] as? String ?? "Asia/Shanghai"
        if let ms = value["xCheckedAt"] as? Double { checkedAt = Date(timeIntervalSince1970: ms / 1000) }
        if let ms = value["xRetryAt"] as? Double { retryAt = Date(timeIntervalSince1970: ms / 1000) }
        pollSeconds = value["pollSeconds"] as? Int ?? 60
        notification = value["notification"] as? [String: Any]
    }
    var stateTitle: String {
        ["ready": "X 已连接", "loading": "正在检查 X", "login-required": "X 需要登录", "error": "X 连接待恢复",
         "disconnected": "X 已断开", "disconnecting": "正在断开 X"][state] ?? "正在检查 X"
    }
}
