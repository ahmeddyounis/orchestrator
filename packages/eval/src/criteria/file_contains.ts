import type { CriterionEvaluator } from './types';
import * as fs from 'fs/promises';
import * as path from 'path';

interface FileContainsDetails {
  path: string;
  substring?: string;
  regex?: string;
}

function parseDetails(details: unknown): FileContainsDetails | null {
  if (!details || typeof details !== 'object') {
    return null;
  }

  const d = details as Record<string, unknown>;
  const filePath = d.path;
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return null;
  }

  const substring = typeof d.substring === 'string' ? d.substring : undefined;
  const regex = typeof d.regex === 'string' ? d.regex : undefined;

  if (!substring && !regex) {
    return null;
  }

  return {
    path: filePath,
    substring,
    regex,
  };
}

export const file_contains: CriterionEvaluator = async (summary, details) => {
  const parsed = parseDetails(details);
  if (!parsed) {
    return {
      passed: false,
      message: 'Missing path, substring, or regex for file_contains criterion.',
    };
  }

  const filePath = path.join(summary.repoRoot, parsed.path);

  try {
    const content = await fs.readFile(filePath, 'utf-8');

    if (parsed.substring) {
      if (content.includes(parsed.substring)) {
        return { passed: true, message: `File contains substring.` };
      } else {
        return { passed: false, message: `File does not contain substring.` };
      }
    }

    if (parsed.regex) {
      const regex = new RegExp(parsed.regex);
      if (regex.test(content)) {
        return { passed: true, message: `File content matches regex.` };
      } else {
        return { passed: false, message: `File content does not match regex.` };
      }
    }

    return { passed: false, message: 'Invalid details for file_contains.' };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      passed: false,
      message: `Failed to read or evaluate file: ${message}`,
      details: { error },
    };
  }
};
