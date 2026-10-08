export type Theme = 'light' | 'dark';
export type LightPhase = 'environment' | 'delay' | 'lights' | 'settled';
export const THEME_TIMING = { environment: 900, lampDelay: 180, lamps: 440 } as const;
export function smoothStep(t: number): number { const v = Math.min(1, Math.max(0,t)); return v*v*(3-2*v); }
export interface ThemeFrame { environment: number; lamps: number; phase: LightPhase; }
/** A clock-driven transition: no setTimeout, no stale callbacks when rapidly toggled. */
export class ThemeTransition {
  private start = -Infinity;
  private envFrom: number;
  private lampsFrom: number;
  private target: number;
  private duration: number;
  private lampDuration: number;
  constructor(theme: Theme, reducedMotion = false) {
    this.envFrom = this.lampsFrom = this.target = theme === 'dark' ? 1 : 0;
    this.duration = reducedMotion ? 0 : THEME_TIMING.environment;
    this.lampDuration = reducedMotion ? 100 : THEME_TIMING.lamps;
  }
  setReducedMotion(reduced: boolean) { this.duration = reduced ? 0 : THEME_TIMING.environment; this.lampDuration = reduced ? 100 : THEME_TIMING.lamps; }
  setTarget(theme: Theme, now: number) {
    const next = theme === 'dark' ? 1 : 0;
    if (next === this.target) return;
    const current = this.sample(now);
    this.envFrom = current.environment; this.lampsFrom = current.lamps;
    this.target = next; this.start = now;
  }
  sample(now: number): ThemeFrame {
    const elapsed = now - this.start;
    const envProgress = this.duration === 0 ? 1 : smoothStep(elapsed / this.duration);
    const lampStart = this.duration + THEME_TIMING.lampDelay;
    const lampProgress = smoothStep((elapsed - lampStart) / this.lampDuration);
    return {
      environment: this.envFrom + (this.target-this.envFrom)*envProgress,
      lamps: this.lampsFrom + (this.target-this.lampsFrom)*lampProgress,
      phase: elapsed < this.duration ? 'environment' : elapsed < lampStart ? 'delay' : elapsed < lampStart+this.lampDuration ? 'lights' : 'settled',
    };
  }
}
