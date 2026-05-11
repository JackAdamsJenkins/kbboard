/**
 * Shared pi SDK setup for kb engine agents.
 *
 * Uses the user's existing pi auth (API keys / OAuth from ~/.pi/agent/auth.json).
 * Provides factory functions for creating triage and executor agent sessions.
 */

import {
  AuthStorage,
  createAgentSession,
  createCodingTools,
  createReadOnlyTools,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";

export interface AgentResult {
  session: AgentSession;
}

export interface AgentOptions {
  cwd: string;
  systemPrompt: string;
  tools?: "coding" | "readonly";
  customTools?: ToolDefinition[];
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onToolStart?: (name: string, args?: Record<string, unknown>) => void;
  onToolEnd?: (name: string, isError: boolean, result?: unknown) => void;
  /** Default model provider (e.g. "anthropic"). Used with `defaultModelId` to select a specific model. */
  defaultProvider?: string;
  /** Default model ID within the provider (e.g. "claude-sonnet-4-5"). Used with `defaultProvider`. */
  defaultModelId?: string;
  /** Default thinking effort level (e.g. "medium", "high"). When provided, sets the session's thinking level after creation. */
  defaultThinkingLevel?: string;
  /** Google AI API keys for the engine. */
  googleApiKeys?: string[];
}

/**
 * Create a pi agent session configured for kb.
 * Reuses the user's existing pi auth and model configuration.
 */
export async function createKbAgent(options: AgentOptions): Promise<AgentResult> {
  const authStorage = AuthStorage.inMemory();

  // Inject Google API keys if provided
  if (options.googleApiKeys && options.googleApiKeys.length > 0) {
    // We use the first key for now, or the library might handle multiple if we knew how.
    // For now, let's assume we can set multiple or just the first.
    options.googleApiKeys.forEach((key) => {
      if (key) {
        authStorage.setAuth("google", { apiKey: key });
      }
    });
  }

  const modelRegistry = new ModelRegistry(authStorage);

  const tools =
    options.tools === "readonly"
      ? createReadOnlyTools(options.cwd)
      : createCodingTools(options.cwd);

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 3 },
  });

  // Default to gemma-4-31b-it if no specific model requested or if explicitly requested
  const provider = options.defaultProvider || "google";
  const modelId = options.defaultModelId || "gemma-4-31b-it";

  const selectedModel = modelRegistry.find(provider, modelId);

  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    settingsManager,
    systemPromptOverride: () => options.systemPrompt,
    appendSystemPromptOverride: () => [],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: options.cwd,
    authStorage,
    modelRegistry,
    resourceLoader,
    tools,
    customTools: options.customTools,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
    model: selectedModel,
  });

  // Apply thinking level if specified
  if (options.defaultThinkingLevel) {
    session.setThinkingLevel(options.defaultThinkingLevel as any);
  }

  // Wire up event listeners
  session.subscribe((event) => {
    if (event.type === "message_update") {
      const msgEvent = event.assistantMessageEvent;
      if (msgEvent.type === "text_delta") {
        options.onText?.(msgEvent.delta);
      } else if (msgEvent.type === "thinking_delta") {
        options.onThinking?.(msgEvent.delta);
      }
    }
    if (event.type === "tool_execution_start") {
      options.onToolStart?.(event.toolName, event.args as Record<string, unknown> | undefined);
    }
    if (event.type === "tool_execution_end") {
      options.onToolEnd?.(event.toolName, event.isError, event.result);
    }
  });

  return { session };
}
