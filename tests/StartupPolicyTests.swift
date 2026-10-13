import Foundation

@main struct StartupPolicyTests {
    static func main() {
        let ready = LaunchSafety(age: 1, idle: 2)
        precondition(ready.decision == "connect")
        var cases: [(LaunchSafety, String)] = []
        var v = ready; v.age = 9; cases.append((v, "skip-active"))
        v = ready; v.age = -1; cases.append((v, "skip-active"))
        v = ready; v.idle = 0.5; cases.append((v, "skip-active"))
        v = ready; v.finished = false; cases.append((v, "wait"))
        v = ready; v.foreground = false; cases.append((v, "wait"))
        v = ready; v.foreground = false; v.age = 9; cases.append((v, "skip-active"))
        v = ready; v.instances = 2; cases.append((v, "skip-instance"))
        v = ready; v.argumentsKnown = false; cases.append((v, "skip-instance"))
        v = ready; v.ordinaryLaunch = false; cases.append((v, "skip-custom-launch"))
        v = ready; v.hasDebugging = true; cases.append((v, "skip-instance"))
        v = ready; v.sinceAttempt = 119; cases.append((v, "skip-cooldown"))
        v = ready; v.sinceAttempt = -30; cases.append((v, "skip-cooldown"))
        for (input, result) in cases { precondition(input.decision == result, result) }
        print("PASS startup guards: fresh/old/background/input/unknown/multiple/debugging/cooldown")
    }
}
