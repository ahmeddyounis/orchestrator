'use strict';
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, 'default', { enumerable: true, value: v });
      }
    : function (o, v) {
        o['default'] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== 'default') __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
Object.defineProperty(exports, '__esModule', { value: true });
exports.PlanService = void 0;
const adapters_1 = require('@orchestrator/adapters');
const repo_1 = require('@orchestrator/repo');
const fs = __importStar(require('fs/promises'));
const path = __importStar(require('path'));
class PlanService {
  eventBus;
  constructor(eventBus) {
    this.eventBus = eventBus;
  }
  async generatePlan(goal, providers, ctx, artifactsDir, repoRoot, config) {
    await this.eventBus.emit({
      type: 'PlanRequested',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: ctx.runId,
      payload: { goal },
    });
    // 1. Build Context
    const queries = [goal];
    let contextPack;
    let candidates = [];
    try {
      // 1a. Scan Repo
      const scanner = new repo_1.RepoScanner();
      const scanStart = Date.now();
      const snapshot = await scanner.scan(repoRoot, {
        excludes: config?.context?.exclude,
      });
      await this.eventBus.emit({
        type: 'RepoScan',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId: ctx.runId,
        payload: {
          fileCount: snapshot.files.length,
          durationMs: Date.now() - scanStart,
        },
      });
      // 1b. Derive File Matches (Naive heuristic)
      const goalKeywords = goal
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const fileMatches = [];
      for (const file of snapshot.files) {
        const fileName = path.basename(file.path).toLowerCase();
        // Check if filename contains a keyword
        for (const keyword of goalKeywords) {
          if (fileName.includes(keyword)) {
            fileMatches.push({
              path: file.path,
              line: 1,
              column: 1,
              matchText: 'FILENAME_MATCH',
              lineText: '',
              score: 100, // High priority for filename matches
            });
            break;
          }
        }
      }
      // 1c. Search Content
      const searchService = new repo_1.SearchService(config?.context?.rgPath);
      const searchStart = Date.now();
      const searchResults = await searchService.search({
        query: goal,
        cwd: repoRoot,
        maxMatchesPerFile: 5,
      });
      await this.eventBus.emit({
        type: 'RepoSearch',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId: ctx.runId,
        payload: {
          query: goal,
          matches: searchResults.matches.length,
          durationMs: Date.now() - searchStart,
        },
      });
      const allMatches = [...fileMatches, ...searchResults.matches];
      // 1d. Extract Snippets
      const extractor = new repo_1.SnippetExtractor();
      candidates = await extractor.extractSnippets(allMatches, {
        cwd: repoRoot,
      });
      // 1e. Pack Context
      const packer = new repo_1.SimpleContextPacker();
      const signals = [];
      const options = {
        tokenBudget: config?.context?.tokenBudget || 10000,
      };
      contextPack = packer.pack(goal, signals, candidates, options);
      await this.eventBus.emit({
        type: 'ContextBuilt',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId: ctx.runId,
        payload: {
          fileCount: contextPack.items.length,
          tokenEstimate: contextPack.estimatedTokens,
        },
      });
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
    const request = {
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
    let planSteps = [];
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
      const parsedPlan = (0, adapters_1.parsePlanFromText)(rawText);
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
exports.PlanService = PlanService;
//# sourceMappingURL=service.js.map
