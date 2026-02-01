import { AdapterContext, RetryOptions } from '../types';
export declare function executeProviderRequest<T>(
  ctx: AdapterContext,
  provider: string,
  model: string,
  requestFn: (signal: AbortSignal) => Promise<T>,
  optionsOverride?: RetryOptions,
): Promise<T>;
//# sourceMappingURL=index.d.ts.map
