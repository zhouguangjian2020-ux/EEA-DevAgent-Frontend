/** Backend-measured milliseconds only. Never reconstruct timing from UI clocks. */
const terminalStatuses = new Set(["completed", "succeeded", "preview", "empty", "failed"]);
export function validDurationMs(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function taskDurationParts(value: unknown, status: string): { minutes: number; seconds: number } | null {
  const milliseconds = validDurationMs(value);
  if (milliseconds === null || !terminalStatuses.has(status)) return null;
  const seconds = Math.floor(milliseconds / 1000);
  return { minutes: Math.floor(seconds / 60), seconds: seconds % 60 };
}
