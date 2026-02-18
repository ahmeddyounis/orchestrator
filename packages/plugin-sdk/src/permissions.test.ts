import { describe, it, expect } from 'vitest';
import { permissions, PermissionManifestBuilder } from './permissions';
import { PLUGIN_SECURITY_VERSION } from '@orchestrator/shared';

describe('permissions', () => {
  it('creates a PermissionManifestBuilder', () => {
    expect(permissions()).toBeInstanceOf(PermissionManifestBuilder);
  });
});

describe('PermissionManifestBuilder', () => {
  it('builds required, optional, and restrictions', () => {
    const manifest = permissions()
      .requireFilesystemRead('read files')
      .requireFilesystemWrite('write files')
      .requireNetworkHttp('call APIs')
      .requireNetworkWebsocket('stream updates')
      .requireProcessSpawn('run tools')
      .requireEnvironmentRead('read env')
      .requireVectorMemory('use vector memory')
      .optionally('system:info', 'better diagnostics')
      .allowHost('api.example.com')
      .allowPath('/tmp/**')
      .build();

    expect(manifest).toEqual({
      schemaVersion: PLUGIN_SECURITY_VERSION,
      required: {
        'filesystem:read': true,
        'filesystem:write': true,
        'network:http': true,
        'network:websocket': true,
        'process:spawn': true,
        'environment:read': true,
        'memory:vector': true,
      },
      optional: {
        'system:info': true,
      },
      justifications: {
        'filesystem:read': 'read files',
        'filesystem:write': 'write files',
        'network:http': 'call APIs',
        'network:websocket': 'stream updates',
        'process:spawn': 'run tools',
        'environment:read': 'read env',
        'memory:vector': 'use vector memory',
        'system:info': 'better diagnostics',
      },
      allowedHosts: ['api.example.com'],
      allowedPaths: ['/tmp/**'],
    });
  });

  it('omits empty optional fields', () => {
    const manifest = permissions().requireFilesystemRead('needed').build();

    expect(manifest.optional).toBeUndefined();
    expect(manifest.justifications).toEqual({ 'filesystem:read': 'needed' });
    expect(manifest.allowedHosts).toBeUndefined();
    expect(manifest.allowedPaths).toBeUndefined();
  });
});

