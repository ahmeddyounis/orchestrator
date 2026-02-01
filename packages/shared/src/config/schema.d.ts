import { z } from 'zod';
export declare const IndexingConfigSchema: z.ZodObject<
  {
    enabled: z.ZodDefault<z.ZodBoolean>;
    path: z.ZodDefault<z.ZodString>;
    mode: z.ZodDefault<
      z.ZodEnum<{
        full: 'full';
        off: 'off';
        'on-demand': 'on-demand';
      }>
    >;
    hashAlgorithm: z.ZodDefault<
      z.ZodEnum<{
        sha256: 'sha256';
      }>
    >;
    maxFileSizeBytes: z.ZodDefault<z.ZodNumber>;
    ignore: z.ZodOptional<z.ZodArray<z.ZodString>>;
    autoUpdateOnRun: z.ZodDefault<z.ZodBoolean>;
    maxAutoUpdateFiles: z.ZodDefault<z.ZodNumber>;
  },
  z.core.$strip
>;
export declare const ProviderConfigSchema: z.ZodObject<
  {
    type: z.ZodString;
    model: z.ZodString;
    supportsTools: z.ZodOptional<z.ZodBoolean>;
    api_key_env: z.ZodOptional<z.ZodString>;
    api_key: z.ZodOptional<z.ZodString>;
    command: z.ZodOptional<z.ZodString>;
    args: z.ZodOptional<z.ZodArray<z.ZodString>>;
    env: z.ZodOptional<z.ZodArray<z.ZodString>>;
    cwdMode: z.ZodOptional<
      z.ZodEnum<{
        repoRoot: 'repoRoot';
        runDir: 'runDir';
      }>
    >;
    pricing: z.ZodOptional<
      z.ZodObject<
        {
          inputPerMTokUsd: z.ZodOptional<z.ZodNumber>;
          outputPerMTokUsd: z.ZodOptional<z.ZodNumber>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$loose
>;
export declare const ToolPolicySchema: z.ZodObject<
  {
    enabled: z.ZodDefault<z.ZodBoolean>;
    requireConfirmation: z.ZodDefault<z.ZodBoolean>;
    allowlistPrefixes: z.ZodDefault<z.ZodArray<z.ZodString>>;
    denylistPatterns: z.ZodDefault<z.ZodArray<z.ZodString>>;
    allowNetwork: z.ZodDefault<z.ZodBoolean>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    maxOutputBytes: z.ZodDefault<z.ZodNumber>;
    autoApprove: z.ZodDefault<z.ZodBoolean>;
    interactive: z.ZodDefault<z.ZodBoolean>;
  },
  z.core.$strip
>;
export declare const BudgetSchema: z.ZodObject<
  {
    cost: z.ZodOptional<z.ZodNumber>;
    iter: z.ZodOptional<z.ZodNumber>;
    tool: z.ZodOptional<z.ZodNumber>;
    time: z.ZodOptional<z.ZodNumber>;
  },
  z.core.$strip
>;
export declare const MemoryConfigSchema: z.ZodPipe<
  z.ZodObject<
    {
      enabled: z.ZodDefault<z.ZodBoolean>;
      scope: z.ZodDefault<
        z.ZodEnum<{
          repo: 'repo';
        }>
      >;
      maxChars: z.ZodDefault<z.ZodNumber>;
      storage: z.ZodDefault<
        z.ZodObject<
          {
            backend: z.ZodDefault<
              z.ZodEnum<{
                sqlite: 'sqlite';
              }>
            >;
            path: z.ZodDefault<z.ZodString>;
            encryptAtRest: z.ZodDefault<z.ZodBoolean>;
          },
          z.core.$strip
        >
      >;
      retrieval: z.ZodDefault<
        z.ZodObject<
          {
            mode: z.ZodDefault<
              z.ZodEnum<{
                lexical: 'lexical';
              }>
            >;
            topK: z.ZodDefault<z.ZodNumber>;
            staleDownrank: z.ZodDefault<z.ZodBoolean>;
          },
          z.core.$strip
        >
      >;
      writePolicy: z.ZodDefault<
        z.ZodObject<
          {
            enabled: z.ZodOptional<z.ZodBoolean>;
            storeProcedures: z.ZodDefault<z.ZodBoolean>;
            storeEpisodes: z.ZodDefault<z.ZodBoolean>;
            requireEvidence: z.ZodDefault<z.ZodBoolean>;
            redactSecrets: z.ZodDefault<z.ZodBoolean>;
          },
          z.core.$strip
        >
      >;
    },
    z.core.$strip
  >,
  z.ZodTransform<
    {
      writePolicy: {
        enabled: boolean;
        storeProcedures: boolean;
        storeEpisodes: boolean;
        requireEvidence: boolean;
        redactSecrets: boolean;
      };
      enabled: boolean;
      scope: 'repo';
      maxChars: number;
      storage: {
        backend: 'sqlite';
        path: string;
        encryptAtRest: boolean;
      };
      retrieval: {
        mode: 'lexical';
        topK: number;
        staleDownrank: boolean;
      };
    },
    {
      enabled: boolean;
      scope: 'repo';
      maxChars: number;
      storage: {
        backend: 'sqlite';
        path: string;
        encryptAtRest: boolean;
      };
      retrieval: {
        mode: 'lexical';
        topK: number;
        staleDownrank: boolean;
      };
      writePolicy: {
        storeProcedures: boolean;
        storeEpisodes: boolean;
        requireEvidence: boolean;
        redactSecrets: boolean;
        enabled?: boolean | undefined;
      };
    }
  >
>;
export declare const ConfigSchema: z.ZodObject<
  {
    configVersion: z.ZodDefault<z.ZodLiteral<1>>;
    thinkLevel: z.ZodDefault<
      z.ZodEnum<{
        L0: 'L0';
        L1: 'L1';
        L2: 'L2';
      }>
    >;
    budget: z.ZodOptional<
      z.ZodObject<
        {
          cost: z.ZodOptional<z.ZodNumber>;
          iter: z.ZodOptional<z.ZodNumber>;
          tool: z.ZodOptional<z.ZodNumber>;
          time: z.ZodOptional<z.ZodNumber>;
        },
        z.core.$strip
      >
    >;
    memory: z.ZodDefault<
      z.ZodPipe<
        z.ZodObject<
          {
            enabled: z.ZodDefault<z.ZodBoolean>;
            scope: z.ZodDefault<
              z.ZodEnum<{
                repo: 'repo';
              }>
            >;
            maxChars: z.ZodDefault<z.ZodNumber>;
            storage: z.ZodDefault<
              z.ZodObject<
                {
                  backend: z.ZodDefault<
                    z.ZodEnum<{
                      sqlite: 'sqlite';
                    }>
                  >;
                  path: z.ZodDefault<z.ZodString>;
                  encryptAtRest: z.ZodDefault<z.ZodBoolean>;
                },
                z.core.$strip
              >
            >;
            retrieval: z.ZodDefault<
              z.ZodObject<
                {
                  mode: z.ZodDefault<
                    z.ZodEnum<{
                      lexical: 'lexical';
                    }>
                  >;
                  topK: z.ZodDefault<z.ZodNumber>;
                  staleDownrank: z.ZodDefault<z.ZodBoolean>;
                },
                z.core.$strip
              >
            >;
            writePolicy: z.ZodDefault<
              z.ZodObject<
                {
                  enabled: z.ZodOptional<z.ZodBoolean>;
                  storeProcedures: z.ZodDefault<z.ZodBoolean>;
                  storeEpisodes: z.ZodDefault<z.ZodBoolean>;
                  requireEvidence: z.ZodDefault<z.ZodBoolean>;
                  redactSecrets: z.ZodDefault<z.ZodBoolean>;
                },
                z.core.$strip
              >
            >;
          },
          z.core.$strip
        >,
        z.ZodTransform<
          {
            writePolicy: {
              enabled: boolean;
              storeProcedures: boolean;
              storeEpisodes: boolean;
              requireEvidence: boolean;
              redactSecrets: boolean;
            };
            enabled: boolean;
            scope: 'repo';
            maxChars: number;
            storage: {
              backend: 'sqlite';
              path: string;
              encryptAtRest: boolean;
            };
            retrieval: {
              mode: 'lexical';
              topK: number;
              staleDownrank: boolean;
            };
          },
          {
            enabled: boolean;
            scope: 'repo';
            maxChars: number;
            storage: {
              backend: 'sqlite';
              path: string;
              encryptAtRest: boolean;
            };
            retrieval: {
              mode: 'lexical';
              topK: number;
              staleDownrank: boolean;
            };
            writePolicy: {
              storeProcedures: boolean;
              storeEpisodes: boolean;
              requireEvidence: boolean;
              redactSecrets: boolean;
              enabled?: boolean | undefined;
            };
          }
        >
      >
    >;
    providers: z.ZodOptional<
      z.ZodRecord<
        z.ZodString,
        z.ZodObject<
          {
            type: z.ZodString;
            model: z.ZodString;
            supportsTools: z.ZodOptional<z.ZodBoolean>;
            api_key_env: z.ZodOptional<z.ZodString>;
            api_key: z.ZodOptional<z.ZodString>;
            command: z.ZodOptional<z.ZodString>;
            args: z.ZodOptional<z.ZodArray<z.ZodString>>;
            env: z.ZodOptional<z.ZodArray<z.ZodString>>;
            cwdMode: z.ZodOptional<
              z.ZodEnum<{
                repoRoot: 'repoRoot';
                runDir: 'runDir';
              }>
            >;
            pricing: z.ZodOptional<
              z.ZodObject<
                {
                  inputPerMTokUsd: z.ZodOptional<z.ZodNumber>;
                  outputPerMTokUsd: z.ZodOptional<z.ZodNumber>;
                },
                z.core.$strip
              >
            >;
          },
          z.core.$loose
        >
      >
    >;
    defaults: z.ZodOptional<
      z.ZodObject<
        {
          planner: z.ZodOptional<z.ZodString>;
          executor: z.ZodOptional<z.ZodString>;
          reviewer: z.ZodOptional<z.ZodString>;
        },
        z.core.$strip
      >
    >;
    budgets: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    context: z.ZodOptional<
      z.ZodObject<
        {
          tokenBudget: z.ZodOptional<z.ZodNumber>;
          include: z.ZodOptional<z.ZodArray<z.ZodString>>;
          exclude: z.ZodOptional<z.ZodArray<z.ZodString>>;
          rgPath: z.ZodOptional<z.ZodString>;
        },
        z.core.$strip
      >
    >;
    commandPolicy: z.ZodOptional<
      z.ZodObject<
        {
          allow: z.ZodOptional<z.ZodArray<z.ZodString>>;
          deny: z.ZodOptional<z.ZodArray<z.ZodString>>;
        },
        z.core.$strip
      >
    >;
    patch: z.ZodOptional<
      z.ZodObject<
        {
          maxFilesChanged: z.ZodDefault<z.ZodNumber>;
          maxLinesChanged: z.ZodDefault<z.ZodNumber>;
          allowBinary: z.ZodDefault<z.ZodBoolean>;
        },
        z.core.$strip
      >
    >;
    execution: z.ZodOptional<
      z.ZodObject<
        {
          allowDirtyWorkingTree: z.ZodDefault<z.ZodBoolean>;
          noCheckpoints: z.ZodDefault<z.ZodBoolean>;
          tools: z.ZodDefault<
            z.ZodObject<
              {
                enabled: z.ZodDefault<z.ZodBoolean>;
                requireConfirmation: z.ZodDefault<z.ZodBoolean>;
                allowlistPrefixes: z.ZodDefault<z.ZodArray<z.ZodString>>;
                denylistPatterns: z.ZodDefault<z.ZodArray<z.ZodString>>;
                allowNetwork: z.ZodDefault<z.ZodBoolean>;
                timeoutMs: z.ZodDefault<z.ZodNumber>;
                maxOutputBytes: z.ZodDefault<z.ZodNumber>;
                autoApprove: z.ZodDefault<z.ZodBoolean>;
                interactive: z.ZodDefault<z.ZodBoolean>;
              },
              z.core.$strip
            >
          >;
          sandbox: z.ZodDefault<
            z.ZodObject<
              {
                mode: z.ZodDefault<
                  z.ZodEnum<{
                    none: 'none';
                    docker: 'docker';
                    devcontainer: 'devcontainer';
                  }>
                >;
              },
              z.core.$strip
            >
          >;
        },
        z.core.$strip
      >
    >;
    verification: z.ZodDefault<
      z.ZodObject<
        {
          enabled: z.ZodDefault<z.ZodBoolean>;
          mode: z.ZodDefault<
            z.ZodEnum<{
              auto: 'auto';
              custom: 'custom';
            }>
          >;
          steps: z.ZodDefault<
            z.ZodArray<
              z.ZodObject<
                {
                  name: z.ZodString;
                  command: z.ZodString;
                  required: z.ZodBoolean;
                  timeoutMs: z.ZodOptional<z.ZodNumber>;
                  allowNetwork: z.ZodOptional<z.ZodBoolean>;
                },
                z.core.$strip
              >
            >
          >;
          auto: z.ZodDefault<
            z.ZodObject<
              {
                enableLint: z.ZodDefault<z.ZodBoolean>;
                enableTypecheck: z.ZodDefault<z.ZodBoolean>;
                enableTests: z.ZodDefault<z.ZodBoolean>;
                testScope: z.ZodDefault<
                  z.ZodEnum<{
                    targeted: 'targeted';
                    full: 'full';
                  }>
                >;
                maxCommandsPerIteration: z.ZodDefault<z.ZodNumber>;
              },
              z.core.$strip
            >
          >;
        },
        z.core.$strip
      >
    >;
    indexing: z.ZodOptional<
      z.ZodObject<
        {
          enabled: z.ZodDefault<z.ZodBoolean>;
          path: z.ZodDefault<z.ZodString>;
          mode: z.ZodDefault<
            z.ZodEnum<{
              full: 'full';
              off: 'off';
              'on-demand': 'on-demand';
            }>
          >;
          hashAlgorithm: z.ZodDefault<
            z.ZodEnum<{
              sha256: 'sha256';
            }>
          >;
          maxFileSizeBytes: z.ZodDefault<z.ZodNumber>;
          ignore: z.ZodOptional<z.ZodArray<z.ZodString>>;
          autoUpdateOnRun: z.ZodDefault<z.ZodBoolean>;
          maxAutoUpdateFiles: z.ZodDefault<z.ZodNumber>;
        },
        z.core.$strip
      >
    >;
  },
  z.core.$strip
>;
export type Config = z.infer<typeof ConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
//# sourceMappingURL=schema.d.ts.map
