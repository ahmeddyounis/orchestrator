'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.SimpleContextFuser = void 0;
const HEADER_SEPARATOR = `
${'-'.repeat(20)}
`;
class SimpleContextFuser {
  fuse(inputs) {
    const { repoPack, memoryHits, signals, budgets, goal } = inputs;
    const metadata = {
      repoItems: [],
      memoryHits: [],
      signals: [],
    };
    const promptSections = [];
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
  packRepoContext(repoPack, budget) {
    let totalChars = 0;
    const items = [];
    const metadata = [];
    for (const item of repoPack.items) {
      const header = `// ${item.path}:${item.startLine}`;
      const content = item.content;
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
  packMemory(memoryHits, budget) {
    let totalChars = 0;
    const items = [];
    const metadata = [];
    for (const hit of memoryHits) {
      const header = `// MEMORY ID: ${hit.id} (${hit.type})`;
      const content = `// ${hit.title}\n${hit.content}`;
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
  packSignals(signals, budget) {
    let totalChars = 0;
    const items = [];
    const metadata = [];
    for (const signal of signals) {
      let content = `Type: ${signal.type}`;
      if (signal.data) {
        content += `\nData: ${JSON.stringify(signal.data, null, 2)}`;
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
exports.SimpleContextFuser = SimpleContextFuser;
//# sourceMappingURL=fusion.js.map
