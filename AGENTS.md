# Tibo Reset development

This repository is independent of the former badge project. Do not add imports from that repository or restore Token/quota/project-styling features.

- Build: `python3 scripts/build.py`
- Tests: `npm test` (uses Playwright; `PLAYWRIGHT_EXECUTABLE_PATH` can select an existing Chrome executable)
- Package: `python3 scripts/package.py`
- Runtime: `~/Library/Application Support/TiboReset/`, LaunchAgent `com.tiboreset.monitor`
- Windows 11: `python3 scripts/build.py --platform windows`, `python3 scripts/package.py --platform windows`; runtime `%LOCALAPPDATA%\TiboReset\`. Use the per-user startup shortcut and mutex runner, graceful stop requests, and explicit client launch. Never terminate an existing desktop client. The dedicated Edge profile is independent of the macOS WebKit store; only normalized public post fields may leave the collector.
- Native Windows tray app: `windows/Tray/`, built on Mac with `python3 scripts/windows_app.py --arch all --package`. The app owns the same per-user mutex as the legacy runner and starts its bundled Node with `--stdio --standalone`; the original script build remains a compatibility path. The default native app must not require a desktop debug port. macOS compilation/PE validation does not establish Windows desktop acceptance; keep that limitation in delivery reports.
- Source UI: `src/sidebar.js`; increment its version when changing injected behavior.
- Native X helper: `native/XSource.swift`; retain the dedicated store identifier and installed basename `bridge` for session continuity.
- macOS menu bar: `native/MenuBar.swift`, `native/MenuBarModel.swift`; app owns the background process through private pipes. Pin Node under the private runtime directory so desktop updates cannot remove it. Default macOS sidebar injection is off; Windows keeps its sidebar default. Never run two collectors against the named X store.
- Menu sizing: keep an explicit viewport within the status item's screen, with pinned header/footer and scrolling announcements. Set `NSPopover.contentSize` before resizing its content view. Verify the real popover with `--layout-test` (long posts, live updates and short screens), not just the static preview; fixtures must never open the real X store.
- Original-icon startup: `native/Startup.swift` runs under the monitor, baselines existing apps and only reconnects fresh, untouched foreground launches by graceful termination. Keep the refusal/input/identity/cooldown guards. `node tests/startup-icon.cjs` verifies a disposable app, never the real Codex process.

User preferences: macOS now uses a standalone menu bar app inspired by CodexBar; retain the Codex sidebar as an optional compatibility mode. Use compact cards with a status heading, quoted original/parent text, source link and publication time. Preserve source semantics without inventing exact EOD clocks. Do not change models unless requested.

Never put real settings, caches, logs or authentication data in the repository/package. Do not force-close the user's desktop application. The old project/install is a retained fallback, not a runtime dependency; its collector must remain stopped while this one uses the migrated X session.
