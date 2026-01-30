"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigLoader = void 0;
exports.getOrchestratorConfig = getOrchestratorConfig;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const js_yaml_1 = __importDefault(require("js-yaml"));
const shared_1 = require("@orchestrator/shared");
const os_1 = __importDefault(require("os"));
const budget_1 = require("./budget");
const repo_1 = require("@orchestrator/repo");
async function getOrchestratorConfig(configPath, flags) {
    const repoRoot = await (0, repo_1.findRepoRoot)();
    const config = ConfigLoader.load({
        configPath,
        flags,
        cwd: repoRoot,
    });
    const orchestratorDir = path_1.default.join(repoRoot, '.orchestrator');
    const loadedConfig = {
        ...config,
        rootDir: repoRoot,
        orchestratorDir,
        configPath: configPath,
        effective: {
            ...config,
            rootDir: repoRoot,
            orchestratorDir,
        },
    };
    return loadedConfig;
}
class ConfigLoader {
    static loadYaml(filePath) {
        try {
            if (!fs_1.default.existsSync(filePath)) {
                return {};
            }
            const content = fs_1.default.readFileSync(filePath, 'utf8');
            const parsed = js_yaml_1.default.load(content);
            return parsed;
        }
        catch (error) {
            if (error instanceof js_yaml_1.default.YAMLException) {
                throw new Error(`Error parsing YAML file: ${filePath}\n${error.message}`);
            }
            throw error;
        }
    }
    static mergeConfigs(target, source) {
        const output = { ...target };
        if (!source || Object.keys(source).length === 0) {
            return output;
        }
        for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                const sourceValue = source[key];
                if (sourceValue === undefined) {
                    continue;
                }
                const targetValue = output[key];
                if (sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
                    if (targetValue && typeof targetValue === 'object' && !Array.isArray(targetValue)) {
                        output[key] = this.mergeConfigs(targetValue, sourceValue);
                    }
                    else {
                        output[key] = sourceValue;
                    }
                }
                else {
                    // Arrays and primitives replace
                    output[key] = sourceValue;
                }
            }
        }
        return output;
    }
    static writeEffectiveConfig(config, dir) {
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        const filePath = path_1.default.join(dir, 'effective-config.json');
        fs_1.default.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
    }
    static applyThinkLevelDefaults(config) {
        if (!config.memory?.enabled) {
            return config;
        }
        const thinkLevel = config.thinkLevel || 'L1';
        const memory = config.memory || {};
        memory.retrieval = memory.retrieval || {};
        memory.writePolicy = memory.writePolicy || {};
        switch (thinkLevel) {
            case 'L0':
                memory.retrieval.topK ??= 3;
                memory.maxChars ??= 1000;
                memory.writePolicy.storeEpisodes ??= false;
                break;
            case 'L1':
                memory.retrieval.topK ??= 5;
                memory.maxChars ??= 1500;
                memory.writePolicy.storeEpisodes ??= true;
                break;
            case 'L2':
                memory.retrieval.topK ??= 8;
                memory.maxChars ??= 2500;
                memory.writePolicy.storeEpisodes ??= true;
                break;
        }
        return { ...config, memory };
    }
    static load(options = {}) {
        const cwd = options.cwd || process.cwd();
        const env = options.env || process.env;
        // 1. User config: ~/.orchestrator/config.yaml
        const userConfigPath = path_1.default.join(os_1.default.homedir(), '.orchestrator', 'config.yaml');
        const userConfig = this.loadYaml(userConfigPath);
        // 2. Repo config: <repoRoot>/.orchestrator.yaml
        const repoConfigPath = path_1.default.join(cwd, '.orchestrator.yaml');
        const repoConfig = this.loadYaml(repoConfigPath);
        // 3. Explicit --config file (if provided)
        let explicitConfig = {};
        if (options.configPath) {
            if (!fs_1.default.existsSync(options.configPath)) {
                throw new Error(`Config file not found: ${options.configPath}`);
            }
            explicitConfig = this.loadYaml(options.configPath);
        }
        // 4. CLI flags (passed as partial config)
        const flagConfig = options.flags || {};
        // Merge in order of precedence: flags > explicit > repo > user
        // We cast to Record<string, unknown> to satisfy the generic constraint of mergeConfigs
        // while maintaining type safety through ConfigSchema validation at the end.
        let mergedConfig = this.mergeConfigs({}, userConfig);
        mergedConfig = this.mergeConfigs(mergedConfig, repoConfig);
        mergedConfig = this.mergeConfigs(mergedConfig, explicitConfig);
        mergedConfig = this.mergeConfigs(mergedConfig, flagConfig);
        // Defaults
        const defaults = {
            configVersion: 1,
            thinkLevel: 'L1',
            budget: budget_1.DEFAULT_BUDGET,
        };
        mergedConfig = this.mergeConfigs(defaults, mergedConfig);
        // Apply think level defaults
        mergedConfig = this.applyThinkLevelDefaults(mergedConfig);
        // Validate
        const result = shared_1.ConfigSchema.safeParse(mergedConfig);
        if (!result.success) {
            const issues = result.error.issues
                .map((i) => `- ${i.path.join('.')}: ${i.message}`)
                .join('\n');
            throw new Error(`Configuration validation failed:\n${issues}`);
        }
        const finalConfig = result.data;
        // Handle `api_key_env` resolution
        if (finalConfig.providers) {
            for (const providerName in finalConfig.providers) {
                const providerConfig = finalConfig.providers[providerName];
                if (providerConfig.api_key_env && !providerConfig.api_key) {
                    const envKey = providerConfig.api_key_env;
                    if (env[envKey]) {
                        providerConfig.api_key = env[envKey];
                    }
                }
            }
        }
        return finalConfig;
    }
}
exports.ConfigLoader = ConfigLoader;
//# sourceMappingURL=loader.js.map