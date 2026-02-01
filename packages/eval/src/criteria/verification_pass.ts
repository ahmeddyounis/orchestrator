import type { CriterionEvaluator } from './types';

export const verification_pass: CriterionEvaluator = async (summary) => {
  const verification = summary.verification;

  if (!verification?.enabled) {
    return {
      passed: false,
      message: 'Verification was not enabled for the run.',
    };
  }

  if (verification.passed) {
    return {
      passed: true,
      message: 'Verification passed.',
    };
  }

  return {
    passed: false,
    message: 'Verification did not pass.',
    details: {
      failedChecks: verification.failedChecks,
    },
  };
};
