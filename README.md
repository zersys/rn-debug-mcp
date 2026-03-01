# RN Debug MCP

A TypeScript MCP server for React Native debugging and interaction on Android emulator and iOS simulator.

RN Debug MCP gives agents a single loop for:

- connecting to a running app
- reading logs, errors, network events, and UI state
- interacting with the app (tap/type/scroll/back)
- iterating quickly with reload and testID-first targeting

## Features

- Multi-session support with explicit `sessionId` routing.
- Android + iOS support via `connect_app({ platform })`.
- Metro integration for status checks and app reload.
- Runtime log collection:
  - Android: `adb logcat`
  - iOS: `xcrun simctl log stream`
- Network event extraction with cursor-based polling.
- UI hierarchy extraction:
  - Android via `uiautomator dump`
  - iOS via WebDriverAgent (`source: "wda"`)
- React Native testID-focused tools:
  - `get_screen_test_ids`
  - `get_elements_by_test_id`
  - `get_test_id_remediation_plan`
- Direct interaction tools: `tap`, `tap_element`, `type_text`, `press_back`, `scroll`.
- Screenshot output as MCP `image` content plus saved temp PNG path.

## Requirements

- Node.js 20+
- Android SDK / `adb` on `PATH`
- Xcode command line tools (`xcrun`) and iOS Simulator (for iOS)
- React Native app running on emulator/simulator
- Metro running (default: `8081`)
- WebDriverAgent reachable for iOS (default: `http://127.0.0.1:8100`)

## Quickstart

```bash
npm install
npm run build
node dist/src/index.js
```

## MCP Client Configuration

Use the published package in any MCP-compatible client:

```json
{
  "mcpServers": {
    "rn-debug": {
      "command": "npx",
      "args": ["-y", "rn-debug-mcp"],
      "env": {
        "WDA_BASE_URL": "http://127.0.0.1:8100"
      }
    }
  }
}
```

For local development from this repo, keep using:

```json
{
  "mcpServers": {
    "rn-debug": {
      "command": "node",
      "args": ["/ABS/PATH/react_native_debug_bridge_mcp/dist/src/index.js"],
      "env": {
        "WDA_BASE_URL": "http://127.0.0.1:8100"
      }
    }
  }
}
```

## iOS Support

iOS works automatically on first `connect_app({ platform: "ios" })`. WebDriverAgent sources are cloned and built transparently if not already present.

- If WDA is already running on `:8100` (or the configured `WDA_BASE_URL`), the install/build is skipped entirely.
- Set `WDA_NO_AUTO_INSTALL=1` to disable automatic installation and require manual setup.
- Set `WDA_BASE_URL` to point to an externally managed WebDriverAgent instance.

### Manual / Advanced Setup

Install WDA sources manually:

```bash
npx --no-install rndmcp install wda
```

Run WDA standalone:

```bash
npm run ios:wda
```

Optional overrides:

```bash
WDA_PROJECT_PATH="/abs/path/to/WebDriverAgent.xcodeproj" npm run ios:wda
WDA_DEVICE_ID="<booted-simulator-udid>" npm run ios:wda
WDA_DESTINATION='platform=iOS Simulator,name=iPhone 16' npm run ios:wda
```

WebDriverAgent sources are kept in `./WebDriverAgent` and are not tracked in git.

## Tools

### Session and Connection

- `connect_app({ platform?, deviceId?, metroPort? })`
- `list_sessions({})`
- `set_active_session({ sessionId })`
- `close_session({ sessionId })`
- `get_connection_status({ sessionId? })`
- `disconnect_app({ sessionId? })`
- `reload_app({ sessionId? })`

### Logs, Errors, and Network

- `get_logs({ sessionId?, sinceCursor?, limit?, levels?, tags?, sources? })`
- `get_errors({ sessionId?, sinceCursor?, limit?, levels?, tags?, sources? })`
- `get_network_requests({ sessionId?, sinceCursor?, limit?, phases?, methods?, statuses?, urlContains?, sources? })`

### UI and Context

- `get_screen_context({ sessionId? })`
- `get_ui_tree({ sessionId?, maxDepth?, maxNodes? })`
- `get_visible_elements({ sessionId?, maxDepth?, maxNodes?, limit?, clickableOnly?, includeTextless?, skipVisibilityCheck?, testId?, testIdMatch? })`
- `get_screen_test_ids({ sessionId?, maxDepth?, maxNodes?, limit?, includeNonClickable?, includeInvisible? })`
- `get_elements_by_test_id({ sessionId?, testId, maxDepth?, maxNodes?, limit?, clickableOnly?, includeTextless?, skipVisibilityCheck?, testIdMatch? })`
- `get_test_id_remediation_plan({ sessionId?, desiredAction, desiredTestId?, matchMode? })`

### Interaction

- `tap({ sessionId?, x, y })`
- `tap_element({ sessionId?, elementId, maxDepth?, maxNodes? })`
- `type_text({ sessionId?, text, submit? })`
- `press_back({ sessionId? })`
- `scroll({ sessionId?, direction, distanceRatio?, durationMs? })`
- `take_screenshot({ sessionId? })`

## Recommended Agent Flow (testID-first)

1. `get_elements_by_test_id` with `testIdMatch: "exact"`.
2. If unknown IDs, call `get_screen_test_ids`.
3. If empty, retry `get_elements_by_test_id` with `testIdMatch: "contains"`.
4. If still empty:
   - call `get_screen_context`
   - call `get_test_id_remediation_plan`
   - patch app code with suggested testID
   - call `reload_app`
   - retry exact testID lookup
5. If unresolved:
   - try `tap_element` from visible candidates
   - fallback to `tap({ x, y })`
   - use `scroll`, `press_back`, and `type_text` for navigation/input

testID naming convention: `screen.element.action` (example: `checkout.submit.button`).

## Platform Notes

- `connect_app` defaults to `platform: "android"` for backward compatibility.
- iOS tap coordinates use point space (WDA coordinates), not screenshot pixels.
- If converting screenshot pixels to iOS points:
  - `pointX = round(pixelX / scaleFactor)`
  - `pointY = round(pixelY / scaleFactor)`
- `get_elements_by_test_id` defaults:
  - `skipVisibilityCheck: true` (RN-friendly)
  - `clickableOnly: false` (broader matching)
- `get_screen_test_ids` default: `includeInvisible: true`.

## Development

```bash
npm run typecheck
npm test
```

CLI usage:

```bash
rndmcp                   # Start MCP server over stdio
rndmcp install wda       # Clone WebDriverAgent into this package
```

## Troubleshooting

- iOS connect reports missing WDA:
  - WDA is auto-installed on first `connect_app({ platform: "ios" })` unless `WDA_NO_AUTO_INSTALL=1`
  - set `WDA_BASE_URL` to an already running WDA, or
  - run `rndmcp install wda` and then `npm run ios:wda` for manual setup
- Reload fallbacks:
  - Android: ADB broadcast/key events
  - iOS simulator: `Cmd+R` keyboard trigger via `osascript`
