import {
  ProviderConfig,
  ProviderCapabilities,
  ModelRequest as GenerateRequest,
  ModelResponse as GenerateResponse,
} from '@orchestrator/shared';

import { ProviderAdapter } from '../adapter';
import { AdapterContext } from '../types';

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
      supportsJsonMode: false,
      modality: 'text',
      latencyClass: 'fast',
    };
  }

  async generate(request: GenerateRequest, context: AdapterContext): Promise<GenerateResponse> {
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
