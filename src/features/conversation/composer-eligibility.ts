export function canSubmitComposer(value: string, busy: boolean, disabledReason?: string, sendDisabledReason?: string, composing = false) {
  return Boolean(value.trim()) && !busy && !disabledReason && !sendDisabledReason && !composing;
}
