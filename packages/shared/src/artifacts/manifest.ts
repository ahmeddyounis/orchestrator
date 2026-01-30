// packages/shared/src/artifacts/manifest.ts

export const MANIFEST_VERSION = 1
export const MANIFEST_FILENAME = 'manifest.json'

export interface Manifest {
  schemaVersion: number
  runId: string
  runDir: string
  createdAt: string
  updatedAt: string
  paths: {
    trace?: string
    summary?: string
    effectiveConfig?: string
    finalDiff?: string
    patchesDir?: string
    toolLogsDir?: string
  }
  lists: {
    patchPaths: string[]
    toolLogPaths: string[]
    contextPaths: string[]
    provenancePaths: string[]
    verificationPaths: string[]
  }
}
