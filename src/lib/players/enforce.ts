import path from "path";
import type { GameDefinitionSpec, PlayerListAction, PlayerListSpec } from "@/lib/definitions/types";
import { mergeListFile, renderConsole, resolvePlayerId } from "./listFormat";

export type EnforcementType = "BAN" | "WHITELIST";
export type EnforcementOp = "add" | "remove";
export type EnforcementStatus = "APPLIED" | "PENDING" | "UNSUPPORTED" | "FAILED";

export interface EnforceArgs { type: EnforcementType; op: EnforcementOp; reason?: string; }

export interface EnforcementPlan {
  status: EnforcementStatus;        // UNSUPPORTED/FAILED short-circuit; otherwise the planned change
  filePath?: string;
  mergeId?: string;
  format?: "jsonArray" | "lineList";
  field?: string;
  op: EnforcementOp;
  consoleCommand?: string;
  detail?: string;
}

type EnforcePlayer = { steamId?: string | null; xboxId?: string | null; minecraftUuid?: string | null; minecraftName?: string | null };

function actionFor(pl: PlayerListSpec, type: EnforcementType): (PlayerListAction & { enforced?: boolean }) | undefined {
  return type === "BAN" ? pl.ban : pl.whitelist;
}

export function planEnforcement(spec: GameDefinitionSpec, player: EnforcePlayer, args: EnforceArgs): EnforcementPlan {
  const pl = spec.playerList;
  if (!pl) return { status: "UNSUPPORTED", op: args.op };
  const action = actionFor(pl, args.type);
  if (!action || action.enforced === false || (!action.file && !action.console)) {
    return { status: "UNSUPPORTED", op: args.op };
  }
  const id = resolvePlayerId(player, pl.identity);
  if (!id) return { status: "FAILED", op: args.op, detail: `Player has no ${pl.identity} value` };

  const plan: EnforcementPlan = { status: "APPLIED", op: args.op };
  if (action.file) { plan.filePath = action.file.path; plan.mergeId = id; plan.format = action.file.format; plan.field = action.file.field; }
  if (action.console) plan.consoleCommand = renderConsole(args.op === "add" ? action.console.add : action.console.remove, { id, reason: args.reason });
  return plan;
}

export interface ApplyDeps {
  resolveSpec: (server: { definitionId: string | null; game: string }) => Promise<GameDefinitionSpec>;
  installDir: (server: { id: string; game: string }, spec: GameDefinitionSpec) => string;
  readFile: (absPath: string) => string;       // "" if missing
  writeFile: (absPath: string, content: string) => void;
  isRunning: (serverId: string) => boolean;
  sendCommand: (server: any, command: string) => Promise<void>;
  recordEnforcement: (serverId: string, type: EnforcementType, status: EnforcementStatus, detail?: string) => Promise<void>;
}

export async function applyToServer(
  player: EnforcePlayer & { id?: string },
  server: { id: string; game: string; definitionId: string | null; status: string },
  deps: ApplyDeps,
  args: EnforceArgs,
): Promise<{ serverId: string; status: EnforcementStatus; detail?: string }> {
  let status: EnforcementStatus = "APPLIED";
  let detail: string | undefined;
  try {
    const spec = await deps.resolveSpec(server);
    const plan = planEnforcement(spec, player, args);
    if (plan.status === "UNSUPPORTED" || plan.status === "FAILED") {
      status = plan.status; detail = plan.detail;
    } else {
      let didFile = false;
      if (plan.filePath && plan.mergeId && plan.format) {
        const abs = path.join(deps.installDir(server, spec), plan.filePath);
        const next = mergeListFile(deps.readFile(abs), plan.mergeId, plan.op, plan.format, plan.field);
        deps.writeFile(abs, next);
        didFile = true;
      }
      let didConsole = false;
      if (plan.consoleCommand && deps.isRunning(server.id)) {
        await deps.sendCommand(server, plan.consoleCommand);
        didConsole = true;
      }
      if (!didFile && !didConsole && plan.consoleCommand) {
        status = "PENDING"; detail = "Server stopped; live-only command will apply on next start";
      }
    }
  } catch (e: any) {
    status = "FAILED"; detail = e?.message ?? String(e);
  }
  await deps.recordEnforcement(server.id, args.type, status, detail);
  return { serverId: server.id, status, detail };
}

export async function applyPlayerEverywhere(
  player: EnforcePlayer & { id?: string },
  servers: Array<{ id: string; game: string; definitionId: string | null; status: string }>,
  deps: ApplyDeps,
  args: EnforceArgs,
) {
  const out: Array<{ serverId: string; status: EnforcementStatus; detail?: string }> = [];
  for (const s of servers) out.push(await applyToServer(player, s, deps, args));
  return out;
}
