/** Buffered Agent response revealed progressively; this is not upstream token streaming. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const cancel = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

export async function revealExpansion(text: string, signal: AbortSignal, onProgress: (value: string) => void, reducedMotion = false, delayMs = 24): Promise<void> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (reducedMotion) { onProgress(text); return; }
  const characters = Array.from(text);
  // About three seconds at most, including longer generated text. Never split surrogate pairs.
  const step = Math.max(1, Math.ceil(characters.length / 120));
  for (let end = step; end < characters.length; end += step) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    onProgress(characters.slice(0, end).join(""));
    await pause(delayMs, signal);
  }
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  onProgress(text);
}
