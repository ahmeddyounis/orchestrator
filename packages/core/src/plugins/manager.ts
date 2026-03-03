import type { PreparedPlugin, ProviderAdapterPlugin } from '@orchestrator/plugin-sdk';
import type { Config, Logger } from '@orchestrator/shared';
import type { ProviderRegistry } from '../registry';
import type { LoadedPlugin } from './loader';
import { PluginLoader } from './loader';
import { PluginProviderAdapter } from './provider_adapter';

export class PluginManager {
  private loadedPlugins: LoadedPlugin[] = [];

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
    private readonly repoRoot: string,
  ) {}

  async load(): Promise<LoadedPlugin[]> {
    const loader = new PluginLoader(this.config, this.logger, this.repoRoot);
    this.loadedPlugins = await loader.loadPlugins();
    return this.loadedPlugins;
  }

  getLoaded(): LoadedPlugin[] {
    return this.loadedPlugins;
  }

  registerProviderPlugins(registry: ProviderRegistry): void {
    const pluginConfigByName = this.config.plugins?.config ?? {};

    const toObjectRecord = (value: unknown): Record<string, unknown> => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      return value as Record<string, unknown>;
    };

    for (const loadedPlugin of this.loadedPlugins) {
      if (loadedPlugin.manifest.type !== 'provider') continue;

      const pluginName = loadedPlugin.manifest.name;
      const pluginDefaults = toObjectRecord(pluginConfigByName[pluginName]);
      const prepared = loadedPlugin.prepared as unknown as PreparedPlugin<ProviderAdapterPlugin>;

      registry.registerFactory(pluginName, (providerConfig) => {
        const events = registry.getEventContext();
        return new PluginProviderAdapter({
          pluginName,
          prepared,
          config: { ...pluginDefaults, ...providerConfig },
          logger: this.logger,
          events,
        });
      });
    }
  }
}
