# Unified React Native Debugger MCP
## Product Requirements Document (PRD)

---

## 1. Overview

**Project Name:** RN-Inspector MCP  
**Type:** Developer Infrastructure / AI Tooling  
**Primary Goal:**  
Create a single Model Context Protocol (MCP) server that allows AI agents to fully observe and interact with a running React Native application on **Android and iOS** similar to Chrome DevTools.

The system will enable AI coding agents (Codex, Claude, Cursor, Cline, etc.) to:

- Observe runtime behavior (logs, errors, network)
- Inspect UI hierarchy
- Capture screenshots
- Interact with UI (tap, type, scroll)
- Reload and control app lifecycle

---

## 2. Problem Statement

Current React Native debugging tools are fragmented:

| Tool | Limitation |
|----|----|
| Metro logs | No UI awareness |
| Flipper | Not AI-accessible |
| Appium/Detox | Slow, test-oriented |
| CDP | JS only |
| Device automation | Blind to runtime state |

AI agents therefore cannot reliably debug mobile apps because they lack a **unified runtime + UI feedback loop**.

We need a single protocol bridge.

---

## 3. Objectives

### Primary Objective
Enable AI agents to debug React Native apps autonomously.

### Secondary Objectives
- Reduce human debugging time
- Provide cross-agent compatibility
- Work with React Native CLI
- Zero app code modification required

---

## 4. Non-Goals

- Not an end-user testing framework
- Not a visual regression platform
- Not a replacement for Detox/Appium
- Not cloud device hosting

---

## 5. Target Users

| Persona | Use Case |
|----|----|
| Solo developers | AI fixes crashes automatically |
| Teams | Continuous AI debugging |
| AI IDEs | Runtime environment awareness |
| CI pipelines | Automated verification |

---

## 6. System Architecture

              RN-Inspector MCP
                     │
        ┌────────────┼────────────┐
        │            │            │
      Metro        Android        iOS
       CDP      ADB/UIAutomator  XCUITest
        │            │            │
   JS Runtime     UI Tree      UI Tree

---

## 7. Core Capabilities

### 7.1 Runtime Inspection
- Attach to Metro WebSocket
- Stream logs, warnings, errors
- Capture unhandled exceptions
- Monitor reload events

### 7.2 Network Monitoring
- Intercept fetch/XHR via CDP
- Request/response bodies
- Status codes
- Timing metrics

### 7.3 UI Inspection
- Query accessibility hierarchy
- Retrieve element bounds
- Identify clickable components
- Cross-platform abstraction

### 7.4 Interaction
- Tap
- Type text
- Scroll/swipe
- Back navigation

### 7.5 Visual Capture
- Screenshot device
- Annotated screenshot (future)
- Compare before/after (future)

### 7.6 App Control
- Reload JS bundle
- Open screen by deep link
- Launch/terminate app

---

## 8. MCP Tool API Design

### Connection
connect_app()
disconnect_app()
reload_app()

### Observation
get_logs()
get_errors()
get_network_requests()
get_ui_tree()
get_visible_elements()

### Interaction
tap(x, y | element_id)
type_text(text)
scroll(direction)
press_back()

### Visual
take_screenshot()

---

## 9. Platform Support

| Platform | Version |
|----|----|
| React Native | 0.71+ |
| Android | Emulator + Physical |
| iOS | Simulator (Phase 1), Device (Phase 2) |

---

## 10. Technical Stack

| Layer | Technology |
|----|----|
| MCP Server | Node.js + @modelcontextprotocol/sdk |
| JS Runtime Bridge | Chrome DevTools Protocol |
| Metro Discovery | HTTP /json endpoint |
| Android Automation | adb + uiautomator |
| iOS Automation | simctl + accessibility |
| Screenshots | native device capture |

---

## 11. Milestones & Timeline

### Phase 1 — Visibility (Week 1)
- Metro attach
- Logs streaming
- Screenshot capture

### Phase 2 — Understanding (Week 2)
- UI tree extraction
- Network inspection
- Reload handling

### Phase 3 — Interaction (Week 3)
- Tap
- Type
- Scroll

### Phase 4 — Stability (Week 4)
- Auto reconnect
- Multi-device handling
- Agent compatibility validation

---

## 12. Risks

| Risk | Mitigation |
|----|----|
| RN reload breaks connection | Auto-reattach logic |
| iOS restrictions | Simulator-first strategy |
| Agent incompatibility | Strict MCP schema |
| Performance overhead | Lazy polling |

---

## 13. Success Metrics

| Metric | Target |
|----|----|
| Agent can fix runtime error | >80% cases |
| Setup time | <2 minutes |
| Crash reproduction | Automated |
| Cross-agent compatibility | 4+ agents |

---

## 14. Future Roadmap

- Component-level inspection
- Visual diff validation
- Gesture recording
- CI integration
- Cloud devices

---

## 15. Release Strategy

| Stage | Audience |
|----|----|
| Alpha | Internal developers |
| Beta | Open source community |
| v1.0 | Public release |

---

## 16. Definition of Done

The project is complete when an AI agent can:

1. Launch the app
2. Navigate to a screen
3. Detect an error
4. Apply a code fix
5. Verify visually

Without human assistance.

---

---

## 17. Branding & Distribution

| Item | Value |
|----|----|
| Display Name | React Native Debug Bridge MCP |
| GitHub Repo | react-native-debug-bridge-mcp |
| NPM Package | @rndb/server |
| CLI Command | rndb |
| Docs URL | rndb.dev (future) |

---

END OF DOCUMENT

