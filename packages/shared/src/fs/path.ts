import path from 'node:path';
import os from 'node:os';
import { readFileSync } from 'node:fs';

/**
 * Normalizes a path to use forward slashes, which is the standard for Orchestrator.
 * This is especially important for ensuring consistent behavior across different operating systems.
 *
 * @param p The path to normalize.
 * @returns The normalized path with forward slashes.
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Joins all given path segments together using the platform-specific separator as a delimiter,
 * then normalizes the resulting path to use forward slashes.
 *
 * @param paths A sequence of path segments.
 * @returns The normalized joined path.
 */
export function join(...paths: string[]): string {
  return normalizePath(path.join(...paths));
}

/**
 * A platform-agnostic version of `path.relative`.
 *
 * @param from The path to calculate the relative path from.
 * @param to The path to calculate the relative path to.
 * @returns The relative path.
 */
export function relative(from: string, to: string): string {
  return normalizePath(path.relative(from, to));
}

/**
 * A platform-agnostic version of `path.dirname`.
 *
 * @param p The path to get the directory name from.
 * @returns The directory name.
 */
export function dirname(p: string): string {
  return normalizePath(path.dirname(p));
}

/**
 * A platform-agnostic version of `path.resolve`.
 *
 * @param pathSegments The sequence of paths or path segments.
 * @returns An absolute path.
 */
export function resolve(...pathSegments: string[]): string {
  return normalizePath(path.resolve(...pathSegments));
}

/**
 * Checks if the current environment is Windows.
 *
 * @returns `true` if the OS is Windows, `false` otherwise.
 */
export function isWindows(): boolean {
  return os.platform() === 'win32';
}

/**
 * Checks if the current environment is WSL (Windows Subsystem for Linux).
 * It checks for the presence of /proc/version and if the output contains 'Microsoft'.
 *
 * @returns `true` if the OS is WSL, `false` otherwise.
 */
export function isWSL(): boolean {
  try {
    if (os.platform() !== 'linux') {
      return false;
    }
    const version = readFileSync('/proc/version', 'utf8');
    return /microsoft/i.test(version);
  } catch {
    return false;
  }
}
