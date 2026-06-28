import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import type { GameDefinitionSpec } from "@/lib/definitions/types";
import { getRunner } from "@/lib/runners";
import { getLocalServerDir, resolveDefinition, localProcesses } from "@/lib/runners/LocalWindowsRunner";
import { applyPlayerEverywhere, type ApplyDeps, type EnforceArgs } from "./enforce";

export function resolveInstallSubDir(spec: GameDefinitionSpec): string | undefined {
  const i = spec.install as any;
  return i?.installSubDir || undefined;
}

export function buildApplyDeps(playerId: string): ApplyDeps {
  return {
    resolveSpec: async (server) => (await resolveDefinition(server)).spec,
    installDir: (server, spec) => {
      const sub = resolveInstallSubDir(spec);
      return sub ? getLocalServerDir(server.id, sub) : getLocalServerDir(server.id);
    },
    readFile: (abs) => (fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : ""),
    writeFile: (abs, content) => {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    },
    isRunning: (serverId) => localProcesses.has(serverId),
    sendCommand: (server, command) => getRunner(server.runnerType).sendCommand(server, command),
    recordEnforcement: async (serverId, type, status, detail) => {
      await prisma.playerEnforcement.upsert({
        where: { playerId_serverId_type: { playerId, serverId, type } },
        update: { status, detail: detail ?? null, appliedAt: new Date() },
        create: { playerId, serverId, type, status, detail: detail ?? null },
      });
    },
  };
}

export async function applyForOwner(
  ownerId: string,
  player: {
    id: string;
    steamId: string | null;
    xboxId: string | null;
    minecraftUuid: string | null;
    minecraftName: string | null;
  },
  args: EnforceArgs,
  opts?: { serverIds?: string[] },
) {
  const where: any = { userId: ownerId };
  if (opts?.serverIds) where.id = { in: opts.serverIds };
  const servers = await prisma.server.findMany({ where });
  const deps = buildApplyDeps(player.id);
  return applyPlayerEverywhere(player, servers as any, deps, args);
}

export async function logPlayerEvent(
  playerId: string,
  actorId: string,
  action: string,
  detail: string,
) {
  await prisma.playerEvent.create({ data: { playerId, actorId, action, detail } });
}
