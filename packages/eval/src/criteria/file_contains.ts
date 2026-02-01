import type { CriterionEvaluator } from './types';
import * as fs from 'fs/promises';
import * as path from 'path';

interface FileContainsDetails {
  path: string;
  substring?: string;
  regex?: string;
}

export const file_contains: CriterionEvaluator = async (summary, details: FileContainsDetails) => {
  if (!details?.path || (!details.substring && !details.regex)) {
    return {
      passed: false,
      message: 'Missing path, substring, or regex for file_contains criterion.',
    };
  }

  const filePath = path.join(summary.repoRoot, details.path);

  try {
    const content = await fs.readFile(filePath, 'utf-8');

    if (details.substring) {
      if (content.includes(details.substring)) {
        return { passed: true, message: `File contains substring.` };
      } else {
        return { passed: false, message: `File does not contain substring.` };
      }
    }

    if (details.regex) {
      const regex = new RegExp(details.regex);
      if (regex.test(content)) {
        return { passed: true, message: `File content matches regex.` };
      } else {
        return { passed: false, message: `File content does not match regex.` };
      }
    }

    return { passed: false, message: 'Invalid details for file_contains.' };
  } catch (error) {
    return {
      passed: false,
      message: `Failed to read or evaluate file: ${error.message}`,
      details: { error },
    };
  }
};
