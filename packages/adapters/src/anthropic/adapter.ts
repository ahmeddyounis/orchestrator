import Anthropic from '@anthropic-ai/sdk';
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
import { executeProviderRequest } from '../common';

export class AnthropicAdapter implements ProviderAdapter {
  private client: Anthropic;
  private model: string;

  constructor(config: ProviderConfig) {
    const apiKey = config.api_key || (config.api_key_env && process.env[config.api_key_env]);
    if (!apiKey) {
      throw new ConfigError(
        `Missing API Key for Anthropic provider. Checked config.api_key and env var ${config.api_key_env}`,
      );
    }
    this.model = config.model;
    this.client = new Anthropic({
      apiKey,
    });
  }

  id(): string {
    return 'anthropic';
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsJsonMode: false,
      modality: 'text',
      latencyClass: 'medium',
    };
  }

  async generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse> {
    return executeProviderRequest(ctx, 'anthropic', this.model, async (signal) => {
      try {
        const { system, messages } = this.mapMessages(req.messages);
        const tools = this.mapTools(req.tools);

        const response = await this.client.messages.create(
          {
            model: this.model,
            max_tokens: req.maxTokens || 1024,
            system,
            messages,
            tools: tools.length > 0 ? tools : undefined,
            temperature: req.temperature,
          },
          {
            signal,
          },
        );

        const textBlocks = response.content.filter((b) => b.type === 'text');
        const text = textBlocks.map((b) => b.text).join('');

        const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
        const toolCalls: ToolCall[] = toolUseBlocks.map((b) => ({
          name: b.name,
          arguments: b.input,
          id: b.id,
        }));

        const usage: Usage = {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        };

        return {
          text,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage,
          raw: response,
        };
      } catch (error) {
        throw this.mapError(error);
      }
    });
  }

  async *stream(req: ModelRequest, ctx: AdapterContext): AsyncIterable<StreamEvent> {
    try {
      const stream = await executeProviderRequest(ctx, 'anthropic', this.model, async (signal) => {
        try {
          const { system, messages } = this.mapMessages(req.messages);
          const tools = this.mapTools(req.tools);

          return await this.client.messages.create(
            {
              model: this.model,
              max_tokens: req.maxTokens || 1024,
              system,
              messages,
              tools: tools.length > 0 ? tools : undefined,
              temperature: req.temperature,
              stream: true,
            },
            {
              signal,
            },
          );
        } catch (error) {
          throw this.mapError(error);
        }
      });

      for await (const chunk of stream) {
        if (chunk.type === 'message_start') {
          if (chunk.message.usage) {
            yield {
              type: 'usage',
              usage: {
                inputTokens: chunk.message.usage.input_tokens,
                outputTokens: chunk.message.usage.output_tokens, // likely 0 here
                totalTokens: chunk.message.usage.input_tokens + chunk.message.usage.output_tokens,
              },
            };
          }
        } else if (chunk.type === 'content_block_start') {
          if (chunk.content_block.type === 'tool_use') {
            yield {
              type: 'tool-call-delta',
              toolCall: {
                index: chunk.index,
                id: chunk.content_block.id,
                name: chunk.content_block.name,
                arguments: '',
              },
            };
          }
        } else if (chunk.type === 'content_block_delta') {
          if (chunk.delta.type === 'text_delta') {
            yield {
              type: 'text-delta',
              content: chunk.delta.text,
            };
          } else if (chunk.delta.type === 'input_json_delta') {
            yield {
              type: 'tool-call-delta',
              toolCall: {
                index: chunk.index,
                arguments: chunk.delta.partial_json,
              },
            };
          }
        } else if (chunk.type === 'message_delta') {
          if (chunk.usage) {
            yield {
              type: 'usage',
              usage: {
                // inputTokens not sent here usually, but output is
                outputTokens: chunk.usage.output_tokens,
              },
            };
          }
        }
      }
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapMessages(messages: ChatMessage[]): {
    system?: string;
    messages: Anthropic.MessageParam[];
  } {
    let system: string | undefined;
    const mappedMessages: Anthropic.MessageParam[] = [];

    // Buffer for tool results to coalesce them
    let toolResultBuffer: Anthropic.ToolResultBlockParam[] = [];

    const flushToolResults = () => {
      if (toolResultBuffer.length > 0) {
        mappedMessages.push({
          role: 'user',
          content: toolResultBuffer,
        });
        toolResultBuffer = [];
      }
    };

    for (const m of messages) {
      if (m.role === 'system') {
        system = system ? system + '\n' + m.content : m.content;
      } else if (m.role === 'tool') {
        toolResultBuffer.push({
          type: 'tool_result',
          tool_use_id: m.toolCallId || 'unknown',
          content: m.content,
        });
      } else {
        // Before handling other roles, flush any pending tool results
        flushToolResults();

        if (m.role === 'user') {
          mappedMessages.push({ role: 'user', content: m.content });
        } else if (m.role === 'assistant') {
          const content: Anthropic.ContentBlockParam[] = [];
          if (m.content) {
            content.push({ type: 'text', text: m.content });
          }
          if (m.toolCalls) {
            m.toolCalls.forEach((tc) => {
              content.push({
                type: 'tool_use',
                id: tc.id || 'unknown',
                name: tc.name,
                input: tc.arguments as Record<string, unknown>,
              });
            });
          }
          mappedMessages.push({ role: 'assistant', content });
        }
      }
    }
    // Flush any remaining tool results
    flushToolResults();

    return { system, messages: mappedMessages };
  }

  private mapTools(tools?: ToolSpec[]): Anthropic.Tool[] {
    if (!tools) return [];
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));
  }

  private mapError(error: unknown): Error {
    if (error instanceof Anthropic.APIError) {
      if (error.status === 429) {
        return new RateLimitError(error.message);
      }
      if (error.status === 401) {
        return new ConfigError(error.message);
      }
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return new TimeoutError(error.message);
    }
    if (error instanceof Error) return error;
    return new Error(String(error));
  }
}
