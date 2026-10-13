# Code origins

Tibo Reset is a separate project with a fresh Git repository. Its purpose is X collection, interpretation and reset notifications in the Codex sidebar.

The Tibo-specific collection, interpretation, UI and regression tests were first developed as local additions in the `codex-usage-badge` working directory during October 2026. These files were absent from that repository's upstream `HEAD` (`d014efc`) when extracted. They are carried forward here rather than claimed as newly written a second time.

The connection layer, application entrypoint, settings, installer and packaging in this repository were written for Tibo Reset. The upstream badge's quota client, Token reader, project styling, startup controller, updater, installer and Git history are not included. There is no runtime import from the old source or install directory.

Original-icon startup support is implemented here in `native/Startup.swift`, `native/StartupPolicy.swift` and `src/startup.js`. It restores the desired behavior using macOS system APIs and the same safety requirements (fresh launches only, no user interaction, graceful exit, no relaunch loops). It does not execute or import the previous startup controller.

`--import-badge` is an optional one-time migration path. It imports non-secret preferences and public-message cache, disables the former background jobs, and retains the old files for rollback. WebKit owns the named X login store; the monitor never exports cookies. The same store identifier is retained to attempt session continuity, so the former collector should remain disabled.

The native helper's installed basename remains `bridge` for WebKit store compatibility. It is compiled from this project's own `native/XSource.swift` and installed under Tibo Reset's directory; it does not execute the previous installation's helper.

Runtime uses the user's existing desktop application's Node.js and Codex CLI, plus macOS system frameworks. These runtimes are not redistributed. Playwright is a development-only dependency and is excluded from release archives.
