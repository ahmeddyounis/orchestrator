import { z } from 'zod';

export const CONTEXT_STACK_FRAME_SCHEMA_VERSION = 1 as const;

export const ContextStackFrameSchema = z.object({
  schemaVersion: z.literal(CONTEXT_STACK_FRAME_SCHEMA_VERSION),
  ts: z.string(),
  runId: z.string().optional(),
  kind: z.string(),
  title: z.string(),
  summary: z.string(),
  details: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type ContextStackFrame = z.infer<typeof ContextStackFrameSchema>;
