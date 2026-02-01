import { ContextFuser, FusedContext, FusionBudgets } from './types';
import { ContextPack, ContextSignal } from '@orchestrator/repo';
import { MemoryEntry } from '@orchestrator/memory';
import { Config, SecretScanner, redact } from '@orchestrator/shared';
import {
  filterInjectionPhrases,
  wrapUntrustedContent,
} from '../security/guards';

const HEADER_SEPARATOR = `
${'-'.repeat(20)}
`;

export class SimpleContextFuser implements ContextFuser {
  private scanner?: SecretScanner;
  private redactionEnabled: boolean;

  constructor(config?: Config['security']) {
    this.redactionEnabled = config?.redaction?.enabled ?? false;
    if (this.redactionEnabled) {
      this.scanner = new SecretScanner();
    }
  }

  fuse(inputs: {
    repoPack: ContextPack;
    memoryHits: MemoryEntry[];
    signals: ContextSignal[];
    budgets: FusionBudgets;
    goal: string;
  }): FusedContext {
    const { repoPack, memoryHits, signals, budgets, goal } = inputs;

    const metadata: FusedContext['metadata'] = {
      repoItems: [],
      memoryHits: [],
      signals: [],
    };

    const promptSections: string[] = [];

    // 1. Goal
    if (goal) {
      promptSections.push(`GOAL: ${goal}`);
    }

    // 2. Repo Context
    if (repoPack.items.length > 0) {
      const [repoString, repoMeta] = this.packRepoContext(repoPack, budgets.maxRepoContextChars);
      promptSections.push(`REPO CONTEXT:${HEADER_SEPARATOR}${repoString}`);
      metadata.repoItems = repoMeta;
    }

    // 3. Memory
    if (memoryHits.length > 0) {
      const [memoryString, memoryMeta] = this.packMemory(memoryHits, budgets.maxMemoryChars);
      promptSections.push(`MEMORY:${HEADER_SEPARATOR}${memoryString}`);
      metadata.memoryHits = memoryMeta;
    }

    // 4. Signals
    if (signals.length > 0) {
      const [signalsString, signalsMeta] = this.packSignals(signals, budgets.maxSignalsChars);
      promptSections.push(`RECENT SIGNALS:${HEADER_SEPARATOR}${signalsString}`);
      metadata.signals = signalsMeta;
    }

    const prompt = promptSections.join(`

`);

    return {
      prompt,
      metadata,
    };
  }

  private packRepoContext(
    repoPack: ContextPack,
    budget: number,
  ): [string, FusedContext['metadata']['repoItems']] {
    let totalChars = 0;
    const items: string[] = [];
    const metadata: FusedContext['metadata']['repoItems'] = [];

    for (const item of repoPack.items) {
      const header = `// ${item.path}:${item.startLine}`;
      let content = item.content;

      // M18-03: Apply prompt injection defenses.
      content = wrapUntrustedContent(filterInjectionPhrases(content));

      if (this.redactionEnabled && this.scanner) {
        const findings = this.scanner.scan(content);
        if (findings.length > 0) {
          content = redact(content, findings);
        }
      }

      const block = `${header}\n${content}`;

      if (totalChars + block.length > budget) {
        const remainingBudget = budget - totalChars;
        const truncatedBlock = block.slice(0, remainingBudget) + '\n// ...[TRUNCATED]';
        items.push(truncatedBlock);
        metadata.push({ ...item, truncated: true });
        totalChars += truncatedBlock.length;
        break; // Stop adding more items
      } else {
        items.push(block);
        metadata.push({ ...item, truncated: false });
        totalChars += block.length;
      }
    }
    return [items.join('\n\n'), metadata];
  }

  private packMemory(
    memoryHits: MemoryEntry[],
    budget: number,
  ): [string, FusedContext['metadata']['memoryHits']] {
    let totalChars = 0;
    const items: string[] = [];
    const metadata: FusedContext['metadata']['memoryHits'] = [];

    for (const hit of memoryHits) {
      const header = `// MEMORY ID: ${hit.id} (${hit.type})`;
      let content = `// ${hit.title}\n${hit.content}`;

      if (this.redactionEnabled && this.scanner) {
        const findings = this.scanner.scan(content);
        if (findings.length > 0) {
          content = redact(content, findings);
        }
      }

      const block = `${header}\n${content}`;

      if (totalChars + block.length > budget) {
        const remainingBudget = budget - totalChars;
        const truncatedBlock = block.slice(0, remainingBudget) + '\n// ...[TRUNCATED]';
        items.push(truncatedBlock);
        metadata.push({ id: hit.id, truncated: true });
        totalChars += truncatedBlock.length;
        break;
      } else {
        items.push(block);
        metadata.push({ id: hit.id, truncated: false });
        totalChars += block.length;
      }
    }
    return [items.join('\n\n'), metadata];
  }

  private packSignals(
    signals: ContextSignal[],
    budget: number,
  ): [string, FusedContext['metadata']['signals']] {
    let totalChars = 0;
    const items: string[] = [];
    const metadata: FusedContext['metadata']['signals'] = [];

    for (const signal of signals) {
      let content = `Type: ${signal.type}`;
      if (signal.type === 'diagnosis' && typeof signal.data === 'string') {
        content += `\n${signal.data}`;
      } else if (signal.data) {
        content += `\nData: ${JSON.stringify(signal.data, null, 2)}`;
      }

      if (this.redactionEnabled && this.scanner) {
        const findings = this.scanner.scan(content);
        if (findings.length > 0) {
          content = redact(content, findings);
        }
      }

      if (totalChars + content.length > budget) {
        const remainingBudget = budget - totalChars;
        const truncatedContent = content.slice(0, remainingBudget) + '\n...[TRUNCATED]';
        items.push(truncatedContent);
        metadata.push({ type: signal.type, truncated: true });
        totalChars += truncatedContent.length;
        break;
      } else {
        items.push(content);
        metadata.push({ type: signal.type, truncated: false });
        totalChars += content.length;
      }
    }
    return [items.join('\n---\n'), metadata];
  }
}
