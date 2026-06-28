export type BulkAction = "ban" | "whitelist" | "delete";
export interface BulkRequest {
  playerIds: string[];
  action: BulkAction;
  reason?: string;
  serverIds?: string[];
  all?: boolean;
}

export function validateBulkRequest(
  body: any,
): { ok: true; value: BulkRequest } | { ok: false; error: string } {
  if (!Array.isArray(body?.playerIds) || body.playerIds.length === 0)
    return { ok: false, error: "playerIds required" };
  if (!["ban", "whitelist", "delete"].includes(body?.action))
    return { ok: false, error: "invalid action" };
  return { ok: true, value: body as BulkRequest };
}
