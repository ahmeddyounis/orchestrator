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
  toolChoice?:
    | 'auto'
    | 'none'
    | 'required'
    | {
        type: 'function';
        function: {
          name: string;
        };
      };
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
  | {
      type: 'text-delta';
      content: string;
    }
  | {
      type: 'tool-call-delta';
      toolCall: Partial<ToolCall> & {
        index?: number;
      };
    }
  | {
      type: 'usage';
      usage: Usage;
    };
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
}
//# sourceMappingURL=llm.d.ts.map
