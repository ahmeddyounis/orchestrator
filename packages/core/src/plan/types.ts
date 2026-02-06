export const PLAN_JSON_SCHEMA_VERSION = 2;
export const PLAN_REVIEW_SCHEMA_VERSION = 1;

export interface PlanNode {
  /**
   * Human-friendly hierarchical ID (e.g. "1", "2.3", "4.1.2").
   * IDs are positional and primarily intended for UI/traceability.
   */
  id: string;
  /** The actionable instruction for this node. */
  step: string;
  /** Optional nested steps produced via expansion. */
  children?: PlanNode[];
}

export interface PlanExecutionStep {
  /** The hierarchical ID of the leaf node that will be executed. */
  id: string;
  /** The leaf step text to execute. */
  step: string;
  /** Ancestor step texts for context (top-down, excluding this step). */
  ancestors: string[];
}

export type PlanReviewVerdict = 'approve' | 'revise';

export interface PlanReviewResult {
  schemaVersion: typeof PLAN_REVIEW_SCHEMA_VERSION;
  verdict: PlanReviewVerdict;
  summary: string;
  issues: string[];
  suggestions: string[];
  /**
   * Optional revised top-level plan steps. Present when verdict is "revise".
   * When applied, these replace the original outline before any expansions.
   */
  revisedSteps?: string[];
}

export interface PlanJson {
  schemaVersion: typeof PLAN_JSON_SCHEMA_VERSION;
  goal: string;
  generatedAt: string;
  maxDepth: number;
  /**
   * Back-compat: the steps array is what the orchestrator will execute.
   * When maxDepth > 1, this corresponds to the flattened leaf steps.
   */
  steps: string[];
  /** The top-level outline steps (depth 1). */
  outline: string[];
  /** The nested plan tree, including expanded substeps when enabled. */
  tree: PlanNode[];
  /** Flattened leaf nodes with IDs and ancestor context. */
  execution: PlanExecutionStep[];
  /** Optional review output when plan review is enabled. */
  review?: PlanReviewResult;
}

