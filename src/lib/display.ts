export const fontScaleRange = { min: 0.85, max: 1.75, step: 0.05 };
export const uiScaleRange = { min: 0.9, max: 2, step: 0.05 };

export function formatScale(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
