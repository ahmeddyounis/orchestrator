import { OpenAIAdapter } from './packages/adapters/src/openai/adapter';
import { ProviderConfig } from './packages/shared/src/config/schema';

// This script expects ts-node or similar to run.
// usage: npx tsx verify-m02-03.ts

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.log('Skipping manual verification: OPENAI_API_KEY not set.');
    console.log(
      'To run manual verification: export OPENAI_API_KEY=sk-... && npx tsx verify-m02-03.ts',
    );
    return;
  }

  const config: ProviderConfig = {
    type: 'openai',
    model: 'gpt-3.5-turbo',
    api_key_env: 'OPENAI_API_KEY',
  };

  try {
    const adapter = new OpenAIAdapter(config);

    console.log('Testing generate()...');
    const response = await adapter.generate(
      {
        messages: [{ role: 'user', content: 'Say hello!' }],
        maxTokens: 10,
      },
      {
        runId: 'test',
        logger: console as any,
      },
    );

    console.log('Response:', response.text);

    if (!response.text) {
      console.error('FAILED: No text response');
      process.exit(1);
    }

    console.log('Testing stream()...');
    const stream = adapter.stream(
      {
        messages: [{ role: 'user', content: 'Count to 3' }],
        maxTokens: 20,
      },
      {
        runId: 'test-stream',
        logger: console as any,
      },
    );

    for await (const event of stream) {
      if (event.type === 'text-delta') {
        process.stdout.write(event.content);
      }
    }
    console.log('\nDone.');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main().catch(console.error);
