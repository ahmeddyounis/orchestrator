import { join, normalizePath } from './path';
import * as fs from 'fs/promises';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync } from 'node:fs';

export const ORCHESTRATOR_DIR = '.orchestrator';
export const RUNS_DIR = 'runs';
export const MANIFEST_FILENAME = 'manifest.json';
export const MANIFEST_VERSION = 1;

export interface RunArtifactPaths {
  root: string;
  trace: string;
  summary: string;
  manifest: string;
  patchesDir: string;
  toolLogsDir: string;
}

export interface Manifest {
  schemaVersion: typeof MANIFEST_VERSION;
  runId: string;
  startedAt: string;
  finishedAt?: string;
  command: string;
  repoRoot: string;
  artifactsDir: string;
  tracePath: string;
  summaryPath: string;
  effectiveConfigPath: string;
  patchPaths: string[];
  contextPaths?: string[];
  toolLogPaths: string[];
  verificationPaths?: string[];
}

// Encryption constants for artifact encryption
const ARTIFACT_ALGORITHM = 'aes-256-gcm';
const ARTIFACT_IV_LENGTH = 12;
const ARTIFACT_AUTH_TAG_LENGTH = 16;
const ARTIFACT_KEY_LENGTH = 32;
const ENCRYPTED_EXTENSION = '.enc';

/** Version byte prepended to encrypted payloads for format detection. */
const FORMAT_VERSION = 0x01;

/** Length in bytes for the random per-encryption salt used in key derivation. */
const SALT_LENGTH = 16;

/**
 * Artifact encryption utilities for securing run artifacts
 */
export interface ArtifactCrypto {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
  encryptBuffer(data: Buffer): Buffer;
  decryptBuffer(data: Buffer): Buffer;
}

/**
 * Creates an artifact encryption instance using AES-256-GCM
 * @param key Encryption key (will be derived using scrypt)
 */
export function createArtifactCrypto(key: string): ArtifactCrypto {
  if (!key) {
    throw new Error('Artifact encryption key is required');
  }

  const derivedKey = scryptSync(key, ARTIFACT_SALT, ARTIFACT_KEY_LENGTH);

  const encryptBuffer = (data: Buffer): Buffer => {
    const iv = randomBytes(ARTIFACT_IV_LENGTH);
    const cipher = createCipheriv(ARTIFACT_ALGORITHM, derivedKey, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]);
  };

  const decryptBuffer = (data: Buffer): Buffer => {
    const iv = data.subarray(0, ARTIFACT_IV_LENGTH);
    const authTag = data.subarray(ARTIFACT_IV_LENGTH, ARTIFACT_IV_LENGTH + ARTIFACT_AUTH_TAG_LENGTH);
    const encrypted = data.subarray(ARTIFACT_IV_LENGTH + ARTIFACT_AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ARTIFACT_ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  };

  return {
    encrypt(plaintext: string): string {
      return encryptBuffer(Buffer.from(plaintext, 'utf8')).toString('base64');
    },
    decrypt(ciphertext: string): string {
      return decryptBuffer(Buffer.from(ciphertext, 'base64')).toString('utf8');
    },
    encryptBuffer,
    decryptBuffer,
  };
}

/**
 * Writes an artifact file with optional encryption
 */
export async function writeArtifact(
  filePath: string,
  content: string | Buffer,
  crypto?: ArtifactCrypto,
): Promise<string> {
  const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  
  if (crypto) {
    const encrypted = crypto.encryptBuffer(data);
    const encryptedPath = filePath + ENCRYPTED_EXTENSION;
    await fs.writeFile(encryptedPath, encrypted);
    return encryptedPath;
  }
  
  await fs.writeFile(filePath, data);
  return filePath;
}

/**
 * Reads an artifact file with optional decryption
 */
export async function readArtifact(
  filePath: string,
  crypto?: ArtifactCrypto,
): Promise<string> {
  // Check for encrypted version first
  const encryptedPath = filePath + ENCRYPTED_EXTENSION;
  const useEncrypted = existsSync(encryptedPath);
  
  if (useEncrypted) {
    if (!crypto) {
      throw new Error(`Encrypted artifact found at ${encryptedPath} but no decryption key provided`);
    }
    const data = await fs.readFile(encryptedPath);
    return crypto.decryptBuffer(data).toString('utf8');
  }
  
  const data = await fs.readFile(filePath, 'utf8');
  return data;
}

/**
 * Appends to an artifact file (for JSONL files). Encrypted files must be read, appended, and rewritten.
 */
export async function appendArtifact(
  filePath: string,
  content: string,
  crypto?: ArtifactCrypto,
): Promise<void> {
  if (crypto) {
    // For encrypted files, we need to read, append, and rewrite
    const existing = await readArtifact(filePath, crypto).catch(() => '');
    await writeArtifact(filePath, existing + content, crypto);
  } else {
    await fs.appendFile(filePath, content);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function toRunRelativePath(runDir: string, p: string): string {
  const normalizedRunDir = normalizePath(runDir).replace(/\/+$/, '');
  const normalizedPath = normalizePath(p);

  // If already relative, keep it as-is (but normalized).
  if (!normalizedPath.includes(':') && !normalizedPath.startsWith('/')) {
    return normalizedPath;
  }

  if (normalizedPath.startsWith(`${normalizedRunDir}/`)) {
    return normalizedPath.slice(normalizedRunDir.length + 1);
  }

  return normalizedPath;
}

function normalizeManifest(manifest: Manifest): Manifest {
  const artifactsDir = normalizePath(manifest.artifactsDir);
  const normalizePaths = (values: string[] | undefined): string[] =>
    uniqueStrings((values ?? []).map((p) => toRunRelativePath(artifactsDir, p)));

  return {
    ...manifest,
    schemaVersion: manifest.schemaVersion ?? MANIFEST_VERSION,
    repoRoot: normalizePath(manifest.repoRoot),
    artifactsDir,
    tracePath: normalizePath(manifest.tracePath),
    summaryPath: normalizePath(manifest.summaryPath),
    effectiveConfigPath: normalizePath(manifest.effectiveConfigPath),
    patchPaths: normalizePaths(manifest.patchPaths),
    toolLogPaths: normalizePaths(manifest.toolLogPaths),
    contextPaths: normalizePaths(manifest.contextPaths),
    verificationPaths: normalizePaths(manifest.verificationPaths),
  };
}

/**
 * Creates the artifact directory structure for a specific run.
 * Returns the paths to the standard artifacts.
 */
export async function createRunDir(baseDir: string, runId: string): Promise<RunArtifactPaths> {
  const runRootDir = join(baseDir, ORCHESTRATOR_DIR, RUNS_DIR, runId);
  const toolLogsDir = join(runRootDir, 'tool_logs');
  const patchesDir = join(runRootDir, 'patches');

  await fs.mkdir(runRootDir, { recursive: true });
  await fs.mkdir(toolLogsDir, { recursive: true });
  await fs.mkdir(patchesDir, { recursive: true });

  return {
    root: runRootDir,
    trace: join(runRootDir, 'trace.jsonl'),
    summary: join(runRootDir, 'summary.json'),
    manifest: join(runRootDir, MANIFEST_FILENAME),
    patchesDir: patchesDir,
    toolLogsDir: toolLogsDir,
  };
}

// Alias for backward compatibility if needed, or just remove if I fix call sites.
export const createRunArtifactsDir = createRunDir;

export function getRunArtifactPaths(baseDir: string, runId: string): RunArtifactPaths {
  const runRootDir = join(baseDir, ORCHESTRATOR_DIR, RUNS_DIR, runId);
  return {
    root: runRootDir,
    trace: join(runRootDir, 'trace.jsonl'),
    summary: join(runRootDir, 'summary.json'),
    manifest: join(runRootDir, MANIFEST_FILENAME),
    patchesDir: join(runRootDir, 'patches'),
    toolLogsDir: join(runRootDir, 'tool_logs'),
  };
}

export async function writeManifest(manifestPath: string, manifest: Manifest): Promise<void> {
  const normalized = normalizeManifest(manifest);
  await fs.writeFile(manifestPath, JSON.stringify(normalized, null, 2), 'utf-8');
}

export async function readManifest(manifestPath: string): Promise<Manifest> {
  const raw = await fs.readFile(manifestPath, 'utf-8');
  const parsed = JSON.parse(raw) as Manifest;
  return normalizeManifest(parsed);
}

export async function updateManifest(
  manifestPath: string,
  updater: (manifest: Manifest) => void,
): Promise<Manifest> {
  const manifest = await readManifest(manifestPath);
  updater(manifest);
  const normalized = normalizeManifest(manifest);
  await writeManifest(manifestPath, normalized);
  return normalized;
}
