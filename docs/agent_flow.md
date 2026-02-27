# Agent Interaction Flow (Android + iOS)

This document defines the default runtime policy for Claude/Codex style agents using RN Debug Bridge MCP.

## Session setup

1. Connect:

```json
{ "tool": "connect_app", "arguments": { "platform": "android" } }
```

or

```json
{ "tool": "connect_app", "arguments": { "platform": "ios" } }
```

2. If multiple sessions are active, either:
- pass `sessionId` on all subsequent tool calls, or
- call `set_active_session({ sessionId })` once.

## Policy: testID-first

1. Try exact testID lookup:

```json
{ "tool": "get_elements_by_test_id", "arguments": { "sessionId": "<sessionId>", "testId": "checkout.submit.button", "testIdMatch": "exact" } }
```

Note: element lookup skips `visibleToUser` filtering by default. For strict native visibility filtering, pass `skipVisibilityCheck: false`.
Note: element lookup includes non-clickable nodes by default. For actionable-only matches, pass `clickableOnly: true`.

2. If no results, try contains lookup:

```json
{ "tool": "get_elements_by_test_id", "arguments": { "sessionId": "<sessionId>", "testId": "submit", "testIdMatch": "contains" } }
```

2a. If testIDs are unknown, discover first:

```json
{ \"tool\": \"get_screen_test_ids\", \"arguments\": { \"sessionId\": \"<sessionId>\" } }
```

3. If still no results, remediate:

- `get_screen_context({ sessionId })`
- `get_test_id_remediation_plan({ sessionId, desiredAction, desiredTestId?, matchMode? })`
- patch source with suggested testID
- `reload_app({ sessionId })`
- re-run exact lookup

4. If unresolved after remediation attempts:

- fallback to `tap_element({ sessionId, elementId })`
- final fallback: `tap({ sessionId, x, y })`
  - iOS uses point coordinates. If you started from screenshot pixels, convert with screenshot `scaleFactor`:
    - `pointX = round(pixelX / scaleFactor)`
    - `pointY = round(pixelY / scaleFactor)`
- for navigation/input flows: `scroll({ sessionId, direction })`, `press_back({ sessionId })`, `type_text({ sessionId, text, submit? })`

## Remediation attempt budget

- Maximum remediation loops: 2
- Each loop:
  - apply one patch
  - `reload_app`
  - one exact lookup re-check

## Prompt template for code patching

```text
Add/normalize a React Native testID for this action.

Screen context:
- activity: <activity>
- screenSlug: <screenSlug>
- title: <primaryTitle>

Desired action: <desiredAction>
Suggested testID: <suggestedTestId>
Search terms: <searchTerms>
Preferred components: Pressable / TouchableOpacity / Button / TextInput

Update the smallest correct JSX node so this interaction can be resolved by testID-first lookup.
```

## Notes

- JS-level testID changes should work with Metro reload.
- Native-only view changes may require rebuild/reinstall outside this flow.
- For runtime API diagnosis during interaction flows, poll `get_network_requests` with cursors.
