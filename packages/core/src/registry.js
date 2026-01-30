"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderRegistry = exports.RegistryError = void 0;
const proxy_1 = require("./cost/proxy");
class RegistryError extends Error {
    exitCode;
    constructor(message, exitCode) {
        super(message);
        this.exitCode = exitCode;
        this.name = 'RegistryError';
    }
}
exports.RegistryError = RegistryError;
class ProviderRegistry {
    config;
    costTracker;
    factories = new Map();
    adapters = new Map();
    constructor(config, costTracker) {
        this.config = config;
        this.costTracker = costTracker;
    }
    registerFactory(type, factory) {
        this.factories.set(type, factory);
    }
    getAdapter(providerId) {
        // Check cache
        if (this.adapters.has(providerId)) {
            return this.adapters.get(providerId);
        }
        // Look up provider config
        const providerConfig = this.config.providers?.[providerId];
        if (!providerConfig) {
            throw new Error(`Provider '${providerId}' not found in configuration.`);
        }
        // Look up factory
        const factory = this.factories.get(providerConfig.type);
        if (!factory) {
            throw new RegistryError(`Unknown provider type '${providerConfig.type}' for provider '${providerId}'`, 2);
        }
        // Validate env vars
        if (providerConfig.api_key_env && !providerConfig.api_key) {
            throw new RegistryError(`Missing environment variable '${providerConfig.api_key_env}' for provider '${providerId}'`, 2);
        }
        // Create adapter
        let adapter = factory(providerConfig);
        if (this.costTracker) {
            adapter = new proxy_1.CostTrackingAdapter(providerId, adapter, this.costTracker);
        }
        this.adapters.set(providerId, adapter);
        return adapter;
    }
    async resolveRoleProviders(roles, context) {
        const planner = this.getAdapter(roles.plannerId);
        await context.eventBus.emit({
            type: 'ProviderSelected',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId: context.runId,
            payload: {
                role: 'planner',
                providerId: roles.plannerId,
                capabilities: planner.capabilities(),
            },
        });
        const executor = this.getAdapter(roles.executorId);
        await context.eventBus.emit({
            type: 'ProviderSelected',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId: context.runId,
            payload: {
                role: 'executor',
                providerId: roles.executorId,
                capabilities: executor.capabilities(),
            },
        });
        const reviewer = this.getAdapter(roles.reviewerId);
        await context.eventBus.emit({
            type: 'ProviderSelected',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId: context.runId,
            payload: {
                role: 'reviewer',
                providerId: roles.reviewerId,
                capabilities: reviewer.capabilities(),
            },
        });
        return { planner, executor, reviewer };
    }
}
exports.ProviderRegistry = ProviderRegistry;
//# sourceMappingURL=registry.js.map