import type { ContextSignal } from '@orchestrator/repo';

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((v) => String(v).trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function extractOrchestratorPackages(text: string): string[] {
  const out: string[] = [];
  const input = String(text ?? '');
  const re = /@orchestrator\/([a-z0-9_-]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const pkg = match[1];
    if (pkg) out.push(`packages/${pkg}`);
  }
  return out;
}

function extractPackagesPathHints(text: string): string[] {
  const out: string[] = [];
  const input = String(text ?? '');
  const re = /(^|[^a-z0-9_-])packages\/([a-z0-9_-]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const pkg = match[2];
    if (pkg) out.push(`packages/${pkg}`);
  }
  return out;
}

function tail(text: string, maxChars: number): string {
  const input = String(text ?? '');
  if (input.length <= maxChars) return input;
  return input.slice(input.length - maxChars);
}

export function buildContextSignals(args: {
  goal: string;
  step: string;
  ancestors?: string[];
  touchedFiles?: Iterable<string>;
  errorText?: string;
  errorContext?: string;
  baseSignals?: ContextSignal[];
}): ContextSignal[] {
  const baseSignals = args.baseSignals ?? [];
  const touchedFiles = args.touchedFiles ?? [];

  const packageHints = uniqueSorted([
    ...extractOrchestratorPackages(args.goal),
    ...extractOrchestratorPackages(args.step),
    ...(args.ancestors ? args.ancestors.flatMap(extractOrchestratorPackages) : []),
    ...extractPackagesPathHints(args.goal),
    ...extractPackagesPathHints(args.step),
    ...(args.ancestors ? args.ancestors.flatMap(extractPackagesPathHints) : []),
  ]);

  const signals: ContextSignal[] = [];

  for (const s of baseSignals) signals.push(s);

  for (const pkg of packageHints.slice(0, 10)) {
    signals.push({ type: 'package_focus', data: pkg, weight: 1.6 });
  }

  const touched = uniqueSorted(touchedFiles).slice(0, 25);
  for (const file of touched) {
    signals.push({ type: 'file_change', data: file, weight: 2 });
  }

  const errorParts = [args.errorText, args.errorContext].filter((p) => p && p.trim().length > 0);
  if (errorParts.length > 0) {
    signals.push({
      type: 'error',
      data: { stack: tail(errorParts.join('\n\n'), 8000) },
      weight: 2,
    });
  }

  return signals;
}
