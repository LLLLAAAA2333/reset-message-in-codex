# Code origins

Tibo Reset is a separate project with a fresh Git repository. Its purpose is X collection, interpretation and reset notifications in native macOS menu bar and Windows tray apps, with an optional Codex sidebar.

The Tibo-specific collection, interpretation, UI and regression tests were first developed as local additions in the `codex-usage-badge` working directory during October 2026. These files were absent from that repository's upstream `HEAD` (`d014efc`) when extracted. They are carried forward here rather than claimed as newly written a second time.

The connection layer, application entrypoint, settings, installer and packaging in this repository were written for Tibo Reset. The upstream badge's quota client, Token reader, project styling, startup controller, updater, installer and Git history are not included. There is no runtime import from the old source or install directory.

Original-icon startup support is implemented here in `native/Startup.swift`, `native/StartupPolicy.swift` and `src/startup.js`. It restores the desired behavior using macOS system APIs and the same safety requirements (fresh launches only, no user interaction, graceful exit, no relaunch loops). It does not execute or import the previous startup controller.

`--import-badge` is an optional one-time migration path. It imports non-secret preferences and public-message cache, disables the former background jobs, and retains the old files for rollback. WebKit owns the named X login store; the monitor never exports cookies. The same store identifier is retained to attempt session continuity, so the former collector should remain disabled.

The native helper's installed basename remains `bridge` for WebKit store compatibility. It is compiled from this project's own `native/XSource.swift` and installed under Tibo Reset's directory; it does not execute the previous installation's helper.

The macOS menu bar app is implemented in AppKit and SwiftUI. Its compact menu styling is inspired by CodexBar (https://github.com/steipete/CodexBar); no CodexBar code, icons, quota features or dependencies are copied. The app owns its monitor through private standard-input/output pipes, with no local web server.

On macOS the installer pins a local copy of the existing Node executable in the private runtime directory. A direct first launch can copy the desktop application's bundled Node. Subsequent desktop updates do not remove that copy. Node and the Codex CLI are not redistributed in the release archive. Model interpretation still uses an installed, logged-in Codex CLI; collection and original text do not require the desktop app to be running. Playwright is a development-only dependency and is excluded from release archives.

The historical Windows script-only support is implemented independently in `windows/`. It uses a dedicated Edge profile, public-field-only page bindings, the native Windows Codex CLI, and a per-user PowerShell monitor. Its launch shortcut refuses to close a running desktop client. It does not implement the macOS fresh-launch reconnect watcher or share the WebKit login store. The script-only installer can download Node.js from nodejs.org with a pinned SHA256; its license is retained locally, and that historical ZIP does not include the runtime. Windows installation state and browser data stay under the user's local application data directory and are excluded from source and release packages.

The native Windows tray frontend in `windows/Tray/` is new C# / WinForms code. Its architecture-specific packages include a self-contained Microsoft .NET runtime and a checksum-verified official Node executable, with their licenses under `licenses/` and `runtime/`. The .NET SDK and development caches are not redistributed. The tray app owns the same per-user mutex as the historical PowerShell runner and communicates with the public-announcement backend through private pipes. It does not import the macOS UI, the former badge, or CodexBar. The historical Windows script-only package remains available separately.
