import {
  ProviderConfig,
  ProviderCapabilities,
  ModelRequest as GenerateRequest,
  ModelResponse as GenerateResponse,
} from '@orchestrator/shared';

import { ProviderAdapter } from '../adapter';
import { AdapterContext } from '../types';

const HELLO_WORLD_PLAN = {
  steps: ["Add a new exported function to package-a's index.ts that returns 'hello world'."],
};

const HELLO_WORLD_DIFF = `
BEGIN_DIFF
diff --git a/packages/package-a/src/index.ts b/packages/package-a/src/index.ts
--- a/packages/package-a/src/index.ts
+++ b/packages/package-a/src/index.ts
@@ -1,5 +1,7 @@
 import { add } from 'package-b';
 
 export function myFunc(a: number, b: number): number {
   return add(a, b);
 }
+
+export const helloWorld = () => 'hello world';
END_DIFF
`;

const FAKE_DIFF_FAIL = `
BEGIN_DIFF
diff --git a/packages/package-a/src/index.test.ts b/packages/package-a/src/index.test.ts
--- a/packages/package-a/src/index.test.ts
+++ b/packages/package-a/src/index.test.ts
@@ -2,5 +2,5 @@
 import { expect, test } from 'vitest';
 
 test('myFunc', () => {
-  expect(myFunc(1, 2)).toBe(4);
+  expect(myFunc(1, 2)).toBe(5);
 });
END_DIFF
`;

const FAKE_DIFF_SUCCESS = `
BEGIN_DIFF
diff --git a/packages/package-a/src/index.test.ts b/packages/package-a/src/index.test.ts
--- a/packages/package-a/src/index.test.ts
+++ b/packages/package-a/src/index.test.ts
@@ -2,5 +2,5 @@
 import { expect, test } from 'vitest';
 
 test('myFunc', () => {
-  expect(myFunc(1, 2)).toBe(4);
+  expect(myFunc(1, 2)).toBe(3);
 });
END_DIFF
`;

export class FakeAdapter implements ProviderAdapter {
  constructor(private config: ProviderConfig) {}

  id(): string {
    return 'fake';
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false,
      supportsToolCalling: false,
      supportsJsonMode: true,
      modality: 'text',
      latencyClass: 'fast',
    };
  }

  async generate(request: GenerateRequest, _context: AdapterContext): Promise<GenerateResponse> {
    if (request.jsonMode) {
      const prompt = request.messages?.map((m) => m.content).join('\n') || '';
      if (prompt.toLowerCase().includes('hello world')) {
        return { text: JSON.stringify(HELLO_WORLD_PLAN) };
      }
      return { text: JSON.stringify({ steps: ['Implement the requested change.'] }) };
    }

    const prompt = request.messages?.map((m) => m.content).join('\n') || '';
    if (prompt.toLowerCase().includes('hello world')) {
      return { text: HELLO_WORLD_DIFF };
    }

    const behavior = process.env.FAKE_ADAPTER_BEHAVIOR;
    if (!behavior) {
      return { text: FAKE_DIFF_SUCCESS };
    }

    const behaviors = behavior.split(',');
    const currentBehavior = behaviors.shift() || 'SUCCESS';
    process.env.FAKE_ADAPTER_BEHAVIOR = behaviors.join(',');

    if (currentBehavior === 'FAIL') {
      return { text: FAKE_DIFF_FAIL };
    }

    return { text: FAKE_DIFF_SUCCESS };
  }
}
