export interface JudgeCandidate {
  id: string;
  patch: string;
  patchStats?: {
    filesChanged: number;
    linesAdded: number;
    linesDeleted: number;
  };
}

export type JudgeVerificationStatus = 'passed' | 'failed' | 'not_run';

export interface JudgeVerification {
  candidateId: string;
  status: JudgeVerificationStatus;
  score: number;
  summary?: string;
}

export interface JudgeInput {
  goal: string;
  candidates: JudgeCandidate[];
  verifications: JudgeVerification[];
  invocationReason: JudgeInvocationReason;
}

export type JudgeInvocationReason =
  | 'no_passing_candidates'
  | 'objective_near_tie'
  | 'verification_unavailable';

export interface JudgeOutput {
  winnerCandidateId: string;
  rationale: string[];
  riskAssessment: string[];
  confidence: number;
}

export interface JudgeArtifact {
  iteration: number;
  input: JudgeInput;
  output: JudgeOutput;
  timestamp: string;
  durationMs: number;
}
