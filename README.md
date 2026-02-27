# React Native Debug Bridge MCP (Phase 1 Android)

A TypeScript MCP server that gives AI agents a unified Android React Native debugging loop over stdio.

## Implemented Phase 1 Tools

- `connect_app({ deviceId?, metroPort? })`
- `get_connection_status({})`
- `disconnect_app({})`
- `reload_app({})`
- `get_logs({ sinceCursor?, limit?, levels?, tags?, sources? })`
- `get_errors({ sinceCursor?, limit?, levels?, tags?, sources? })`
- `get_network_requests({ sinceCursor?, limit?, phases?, methods?, statuses?, urlContains?, sources? })`
- `get_screen_context({})`
- `get_ui_tree({ maxDepth?, maxNodes? })`
- `get_visible_elements({ maxDepth?, maxNodes?, limit?, clickableOnly?, includeTextless?, skipVisibilityCheck?, testId?, testIdMatch? })`
- `get_screen_test_ids({ maxDepth?, maxNodes?, limit?, includeNonClickable?, includeInvisible? })`
- `get_elements_by_test_id({ testId, maxDepth?, maxNodes?, limit?, clickableOnly?, includeTextless?, skipVisibilityCheck?, testIdMatch? })`
- `get_test_id_remediation_plan({ desiredAction, desiredTestId?, matchMode? })`
- `tap({ x, y })`
- `tap_element({ elementId, maxDepth?, maxNodes? })`
- `type_text({ text, submit? })`
- `press_back({})`
- `scroll({ direction, distanceRatio?, durationMs? })`
- `take_screenshot({})`

## Behavior Highlights

- Single active Android session.
- Session introspection via `get_connection_status`.
- Emulator-first device auto-selection (`emulator-*`).
- Metro health check via `http://127.0.0.1:<port>/status`.
- Hybrid bridge:
  - Metro: status/reload/probe.
  - ADB logcat: runtime log/error collection.
- Network inspection pipeline from logcat-derived request/response/error events (`get_network_requests`).
- Transient retry/backoff for connect/reload operations (Metro and ADB actions).
- Cursor-based log polling from in-memory ring buffer.
- Log filtering support in `get_logs` and `get_errors` by level, tag (case-insensitive), and source.
- Initial Android UI hierarchy extraction via `uiautomator dump` (`get_ui_tree`).
- Flattened visible/actionable element extraction for planning (`get_visible_elements`).
- testID-aware element lookup (`get_elements_by_test_id`) using `resource-id` tail matching.
- screen-wide testID discovery (`get_screen_test_ids`) to let agents discover available IDs before lookup.
- Visibility filtering is off by default for element lookup (`skipVisibilityCheck: true`) to work better with React Native accessibility trees; set `skipVisibilityCheck: false` to enforce `visibleToUser`.
- `get_screen_test_ids` defaults to `includeInvisible: true` for React Native compatibility; set `includeInvisible: false` for strict visible-only discovery.
- Screen context inference (`get_screen_context`) from activity/window dumps + UI titles.
- Guided testID remediation plans (`get_test_id_remediation_plan`) for Claude/Codex patch loops.
- Direct interaction without screenshots via coordinate tap and element-id tap (`tap`, `tap_element`).
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

- iOS and multi-device concurrency are out of scope for this phase.
- Fallback reload strategy uses ADB broadcast/key events if Metro reload fails.
