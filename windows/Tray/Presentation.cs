using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TiboReset;

internal sealed record Announcement(string Id, string Text, string Url, string PublishedAt, string Status,
    string ParserState, string TimeKind, string TimePhrase, string ResetDate, string ResetAt, string Timezone, string Precision, string[] Parents)
{
    public string Heading => ParserState switch {
        "pending" => "重置消息 · 正在解释", "failed" => "重置消息 · 原文已保存",
        _ => Status switch { "completed" => "作者宣布已完成", "scheduled" => "计划重置", "cancelled" => "计划已取消", _ => "重置相关消息" }
    };
    public static Announcement? Parse(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object) return null;
        string Read(string name) => JsonValue.String(value, name);
        var id = Read("id"); var url = Read("url");
        if (!Regex.IsMatch(id, "^[0-9]{1,25}$") || url != "https://x.com/thsottiaux/status/" + id || string.IsNullOrWhiteSpace(Read("text"))) return null;
        var parents = value.TryGetProperty("threadContext", out var context) && context.ValueKind == JsonValueKind.Array
            ? context.EnumerateArray().Take(2).Select(p => JsonValue.String(p, "text")).Where(p => p.Length > 0).ToArray() : [];
        return new(id, Read("text"), url, Read("publishedAt"), Read("status"), Read("parserState"), Read("timeKind"), Read("timePhrase"),
            Read("resetDate"), Read("resetAt"), Read("timezone"), Read("precision"), parents);
    }
    public string? Timing(string zone)
    {
        if (Status == "completed") return "个人账户状态请以客户端为准";
        if (Status == "cancelled") return null;
        if (TimeKind == "deadline" && Regex.IsMatch(TimePhrase, @"\bEOD\b|end of (?:the )?day", RegexOptions.IgnoreCase)) {
            var end = Presentation.DayEnd(ResetDate, Timezone);
            return end.HasValue ? $"计划于 {Presentation.Clock(end.Value, zone)} 前完成（{Presentation.ZoneLabel(zone)}，按日末估算）"
                : $"计划在所述当天结束前完成 · {TimePhrase}（无精确钟点）";
        }
        if (Precision == "exact" && DateTimeOffset.TryParse(ResetAt, CultureInfo.InvariantCulture, DateTimeStyles.None, out var exact))
            return $"{(TimeKind == "deadline" ? "预计最晚完成" : "预计重置")}：{Presentation.Clock(exact, zone)}（{Presentation.ZoneLabel(zone)}）";
        if (TimePhrase.Length > 0) return "计划时间：" + TimePhrase;
        return Precision == "day" && ResetDate.Length > 0 ? $"计划日期：{ResetDate} {Timezone}（具体时间待定）" : null;
    }
}

internal static class JsonValue
{
    public static string String(JsonElement value, string key) => value.ValueKind == JsonValueKind.Object && value.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.String ? field.GetString() ?? "" : "";
    public static double Number(JsonElement value, string key) => value.ValueKind == JsonValueKind.Object && value.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.Number && field.TryGetDouble(out var number) ? number : 0;
}

internal sealed record Snapshot(string State, string Error, string Zone, DateTimeOffset? CheckedAt,
    DateTimeOffset? RetryAt, int PollSeconds, string[] Unread, Announcement[] Records, string RecordKey, string NoticeKey, string NoticeText, double NoticeAt)
{
    public static Snapshot Empty => new("loading", "", "Asia/Shanghai", null, null, 60, [], [], "", "", "", 0);
    public string StateTitle => State switch {
        "ready" => "X 已连接", "loading" => "正在检查 X", "login-required" => "X 需要登录", "error" => "X 连接待恢复",
        "disconnected" => "X 已断开", "disconnecting" => "正在断开 X", _ => "正在检查 X"
    };
    public static Snapshot Parse(JsonElement value)
    {
        var records = value.TryGetProperty("records", out var list) && list.ValueKind == JsonValueKind.Array ? list.EnumerateArray().Take(60).Select(Announcement.Parse).OfType<Announcement>().ToArray() : [];
        var unread = value.TryGetProperty("unreadIds", out var ids) && ids.ValueKind == JsonValueKind.Array ? ids.EnumerateArray().Where(p => p.ValueKind == JsonValueKind.String).Select(p => p.GetString()!).ToArray() : [];
        var zone = JsonValue.String(value, "displayTimezone");
        var notice = value.TryGetProperty("notification", out var n) && n.ValueKind == JsonValueKind.Object ? n : default;
        DateTimeOffset? Time(string key) { var ms = JsonValue.Number(value, key); return ms > 0 && ms < 253402300799000 ? DateTimeOffset.FromUnixTimeMilliseconds((long)ms) : null; }
        return new(JsonValue.String(value, "xState"), JsonValue.String(value, "xError"), zone.Length > 0 ? zone : "Asia/Shanghai", Time("xCheckedAt"), Time("xRetryAt"),
            (int)JsonValue.Number(value, "pollSeconds"), unread, records, list.ValueKind == JsonValueKind.Array ? list.GetRawText() : "[]",
            JsonValue.String(notice, "key"), JsonValue.String(notice, "text"), JsonValue.Number(notice, "at"));
    }
}

internal static class Presentation
{
    public static string ZoneLabel(string zone) => zone == "Asia/Shanghai" ? "北京时间" : zone;
    public static TimeZoneInfo? Zone(string zone)
    {
        var fixedHours = zone switch { "PST" => -8, "PDT" => -7, "UTC" or "GMT" => 0, _ => (int?)null };
        if (fixedHours.HasValue) return TimeZoneInfo.CreateCustomTimeZone(zone, TimeSpan.FromHours(fixedHours.Value), zone, zone);
        var match = Regex.Match(zone, @"^(?:UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?$");
        if (match.Success) {
            var hours = int.Parse(match.Groups[2].Value); var minutes = match.Groups[3].Success ? int.Parse(match.Groups[3].Value) : 0;
            if (hours * 60 + minutes > 840 || minutes > 59) return null;
            return TimeZoneInfo.CreateCustomTimeZone(zone, TimeSpan.FromMinutes((hours * 60 + minutes) * (match.Groups[1].Value == "+" ? 1 : -1)), zone, zone);
        }
        try { return TimeZoneInfo.FindSystemTimeZoneById(zone == "PT" ? "America/Los_Angeles" : zone); } catch { return null; }
    }
    public static DateTimeOffset? DayEnd(string date, string zone)
    {
        if (!DateTime.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day) || Zone(zone) is not { } tz) return null;
        try { return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(day.AddDays(1), DateTimeKind.Unspecified), tz)); } catch { return null; }
    }
    public static string Clock(DateTimeOffset date, string zone) => TimeZoneInfo.ConvertTime(date, Zone(zone) ?? TimeZoneInfo.Utc).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
}
