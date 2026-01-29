import { ModelRequest } from '@orchestrator/shared';
import { ProviderAdapter, AdapterContext, parsePlanFromText } from '@orchestrator/adapters';
import {
  SearchService,
  SnippetExtractor,
  SimpleContextPacker,
  ContextSignal,
  Snippet,
} from '@orchestrator/repo';
import { EventBus } from '../registry';
import * as fs from 'fs/promises';
import * as path from 'path';

export class PlanService {
  constructor(private eventBus: EventBus) {}

  async generatePlan(
    goal: string,
    providers: { planner: ProviderAdapter },
    ctx: AdapterContext,
    artifactsDir: string,
    repoRoot: string,
  ): Promise<string[]> {
    await this.eventBus.emit({
      type: 'PlanRequested',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: ctx.runId,
      payload: { goal },
    });

    // 1. Build Context
    const queries = [goal]; // Naive query generation for now
    let contextPack;
    let candidates: Snippet[] = [];

    try {
      const searchService = new SearchService();
      const searchResults = await searchService.search({
        query: goal,
        cwd: repoRoot,
        maxMatchesPerFile: 5, // Limit noise
      });

      const extractor = new SnippetExtractor();
      candidates = await extractor.extractSnippets(searchResults.matches, {
        cwd: repoRoot,
      });

      const packer = new SimpleContextPacker();
      const signals: ContextSignal[] = []; // No signals yet
      const options = {
        tokenBudget: 10000, // Reasonable default?
      };

      contextPack = packer.pack(goal, signals, candidates, options);

      // Write Context Artifacts
      const excludedCount = candidates.length - contextPack.items.length;
      const provenance = {
        goal,
        queries,
        pack: contextPack,
        stats: {
          candidatesFound: candidates.length,
          itemsSelected: contextPack.items.length,
          itemsExcluded: excludedCount,
        },
      };

      await fs.writeFile(
        path.join(artifactsDir, 'context_pack.json'),
        JSON.stringify(provenance, null, 2),
      );

      // Human readable report
      let readableReport = `Goal: ${goal}\n`;
      readableReport += `Queries: ${queries.join(', ')}\n`;
      readableReport += `Stats: ${candidates.length} candidates, ${contextPack.items.length} selected, ${excludedCount} excluded\n`;
      readableReport += `Estimated Tokens: ${contextPack.estimatedTokens}\n\n`;
      readableReport += `--- Selected Context ---\n`;

      for (const item of contextPack.items) {
        readableReport += `File: ${item.path} (${item.startLine}-${item.endLine})\n`;
        readableReport += `Reason: ${item.reason} (Score: ${item.score.toFixed(2)})\n`;
        readableReport += `---\n${item.content}\n---\n\n`;
      }

      await fs.writeFile(path.join(artifactsDir, 'context_pack.txt'), readableReport);

    } catch (err) {
      // Don't fail planning if context fails, just log it
      console.error('Context generation failed:', err);
      // But maybe we should write an error report?
    }

    const systemPrompt = `You are an expert software architecture planner.
Your goal is to break down a high-level user goal into a sequence of clear, actionable steps.
Return ONLY a JSON object with a "steps" property containing an array of strings.
Each step should be a concise instruction.`;

    let userPrompt = `Goal: ${goal}`;
    
    // Inject context if available
    if (contextPack && contextPack.items.length > 0) {
      userPrompt += `\n\nContext:\n`;
      for (const item of contextPack.items) {
        userPrompt += `File: ${item.path}\n\`\`\`\n${item.content}\n\`\`\`\n`;
      }
    }

    const request: ModelRequest = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      jsonMode: true,
    };

    const response = await providers.planner.generate(request, ctx);

    if (!response.text) {
      throw new Error('Planner provider returned empty response');
    }

    const rawText = response.text;
    await fs.writeFile(path.join(artifactsDir, 'plan_raw.txt'), rawText);

    let planSteps: string[] = [];

    // Attempt 1: Parse JSON
    try {
      // Basic cleanup for markdown code blocks if the model includes them despite jsonMode
      const cleanedText = rawText.replace(/```json\n|\n```/g, '').trim();

      const parsed = JSON.parse(cleanedText);
      if (parsed && Array.isArray(parsed.steps)) {
        planSteps = parsed.steps.map(String);
      } else if (Array.isArray(parsed)) {
        // Fallback if model returns just array
        planSteps = parsed.map(String);
      }
    } catch {
      // JSON parsing failed, try plain text parsing
    }

    // Attempt 2: Parse text (bullets/numbers)
    if (planSteps.length === 0) {
      const parsedPlan = parsePlanFromText(rawText);
      if (parsedPlan && parsedPlan.steps.length > 0) {
        planSteps = parsedPlan.steps;
      }
    }

    // Attempt 3: Fallback
    if (planSteps.length === 0) {
      // We couldn't extract steps, so we leave it empty.
      // The CLI will handle warning the user.
      // Alternatively, we could treat the whole text as one step if it's short?
      // For now, empty array implies unstructured output that couldn't be parsed.
    }

    // Write plan.json even if empty steps, as per spec "plan.json (may contain empty steps but valid JSON)"
    await fs.writeFile(
      path.join(artifactsDir, 'plan.json'),
      JSON.stringify({ steps: planSteps }, null, 2),
    );

    await this.eventBus.emit({
      type: 'PlanCreated',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: ctx.runId,
      payload: { planSteps },
    });

    return planSteps;
  }
}
