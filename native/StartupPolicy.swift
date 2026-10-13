import Foundation

struct LaunchSafety {
    var age: Double
    var idle: Double
    var argumentsKnown = true
    var hasDebugging = false
    var ordinaryLaunch = true
    var finished = true
    var foreground = true
    var instances = 1
    var sinceAttempt = Double.infinity

    var decision: String {
        guard instances == 1, argumentsKnown, !hasDebugging else { return "skip-instance" }
        guard ordinaryLaunch else { return "skip-custom-launch" }
        guard age >= 0, age <= 8, idle >= age else { return "skip-active" }
        guard finished, foreground else { return "wait" }
        guard sinceAttempt >= 120 else { return "skip-cooldown" }
        return "connect"
    }
}
