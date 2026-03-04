import type { ContextSignal, GitService } from '@orchestrator/repo';
import { PatchApplier, SimpleContextPacker, SnippetExtractor } from '@orchestrator/repo';
import type { Config, ToolPolicy } from '@orchestrator/shared';
import { SummaryWriter, updateManifest } from '@orchestrator/shared';
import type { UserInterface } from '@orchestrator/exec';
import fs from 'fs/promises';
import path from 'path';
import { PatchStore } from '../../exec/patch_store';
import { extractUnifiedDiff } from '../../exec/diff_extractor';
import { runPatchReviewLoop } from '../../exec/review_loop';
import type { ProviderRegistry } from '../../registry';
import type { RunResult } from '../../orchestrator';
import { runL1 } from './l1';
import { runL3 } from './l3';
import {
  createRunSession,
  type ContextBuilderService,
  type ContextStackService,
  type RunFinalizerService,
  type RunInitializationService,
  type RunMemoryService,
  type RunSession,
  type RunSummaryService,
  VerificationService,
} from '../services';

export interface RunL2Deps {
  config: Config;
  git: GitService;
  registry: ProviderRegistry;
  repoRoot: string;
  toolPolicy?: ToolPolicy;
  ui?: UserInterface;
  initService: RunInitializationService;
  contextStackService: ContextStackService;
  contextBuilder: ContextBuilderService;
  runMemoryService: RunMemoryService;
  runSummaryService: RunSummaryService;
  runFinalizerService: RunFinalizerService;
  escalationCount: number;
  suppressEpisodicMemoryWrite: boolean;
}

export interface RunL2Options {
  session?: RunSession;
}

export async function runL2(
  goal: string,
  runId: string,
  deps: RunL2Deps,
  options: RunL2Options = {},
): Promise<RunResult> {
  const runSession =
    options.session ??
    (await createRunSession({
      runId,
      goal,
      initService: deps.initService,
      contextStackService: deps.contextStackService,
    }));
  const { runContext, contextStack } = runSession;
  const { artifacts, logger } = runContext;
  const eventBus = contextStack.eventBus;
  deps.registry.bindEventBus?.(eventBus, runId);

  const startTime = runContext.startTime;
  const baseRef = await deps.git.getHeadSha();

  let escalationCount = deps.escalationCount;

  await deps.initService.emitRunStarted(eventBus, runId, goal);
  await deps.initService.initializeManifest(artifacts, runId, goal, true);

  // 1. Initial Plan & Execute (L1)
  const l1Result = await runL1(
    goal,
    runId,
    {
      config: deps.config,
      git: deps.git,
      registry: deps.registry,
      repoRoot: deps.repoRoot,
      initService: deps.initService,
      contextStackService: deps.contextStackService,
      contextBuilder: deps.contextBuilder,
      runMemoryService: deps.runMemoryService,
      runSummaryService: deps.runSummaryService,
      runFinalizerService: deps.runFinalizerService,
      escalationCount,
      suppressEpisodicMemoryWrite: deps.suppressEpisodicMemoryWrite,
    },
    {
      session: runSession,
      emitRunStarted: false,
      initializeManifest: false,
      finalizeRun: false,
    },
  );

  const patchPaths = l1Result.patchPaths ?? [];
  const touchedFiles = new Set(l1Result.filesChanged ?? []);

  const finalize = async (
    runResult: RunResult,
    args?: {
      reportPaths?: string[];
      verification?: import('../../verify/types').VerificationReport;
    },
  ): Promise<RunResult> => {
    runResult.patchPaths = patchPaths;
    runResult.filesChanged = Array.from(touchedFiles);

    const summaryMsg = runResult.summary ?? '';

    if (runResult.stopReason) {
      await eventBus.emit({
        type: 'RunStopped',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { reason: runResult.stopReason, details: summaryMsg },
      });
    }

    await eventBus.emit({
      type: 'RunFinished',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: { status: runResult.status, summary: summaryMsg },
    });

    try {
      const finalDiff = await deps.git.diff(baseRef);
      if (finalDiff.trim().length > 0) {
        const patchStore = new PatchStore(artifacts.patchesDir, artifacts.manifest);
        const finalDiffPath = await patchStore.saveFinalDiff(finalDiff);
        if (!patchPaths.includes(finalDiffPath)) patchPaths.push(finalDiffPath);
      }
    } catch {
      // Non-fatal: final diff generation should not fail the run.
    }

    const finishedAt = new Date().toISOString();
    try {
      await updateManifest(artifacts.manifest, (manifest) => {
        manifest.finishedAt = finishedAt;
        manifest.patchPaths = [...manifest.patchPaths, ...patchPaths];
        if (args?.reportPaths && args.reportPaths.length > 0) {
          manifest.verificationPaths = [...(manifest.verificationPaths ?? []), ...args.reportPaths];
        }
      });
    } catch {
      // Non-fatal: artifact updates should not fail the run.
    }

    const summary = deps.runSummaryService.build({
      runId,
      goal,
      startTime,
      status: runResult.status,
      thinkLevel: 'L2',
      runResult,
      artifacts,
      escalationCount,
    });
    await SummaryWriter.write(summary, artifacts.root);

    await deps.runMemoryService.writeEpisodicMemory(
      summary,
      {
        artifactsRoot: artifacts.root,
        patchPaths: runResult.patchPaths,
        extraArtifactPaths: args?.reportPaths,
        verificationReport: args?.verification,
      },
      {
        eventBus,
        suppress: deps.suppressEpisodicMemoryWrite,
      },
    );

    return runResult;
  };

  if (l1Result.stopReason === 'budget_exceeded') {
    return finalize(l1Result);
  }

  // 2. Setup Verification
  if (!deps.ui || !deps.toolPolicy) {
    return finalize({
      ...l1Result,
      summary: (l1Result.summary ?? '') + ' (L2 skipped: missing UI/Policy)',
    });
  }

  const verificationService = new VerificationService(
    deps.config,
    deps.repoRoot,
    deps.toolPolicy,
    deps.ui,
    eventBus,
  );

  const profile = verificationService.getProfile();

  // 3. Initial Verification
  let verification = await verificationService.verify(l1Result.filesChanged || [], runId);

  const initialReportPath = path.join(artifacts.root, 'verification_report_initial.json');
  await fs.writeFile(initialReportPath, JSON.stringify(verification, null, 2));
  const reportPaths = [initialReportPath];

  if (verification.passed) {
    return finalize(
      {
        ...l1Result,
        status: 'success',
        summary: 'L2 Verified Success',
        memory: deps.config.memory,
        verification: {
          enabled: profile.enabled,
          reportPaths,
          ...verification,
        },
      },
      { reportPaths, verification },
    );
  }

  // 4. Repair Loop
  const maxIterations = 5;
  let iterations = 0;
  let failureSignature = verification.failureSignature;
  let consecutiveSameSignature = 0;
  let consecutivePatchApplyFailures = 0;

  const executorId = deps.config.defaults?.executor || 'openai';
  const executor = deps.registry.getAdapter(executorId);
  const reviewerId = deps.config.defaults?.reviewer || executorId;
  const reviewer = deps.registry.getAdapter(reviewerId);

  while (iterations < maxIterations) {
    iterations++;

    // Escalation checks
    const escalationConfig = deps.config.escalation;
    if (escalationConfig?.enabled && escalationCount < (escalationConfig.maxEscalations ?? 1)) {
      if (
        consecutiveSameSignature >= (escalationConfig.toL3AfterNonImprovingIterations ?? 2) ||
        consecutivePatchApplyFailures >= (escalationConfig.toL3AfterPatchApplyFailures ?? 2)
      ) {
        await eventBus.emit({
          type: 'RunEscalated',
          schemaVersion: 1,
          runId,
          timestamp: new Date().toISOString(),
          payload: {
            from: 'L2',
            to: 'L3',
            reason:
              consecutiveSameSignature >= (escalationConfig.toL3AfterNonImprovingIterations ?? 2)
                ? 'non_improving'
                : 'patch_apply_failure',
          },
        });
        escalationCount++;
        return runL3(
          goal,
          runId,
          {
            config: deps.config,
            git: deps.git,
            registry: deps.registry,
            repoRoot: deps.repoRoot,
            toolPolicy: deps.toolPolicy,
            ui: deps.ui,
            initService: deps.initService,
            contextStackService: deps.contextStackService,
            contextBuilder: deps.contextBuilder,
            runMemoryService: deps.runMemoryService,
            runSummaryService: deps.runSummaryService,
            runFinalizerService: deps.runFinalizerService,
            escalationCount,
            suppressEpisodicMemoryWrite: deps.suppressEpisodicMemoryWrite,
          },
          {
            session: runSession,
            emitRunStarted: false,
            initializeManifest: false,
            baseRef,
            initialPatchPaths: patchPaths,
            initialTouchedFiles: touchedFiles,
          },
        );
      }
    }

    await eventBus.emit({
      type: 'IterationStarted',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: { iteration: iterations, goal },
    });

    // Stop Conditions checks (Signature)
    if (failureSignature && verification.failureSignature === failureSignature) {
      consecutiveSameSignature++;
      if (consecutiveSameSignature >= 2) {
        return finalize(
          {
            ...l1Result,
            status: 'failure',
            stopReason: 'non_improving',
            summary: 'Verification failure signature unchanged for 2 iterations',
            memory: deps.config.memory,
            verification: {
              enabled: profile.enabled,
              failedChecks: verification.checks.filter((c) => !c.passed).map((c) => c.name),
              reportPaths,
              ...verification,
            },
            lastFailureSignature: verification.failureSignature,
          },
          { reportPaths, verification },
        );
      }
    } else {
      consecutiveSameSignature = 0;
      failureSignature = verification.failureSignature;
    }

    // Search memory for similar failures
    const memoryHits = await deps.runMemoryService.searchMemoryHits(
      {
        query: `${goal} ${verification.summary}`,
        runId,
        stepId: 100 + iterations,
        artifactsRoot: artifacts.root,
        intent: 'verification',
        failureSignature: verification.failureSignature,
      },
      eventBus,
    );

    // Generate Repair
    const verificationSummary = `Verification Failed.\n${verification.summary}\nFailed Checks: ${verification.checks
      .filter((c) => !c.passed)
      .map((c) => c.name)
      .join(', ')}\n`;

    let errorDetails = '';
    for (const check of verification.checks) {
      if (!check.passed) {
        if (check.stderrPath) {
          try {
            const errContent = await fs.readFile(check.stderrPath, 'utf8');
            errorDetails += `\nCommand '${check.command}' failed:\n${errContent.slice(-2000)}\n`;
          } catch {
            /* ignore */
          }
        }
      }
    }

    const signals: ContextSignal[] = [];
    for (const filePath of touchedFiles) {
      signals.push({ type: 'file_change', data: filePath, weight: 2 });
    }
    for (const filePath of verification.failureSummary?.suspectedFiles ?? []) {
      signals.push({ type: 'file_change', data: filePath, weight: 3 });
    }
    if (errorDetails.trim().length > 0) {
      signals.push({ type: 'error', data: { stack: errorDetails }, weight: 2 });
    }

    const normalizePathForMatch = (p: string): string => p.replace(/\\/g, '/');
    const repoRootNormalized = normalizePathForMatch(deps.repoRoot).replace(/\/$/, '');
    const toRepoRelative = (p: string): string => {
      const normalized = normalizePathForMatch(p);
      if (normalized.startsWith(repoRootNormalized + '/')) {
        return normalized.slice(repoRootNormalized.length + 1);
      }
      return normalized;
    };

    let contextPack: ReturnType<SimpleContextPacker['pack']> = {
      items: [],
      totalChars: 0,
      estimatedTokens: 0,
    };
    try {
      const matches: Array<{
        path: string;
        line: number;
        column: number;
        matchText: string;
        lineText: string;
        score: number;
      }> = [];
      const seen = new Set<string>();

      const addMatch = (filePath: string, line: number, score: number, matchText: string) => {
        const p = toRepoRelative(String(filePath ?? '').trim());
        if (!p || p.includes('node_modules')) return;
        const safeLine = Number.isFinite(line) && line > 0 ? Math.floor(line) : 1;
        const key = `${p}:${safeLine}:${matchText}`;
        if (seen.has(key)) return;
        seen.add(key);
        matches.push({
          path: p,
          line: safeLine,
          column: 1,
          matchText,
          lineText: '',
          score,
        });
      };

      for (const filePath of touchedFiles) addMatch(filePath, 1, 200, 'TOUCHED_FILE');
      for (const filePath of verification.failureSummary?.suspectedFiles ?? []) {
        addMatch(filePath, 1, 500, 'SUSPECTED_FILE');
      }

      const hintTextParts: string[] = [];
      for (const fc of verification.failureSummary?.failedChecks ?? []) {
        hintTextParts.push(...(fc.keyErrors ?? []));
        if (fc.stderrTailSnippet) hintTextParts.push(fc.stderrTailSnippet);
      }
      if (errorDetails) hintTextParts.push(errorDetails);
      const hintText = hintTextParts.join('\n');

      const exts = '(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|json|md)';
      const filePathPattern = `((?:[A-Za-z]:)?[A-Za-z0-9_\\-/.\\\\]+\\.${exts})`;
      const locationPatterns = [
        // TS compiler style: file.ts(10,5)
        new RegExp(`${filePathPattern}\\((\\d+)(?:,\\d+)?\\)`, 'g'),
        // Stack trace / ESLint style: file.ts:10:5
        new RegExp(`${filePathPattern}:(\\d+)(?::\\d+)?`, 'g'),
      ];

      for (const pattern of locationPatterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(hintText)) !== null) {
          const filePath = match[1];
          const line = Number(match[2]);
          if (!filePath || !Number.isFinite(line) || line <= 0) continue;
          addMatch(filePath, line, 1500, 'ERROR_LOCATION');
        }
      }

      const extractor = new SnippetExtractor();
      const candidates = await extractor.extractSnippets(matches, {
        cwd: deps.repoRoot,
        windowSize: 20,
        maxSnippetChars: 1200,
        maxSnippetsPerFile: 3,
      });

      const packer = new SimpleContextPacker();
      contextPack = packer.pack(goal, signals, candidates, {
        tokenBudget: deps.config.context?.tokenBudget || 8000,
      });
    } catch {
      // Non-fatal; repairs should still proceed with memory + logs.
    }

    const fusedContext = deps.contextBuilder.fuseContext({
      goalText: `Goal: ${goal}\nTask: Fix verification errors.`,
      contextPack,
      memoryHits,
      signals,
      contextStack: contextStack.store?.getAllFrames(),
      budgets: {
        maxMemoryChars: 4000,
      },
    });

    const repairPrompt = `
The previous attempt failed verification.
Goal: ${goal}

Verification Results:
${verificationSummary}

Error Details:
${errorDetails}

CONTEXT:
${fusedContext.prompt}

Please analyze the errors and produce a unified diff to fix them.
Output ONLY the unified diff between BEGIN_DIFF and END_DIFF markers.
`;

    const response = await executor.generate(
      {
        messages: [
          { role: 'system', content: 'You are an expert software engineer fixing code.' },
          { role: 'user', content: repairPrompt },
        ],
      },
      { runId, logger, repoRoot: deps.repoRoot },
    );

    const outputText = response.text;

    if (outputText) {
      await fs.writeFile(
        path.join(artifacts.root, `repair_iter_${iterations}_output.txt`),
        outputText,
      );
    }

    const diffContent = extractUnifiedDiff(outputText);

    if (diffContent === null) {
      // Fail iteration (no diff)
      await eventBus.emit({
        type: 'RepairAttempted',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { iteration: iterations, patchPath: 'none (no-diff)' },
      });
      continue;
    }

    if (diffContent.trim().length === 0) {
      await eventBus.emit({
        type: 'RepairAttempted',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { iteration: iterations, patchPath: 'none (empty-diff)' },
      });
      continue;
    }

    // Apply Patch
    const patchStore = new PatchStore(artifacts.patchesDir, artifacts.manifest);
    const patchPath = await patchStore.saveSelected(100 + iterations, diffContent);
    patchPaths.push(patchPath);

    let patchToApply = diffContent;
    try {
      const reviewLoopResult = await runPatchReviewLoop({
        goal,
        step: `Fix verification failures (iteration ${iterations})`,
        stepId: undefined,
        ancestors: [],
        fusedContextText: fusedContext.prompt,
        initialPatch: patchToApply,
        providers: { executor, reviewer },
        adapterCtx: { runId, logger, repoRoot: deps.repoRoot },
        repoRoot: deps.repoRoot,
        artifactsRoot: artifacts.root,
        manifestPath: artifacts.manifest,
        config: deps.config,
        dryRunApplyOptions: { maxFilesChanged: 5 },
        label: { kind: 'repair', index: iterations, slug: `iter_${iterations}` },
      });
      if (reviewLoopResult.patch.trim().length > 0) {
        patchToApply = reviewLoopResult.patch;
      }
    } catch {
      // Non-fatal
    }

    if (patchToApply.trim() !== diffContent.trim()) {
      await patchStore.saveSelected(100 + iterations, patchToApply);
    }

    await eventBus.emit({
      type: 'RepairAttempted',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: { iteration: iterations, patchPath },
    });

    const applier = new PatchApplier();
    const patchTextWithNewline = patchToApply.endsWith('\n') ? patchToApply : patchToApply + '\n';

    const applyResult = await applier.applyUnifiedDiff(deps.repoRoot, patchTextWithNewline, {
      maxFilesChanged: 5,
    });

    if (applyResult.applied) {
      consecutivePatchApplyFailures = 0;
      applyResult.filesChanged?.forEach((f) => touchedFiles.add(f));
      await eventBus.emit({
        type: 'PatchApplied',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
          description: `L2 Repair Iteration ${iterations}`,
          filesChanged: applyResult.filesChanged || [],
          success: true,
        },
      });
    } else {
      consecutivePatchApplyFailures++;
      await eventBus.emit({
        type: 'PatchApplyFailed',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
          error: applyResult.error?.message || 'Unknown apply error',
          details: applyResult.error,
        },
      });
      // Continue loop to try again? Or verify existing state?
      // If patch failed, verify result is likely same, so signature check will catch it.
    }

    // Verify again
    verification = await verificationService.verify(Array.from(touchedFiles), runId);

    const reportPath = path.join(artifacts.root, `verification_report_iter_${iterations}.json`);
    await fs.writeFile(reportPath, JSON.stringify(verification, null, 2));
    reportPaths.push(reportPath);

    await fs.writeFile(
      path.join(artifacts.root, `verification_summary_iter_${iterations}.txt`),
      verification.summary,
    );

    if (verification.passed) {
      await eventBus.emit({
        type: 'IterationFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { iteration: iterations, result: 'success' },
      });

      return finalize(
        {
          status: 'success',
          runId,
          summary: `L2 Verified Success after ${iterations} iterations`,
          memory: deps.config.memory,
          verification: {
            enabled: profile.enabled,
            reportPaths,
            ...verification,
          },
        },
        { reportPaths, verification },
      );
    }

    await eventBus.emit({
      type: 'IterationFinished',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: { iteration: iterations, result: 'failure' },
    });
  }

  // Budget exceeded
  const failureSummary = `L2 failed to converge after ${iterations} iterations`;
  return finalize(
    {
      status: 'failure',
      runId,
      summary: failureSummary,
      stopReason: 'budget_exceeded',
      memory: deps.config.memory,
      verification: {
        enabled: profile.enabled,
        failedChecks: verification.checks.filter((c) => !c.passed).map((c) => c.name),
        reportPaths,
        ...verification,
      },
      lastFailureSignature: verification.failureSignature,
    },
    { reportPaths, verification },
  );
}
