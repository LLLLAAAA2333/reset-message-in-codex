using System.Text.Json;
using TiboReset;

static void Check(bool value, string message) { if (!value) throw new Exception(message); }
static Announcement Record(string extra = "") {
    using var value = JsonDocument.Parse("{\"id\":\"101\",\"url\":\"https://x.com/thsottiaux/status/101\",\"text\":\"Reset by EOD PST\",\"status\":\"scheduled\",\"timeKind\":\"deadline\",\"timePhrase\":\"by EOD PST\",\"resetDate\":\"2026-10-12\",\"timezone\":\"PST\"" + extra + "}");
    return Announcement.Parse(value.RootElement)!;
}
Check(Record().Timing("Asia/Shanghai")!.Contains("2026-10-13 16:00") && Record().Timing("Asia/Shanghai")!.Contains("按日末估算"), "EOD is a boundary estimate");
Check(Record(",\"timezone\":\"PT\"").Timing("Asia/Shanghai")!.Contains("2026-10-13 15:00"), "PT must use summer time");
Check(Record(",\"timezone\":\"PT\",\"resetDate\":\"2026-11-01\"").Timing("Asia/Shanghai")!.Contains("2026-11-02 16:00"), "DST end");
Check(Record(",\"timezone\":\"PT\",\"resetDate\":\"2026-03-08\"").Timing("Asia/Shanghai")!.Contains("2026-03-09 15:00"), "DST start");
Check(Record(",\"timezone\":\"UTC+05:30\"").Timing("Asia/Shanghai")!.Contains("2026-10-13 02:30"), "Fixed offset");
Check(Record(",\"resetDate\":\"2026-02-30\"").Timing("Asia/Shanghai")!.Contains("无精确钟点"), "Invalid date");
Check(Record(",\"status\":\"completed\"").Timing("Asia/Shanghai")!.Contains("以客户端为准"), "Author completion is not a personal reset");
Check(Record(",\"url\":\"https://evil.example/\"") is null, "Reject untrusted source links");
using var nulls = JsonDocument.Parse("{\"records\":[],\"notification\":null,\"xRetryAt\":null,\"xCheckedAt\":null}");
var snapshot = Snapshot.Parse(nulls.RootElement); Check(snapshot.Records.Length == 0 && snapshot.RetryAt is null && snapshot.NoticeKey == "", "Nullable protocol fields");
using var bad = JsonDocument.Parse("{\"records\":[{\"id\":\"1\",\"url\":\"https://evil.example/\",\"text\":\"bad\"}]}");
Check(Snapshot.Parse(bad.RootElement).Records.Length == 0, "Invalid posts must not render");
Console.WriteLine("PASS Windows presentation: source validation, null protocol fields, status semantics, EOD, PST/PT, daylight saving and invalid dates");
