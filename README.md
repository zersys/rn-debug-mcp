# React Native Debug Bridge MCP

A TypeScript MCP server that gives AI agents a unified React Native debugging loop over stdio for Android emulator and iOS simulator.

## Implemented Tools

- `connect_app({ platform?, deviceId?, metroPort? })`
- `list_sessions({})`
- `set_active_session({ sessionId })`
- `close_session({ sessionId })`
- `get_connection_status({ sessionId? })`
- `disconnect_app({ sessionId? })`
- `reload_app({ sessionId? })`
- `get_logs({ sessionId?, sinceCursor?, limit?, levels?, tags?, sources? })`
- `get_errors({ sessionId?, sinceCursor?, limit?, levels?, tags?, sources? })`
- `get_network_requests({ sessionId?, sinceCursor?, limit?, phases?, methods?, statuses?, urlContains?, sources? })`
- `get_screen_context({ sessionId? })`
- `get_ui_tree({ sessionId?, maxDepth?, maxNodes? })`
- `get_visible_elements({ sessionId?, maxDepth?, maxNodes?, limit?, clickableOnly?, includeTextless?, skipVisibilityCheck?, testId?, testIdMatch? })`
- `get_screen_test_ids({ sessionId?, maxDepth?, maxNodes?, limit?, includeNonClickable?, includeInvisible? })`
- `get_elements_by_test_id({ sessionId?, testId, maxDepth?, maxNodes?, limit?, clickableOnly?, includeTextless?, skipVisibilityCheck?, testIdMatch? })`
- `get_test_id_remediation_plan({ sessionId?, desiredAction, desiredTestId?, matchMode? })`
- `tap({ sessionId?, x, y })`
- `tap_element({ sessionId?, elementId, maxDepth?, maxNodes? })`
- `type_text({ sessionId?, text, submit? })`
- `press_back({ sessionId? })`
- `scroll({ sessionId?, direction, distanceRatio?, durationMs? })`
- `take_screenshot({ sessionId? })`

## Behavior Highlights

- Multi-session support with explicit `sessionId` routing.
- Android + iOS platform selection via `connect_app({ platform })`.
- Emulator/simulator auto-selection when `deviceId` is omitted.
- Metro health check via `http://127.0.0.1:<port>/status`.
- Hybrid bridge:
  - Metro: status/reload/probe.
  - Android: ADB logcat runtime collection.
  - iOS: `xcrun simctl ... log stream` runtime collection.
- Network inspection pipeline from logcat-derived request/response/error events (`get_network_requests`).
- Transient retry/backoff for connect/reload/interaction operations.
- Collector auto-reconnect status surfaced in `get_connection_status`.
- Cursor-based log polling from in-memory ring buffer.
- Log filtering support in `get_logs` and `get_errors` by level, tag (case-insensitive), and source.
- UI hierarchy extraction:
  - Android via `uiautomator dump`
  - iOS via WDA source (`source: "wda"`)
- Flattened visible/actionable element extraction for planning (`get_visible_elements`).
- testID-aware element lookup (`get_elements_by_test_id`) using `resource-id` tail matching.
- screen-wide testID discovery (`get_screen_test_ids`) to let agents discover available IDs before lookup.
- Visibility filtering is off by default for element lookup (`skipVisibilityCheck: true`) to work better with React Native accessibility trees; set `skipVisibilityCheck: false` to enforce `visibleToUser`.
- `get_screen_test_ids` defaults to `includeInvisible: true` for React Native compatibility; set `includeInvisible: false` for strict visible-only discovery.
- Screen context inference (`get_screen_context`) from activity/window dumps + UI titles.
- Guided testID remediation plans (`get_test_id_remediation_plan`) for Claude/Codex patch loops.
- Direct interaction without screenshots via coordinate tap and element-id tap (`tap`, `tap_element`) on both platforms.
- Keyboard/navigation gestures for flows (`type_text`, `press_back`, `scroll`).
- Screenshot output as MCP `image` content block, and the PNG is also saved to OS temp path (returned as `tempPath`).

## Recommended Agent Flow (TestID-first)

1. `get_elements_by_test_id` with `testIdMatch: "exact"`.
2. If unknown IDs, run `get_screen_test_ids` first.
3. If empty, retry `get_elements_by_test_id` with `testIdMatch: "contains"`.
4. If still empty:
   - call `get_screen_context`
   - call `get_test_id_remediation_plan`
   - patch app code with suggested testID
   - call `reload_app`
   - retry exact testID lookup
5. If unresolved:
   - `tap_element` from visible candidates
   - final fallback: `tap({ x, y })`
   - if navigation/input is needed: `scroll`, `press_back`, `type_text`

testID naming convention: `screen.element.action` (example: `checkout.submit.button`).

## Requirements

- Node.js 20+
- Android SDK / `adb` on PATH
- Xcode command line tools (`xcrun`) and iOS Simulator
- WebDriverAgent running and reachable (`http://127.0.0.1:8100` by default; override with `WDA_BASE_URL`)
- React Native app running on Android emulator or iOS simulator
- Metro running (default port `8081`)

## Setup

```bash
npm install
npm run build
```

## Start WebDriverAgent (iOS)

```bash
npm run ios:wda
```

Optional overrides:

```bash
WDA_PROJECT_PATH="/abs/path/to/WebDriverAgent.xcodeproj" npm run ios:wda
WDA_DEVICE_ID="<booted-simulator-udid>" npm run ios:wda
WDA_DESTINATION='platform=iOS Simulator,name=iPhone 16' npm run ios:wda
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

- `connect_app` defaults to `platform: "android"` for backward compatibility.
- Reload fallback strategies:
  - Android: ADB broadcast/key events
  - iOS simulator: `Cmd+R` keyboard trigger via `osascript`
