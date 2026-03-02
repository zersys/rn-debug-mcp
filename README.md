# RN Debug MCP

Let AI agents see, understand, and interact with your React Native app running on Android emulator or iOS simulator — through a single MCP server.

Point your MCP client at this server and an agent can connect to your app, read logs, inspect the UI, tap buttons, type text, scroll, take screenshots, and reload — all without leaving the conversation.

## Features

### Connect and Control

- **Android + iOS** — one server handles both platforms
- **Multi-session** — debug multiple devices or apps at the same time
- **Hot reload** — reload your app instantly via Metro; automatic fallback to native reload when Metro is unavailable

### See What's Happening

- **Live logs** — stream device logs in real time (Android `logcat` / iOS `simctl`)
- **Error filtering** — surface only errors so the agent focuses on what matters
- **Network inspector** — capture HTTP requests and responses with cursor-based polling
- **Screenshots** — capture the screen as a PNG image the agent can see inline

### Understand the UI

- **UI tree** — get the full view hierarchy (Android UIAutomator / iOS WebDriverAgent)
- **Visible elements** — list what's on screen with text, bounds, and testIDs
- **Screen context** — get the current activity/screen name so the agent knows where it is

### Interact with the App

- **Tap, scroll, type, back** — drive the app like a real user
- **Tap by testID** — target elements by `testID` instead of fragile coordinates
- **testID discovery** — list all testIDs on screen, search by exact or partial match
- **testID remediation** — when a testID is missing, the agent gets a ready-to-paste code fix and can reload to verify

## Requirements

- Node.js 20+
- Android SDK / `adb` on `PATH`
- Xcode command line tools (`xcrun`) and iOS Simulator (for iOS)
- React Native app running on emulator/simulator
- Metro running (default: `8081`)
- WebDriverAgent reachable for iOS (default: `http://127.0.0.1:8100`)

## Quickstart

### Option A: Global install (use from any project)

```bash
npm install -g rn-debug-mcp
```

Add to your MCP client config:

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

### Option B: Local dev dependency (per-project)

```bash
npm install -D rn-debug-mcp
npm run build
```

Add to your MCP client config:

```json
{
  "mcpServers": {
    "rn-debug": {
      "command": "node",
      "args": ["/ABS/PATH/TO/node_modules/rn-debug-mcp/dist/src/index.js"],
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
