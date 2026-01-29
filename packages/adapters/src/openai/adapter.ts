import OpenAI, { APIError, APIConnectionTimeoutError } from 'openai';
import {
  ModelRequest,
  ModelResponse,
  ProviderCapabilities,
  StreamEvent,
  ChatMessage,
  Usage,
  ToolSpec,
  ProviderConfig,
  ToolCall,
} from '@orchestrator/shared';
import {
  ProviderAdapter,
  AdapterContext,
  ConfigError,
  RateLimitError,
  TimeoutError,
} from '../index';

export class OpenAIAdapter implements ProviderAdapter {
  private client: OpenAI;
  private model: string;

  constructor(config: ProviderConfig) {
    const apiKey = config.api_key || (config.api_key_env && process.env[config.api_key_env]);
    if (!apiKey) {
      throw new ConfigError(
        `Missing API Key for OpenAI provider. Checked config.api_key and env var ${config.api_key_env}`,
      );
    }
    this.model = config.model;
    this.client = new OpenAI({
      apiKey,
      baseURL: undefined, // Could be added to config if needed
    });
  }

  id(): string {
    return 'openai';
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsJsonMode: true,
      modality: 'text',
      latencyClass: 'medium',
    };
  }

  async generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse> {
    try {
      const messages = this.mapMessages(req.messages);
      const tools = this.mapTools(req.tools);

      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: req.toolChoice as any,
        max_tokens: req.maxTokens,
        temperature: req.temperature ?? 0.2,
        response_format: req.jsonMode ? { type: 'json_object' } : undefined,
      }, {
        signal: ctx.abortSignal,
        timeout: ctx.timeoutMs
      });

      const choice = completion.choices[0];
      const usage = completion.usage
        ? {
            inputTokens: completion.usage.prompt_tokens,
            outputTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : undefined;

      const toolCalls = choice.message.tool_calls
        ?.map((tc) => {
          if (tc.type === 'function') {
            return {
              name: tc.function.name,
              arguments: JSON.parse(tc.function.arguments),
              id: tc.id,
            };
          }
          return null;
        })
        .filter((tc) => tc !== null) as ToolCall[];

      return {
        text: choice.message.content || undefined,
        toolCalls,
        usage,
        raw: completion,
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async *stream(req: ModelRequest, ctx: AdapterContext): AsyncIterable<StreamEvent> {
    try {
      const messages = this.mapMessages(req.messages);
      const tools = this.mapTools(req.tools);

      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: req.toolChoice as any,
        max_tokens: req.maxTokens,
        temperature: req.temperature ?? 0.2,
        response_format: req.jsonMode ? { type: 'json_object' } : undefined,
        stream: true,
        stream_options: { include_usage: true }
      }, {
        signal: ctx.abortSignal,
        timeout: ctx.timeoutMs
      });

      for await (const chunk of stream) {
        if (chunk.usage) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
            },
          };
        }

        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          yield { type: 'text-delta', content: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            yield {
              type: 'tool-call-delta',
              toolCall: {
                name: tc.function?.name,
                arguments: tc.function?.arguments, // Sending partial string
                id: tc.id,
                index: tc.index,
              },
            };
          }
        }
      }
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapMessages(messages: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      // Basic mapping
      const base: any = { role: m.role };

      // Handle content
      if (m.content) {
        base.content = m.content;
      } else if (m.toolCalls && m.role === 'assistant') {
        // Assistant with tool calls might have null content
        base.content = null;
      } else {
        base.content = '';
      }

      if (m.name) base.name = m.name;

      if (m.role === 'tool') {
        if (!m.toolCallId) {
          // This is a requirement for OpenAI tool messages
          // If we don't have it, we might fail or need a fallback.
          // Ideally the orchestrator ensures this.
        }
        base.tool_call_id = m.toolCallId;
      }

      if (m.role === 'assistant' && m.toolCalls) {
        base.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }

      return base as OpenAI.Chat.ChatCompletionMessageParam;
    });
  }

  private mapTools(tools?: ToolSpec[]): OpenAI.Chat.ChatCompletionTool[] {
    if (!tools) return [];
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
        strict: t.strict,
      },
    }));
  }

  private mapError(error: any): Error {
    if (error instanceof APIError) {
      if (error.status === 429) {
        return new RateLimitError(error.message);
      }
      if (error.status === 401) {
        return new ConfigError(error.message);
      }
    }
    if (error instanceof APIConnectionTimeoutError) {
      return new TimeoutError(error.message);
    }
    return error;
  }
}
