import Foundation
import CoreGraphics

@main enum MenuModelTests {
    static func main() {
        for height in [320.0, 380, 600, 900, 1440] {
            let size = MenuPanelLayout.size(in: CGRect(x: 1920, y: -400, width: 1080, height: height))
            assert(size.height <= height - 40); assert(size.height <= MenuPanelLayout.preferredSize.height)
        }
        assert(MenuPanelLayout.size(in: CGRect(x: 0, y: 0, width: 360, height: 600)).width == 336)
        let base: [String: Any] = ["id": "101", "url": "https://x.com/thsottiaux/status/101", "text": "Reset by EOD PST.",
            "status": "scheduled", "timeKind": "deadline", "timePhrase": "by EOD PST", "resetDate": "2026-10-12", "timezone": "PST", "precision": "day"]
        func post(_ extra: [String: Any] = [:]) -> ResetPost { ResetPost(base.merging(extra) { _, new in new })! }
        assert(post().timing(zone: "Asia/Shanghai")!.contains("2026-10-13 16:00"))
        assert(post().timing(zone: "Asia/Shanghai")!.contains("按日末估算"))
        assert(post(["timezone": "PT"]).timing(zone: "Asia/Shanghai")!.contains("2026-10-13 15:00"))
        assert(post(["timezone": "PT", "resetDate": "2026-11-01"]).timing(zone: "Asia/Shanghai")!.contains("2026-11-02 16:00"))
        assert(post(["timezone": "PT", "resetDate": "2026-03-08"]).timing(zone: "Asia/Shanghai")!.contains("2026-03-09 15:00"))
        assert(post(["timezone": "UTC+05:30"]).timing(zone: "Asia/Shanghai")!.contains("2026-10-13 02:30"))
        for extra: [String: Any] in [["timezone": ""], ["timezone": "invalid"], ["resetDate": "2026-02-30"]] {
            assert(post(extra).timing(zone: "Asia/Shanghai")!.contains("无精确钟点"))
        }
        assert(post(["status": "completed"]).statusTitle == "作者宣布已完成")
        assert(post(["status": "completed"]).timing(zone: "Asia/Shanghai")!.contains("以客户端为准"))
        assert(ResetPost(base.merging(["url": "https://evil.example/"]) { _, new in new }) == nil)
        let snapshot = ResetSnapshot(["records": [base, ["text": "bad"]], "unreadIds": ["101"], "xState": "error"])
        assert(snapshot.records.count == 1); assert(snapshot.stateTitle == "X 连接待恢复")
        print("PASS native menu model: origin validation, status semantics, EOD precision, PST/PT, DST, invalid dates and timezone conversion")
    }
}
