#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AdbAdapter } from "./adapters/adb.js";
import { IosAdapter } from "./adapters/ios.js";
import { MetroAdapter } from "./adapters/metro.js";
import { NodeProcessRunner } from "./adapters/processRunner.js";
import { WdaClient } from "./adapters/wda.js";
import { LogBuffer } from "./core/logBuffer.js";
import { NetworkBuffer } from "./core/networkBuffer.js";
import { SessionManager } from "./core/sessionManager.js";
import { registerTools } from "./server/registerTools.js";
import { DEFAULT_IOS_WDA_BASE_URL, DEFAULT_LOG_BUFFER_SIZE, DEFAULT_NETWORK_BUFFER_SIZE } from "./types/api.js";

const server = new McpServer({
  name: "react-native-debug-bridge-mcp",
  version: "0.1.0",
});

const processRunner = new NodeProcessRunner();
const sessionManager = new SessionManager();
const wdaClient = new WdaClient(process.env.WDA_BASE_URL ?? DEFAULT_IOS_WDA_BASE_URL);

registerTools(server, {
  sessionManager,
  logBuffer: new LogBuffer(DEFAULT_LOG_BUFFER_SIZE),
  networkBuffer: new NetworkBuffer(DEFAULT_NETWORK_BUFFER_SIZE),
  adb: new AdbAdapter(processRunner),
  ios: new IosAdapter(processRunner, wdaClient),
  metro: new MetroAdapter(),
});

const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = async (): Promise<void> => {
  await sessionManager.reset();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
