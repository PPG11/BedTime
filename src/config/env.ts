export type EnvLike = Record<string, string | undefined>

const detectedEnv =
  (typeof globalThis !== 'undefined' && (globalThis as any)?.process?.env) ||
  {}

export const env: EnvLike = detectedEnv

export const getEnvVar = (key: string, defaultValue: string | undefined) =>
  env[key] ?? defaultValue
