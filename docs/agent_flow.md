# Agent Interaction Flow (Android)

This document defines the default runtime policy for Claude/Codex style agents using RN Debug Bridge MCP.

## Policy: testID-first

1. Try exact testID lookup:

```json
{ "tool": "get_elements_by_test_id", "arguments": { "testId": "checkout.submit.button", "testIdMatch": "exact" } }
```

Note: element lookup skips `visibleToUser` filtering by default. For strict native visibility filtering, pass `skipVisibilityCheck: false`.

2. If no results, try contains lookup:

```json
{ "tool": "get_elements_by_test_id", "arguments": { "testId": "submit", "testIdMatch": "contains" } }
```

2a. If testIDs are unknown, discover first:

```json
{ \"tool\": \"get_screen_test_ids\", \"arguments\": {} }
```

3. If still no results, remediate:

- `get_screen_context({})`
- `get_test_id_remediation_plan({ desiredAction, desiredTestId?, matchMode? })`
- patch source with suggested testID
- `reload_app({})`
- re-run exact lookup

4. If unresolved after remediation attempts:

- fallback to `tap_element({ elementId })`
- final fallback: `tap({ x, y })`
- for navigation/input flows: `scroll({ direction })`, `press_back({})`, `type_text({ text, submit? })`

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
