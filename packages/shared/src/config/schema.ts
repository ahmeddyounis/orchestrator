import { z } from 'zod';

export const ProviderConfigSchema = z
  .object({
    type: z.string(),
    model: z.string(),
    supportsTools: z.boolean().optional(),
    api_key_env: z.string().optional(),
    api_key: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.array(z.string()).optional(),
    cwdMode: z.enum(['repoRoot', 'runDir']).optional(),
    pricing: z
      .object({
        inputPerMTokUsd: z.number().optional(),
        outputPerMTokUsd: z.number().optional(),
      })
      .optional(),
  })
  .passthrough();

export const ConfigSchema = z.object({
  configVersion: z.literal(1).default(1),
  providers: z.record(z.string(), ProviderConfigSchema).optional(),
  defaults: z
    .object({
      planner: z.string().optional(),
      executor: z.string().optional(),
      reviewer: z.string().optional(),
    })
    .optional(),
  budgets: z.record(z.string(), z.number()).optional(),
  commandPolicy: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
