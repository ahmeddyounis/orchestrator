import { z } from 'zod';

export const ConfigSchema = z.object({
  configVersion: z.literal(1).default(1),
  providers: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  budgets: z.record(z.string(), z.number()).optional(),
  commandPolicy: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
