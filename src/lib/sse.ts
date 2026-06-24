/**
 * Format a payload as a single Server-Sent Events frame.
 * Each newline in `data` becomes its own `data:` field; the browser's
 * EventSource rejoins them with "\n" in event.data.
 */
export function formatSseEvent(data: string, opts?: { event?: string }): string {
  let out = "";
  if (opts?.event) out += `event: ${opts.event}\n`;
  for (const line of data.split("\n")) {
    out += `data: ${line}\n`;
  }
  return out + "\n";
}

/** Comment-only frame sent periodically to keep the connection alive. */
export const SSE_HEARTBEAT = ": ping\n\n";
