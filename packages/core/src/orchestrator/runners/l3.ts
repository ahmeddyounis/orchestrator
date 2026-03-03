import { ContextSignal, GitService, PatchApplier, SimpleContextPacker } from '@orchestrator/repo';
import type { Config, ToolPolicy } from '@orchestrator/shared';
import type { UserInterface } from '@orchestrator/exec';
import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import type { CostTracker } from '../../cost/tracker';
import { DEFAULT_BUDGET } from '../../config/budget';
import { ExecutionService } from '../../exec/service';
import { PatchStore } from '../../exec/patch_store';
import { PlanService } from '../../plan/service';
import { ResearchService } from '../../research/service';
import type { ProviderRegistry } from '../../registry';
import type { RunResult } from '../../orchestrator';
import { CandidateGenerator, StepContext, Candidate } from '../l3/candidate_generator';
import {
  CandidateEvaluator,
  EvaluationResult,
  selectBestCandidate,
} from '../l3/candidate_evaluator';
import { Judge, JudgeContext, JudgeCandidate, JudgeVerification } from '../../judge';
import { Diagnoser } from '../l3/diagnoser';
import { ProceduralMemoryImpl } from '../procedural_memory';
import { VerificationRunner } from '../../verify/runner';
import type { VerificationProfile } from '../../verify/types';
import {
  buildContextSignals,
  createRunSession,
  shouldAcceptEmptyDiffAsNoopForSatisfiedStep,
  type ContextBuilderService,
  type ContextStackService,
  type RunFinalizerService,
  type RunInitializationService,
  type RunMemoryService,
  type RunSession,
  type RunSummaryService,
} from '../services';
import { readPlanExecutionSteps } from './plan-execution';

export interface RunL3Deps {
  config: Config;
  git: GitService;
  registry: ProviderRegistry;
  repoRoot: string;
  costTracker?: CostTracker;
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

export interface RunL3Options {
  session?: RunSession;
  emitRunStarted?: boolean;
  initializeManifest?: boolean;
  baseRef?: string;
  initialPatchPaths?: string[];
  initialContextPaths?: string[];
  initialTouchedFiles?: Iterable<string>;
}

export async function runL3(
  goal: string,
  runId: string,
  deps: RunL3Deps,
  options: RunL3Options = {},
): Promise<RunResult> {
  const session =
    options.session ??
    (await createRunSession({
      runId,
      goal,
      initService: deps.initService,
      contextStackService: deps.contextStackService,
    }));

  const { runContext, contextStack } = session;
  const { artifacts, logger } = runContext;
  const eventBus = contextStack.eventBus;
  deps.registry.bindEventBus?.(eventBus, runId);
  const baseRef = options.baseRef ?? (await deps.git.getHeadSha());

  const startTime = runContext.startTime;

  if (options.emitRunStarted ?? true) {
    await deps.initService.emitRunStarted(eventBus, runId, goal);
  }

  if (options.initializeManifest ?? true) {
    await deps.initService.initializeManifest(artifacts, runId, goal, true);
  }

  // L3 metadata tracking
  const l3Metadata = {
    bestOfN: deps.config.l3?.bestOfN ?? 3,
    candidatesGenerated: 0,
    candidatesEvaluated: 0,
    selectedCandidateId: undefined as string | undefined,
    passingCandidateSelected: false,
    reviewerInvoked: false,
    judgeInvoked: false,
    judgeInvocationReason: undefined as string | undefined,
    evaluationReportPaths: [] as string[],
    selectionRankingPath: undefined as string | undefined,
  };

  const patchPaths: string[] = [...(options.initialPatchPaths ?? [])];
  const contextPaths: string[] = [...(options.initialContextPaths ?? [])];
  const touchedFiles = new Set<string>(options.initialTouchedFiles ?? []);

  const finish = async (
    status: 'success' | 'failure',
    stopReason: RunResult['stopReason'] | undefined,
    summaryMsg: string,
  ): Promise<RunResult> => {
    return deps.runFinalizerService.finalize({
      runId,
      goal,
      startTime,
      status,
      thinkLevel: 'L3',
      stopReason,
      summaryMsg,
      artifacts,
      baseRef,
      patchPaths,
      contextPaths,
      touchedFiles,
      eventBus,
      escalationCount: deps.escalationCount,
      l3Metadata,
      suppressEpisodicMemoryWrite: deps.suppressEpisodicMemoryWrite,
    });
  };

  const plannerId = deps.config.defaults?.planner || 'openai';
  const executorId = deps.config.defaults?.executor || 'openai';
  const reviewerId = deps.config.defaults?.reviewer || 'openai';

  const providers = await deps.registry.resolveRoleProviders(
    { plannerId, executorId, reviewerId },
    { eventBus, runId },
  );

  const planService = new PlanService(eventBus);

  const context = {
    runId,
    config: deps.config,
    logger,
  };

  const planningResearchCfg = deps.config.planning?.research;
  const planningResearchers =
    planningResearchCfg?.enabled &&
    planningResearchCfg.providerIds &&
    planningResearchCfg.providerIds.length > 0
      ? planningResearchCfg.providerIds.map((id) => deps.registry.getAdapter(id))
      : planningResearchCfg?.enabled
        ? [providers.planner]
        : undefined;

  const steps = await planService.generatePlan(
    goal,
    {
      planner: providers.planner,
      reviewer: providers.reviewer,
      researchers: planningResearchers,
    },
    context,
    artifacts.root,
    deps.repoRoot,
    deps.config,
    undefined,
    {
      getContextStackText: () => contextStack.getContextStackText(),
    },
  );

  if (steps.length === 0) {
    return finish('failure', undefined, 'Planning failed to produce any steps.');
  }

  const executionSteps = await readPlanExecutionSteps(artifacts.root, steps);

  const executionService = new ExecutionService(
    eventBus,
    deps.git,
    new PatchApplier(),
    runId,
    deps.repoRoot,
    deps.config,
  );

  const budget = { ...DEFAULT_BUDGET, ...deps.config.budget };

  // Set up verification runner for candidate evaluation
  const proceduralMemory = new ProceduralMemoryImpl(deps.config, deps.repoRoot);
  const toolPolicy = deps.toolPolicy ?? {
    enabled: true,
    requireConfirmation: false,
    allowlistPrefixes: [],
    denylistPatterns: [],
    networkPolicy: 'deny',
    envAllowlist: [],
    allowShell: false,
    maxOutputBytes: 1024 * 1024,
    timeoutMs: 60000,
    autoApprove: true,
    interactive: false,
  };
  const ui = deps.ui ?? {
    confirm: async () => true,
  };
  const verificationRunner = new VerificationRunner(
    proceduralMemory,
    toolPolicy,
    ui,
    eventBus,
    deps.repoRoot,
  );

  const verificationProfile: VerificationProfile = {
    enabled: deps.config.verification?.enabled ?? true,
    mode: deps.config.verification?.mode || 'auto',
    steps: [],
    auto: {
      enableLint: deps.config.verification?.auto?.enableLint ?? true,
      enableTypecheck: deps.config.verification?.auto?.enableTypecheck ?? true,
      enableTests: deps.config.verification?.auto?.enableTests ?? true,
      testScope: deps.config.verification?.auto?.testScope || 'targeted',
      maxCommandsPerIteration: deps.config.verification?.auto?.maxCommandsPerIteration ?? 5,
    },
  };

  // Create candidate evaluator for L3 flow
  const candidateEvaluator = new CandidateEvaluator(
    deps.git,
    new PatchApplier(),
    verificationRunner,
    deps.repoRoot,
    artifacts.root,
    logger,
  );

  let stepsCompleted = 0;

  const baseSignals: ContextSignal[] = [];
  let consecutiveInvalidDiffs = 0;
  let consecutiveApplyFailures = 0;
  let lastApplyErrorHash = '';

  // Optional research pass before executor patch generation
  const execResearchCfg = deps.config.execution?.research;
  const researchService = execResearchCfg?.enabled ? new ResearchService() : undefined;
  const researchProviders =
    execResearchCfg?.enabled &&
    execResearchCfg.providerIds &&
    execResearchCfg.providerIds.length > 0
      ? execResearchCfg.providerIds.map((id) => deps.registry.getAdapter(id))
      : execResearchCfg?.enabled
        ? [providers.executor]
        : [];

  let goalResearchBrief = '';
  if (researchService && execResearchCfg?.enabled && execResearchCfg.scope === 'goal') {
    try {
      const planLines = steps
        .slice(0, 25)
        .map((s) => `- ${s}`)
        .join('\n');
      const goalResearch = await researchService.run({
        mode: 'execution',
        goal,
        step: { text: 'Execute the plan' },
        contextText: `Planned steps (first ${Math.min(25, steps.length)} of ${steps.length}):\n${planLines}`,
        contextStackText: contextStack.getContextStackText(),
        providers: researchProviders,
        adapterCtx: { runId, logger, repoRoot: deps.repoRoot },
        artifactsDir: artifacts.root,
        artifactPrefix: 'l3_exec_goal',
        config: execResearchCfg,
      });
      goalResearchBrief = goalResearch?.brief?.trim() ?? '';
    } catch {
      // Non-fatal
    }
  }

  for (const execStep of executionSteps) {
    const { step, ancestors, id: stepId } = execStep;
    const contextQuery = ancestors.length > 0 ? `${ancestors.join(' ')} ${step}` : step;
    const memoryQuery = [goal, ...ancestors, step]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ');
    const elapsed = Date.now() - startTime;
    if (budget.time !== undefined && elapsed > budget.time) {
      return finish('failure', 'budget_exceeded', `Time budget exceeded (${budget.time}ms)`);
    }
    if (budget.iter !== undefined && stepsCompleted >= budget.iter) {
      return finish('failure', 'budget_exceeded', `Iteration budget exceeded (${budget.iter})`);
    }
    if (budget.cost !== undefined && deps.costTracker) {
      const summary = deps.costTracker.getSummary();
      if (summary.total.estimatedCostUsd && summary.total.estimatedCostUsd > budget.cost) {
        return finish('failure', 'budget_exceeded', `Cost budget exceeded ($${budget.cost})`);
      }
    }

    await eventBus.emit({
      type: 'StepStarted',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: { step, index: stepsCompleted, total: executionSteps.length },
    });

    let stepSignals = buildContextSignals({
      goal,
      step,
      ancestors,
      touchedFiles,
      baseSignals,
    });

    const memoryHits = await deps.runMemoryService.searchMemoryHits(
      {
        query: memoryQuery,
        runId,
        stepId: stepsCompleted,
        artifactsRoot: artifacts.root,
        intent: 'implementation',
      },
      eventBus,
    );

    const stepSlug = step.slice(0, 20).replace(/[^a-z0-9]/gi, '_');
    const planContextLines: string[] = [`Goal: ${goal}`];
    if (stepId) planContextLines.push(`Plan Step ID: ${stepId}`);
    if (ancestors.length > 0) {
      planContextLines.push('Plan Ancestors (outer → inner):');
      for (const a of ancestors) planContextLines.push(`- ${a}`);
    }
    planContextLines.push(`Current Step (leaf): ${step}`);
    const planContextText = planContextLines.join('\n');

    const builtContext = await deps.contextBuilder.buildStepContext({
      goal,
      goalText: planContextText,
      step,
      query: contextQuery,
      touchedFiles,
      memoryHits,
      signals: stepSignals,
      contextStack: contextStack.store?.getAllFrames(),
      eventBus,
      runId,
      artifactsRoot: artifacts.root,
      stepsCompleted,
    });
    let fusedContext = builtContext.fusedContext;
    const contextPack = builtContext.contextPack;
    contextPaths.push(...builtContext.contextPaths);

    const noopAcceptance = await shouldAcceptEmptyDiffAsNoopForSatisfiedStep({
      step,
      repoRoot: deps.repoRoot,
      rgPath: deps.config.context?.rgPath,
      contextText: fusedContext.prompt,
    });
    if (noopAcceptance.allow) {
      consecutiveInvalidDiffs = 0;
      consecutiveApplyFailures = 0;
      lastApplyErrorHash = '';

      await eventBus.emit({
        type: 'PatchApplied',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
          description: `No-op step (already satisfied): ${step}`,
          filesChanged: [],
          success: true,
        },
      });

      await fs.writeFile(
        path.join(artifacts.root, `step_${stepsCompleted}_${stepSlug}_noop.txt`),
        noopAcceptance.reason ?? 'Step already satisfied; no changes required.',
      );

      stepsCompleted++;
      await eventBus.emit({
        type: 'StepFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { step, success: true },
      });
      continue;
    }

    let stepResearchBrief = '';
    if (researchService && execResearchCfg?.enabled && execResearchCfg.scope !== 'goal') {
      try {
        const bundle = await researchService.run({
          mode: 'execution',
          goal,
          step: { id: stepId, text: step, ancestors },
          contextText: fusedContext.prompt,
          providers: researchProviders,
          adapterCtx: { runId, logger, repoRoot: deps.repoRoot },
          artifactsDir: artifacts.root,
          artifactPrefix: `l3_exec_step_${stepsCompleted}_${stepSlug}`,
          config: execResearchCfg,
        });
        stepResearchBrief = bundle?.brief?.trim() ?? '';
      } catch {
        // Non-fatal
      }
    }

    const researchBrief =
      execResearchCfg?.enabled && execResearchCfg.scope === 'goal'
        ? goalResearchBrief
        : stepResearchBrief;

    // --- L3 Candidate Generation ---
    const candidateGenerator = new CandidateGenerator();
    const bestOfN = deps.config.l3?.bestOfN ?? 3;
    const enableJudge = deps.config.l3?.enableJudge ?? true;
    const enableReviewer = deps.config.l3?.enableReviewer ?? true;
    const stepContext: StepContext = {
      runId,
      goal,
      step,
      stepId,
      ancestors,
      stepIndex: stepsCompleted,
      fusedContext,
      researchBrief,
      eventBus,
      costTracker: deps.costTracker!,
      executor: providers.executor,
      reviewer: providers.reviewer,
      artifactsRoot: artifacts.root,
      budget: budget,
      logger,
    };

    // Generate candidates (defer reviewer/judge until we know verification results)
    const generatedCandidates = await candidateGenerator.generateCandidates(stepContext, bestOfN);
    const validCandidates = generatedCandidates.filter(
      (c): c is Candidate & { patch: string } =>
        c.valid && typeof c.patch === 'string' && c.patch.length > 0,
    );

    l3Metadata.candidatesGenerated += generatedCandidates.length;

    let bestCandidate: Candidate | null = null;
    let judgeInvoked = false;
    let judgeReason: string | undefined;

    if (validCandidates.length === 0) {
      // No valid candidates - stop condition
      return finish('failure', 'invalid_output', 'No valid candidates generated for step: ' + step);
    }

    // --- L3 Candidate Evaluation with Verification ---
    // Evaluate each candidate against verification profile
    const evaluationResults: EvaluationResult[] = [];

    for (const candidate of validCandidates) {
      const evalResult = await candidateEvaluator.evaluate(
        { patch: candidate.patch, index: candidate.index },
        verificationProfile,
        { touchedFiles: Array.from(touchedFiles) },
        ui,
        { runId },
        stepsCompleted,
      );

      evaluationResults.push(evalResult);
      l3Metadata.candidatesEvaluated++;

      // Track evaluation report paths
      const evalReportPath = path.join(
        artifacts.root,
        'verification',
        `iter_${stepsCompleted}_candidate_${candidate.index}_report.json`,
      );
      if (fsSync.existsSync(evalReportPath)) {
        l3Metadata.evaluationReportPaths.push(evalReportPath);
      }
    }

    // --- L3 Selection Logic ---
    // 1. If passing candidates exist, select the minimal (smallest diff)
    // 2. Else use reviewer/judge tie-break
    const passingResults = evaluationResults.filter((r) => r.report.passed);

    if (passingResults.length > 0) {
      // Select minimal passing candidate
      const selected = await selectBestCandidate(passingResults, artifacts.root, stepsCompleted);
      if (selected) {
        bestCandidate = validCandidates.find((c) => c.index === selected.candidate.index) || null;
        l3Metadata.passingCandidateSelected = true;
        l3Metadata.selectedCandidateId = String(selected.candidate.index);
      }
    } else if (evaluationResults.length > 0) {
      // No passing candidates - use reviewer/judge tie-break
      const reviews = enableReviewer
        ? await candidateGenerator.reviewCandidates(stepContext, validCandidates)
        : [];
      if (enableReviewer && reviews.length > 0) {
        l3Metadata.reviewerInvoked = true;
      }

      // Check for near-tie or need for judge
      const { invoke: shouldInvokeJudge, reason: invokeReason } = Judge.shouldInvoke(
        verificationProfile.enabled,
        evaluationResults.map((r) => ({
          candidateId: String(r.candidate.index),
          passed: r.report.passed,
          score: r.score,
        })),
        reviews.map((r) => ({
          candidateId: r.candidateId,
          score: r.score,
        })),
      );

      if (enableJudge && shouldInvokeJudge && invokeReason) {
        // Invoke Judge for tie-breaking
        const judge = new Judge(providers.reviewer);

        const judgeContext: JudgeContext = {
          runId,
          iteration: stepsCompleted,
          artifactsRoot: artifacts.root,
          logger,
          eventBus,
        };

        // Build judge input from actual evaluation results
        const judgeCandidates: JudgeCandidate[] = evaluationResults.map((r) => {
          const candidate = validCandidates.find((c) => c.index === r.candidate.index);
          return {
            id: String(r.candidate.index),
            patch: r.candidate.patch,
            patchStats: candidate?.patchStats,
          };
        });

        const judgeVerifications: JudgeVerification[] = evaluationResults.map((r) => ({
          candidateId: String(r.candidate.index),
          status: r.report.passed ? 'passed' : 'failed',
          score: r.score / 1000, // Normalize from evaluation score
          summary: r.report.summary,
        }));

        const judgeOutput = await judge.decide(
          {
            goal,
            candidates: judgeCandidates,
            verifications: judgeVerifications,
            invocationReason: invokeReason,
          },
          judgeContext,
        );

        judgeInvoked = true;
        judgeReason = `${invokeReason}: Judge selected candidate ${judgeOutput.winnerCandidateId} with confidence ${judgeOutput.confidence}.`;
        l3Metadata.judgeInvoked = true;
        l3Metadata.judgeInvocationReason = judgeReason;

        // Select the winner
        const winnerId = parseInt(judgeOutput.winnerCandidateId, 10);
        bestCandidate = validCandidates.find((c) => c.index === winnerId) || validCandidates[0];
        l3Metadata.selectedCandidateId = judgeOutput.winnerCandidateId;
      } else {
        // Use evaluation-based selection (least bad)
        const selected = await selectBestCandidate(
          evaluationResults,
          artifacts.root,
          stepsCompleted,
        );
        if (selected) {
          bestCandidate = validCandidates.find((c) => c.index === selected.candidate.index) || null;
          l3Metadata.selectedCandidateId = String(selected.candidate.index);
        }
      }
    }

    // Update selection ranking path
    const selectionRankingPath = path.join(
      artifacts.root,
      'selection',
      `iter_${stepsCompleted}_ranking.json`,
    );
    if (fsSync.existsSync(selectionRankingPath)) {
      l3Metadata.selectionRankingPath = selectionRankingPath;
    }

    let success = false;
    let lastError = '';

    if (bestCandidate && bestCandidate.patch) {
      consecutiveInvalidDiffs = 0;
      const diffContent = bestCandidate.patch;

      const patchStore = new PatchStore(artifacts.patchesDir, artifacts.manifest);
      const patchPath = await patchStore.saveSelected(stepsCompleted, diffContent);
      patchPaths.push(patchPath);

      // Apply the selected patch
      const result = await executionService.applyPatch(diffContent, step);

      if (result.success) {
        success = true;
        if (result.filesChanged) {
          result.filesChanged.forEach((f) => touchedFiles.add(f));
        }
        consecutiveApplyFailures = 0;
        lastApplyErrorHash = '';

        // Run final verification on applied patch
        const finalVerification = await verificationRunner.run(
          verificationProfile,
          verificationProfile.mode,
          { touchedFiles: result.filesChanged },
          { runId },
        );

        const verificationReportPath = path.join(
          artifacts.root,
          `verification_iter_${stepsCompleted}_final.json`,
        );
        await fs.writeFile(verificationReportPath, JSON.stringify(finalVerification, null, 2));
        l3Metadata.evaluationReportPaths.push(verificationReportPath);

        if (!finalVerification.passed) {
          // Final verification failed - log but continue (patch was applied)
          await eventBus.emit({
            type: 'VerificationFinished',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId,
            payload: {
              passed: false,
              failedChecks: finalVerification.checks.filter((c) => !c.passed).map((c) => c.name),
            },
          });
        }
      } else {
        lastError = result.error || 'Unknown apply error';
        const errorHash = createHash('sha256').update(lastError).digest('hex');
        if (lastApplyErrorHash === errorHash) {
          consecutiveApplyFailures++;
        } else {
          consecutiveApplyFailures = 1;
          lastApplyErrorHash = errorHash;
        }

        const diagnosisConfig = deps.config.l3?.diagnosis;
        const triggerThreshold = diagnosisConfig?.triggerOnRepeatedFailures ?? 2;

        if (diagnosisConfig?.enabled && consecutiveApplyFailures >= triggerThreshold) {
          await eventBus.emit({
            type: 'DiagnosisStarted',
            schemaVersion: 1,
            runId,
            timestamp: new Date().toISOString(),
            payload: {
              iteration: stepsCompleted,
              reason: `Repeated patch apply failure: ${lastError}`,
            },
          });

          const diagnoser = new Diagnoser();
          const diagnosisResult = await diagnoser.diagnose({
            runId,
            goal,
            fusedContext,
            eventBus,
            costTracker: deps.costTracker!,
            reasoner: providers.planner,
            artifactsRoot: artifacts.root,
            logger,
            config: deps.config,
            iteration: stepsCompleted,
            lastError,
          });

          if (diagnosisResult?.selectedHypothesis) {
            baseSignals.push({
              type: 'diagnosis',
              data: `Diagnosis hypothesis: ${diagnosisResult.selectedHypothesis.hypothesis}`,
            });

            // Re-fuse context with new signal
            stepSignals = buildContextSignals({
              goal,
              step,
              ancestors,
              touchedFiles,
              baseSignals,
            });
            fusedContext = deps.contextBuilder.fuseContext({
              goalText: planContextText,
              contextPack: contextPack as ReturnType<SimpleContextPacker['pack']> | undefined,
              memoryHits,
              signals: stepSignals,
              contextStack: contextStack.store?.getAllFrames(),
            });
            stepContext.fusedContext = fusedContext;
          }
          // Reset failure counter
          consecutiveApplyFailures = 0;
        }

        if (consecutiveApplyFailures >= triggerThreshold) {
          return finish(
            'failure',
            'repeated_failure',
            `Repeated patch apply failure: ${lastError}`,
          );
        }
      }
    } else {
      lastError = 'No valid patch generated from candidates';
      consecutiveInvalidDiffs++;
      if (consecutiveInvalidDiffs >= 2) {
        return finish(
          'failure',
          'invalid_output',
          'Executor produced no valid patches twice consecutively',
        );
      }
    }

    if (success) {
      stepsCompleted++;
      await eventBus.emit({
        type: 'StepFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
          step,
          success: true,
          ...(judgeInvoked ? { judgeInvoked: true, judgeReason } : {}),
        },
      });
    } else {
      await eventBus.emit({
        type: 'StepFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { step, success: false, error: lastError },
      });

      return finish('failure', 'repeated_failure', `Step failed: ${step}. Error: ${lastError}`);
    }
  }

  return finish('success', undefined, `L3 Plan Executed Successfully. ${stepsCompleted} steps.`);
}
