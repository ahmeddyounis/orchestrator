"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIAdapter = void 0;
const openai_1 = __importStar(require("openai"));
const index_1 = require("../index");
const common_1 = require("../common");
class OpenAIAdapter {
    client;
    model;
    constructor(config) {
        const apiKey = config.api_key || (config.api_key_env && process.env[config.api_key_env]);
        if (!apiKey) {
            throw new index_1.ConfigError(`Missing API Key for OpenAI provider. Checked config.api_key and env var ${config.api_key_env}`);
        }
        this.model = config.model;
        this.client = new openai_1.default({
            apiKey,
            baseURL: undefined, // Could be added to config if needed
        });
    }
    id() {
        return 'openai';
    }
    capabilities() {
        return {
            supportsStreaming: true,
            supportsToolCalling: true,
            supportsJsonMode: true,
            modality: 'text',
            latencyClass: 'medium',
        };
    }
    async generate(req, ctx) {
        return (0, common_1.executeProviderRequest)(ctx, 'openai', this.model, async (signal) => {
            try {
                const messages = this.mapMessages(req.messages);
                const tools = this.mapTools(req.tools);
                const completion = await this.client.chat.completions.create({
                    model: this.model,
                    messages,
                    tools: tools.length > 0 ? tools : undefined,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    tool_choice: req.toolChoice,
                    max_tokens: req.maxTokens,
                    temperature: req.temperature ?? 0.2,
                    response_format: req.jsonMode ? { type: 'json_object' } : undefined,
                }, {
                    signal,
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
                    .filter((tc) => tc !== null);
                return {
                    text: choice.message.content || undefined,
                    toolCalls,
                    usage,
                    raw: completion,
                };
            }
            catch (error) {
                throw this.mapError(error);
            }
        });
    }
    async *stream(req, ctx) {
        try {
            const stream = await (0, common_1.executeProviderRequest)(ctx, 'openai', this.model, async (signal) => {
                try {
                    const messages = this.mapMessages(req.messages);
                    const tools = this.mapTools(req.tools);
                    return await this.client.chat.completions.create({
                        model: this.model,
                        messages,
                        tools: tools.length > 0 ? tools : undefined,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        tool_choice: req.toolChoice,
                        max_tokens: req.maxTokens,
                        temperature: req.temperature ?? 0.2,
                        response_format: req.jsonMode ? { type: 'json_object' } : undefined,
                        stream: true,
                        stream_options: { include_usage: true },
                    }, {
                        signal,
                    });
                }
                catch (error) {
                    throw this.mapError(error);
                }
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
                if (!delta)
                    continue;
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
        }
        catch (error) {
            throw this.mapError(error);
        }
    }
    mapMessages(messages) {
        return messages.map((m) => {
            // Basic mapping
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const base = { role: m.role };
            // Handle content
            if (m.content) {
                base.content = m.content;
            }
            else if (m.toolCalls && m.role === 'assistant') {
                // Assistant with tool calls might have null content
                base.content = null;
            }
            else {
                base.content = '';
            }
            if (m.name)
                base.name = m.name;
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
            return base;
        });
    }
    mapTools(tools) {
        if (!tools)
            return [];
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
    mapError(error) {
        if (error instanceof openai_1.APIError) {
            if (error.status === 429) {
                return new index_1.RateLimitError(error.message);
            }
            if (error.status === 401) {
                return new index_1.ConfigError(error.message);
            }
        }
        if (error instanceof openai_1.APIConnectionTimeoutError) {
            return new index_1.TimeoutError(error.message);
        }
        if (error instanceof Error)
            return error;
        return new Error(String(error));
    }
}
exports.OpenAIAdapter = OpenAIAdapter;
