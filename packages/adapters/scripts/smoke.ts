import { AnthropicAdapter } from '../src/anthropic/adapter';
import { OpenAIAdapter } from '../src/openai/adapter';
import { AdapterContext } from '../src/types';

// Simple logger mock
const logger = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  log: async (_msg: string, _meta?: unknown) => {
    // Only log essential info or errors to keep output clean as per spec
    // Spec: "print only truncated text and usage"
    // So we suppress verbose logs here unless needed for debugging
  },
};

const context: AdapterContext = {
  runId: 'smoke-test',
  logger: logger as unknown as AdapterContext['logger'],
  retryOptions: { maxRetries: 0 },
};

async function runSmoke() {
  console.log('Starting adapter smoke tests...');
  let ranAny = false;

  // Anthropic
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    ranAny = true;
    console.log('Testing Anthropic...');
    try {
      const adapter = new AnthropicAdapter({
        type: 'anthropic',
        model: 'claude-3-haiku-20240307',
        api_key: anthropicKey,
      });

      const result = await adapter.generate(
        {
          messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
        },
        context,
      );

      console.log('Anthropic Result:', result.text?.slice(0, 100).replace(/\n/g, ' '));
      console.log('Anthropic Usage:', JSON.stringify(result.usage));
      console.log('✅ Anthropic Smoke Test Passed');
    } catch (error) {
      console.error('❌ Anthropic Smoke Test Failed:', error);
      process.exitCode = 1;
    }
  } else {
    console.log('⏭️  Skipping Anthropic (no ANTHROPIC_API_KEY)');
  }

  // OpenAI
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    ranAny = true;
    console.log('Testing OpenAI...');
    try {
      const adapter = new OpenAIAdapter({
        type: 'openai',
        model: 'gpt-3.5-turbo',
        api_key: openaiKey,
      });

      const result = await adapter.generate(
        {
          messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
        },
        context,
      );

      console.log('OpenAI Result:', result.text?.slice(0, 100).replace(/\n/g, ' '));
      console.log('OpenAI Usage:', JSON.stringify(result.usage));
      console.log('✅ OpenAI Smoke Test Passed');
    } catch (error) {
      console.error('❌ OpenAI Smoke Test Failed:', error);
      process.exitCode = 1;
    }
  } else {
    console.log('⏭️  Skipping OpenAI (no OPENAI_API_KEY)');
  }

  if (!ranAny) {
    console.log('ℹ️  No API keys provided. Skipping all smoke tests.');
  }
}

runSmoke().catch((err) => {
  console.error('Unhandled error:', err);
  process.exitCode = 1;
});
