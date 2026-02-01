import { MemoryEntry, IntegrityStatus } from '@orchestrator/memory';

const DENYLISTED_COMMAND_PATTERNS = [
  /rm -rf/,
  // more patterns can be added here
];

const SUSPICIOUS_INJECTION_PHRASES = [
  'ignore previous instructions',
  'sudo',
  // more patterns can be added here
];

interface IntegrityResult {
  status: IntegrityStatus;
  reasons: string[];
}

export function assessMemoryIntegrity(entry: MemoryEntry): IntegrityResult {
  const reasons: string[] = [];
  let status: IntegrityStatus = 'ok';

  // Rule: Denylisted command patterns
  if (entry.type === 'procedural') {
    for (const pattern of DENYLISTED_COMMAND_PATTERNS) {
      if (pattern.test(entry.content)) {
        reasons.push(`Command contains denylisted pattern: ${pattern.toString()}`);
        status = 'blocked';
      }
    }
  }

  // Rule: Suspicious injection phrases
  for (const phrase of SUSPICIOUS_INJECTION_PHRASES) {
    if (entry.content.toLowerCase().includes(phrase)) {
      reasons.push(`Content contains suspicious phrase: "${phrase}"`);
      if (status !== 'blocked') {
        status = 'suspect';
      }
    }
  }

  // Rule: Evidence requirements for procedural memory
  if (entry.type === 'procedural') {
    if (!entry.evidenceJson) {
      reasons.push('Procedural memory is missing evidence.');
      status = 'blocked';
    } else {
      const evidence = JSON.parse(entry.evidenceJson);
      if (evidence.exitCode !== 0) {
        reasons.push(`Procedural memory has non-zero exit code: ${evidence.exitCode}`);
        status = 'blocked';
      }
      const allowedClassifications = ['test', 'lint', 'typecheck', 'build', 'format'];
      if (!allowedClassifications.includes(evidence.classification)) {
        // This is already checked in MemoryWriter, but as a safeguard.
        reasons.push(`Procedural memory has unapproved classification: ${evidence.classification}`);
        if (status !== 'blocked') status = 'suspect';
      }
    }
  }

  // Rule: Evidence requirements for episodic memory
  if (entry.type === 'episodic') {
    if (!entry.evidenceJson) {
      reasons.push('Episodic memory is missing evidence (run summary reference).');
      if (status !== 'blocked') status = 'suspect';
    }
  }

  return { status, reasons };
}
