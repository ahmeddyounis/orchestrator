/**
 * A message in a conversation with an LLM provider.
 * Supports system, user, assistant, and tool roles.
 */
export interface ChatMessage {
  /** The role of the message sender */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** The text content of the message */
  content: string;
  /** Optional name identifier for the message sender */
  name?: string;
  /** Tool calls made by the assistant in this message */
  toolCalls?: ToolCall[];
  /** ID of the tool call this message is responding to (for tool role) */
  toolCallId?: string;
}

/**
 * Specification for a tool that can be called by the LLM.
 * Defines the tool's name, description, and input schema.
 *
 * @example
 * ```typescript
 * const readFileTool: ToolSpec = {
 *   name: 'read_file',
 *   description: 'Read contents of a file',
 *   inputSchema: {
 *     type: 'object',
 *     properties: {
 *       path: { type: 'string', description: 'File path to read' }
 *     },
 *     required: ['path']
 *   }
 * };
 * ```
 */
export interface ToolSpec {
  /** Unique identifier for the tool */
  name: string;
  /** Human-readable description of what the tool does */
  description?: string;
  /** JSON Schema defining the tool's input parameters */
  inputSchema: Record<string, unknown>;
  /** If true, enforce strict schema validation (OpenAI-specific) */
  strict?: boolean;
}

/**
 * Represents a tool call made by the LLM.
 */
export interface ToolCall {
  /** Name of the tool being called */
  name: string;
  /** Arguments to pass to the tool (parsed from JSON) */
  arguments: unknown;
  /** Unique identifier for this tool call */
  id?: string;
}

/**
 * Request payload for generating a model response.
 *
 * @example
 * ```typescript
 * const request: ModelRequest = {
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   tools: [myTool],
 *   maxTokens: 1000,
 *   temperature: 0.7
 * };
 * ```
 */
export interface ModelRequest {
  /** Conversation history to send to the model */
  messages: ChatMessage[];
  /** Available tools the model can call */
  tools?: ToolSpec[];
  /** How the model should use tools */
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  /** Maximum tokens to generate in the response */
  maxTokens?: number;
  /** Sampling temperature (0-2, higher = more random) */
  temperature?: number;
  /** Request JSON-formatted output */
  jsonMode?: boolean;
  /** Additional metadata to pass through */
  metadata?: Record<string, unknown>;
}

/**
 * Token usage statistics from a model response.
 */
export interface Usage {
  /** Number of tokens in the input/prompt */
  inputTokens?: number;
  /** Number of tokens generated in the output */
  outputTokens?: number;
  /** Total tokens (input + output) */
  totalTokens?: number;
}

/**
 * Response from a model generation request.
 */
export interface ModelResponse {
  /** Generated text content */
  text?: string;
  /** Tool calls requested by the model */
  toolCalls?: ToolCall[];
  /** Token usage statistics */
  usage?: Usage;
  /** Raw provider-specific response data */
  raw?: unknown;
}

/**
 * Events emitted during streaming responses.
 * Used to receive incremental updates as the model generates content.
 */
export type StreamEvent =
  /** Incremental text content */
  | { type: 'text-delta'; content: string }
  /** Incremental tool call data */
  | { type: 'tool-call-delta'; toolCall: Partial<ToolCall> & { index?: number } }
  /** Final usage statistics */
  | { type: 'usage'; usage: Usage };

/**
 * Describes the capabilities of an LLM provider adapter.
 * Used for feature detection and configuration validation.
 */
export interface ProviderCapabilities {
  /** Whether the provider supports streaming responses */
  supportsStreaming: boolean;
  /** Whether the provider supports tool/function calling */
  supportsToolCalling: boolean;
  /** Whether the provider supports JSON mode output */
  supportsJsonMode: boolean;
  /** Maximum context window size in tokens */
  maxContextTokens?: number;
  /** Input modality supported by the model */
  modality: 'text' | 'vision';
  /** Expected response latency classification */
  latencyClass: 'fast' | 'medium' | 'slow';
  /** Pricing information per million tokens */
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
  /** Whether the configuration is valid */
  valid: boolean;
  /** Validation errors that must be fixed */
  errors: ConfigValidationError[];
  /** Validation warnings that should be reviewed */
  warnings: ConfigValidationWarning[];
}

/**
 * A validation error that prevents adapter instantiation.
 */
export interface ConfigValidationError {
  /** The config field with the error */
  field: string;
  /** Human-readable error message */
  message: string;
  /** Error type code */
  code: 'MISSING_REQUIRED' | 'FORBIDDEN_FIELD' | 'INVALID_TYPE' | 'INCOMPATIBLE_CAPABILITY';
}

/**
 * A validation warning that doesn't prevent operation but should be reviewed.
 */
export interface ConfigValidationWarning {
  /** The config field with the warning */
  field: string;
  /** Human-readable warning message */
  message: string;
  /** Warning type code */
  code: 'UNKNOWN_FIELD' | 'DEPRECATED_FIELD' | 'CAPABILITY_MISMATCH';
}
