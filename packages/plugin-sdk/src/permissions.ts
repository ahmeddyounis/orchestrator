/**
 * Plugin Permissions Module
 *
 * Utilities for declaring and validating plugin permissions.
 */

import type { PluginPermissions, PermissionManifest } from '@orchestrator/shared';
import {
  validatePermissionManifest,
  checkPermissions,
  DEFAULT_UNTRUSTED_PERMISSIONS,
  DEFAULT_TRUSTED_PERMISSIONS,
  PLUGIN_SECURITY_VERSION,
} from '@orchestrator/shared';

export {
  validatePermissionManifest,
  checkPermissions,
  DEFAULT_UNTRUSTED_PERMISSIONS,
  DEFAULT_TRUSTED_PERMISSIONS,
};

export type { PluginPermissions, PermissionManifest };

/**
 * Builder for creating permission manifests with a fluent API
 */
export class PermissionManifestBuilder {
  private required: PluginPermissions = {};
  private optional: PluginPermissions = {};
  private justifications: Record<string, string> = {};
  private hosts: string[] = [];
  private paths: string[] = [];

  /**
   * Require filesystem read access
   */
  requireFilesystemRead(justification: string): this {
    this.required['filesystem:read'] = true;
    this.justifications['filesystem:read'] = justification;
    return this;
  }

  /**
   * Require filesystem write access
   */
  requireFilesystemWrite(justification: string): this {
    this.required['filesystem:write'] = true;
    this.justifications['filesystem:write'] = justification;
    return this;
  }

  /**
   * Require HTTP network access
   */
  requireNetworkHttp(justification: string): this {
    this.required['network:http'] = true;
    this.justifications['network:http'] = justification;
    return this;
  }

  /**
   * Require WebSocket access
   */
  requireNetworkWebsocket(justification: string): this {
    this.required['network:websocket'] = true;
    this.justifications['network:websocket'] = justification;
    return this;
  }

  /**
   * Require process spawning capability
   */
  requireProcessSpawn(justification: string): this {
    this.required['process:spawn'] = true;
    this.justifications['process:spawn'] = justification;
    return this;
  }

  /**
   * Require environment variable read access
   */
  requireEnvironmentRead(justification: string): this {
    this.required['environment:read'] = true;
    this.justifications['environment:read'] = justification;
    return this;
  }

  /**
   * Require vector memory access
   */
  requireVectorMemory(justification: string): this {
    this.required['memory:vector'] = true;
    this.justifications['memory:vector'] = justification;
    return this;
  }

  /**
   * Add an optional permission
   */
  optionally(permission: keyof PluginPermissions, justification: string): this {
    this.optional[permission] = true;
    this.justifications[permission] = justification;
    return this;
  }

  /**
   * Restrict network access to specific hosts
   */
  allowHost(host: string): this {
    this.hosts.push(host);
    return this;
  }

  /**
   * Restrict filesystem access to specific paths
   */
  allowPath(pathPattern: string): this {
    this.paths.push(pathPattern);
    return this;
  }

  /**
   * Build the final permission manifest
   */
  build(): PermissionManifest {
    return {
      schemaVersion: PLUGIN_SECURITY_VERSION,
      required: this.required,
      optional: Object.keys(this.optional).length > 0 ? this.optional : undefined,
      justifications: Object.keys(this.justifications).length > 0 ? this.justifications : undefined,
      allowedHosts: this.hosts.length > 0 ? this.hosts : undefined,
      allowedPaths: this.paths.length > 0 ? this.paths : undefined,
    };
  }
}

/**
 * Create a new permission manifest builder
 */
export function permissions(): PermissionManifestBuilder {
  return new PermissionManifestBuilder();
}
