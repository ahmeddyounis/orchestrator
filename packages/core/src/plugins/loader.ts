import {
  PluginLifecycle,
  PluginManifest,
  safeLoadPlugin,
  PluginContext,
  LoadPluginResult,
} from '@orchestrator/plugin-sdk';
import { Config, Logger } from '@orchestrator/shared';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as os from 'os';
import { pathToFileURL } from 'url';

export interface LoadedPlugin<T extends PluginLifecycle = PluginLifecycle> {
  manifest: PluginManifest;
  plugin: T;
  filePath: string;
  hash: string;
}

export class PluginLoader {
  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
    private readonly repoRoot: string,
  ) {}

  async loadPlugins(): Promise<Array<LoadedPlugin>> {
    const pluginsConfig = this.config.plugins;
    if (!pluginsConfig?.enabled) {
      return [];
    }

    const pluginPaths: string[] = [];
    let includeHomePluginsDir = false;
    for (const p of pluginsConfig.paths || []) {
      if (path.isAbsolute(p)) {
        pluginPaths.push(p);
        continue;
      }
      includeHomePluginsDir = true;
      pluginPaths.push(path.join(this.repoRoot, p));
    }
    if (includeHomePluginsDir) {
      pluginPaths.push(path.join(os.homedir(), '.orchestrator', 'plugins'));
    }

    const discoveredFiles = await this.discoverPlugins([...new Set(pluginPaths)]);
    const loadedPlugins = await this.loadPluginFiles(discoveredFiles);

    return loadedPlugins;
  }

  private async discoverPlugins(pluginDirs: string[]): Promise<string[]> {
    const files: string[] = [];
    for (const dir of pluginDirs) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
            files.push(path.join(dir, entry.name));
          }
        }
      } catch {
        this.logger.debug(`Could not read plugin directory: ${dir}`);
      }
    }
    return files;
  }

  private async loadPluginFiles(pluginFiles: string[]): Promise<Array<LoadedPlugin>> {
    const plugins: Array<LoadedPlugin> = [];
    const allowlist = this.config.plugins?.allowlistIds;

    for (const file of pluginFiles) {
      try {
        const moduleNs = await import(pathToFileURL(file).href);
        const pluginExport =
          typeof moduleNs?.manifest === 'object' && typeof moduleNs?.createPlugin === 'function'
            ? moduleNs
            : (moduleNs.default as typeof moduleNs);
        const manifest = pluginExport?.manifest as PluginManifest;

        if (!manifest) {
          this.logger.warn(`Plugin ${file} is missing a manifest.`);
          continue;
        }

        if (allowlist && !allowlist.includes(manifest.name)) {
          this.logger.debug(`Skipping plugin ${manifest.name} because it is not in the allowlist.`);
          continue;
        }

        const ctx: PluginContext = {
          runId: `plugin-load:${manifest.name}`,
          logger: this.logger.child({ plugin: manifest.name }),
        };

        const result: LoadPluginResult = await safeLoadPlugin(pluginExport, {}, ctx);

        if (!result.success) {
          this.logger.warn(`Failed to load plugin ${manifest.name}: ${result.error}`);
          continue;
        }

        if (result.plugin && result.manifest) {
          const fileBuffer = await fs.readFile(file);
          const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
          plugins.push({
            manifest: result.manifest,
            plugin: result.plugin,
            filePath: file,
            hash,
          });
          this.logger.info(`Loaded plugin: ${manifest.name}`);
        }
      } catch (error) {
        this.logger.warn(`Error loading plugin from ${file}: ${error}`);
      }
    }

    return plugins;
  }
}
