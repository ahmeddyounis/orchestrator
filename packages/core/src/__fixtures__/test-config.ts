import { Config, ConfigSchema } from '@orchestrator/shared';

export const minimalConfigForTest: Config = {
  configVersion: 1,
  thinkLevel: 'L1',
  memory: ConfigSchema.parse({}).memory,
  verification: {
    enabled: false,
    mode: 'custom',
    steps: [],
    auto: {
      enableLint: false,
      enableTypecheck: false,
      enableTests: false,
      testScope: 'targeted',
      maxCommandsPerIteration: 0,
    },
  },
  patch: {
    maxFilesChanged: 10,
    maxLinesChanged: 100,
    allowBinary: false,
  },
};
