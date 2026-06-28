import fs from "fs";
import path from "path";

// Writes Enshrouded configuration files (moved verbatim from localRunner.ts)
export function writeEnshroudedConfig(serverDir: string, serverName: string, password?: string) {
  const configPath = path.join(serverDir, "enshrouded_server.json");

  // Enshrouded uses a role-based userGroups password configuration.
  // Passwords for each group MUST be unique because the server uses the password
  // typed by the client to determine which group they belong to.
  const defaultGroups = password ? [
    {
      name: "Admin",
      password: `${password}_admin`, // Admin password: <password>_admin
      canKickBan: true,
      canAccessInventories: true,
      canEditBase: true,
      canExtendBase: true,
      reservedSlots: 2
    },
    {
      name: "Friend",
      password: password, // Main password
      canKickBan: false,
      canAccessInventories: true,
      canEditBase: true,
      canExtendBase: true,
      reservedSlots: 0
    }
  ] : [];

  const config = {
    name: serverName,
    password: "", // Keep simple password empty for role-based userGroups system
    saveDirectory: "./savegame",
    logDirectory: "./logs",
    ip: "0.0.0.0",
    gamePort: 15636,
    queryPort: 15637,
    slotCount: 16,
    userGroups: defaultGroups
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// Writes Project Zomboid configuration files (moved verbatim from localRunner.ts)
export function writeZomboidConfig(serverDir: string, password?: string) {
  const serverConfigDir = path.join(serverDir, "zomboid-data", "Server");
  if (!fs.existsSync(serverConfigDir)) {
    fs.mkdirSync(serverConfigDir, { recursive: true });
  }
  const iniPath = path.join(serverConfigDir, "servertest.ini");
  let iniContent = "";
  if (fs.existsSync(iniPath)) {
    iniContent = fs.readFileSync(iniPath, "utf-8");
  }

  // Update/Insert Password setting
  const passwordLine = `Password=${password || ""}`;
  if (iniContent.includes("Password=")) {
    iniContent = iniContent.replace(/^Password=.*$/m, passwordLine);
  } else {
    iniContent += `\n${passwordLine}\n`;
  }

  fs.writeFileSync(iniPath, iniContent);
}

// Builds a deterministic Windrose invite code: >= 6 uppercase alphanumeric chars,
// derived from the server name (padded with "WINDROSE" so short names still qualify).
function makeWindroseInviteCode(serverName: string): string {
  const cleaned = serverName.replace(/[^a-zA-Z0-9]/g, "");
  return (cleaned + "WINDROSE").toUpperCase().slice(0, 6);
}

// Writes the Windrose ServerDescription.json at the server install root.
// Windrose joins are driven by InviteCode (always set); Password is an optional gate.
export function writeWindroseConfig(serverDir: string, serverName: string, password?: string) {
  const config = {
    ServerName: serverName,
    Password: password || "",
    IsPasswordProtected: !!password,
    InviteCode: makeWindroseInviteCode(serverName),
  };
  fs.writeFileSync(path.join(serverDir, "ServerDescription.json"), JSON.stringify(config, null, 2));
}

// Dispatch a non-template config strategy to its writer.
export function writeStrategyConfig(args: {
  strategy: "enshroudedJson" | "zomboidIniMerge" | "windroseJson";
  installDir: string;       // the server's install subdir (e.g. .../enshrouded-server)
  serverName: string;
  password?: string;
}) {
  if (args.strategy === "enshroudedJson") writeEnshroudedConfig(args.installDir, args.serverName, args.password);
  else if (args.strategy === "zomboidIniMerge") writeZomboidConfig(args.installDir, args.password);
  else if (args.strategy === "windroseJson") writeWindroseConfig(args.installDir, args.serverName, args.password);
}
