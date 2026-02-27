# React Native Debug Bridge MCP (Phase 1 Android)

A TypeScript MCP server that gives AI agents a unified Android React Native debugging loop over stdio.

## Implemented Phase 1 Tools

- `connect_app({ deviceId?, metroPort? })`
- `get_connection_status({})`
- `disconnect_app({})`
- `reload_app({})`
- `get_logs({ sinceCursor?, limit?, levels?, tags?, sources? })`
- `get_errors({ sinceCursor?, limit?, levels?, tags?, sources? })`
- `get_ui_tree({ maxDepth?, maxNodes? })`
- `get_visible_elements({ maxDepth?, maxNodes?, limit?, clickableOnly?, includeTextless?, testId?, testIdMatch? })`
- `get_elements_by_test_id({ testId, maxDepth?, maxNodes?, limit?, clickableOnly?, includeTextless?, testIdMatch? })`
- `tap({ x, y })`
- `tap_element({ elementId, maxDepth?, maxNodes? })`
- `take_screenshot({})`

## Behavior Highlights

- Single active Android session.
- Session introspection via `get_connection_status`.
- Emulator-first device auto-selection (`emulator-*`).
- Metro health check via `http://127.0.0.1:<port>/status`.
- Hybrid bridge:
  - Metro: status/reload/probe.
  - ADB logcat: runtime log/error collection.
- Transient retry/backoff for connect/reload operations (Metro and ADB actions).
- Cursor-based log polling from in-memory ring buffer.
- Log filtering support in `get_logs` and `get_errors` by level, tag (case-insensitive), and source.
- Initial Android UI hierarchy extraction via `uiautomator dump` (`get_ui_tree`).
- Flattened visible/actionable element extraction for planning (`get_visible_elements`).
- testID-aware element lookup (`get_elements_by_test_id`) using `resource-id` tail matching.
- Direct interaction without screenshots via coordinate tap and element-id tap (`tap`, `tap_element`).
- Screenshot output as MCP `image` content block, and the PNG is also saved to OS temp path (returned as `tempPath`).

## Requirements

- Node.js 20+
- Android SDK / `adb` on PATH
- React Native app running on Android emulator
- Metro running (default port `8081`)

## Setup

```bash
npm install
npm run build
```

## Run Server (stdio)

```bash
node dist/src/index.js
```

## Development Commands

```bash
npm run typecheck
npm test
```

## Notes

- iOS, UI tree inspection, gestures, and network inspection are out of scope for this phase.
- Fallback reload strategy uses ADB broadcast/key events if Metro reload fails.
