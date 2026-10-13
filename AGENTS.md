# Tibo Reset development

This repository is independent of the former badge project. Do not add imports from that repository or restore Token/quota/project-styling features.

- Build: `python3 scripts/build.py`
- Tests: `npm test` (uses Playwright; `PLAYWRIGHT_EXECUTABLE_PATH` can select an existing Chrome executable)
- Package: `python3 scripts/package.py`
- Runtime: `~/Library/Application Support/TiboReset/`, LaunchAgent `com.tiboreset.monitor`
- Windows 11: `python3 scripts/build.py --platform windows`, `python3 scripts/package.py --platform windows`; runtime `%LOCALAPPDATA%\TiboReset\`. Use the per-user startup shortcut and mutex runner, graceful stop requests, and explicit client launch. Never terminate an existing desktop client. The dedicated Edge profile is independent of the macOS WebKit store; only normalized public post fields may leave the collector.
- Source UI: `src/sidebar.js`; increment its version when changing injected behavior.
- Native X helper: `native/XSource.swift`; retain the dedicated store identifier and installed basename `bridge` for session continuity.
- Original-icon startup: `native/Startup.swift` runs under the monitor, baselines existing apps and only reconnects fresh, untouched foreground launches by graceful termination. Keep the refusal/input/identity/cooldown guards. `node tests/startup-icon.cjs` verifies a disposable app, never the real Codex process.

User preferences: stay in the Codex sidebar; compact cards with a status heading, quoted original/parent text, source link and publication time. Preserve source semantics without inventing exact EOD clocks. Do not change models unless requested.

Never put real settings, caches, logs or authentication data in the repository/package. Do not force-close the user's desktop application. The old project/install is a retained fallback, not a runtime dependency; its collector must remain stopped while this one uses the migrated X session.
