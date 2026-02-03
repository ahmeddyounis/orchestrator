export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolSpec {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  strict?: boolean;
}

export interface ToolCall {
  name: string;
  arguments: unknown;
  id?: string;
}

export interface ModelRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  metadata?: Record<string, unknown>;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ModelResponse {
  text?: string;
  toolCalls?: ToolCall[];
  usage?: Usage;
  raw?: unknown;
}

export type StreamEvent =
  | { type: 'text-delta'; content: string }
  | { type: 'tool-call-delta'; toolCall: Partial<ToolCall> & { index?: number } }
  | { type: 'usage'; usage: Usage };

export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
  supportsJsonMode: boolean;
  maxContextTokens?: number;
  modality: 'text' | 'vision';
  latencyClass: 'fast' | 'medium' | 'slow';
  pricing?: {
    inputPerMTokUsd?: number;
    outputPerMTokUsd?: number;
  };
  /**
   * Configuration requirements for this adapter.
   * Used for runtime validation of provider configs.
   */
  configRequirements?: AdapterConfigRequirements;
}

/**
 * Describes the configuration requirements for an adapter.
 * Used to validate provider configs at runtime before instantiation.
 */
export interface AdapterConfigRequirements {
  /** Whether an API key is required (via api_key or api_key_env) */
  requiresApiKey?: boolean;
  /** Whether a command path is required (for subprocess-based adapters) */
  requiresCommand?: boolean;
  /** List of required config fields */
  requiredFields?: string[];
  /** List of forbidden config field names (adapter manages these internally) */
  forbiddenArgs?: string[];
  /** Supported config fields with their descriptions for documentation */
  supportedFields?: Record<string, { description: string; type: string; default?: unknown }>;
}

/**
 * Validation result for config validation against adapter capabilities.
 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
  warnings: ConfigValidationWarning[];
}

export interface ConfigValidationError {
  field: string;
  message: string;
  code: 'MISSING_REQUIRED' | 'FORBIDDEN_FIELD' | 'INVALID_TYPE' | 'INCOMPATIBLE_CAPABILITY';
}

export interface ConfigValidationWarning {
  field: string;
  message: string;
  code: 'UNKNOWN_FIELD' | 'DEPRECATED_FIELD' | 'CAPABILITY_MISMATCH';
}
