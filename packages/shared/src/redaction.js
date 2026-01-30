"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactForLogs = redactForLogs;
const SENSITIVE_KEYS = new Set(['api_key', 'token', 'secret', 'authorization']);
const MAX_STRING_LENGTH = 4096;
const TRUNCATION_MESSAGE = '[TRUNCATED]';
// Basic allowlist for env vars that are safe to log.
// In a real scenario, this should be more robust.
const ALLOWED_ENV_VARS = new Set([
    'NODE_ENV',
    'DEBUG',
    'CI',
    // Add other safe-to-log env vars here
]);
function redactForLogs(obj) {
    if (typeof obj === 'string' && obj.length > MAX_STRING_LENGTH) {
        return obj.substring(0, MAX_STRING_LENGTH) + TRUNCATION_MESSAGE;
    }
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(redactForLogs);
    }
    const newObj = {};
    for (const [key, value] of Object.entries(obj)) {
        if (SENSITIVE_KEYS.has(key.toLowerCase())) {
            newObj[key] = '[REDACTED]';
            continue;
        }
        if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
            newObj[key] = value.substring(0, MAX_STRING_LENGTH) + TRUNCATION_MESSAGE;
        }
        else if (typeof value === 'object') {
            newObj[key] = redactForLogs(value);
        }
        else {
            newObj[key] = value;
        }
    }
    // Redact environment variables if present
    if ('env' in newObj && typeof newObj.env === 'object' && newObj.env) {
        const redactedEnv = {};
        for (const [envKey, envValue] of Object.entries(newObj.env)) {
            if (ALLOWED_ENV_VARS.has(envKey)) {
                redactedEnv[envKey] = envValue;
            }
            else {
                redactedEnv[envKey] = '[REDACTED]';
            }
        }
        newObj.env = redactedEnv;
    }
    return newObj;
}
//# sourceMappingURL=redaction.js.map