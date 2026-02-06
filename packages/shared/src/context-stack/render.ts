import type { ContextStackFrame } from './types';

const HEADER_SEPARATOR = `
${'-'.repeat(20)}
`;

export function renderContextStackForPrompt(
  frames: ContextStackFrame[],
  options: {
    maxChars: number;
    maxFrames: number;
  },
): string {
  const maxChars = Math.max(0, Math.floor(options.maxChars));
  if (maxChars === 0) return '';

  const maxFrames = Math.max(0, Math.floor(options.maxFrames));
  if (maxFrames === 0) return '';

  if (frames.length === 0) return '';

  const newestFirst = [...frames].reverse();

  const blocks: string[] = [];
  let totalChars = 0;

  for (let i = 0; i < newestFirst.length && blocks.length < maxFrames; i++) {
    const frame = newestFirst[i];
    const headerParts: string[] = [];
    headerParts.push(`#${i + 1}`);
    if (frame.ts) headerParts.push(frame.ts);
    if (frame.runId) headerParts.push(`run:${frame.runId}`);
    if (frame.kind) headerParts.push(frame.kind);

    const header = headerParts.join(' | ');

    const bodyLines: string[] = [];
    if (frame.title) bodyLines.push(`Title: ${frame.title}`);
    if (frame.summary) bodyLines.push(`Summary: ${frame.summary}`);
    if (frame.details) bodyLines.push(`Details: ${frame.details}`);
    if (frame.artifacts && frame.artifacts.length > 0) {
      bodyLines.push(`Artifacts: ${frame.artifacts.join(', ')}`);
    }

    const block = `${header}\n${bodyLines.join('\n')}`.trim();
    if (!block) continue;

    const blockWithSep = blocks.length === 0 ? block : `${HEADER_SEPARATOR}${block}`;

    if (totalChars + blockWithSep.length > maxChars) {
      const remaining = maxChars - totalChars;
      if (remaining <= 0) break;
      const truncated = blockWithSep.slice(0, remaining) + '\n...[TRUNCATED]';
      blocks.push(truncated);
      totalChars += truncated.length;
      break;
    }

    blocks.push(blockWithSep);
    totalChars += blockWithSep.length;
  }

  const omittedFrames = Math.max(0, newestFirst.length - blocks.length);
  if (omittedFrames > 0) {
    const marker = `\n...[TRUNCATED] (+${omittedFrames} older frame${omittedFrames === 1 ? '' : 's'} not shown)`;

    if (totalChars + marker.length > maxChars) {
      // Best-effort: still append a short marker even if we're out of budget.
      blocks.push(`\n...[TRUNCATED]`);
    } else {
      blocks.push(marker);
    }
  }

  if (blocks.length === 0) return '';
  return blocks.join('');
}
