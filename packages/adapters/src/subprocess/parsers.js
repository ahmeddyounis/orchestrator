"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeOutput = sanitizeOutput;
exports.parseUnifiedDiffFromText = parseUnifiedDiffFromText;
exports.parsePlanFromText = parsePlanFromText;
/**
 * Strips ANSI escape codes and normalizes line endings.
 */
function sanitizeOutput(text) {
    // eslint-disable-next-line no-control-regex
    const ansiRegex = /\x1b\[[0-9;]*m/g;
    return text.replace(ansiRegex, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
/**
 * parses unified diff from text using multiple strategies:
 * 1. Explicit markers <BEGIN_DIFF>...</END_DIFF>
 * 2. Markdown code fences ```diff ... ```
 * 3. Heuristic scanning for unified diff headers
 */
function parseUnifiedDiffFromText(text) {
    const sanitized = sanitizeOutput(text);
    // Strategy 1: Explicit markers
    const markerRegex = /<BEGIN_DIFF>([\s\S]*?)<END_DIFF>/;
    const markerMatch = sanitized.match(markerRegex);
    if (markerMatch) {
        const content = markerMatch[1].trim();
        if (isValidDiffStructure(content)) {
            return { diffText: content, confidence: 1.0 };
        }
    }
    // Strategy 2: Markdown code fences
    const fenceRegex = /```diff([\s\S]*?)```/;
    const fenceMatch = sanitized.match(fenceRegex);
    if (fenceMatch) {
        const content = fenceMatch[1].trim();
        if (isValidDiffStructure(content)) {
            return { diffText: content, confidence: 0.9 };
        }
    }
    // Strategy 3: Heuristic scan
    // Look for `diff --git` OR (`--- a/` AND `+++ b/`)
    // We want to capture from the first valid header to the end of the last hunk
    const lines = sanitized.split('\n');
    let startLine = -1;
    let hasDiffHeader = false;
    let hasHunk = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Check for start of diff
        if (startLine === -1) {
            if (line.startsWith('diff --git')) {
                startLine = i;
                hasDiffHeader = true;
            }
            else if (line.startsWith('--- a/')) {
                // Check next line for +++ b/
                if (i + 1 < lines.length && lines[i + 1].startsWith('+++ b/')) {
                    startLine = i;
                    hasDiffHeader = true;
                    i++; // Skip next line as we checked it
                }
            }
            continue;
        }
        // Inside candidate block
        if (line.startsWith('@@ ') && line.includes(' @@')) {
            hasHunk = true;
        }
    }
    if (startLine !== -1 && hasDiffHeader && hasHunk) {
        // Collect from startLine to as far as we can justify
        // Simple approach: if we found headers and hunks, try to extract that block.
        // Issues: interleaving text.
        // For "dirty" output, we might want to extract *only* the diff lines.
        // Refined Strategy 3: Extract block from startLine.
        // We iterate from startLine and keep lines that look like diff lines.
        const extractedLines = [];
        let validDiffSoFar = false;
        // Reset state to re-scan from startLine
        let inHeader = true;
        let inHunk = false;
        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('diff --git')) {
                inHeader = true;
                inHunk = false;
                extractedLines.push(line);
            }
            else if (line.startsWith('index ')) {
                if (inHeader)
                    extractedLines.push(line);
            }
            else if (line.startsWith('--- ') || line.startsWith('+++ ')) {
                inHeader = true;
                extractedLines.push(line);
            }
            else if (line.startsWith('@@ ')) {
                inHeader = false;
                inHunk = true;
                validDiffSoFar = true;
                extractedLines.push(line);
            }
            else if (inHunk) {
                if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
                    extractedLines.push(line);
                }
                else if (line === '' || line.startsWith('\\ No newline')) {
                    extractedLines.push(line);
                }
                else {
                    // Encountered non-diff line.
                    // If it looks like start of new file, good.
                    if (line.startsWith('diff --git') || line.startsWith('--- a/')) {
                        // Back up one iteration to let the outer loop handle it?
                        // No, we are in the extraction loop.
                        // But wait, the check above `if (line.startsWith('diff --git'))` handles it.
                        // So this branch is for *garbage* inside/after hunk.
                        // If we encounter garbage, we stop? Or skip?
                        // Safer to stop if we assume continuous diff block.
                        break;
                    }
                    break;
                }
            }
        }
        if (validDiffSoFar && extractedLines.length > 0) {
            return {
                diffText: extractedLines.join('\n'),
                confidence: 0.7,
            };
        }
    }
    return null;
}
function isValidDiffStructure(text) {
    // Minimal validation: must have ---/+++ header OR diff --git AND @@ hunk
    // We use multiline flag 'm' and allow whitespace indentation
    const hasDiffGit = /^\s*diff --git/m.test(text);
    const hasUnifiedHeader = /^\s*--- a\/.*\n\s*\+\+\+ b\//m.test(text);
    const hasHunk = /^\s*@@ .* @@/m.test(text);
    return (hasDiffGit || hasUnifiedHeader) && hasHunk;
}
/**
 * Parses a step-by-step plan from text.
 * Looks for numbered lists (1. ) or bullet points (- ) that look like steps.
 */
function parsePlanFromText(text) {
    const sanitized = sanitizeOutput(text);
    const lines = sanitized.split('\n');
    const steps = [];
    for (const line of lines) {
        const trimmed = line.trim();
        // Match "1. Step" or "- Step"
        const numberMatch = trimmed.match(/^\d+\.\s+(.*)/);
        const bulletMatch = trimmed.match(/^[-*]\s+(.*)/);
        if (numberMatch) {
            steps.push(numberMatch[1]);
        }
        else if (bulletMatch) {
            steps.push(bulletMatch[1]);
        }
    }
    if (steps.length > 0) {
        return { steps, confidence: 0.8 };
    }
    return null;
}
//# sourceMappingURL=parsers.js.map