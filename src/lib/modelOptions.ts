import type { ModelOptions, Settings } from "../types";

/**
 * Merge a model's saved overrides with the app-wide generation defaults.
 * Only the fields that are explicitly set by the model override are replaced.
 */
export function getEffectiveModelOptions(
  settings: Settings,
  model: string,
): ModelOptions {
  const overrides = settings.modelOptions[model] ?? {};

  return {
    temperature: overrides.temperature ?? settings.temperature,
    numCtx: overrides.numCtx ?? settings.numCtx,
    topP: overrides.topP,
    topK: overrides.topK,
    repeatPenalty: overrides.repeatPenalty,
    seed: overrides.seed,
    numPredict: overrides.numPredict,
    keepAlive: overrides.keepAlive,
  };
}

export function hasModelOverrides(settings: Settings, model: string): boolean {
  const overrides = settings.modelOptions[model];
  return Boolean(overrides && Object.keys(overrides).length > 0);
}
