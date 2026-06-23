import { spawn, exec } from "child_process";
import fs from "fs";
import path from "path";
import https from "https";
import { prisma } from "./db";
import { mapPort, unmapPort, getPublicIP } from "./upnp";
import { startMonitoring, stopMonitoring, clearStatsHistory } from "./processMonitor";

// Global process map to persist running processes across Next.js dev server hot-reloads
const globalForRunner = globalThis as unknown as {
  localProcesses: Map<string, any> | undefined;
  intentionalStops: Set<string> | undefined;
  crashCounters: Map<string, { count: number; windowStart: number }> | undefined;
};

if (!globalForRunner.localProcesses) {
  globalForRunner.localProcesses = new Map();
}
if (!globalForRunner.intentionalStops) {
  globalForRunner.intentionalStops = new Set();
}
if (!globalForRunner.crashCounters) {
  globalForRunner.crashCounters = new Map();
}

export const localProcesses = globalForRunner.localProcesses;
const intentionalStops = globalForRunner.intentionalStops;
const crashCounters = globalForRunner.crashCounters;

const CRASH_MAX_RETRIES = 3;
const CRASH_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// SteamCMD info mapping for each game
export function getGameSteamInfo(game: string): { appId: string; installSubDir: string; checkFile: string } | null {
  switch (game.toUpperCase()) {
    case "VALHEIM": return { appId: "896660", installSubDir: "valheim-server", checkFile: "valheim_server.exe" };
    case "ENSHROUDED": return { appId: "2278520", installSubDir: "enshrouded-server", checkFile: "enshrouded_server.exe" };
    case "ZOMBOID": return { appId: "380870", installSubDir: "zomboid-server", checkFile: "StartServer64.bat" };
    case "ARK": return { appId: "376030", installSubDir: "ark-server", checkFile: "ShooterGame/Binaries/Win64/ShooterGameServer.exe" };
    case "TERRARIA": return { appId: "282440", installSubDir: "terraria-server", checkFile: "TerrariaServer.exe" };
    case "PALWORLD": return { appId: "2394010", installSubDir: "palworld-server", checkFile: "PalServer.exe" };
    case "RUST": return { appId: "258550", installSubDir: "rust-server", checkFile: "RustDedicated.exe" };
    default: return null;
  }
}

const MINECRAFT_JAR_URL = "https://piston-data.mojang.com/v1/objects/8dd1a358e2c3885906f21b6dbec6d7cae504c86a/server.jar"; // 1.20.4
const STEAMCMD_ZIP_URL = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";

// Check if Java is installed (Required only for Minecraft)
export function checkJavaInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    exec("java -version", (err) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

// Ensure local directories exist
function getLocalServerDir(serverId: string, sub?: string): string {
  const dir = sub 
    ? path.join(process.cwd(), "local-servers", serverId, sub)
    : path.join(process.cwd(), "local-servers", serverId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Download utility
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: Status Code ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      fs.unlink(dest, () => {}); // Delete partial file
      reject(err);
    });
  });
}

// Setup SteamCMD on demand
export function setupSteamCMD(onLog: (msg: string) => void): Promise<string> {
  const steamcmdDir = path.join(process.cwd(), "steamcmd");
  const exePath = path.join(steamcmdDir, "steamcmd.exe");
  const zipPath = path.join(process.cwd(), "steamcmd.zip");

  if (fs.existsSync(exePath)) {
    return Promise.resolve(exePath);
  }

  return new Promise(async (resolve, reject) => {
    try {
      onLog("SteamCMD not found. Downloading steamcmd.zip...");
      if (!fs.existsSync(steamcmdDir)) {
        fs.mkdirSync(steamcmdDir, { recursive: true });
      }

      await downloadFile(STEAMCMD_ZIP_URL, zipPath);
      onLog("Extracting steamcmd.zip using Windows PowerShell...");
      
      const extractCmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${steamcmdDir}' -Force"`;
      exec(extractCmd, (err) => {
        try { fs.unlinkSync(zipPath); } catch (_) {}

        if (err) {
          reject(new Error(`Failed to extract SteamCMD: ${err.message}`));
        } else {
          onLog("SteamCMD successfully configured!");
          resolve(exePath);
        }
      });
    } catch (err: any) {
      reject(err);
    }
  });
}

// Helper to query free disk space on Windows in GB
function getFreeDiskSpaceGB(dir: string): Promise<number> {
  return new Promise((resolve) => {
    try {
      const drive = path.parse(path.resolve(dir)).root.substring(0, 2); // e.g. "C:"
      exec(`powershell -Command "[math]::round(((Get-PSDrive ${drive[0]}).Free / 1GB), 2)"`, (err, stdout) => {
        if (err || !stdout) {
          resolve(-1);
          return;
        }
        const gbs = parseFloat(stdout.trim());
        if (isNaN(gbs)) {
          resolve(-1);
        } else {
          resolve(gbs);
        }
      });
    } catch (e) {
      resolve(-1);
    }
  });
}

// Bootstraps SteamCMD. When first run, SteamCMD updates itself and exits,
// which returns a non-zero code. We retry up to 3 times until it exits with code 0 (fully updated).
export function ensureSteamCmdUpdated(steamcmdExe: string, onLog: (msg: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 3;

    const runUpdateCheck = () => {
      attempts++;
      onLog(`SteamCMD self-update check (Attempt ${attempts}/${maxAttempts})...`);
      
      const child = spawn(steamcmdExe, ["+quit"]);

      child.stdout.on("data", (data) => {
        const line = data.toString().trim();
        if (line) {
          onLog(`[SteamCMD Bootstrap] ${line.replace(/[\r\n]+/g, " ")}`);
        }
      });

      child.stderr.on("data", (data) => {
        const line = data.toString().trim();
        if (line) {
          onLog(`[SteamCMD Bootstrap Error] ${line.replace(/[\r\n]+/g, " ")}`);
        }
      });

      child.on("close", (code) => {
        if (code === 0) {
          onLog("SteamCMD is fully updated and ready.");
          resolve();
        } else if (attempts < maxAttempts) {
          onLog(`SteamCMD updated and restarted itself (Exit Code: ${code}). Retrying check...`);
          // Wait 2s to let files write before relaunching
          setTimeout(runUpdateCheck, 2000);
        } else {
          reject(new Error(`SteamCMD failed to bootstrap after ${maxAttempts} attempts. Exit code: ${code}. Check the logs for error details.`));
        }
      });
    };

    runUpdateCheck();
  });
}

// Download a Steam game server via SteamCMD by App ID
function installSteamCmdApp(
  serverId: string,
  appId: string,
  appName: string,
  installDir: string,
  checkFile: string,
  onLog: (msg: string) => void
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const exePath = path.join(installDir, checkFile);
      if (fs.existsSync(exePath)) {
        resolve();
        return;
      }

      // Check free disk space before any SteamCMD action
      const freeSpace = await getFreeDiskSpaceGB(installDir);
      if (freeSpace !== -1) {
        let requiredGB = 3.0; // default minimum
        if (appId === "896660") requiredGB = 2.5; // Valheim
        if (appId === "2278520") requiredGB = 4.0; // Enshrouded
        if (appId === "380870") requiredGB = 3.0; // Zomboid
        if (appId === "376030") requiredGB = 15.0; // ARK
        if (appId === "282440") requiredGB = 1.0; // Terraria
        if (appId === "2394010") requiredGB = 4.0; // Palworld
        if (appId === "258550") requiredGB = 10.0; // Rust

        // SteamCMD itself requires at least 250MB (0.25GB) free space to download and bootstrap
        const minSteamCmdGB = 0.25;
        const totalRequiredGB = Math.max(requiredGB, minSteamCmdGB);

        onLog(`[Disk Check] Available space: ${freeSpace.toFixed(2)} GB, Required: ${totalRequiredGB} GB`);
        if (freeSpace < totalRequiredGB) {
          reject(new Error(`Insufficient disk space on target drive. You have ${freeSpace.toFixed(2)} GB free, but installing/updating SteamCMD and ${appName} requires at least ${totalRequiredGB} GB.`));
          return;
        }
      }

      const steamcmdExe = await setupSteamCMD(onLog);
      await ensureSteamCmdUpdated(steamcmdExe, onLog);

      onLog(`Starting ${appName} installation via SteamCMD (App ID ${appId})...`);
      onLog("This is a background download and may take several minutes depending on connection speeds. Please wait...");

      const cleanInstallDir = installDir.replace(/\\/g, "/");

      // +app_info_update 1 forces SteamCMD to refresh its app-metadata cache before the
      // install. On a freshly bootstrapped SteamCMD the cache is empty, and running
      // app_update immediately fails with "Missing configuration" (exit code 8) because
      // the depot config for the app hasn't synced yet.
      const child = spawn(steamcmdExe, [
        "+force_install_dir", cleanInstallDir,
        "+login", "anonymous",
        "+app_info_update", "1",
        "+app_update", appId,
        "validate",
        "+quit"
      ]);

      // Capture SteamCMD's real error so failures report the cause, not just an exit code.
      let steamErrorDetail = "";
      child.stdout.on("data", (data) => {
        const line = data.toString().trim();
        if (line) {
          const cleanLine = line.replace(/[\r\n]+/g, " ");
          if (/ERROR!|Failed to install|No subscription|Invalid Password|Disk write failure/i.test(cleanLine)) {
            steamErrorDetail = cleanLine;
            onLog(`[SteamCMD Error] ${cleanLine}`);
          } else if (cleanLine.includes("progress") || cleanLine.includes("Downloading") || cleanLine.includes("Update state")) {
            onLog(`[SteamCMD Status] ${cleanLine}`);
          }
        }
      });

      child.stderr.on("data", (data) => {
        const line = data.toString().trim();
        if (line) {
          steamErrorDetail = line.replace(/[\r\n]+/g, " ");
          onLog(`[SteamCMD warning] ${line}`);
        }
      });

      child.on("close", (code) => {
        if (code === 0 || fs.existsSync(exePath)) {
          onLog(`${appName} download completed!`);
          resolve();
        } else {
          const detail = steamErrorDetail ? ` - ${steamErrorDetail}` : " (see steamcmd/logs/console_log.txt for details)";
          reject(new Error(`SteamCMD App ${appId} download process exited with code ${code}${detail}`));
        }
      });
    } catch (err: any) {
      reject(err);
    }
  });
}

// Writes Enshrouded configuration files
function writeEnshroudedConfig(serverDir: string, serverName: string, password?: string) {
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

// Writes Project Zomboid configuration files
function writeZomboidConfig(serverDir: string, password?: string) {
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

// Writes Minecraft configuration files (EULA & Properties)
function writeMinecraftConfigs(serverDir: string, port: number, serverName: string) {
  fs.writeFileSync(path.join(serverDir, "eula.txt"), "eula=true\n");

  const properties = [
    `server-port=${port}`,
    "query.port=25565",
    "online-mode=false", // set to false for local debugging ease
    "max-players=10",
    `motd=GameVault Local Runner Minecraft Server - ${serverName}`
  ].join("\n");
  
  fs.writeFileSync(path.join(serverDir, "server.properties"), properties);
}

// Log writer helper
function appendLog(serverDir: string, message: string) {
  const logFile = path.join(serverDir, "server.log");
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[GameVault Local Runner ${timestamp}] ${message}\n`);
}

// Main: Start a local game server (Minecraft or Valheim)
export async function startLocalServer(serverId: string, game: string, ramAllocation: number): Promise<any> {
  const baseDir = getLocalServerDir(serverId);
  const logFile = path.join(baseDir, "server.log");

  // If server is already running, do nothing
  if (localProcesses.has(serverId)) {
    return;
  }

  // Clear previous log file
  if (fs.existsSync(logFile)) {
    fs.unlinkSync(logFile);
  }

  const logWriter = (msg: string) => appendLog(baseDir, msg);

  // Fetch full server record from database to read custom passwords and UPnP configs
  const server = await prisma.server.findUnique({
    where: { id: serverId }
  });

  if (!server) {
    throw new Error("Server record not found in database.");
  }

  // UPnP & Public WAN IP Setup
  let currentIp = "127.0.0.1";

  // 1. Try to query public WAN IP address so they always get a shareable address
  try {
    const publicIp = await getPublicIP();
    if (publicIp) {
      currentIp = publicIp;
      logWriter(`[IP Resolver] Resolved public WAN Address: ${publicIp}`);
    }
  } catch (ipErr: any) {
    logWriter(`[IP Resolver Warning] Could not resolve public WAN IP address: ${ipErr.message}`);
  }

  // 2. Map router ports using UPnP if requested or enabled by default
  if (server.enableUpnp || server.runnerType === "LOCAL") {
    logWriter("[UPnP] Requesting router port forwarding rules...");
    try {
      if (game.toUpperCase() === "MINECRAFT") {
        await mapPort(25565, "TCP", `GameVault MC - ${server.name}`);
        await mapPort(25565, "UDP", `GameVault MC - ${server.name}`);
      } else if (game.toUpperCase() === "VALHEIM") {
        await mapPort(2456, "UDP", `GameVault VH - ${server.name}`);
        await mapPort(2457, "UDP", `GameVault VH - ${server.name}`);
        await mapPort(2458, "UDP", `GameVault VH - ${server.name}`);
      } else if (game.toUpperCase() === "ENSHROUDED") {
        await mapPort(15636, "TCP", `GameVault EN - ${server.name}`);
        await mapPort(15636, "UDP", `GameVault EN - ${server.name}`);
        await mapPort(15637, "TCP", `GameVault EN - ${server.name}`);
        await mapPort(15637, "UDP", `GameVault EN - ${server.name}`);
      } else if (game.toUpperCase() === "ZOMBOID") {
        await mapPort(16261, "UDP", `GameVault PZ - ${server.name}`);
        await mapPort(16262, "UDP", `GameVault PZ - ${server.name}`);
        await mapPort(8766, "UDP", `GameVault PZ - ${server.name}`);
      } else if (game.toUpperCase() === "ARK") {
        await mapPort(7777, "UDP", `GameVault ARK - ${server.name}`);
        await mapPort(7778, "UDP", `GameVault ARK - ${server.name}`);
        await mapPort(27015, "UDP", `GameVault ARK - ${server.name}`);
      } else if (game.toUpperCase() === "TERRARIA") {
        await mapPort(7777, "TCP", `GameVault TR - ${server.name}`);
        await mapPort(7777, "UDP", `GameVault TR - ${server.name}`);
      } else if (game.toUpperCase() === "PALWORLD") {
        await mapPort(8211, "UDP", `GameVault PW - ${server.name}`);
      } else if (game.toUpperCase() === "RUST") {
        await mapPort(28015, "UDP", `GameVault RS - ${server.name}`);
        await mapPort(28016, "TCP", `GameVault RS RCON - ${server.name}`);
      }
      logWriter("[UPnP] Success! Router port forward mapping completed successfully.");
    } catch (e: any) {
      logWriter(`[UPnP Warning] Failed to configure router port maps: ${e.message}`);
      if (currentIp !== "127.0.0.1") {
        logWriter(`[UPnP Note] You can still share your public IP (${currentIp}) with friends, but you may need to configure port forwarding manually on your router.`);
      }
    }
  }

  if (game.toUpperCase() === "MINECRAFT") {
    // Check Java
    const isJavaOk = await checkJavaInstalled();
    if (!isJavaOk) {
      throw new Error("Java Runtime Environment (JRE) was not found on your system. Please install Java (JDK/JRE 17+) to run Minecraft servers locally.");
    }

    const jarPath = path.join(baseDir, "server.jar");

    // Download jar if missing
    if (!fs.existsSync(jarPath)) {
      logWriter("Server jar not found. Initializing Mojang download stream...");
      try {
        await prisma.server.update({
          where: { id: serverId },
          data: { status: "STARTING" },
        });
        await downloadFile(MINECRAFT_JAR_URL, jarPath);
        logWriter("Download completed. server.jar cached successfully.");
      } catch (err: any) {
        logWriter(`Download failed: ${err.message}`);
        throw new Error(`Failed to download game server binaries: ${err.message}`);
      }
    }

    writeMinecraftConfigs(baseDir, 25565, server.name);
    logWriter(`Spawning Minecraft process: java -Xmx${ramAllocation}G -jar server.jar`);

    const child = spawn("java", [
      `-Xms512M`,
      `-Xmx${ramAllocation}G`,
      "-jar",
      "server.jar",
      "nogui"
    ], {
      cwd: baseDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });

    if (!child.pid) throw new Error("Failed to spawn Java child process.");
    
    localProcesses.set(serverId, child);

    await prisma.server.update({
      where: { id: serverId },
      data: { 
        status: "RUNNING", 
        pid: child.pid, 
        ipAddress: currentIp,
        cpuUsage: 0, 
        memoryUsage: 0 
      },
    });

    startMonitoring(serverId, child.pid);

    // Pipe outputs to file
    const logStream = fs.createWriteStream(logFile, { flags: "a" });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    child.on("exit", (code, signal) => handleProcessExit(serverId, code, signal, baseDir));

  } else if (game.toUpperCase() === "VALHEIM") {
    const valheimDir = getLocalServerDir(serverId, "valheim-server");
    const exePath = path.join(valheimDir, "valheim_server.exe");

    // Install Valheim if missing
    if (!fs.existsSync(exePath)) {
      try {
        await prisma.server.update({
          where: { id: serverId },
          data: { status: "STARTING" },
        });
        await installSteamCmdApp(serverId, "896660", "Valheim Dedicated Server", valheimDir, "valheim_server.exe", logWriter);
      } catch (err: any) {
        logWriter(`Valheim Installation failed: ${err.message}`);
        throw new Error(`Valheim install failed: ${err.message}`);
      }
    }

    // Set custom password (Valheim requires minimum of 5 characters)
    const password = (server.password && server.password.length >= 5) ? server.password : "viking123";
    logWriter(`Launching Valheim server with password: "${password}"`);
    
    // Spawn Valheim server process with -crossplay to support Microsoft PlayFab NAT punchthrough & Join Codes
    const child = spawn(exePath, [
      "-nographics",
      "-batchmode",
      "-name", server.name,
      "-port", "2456",
      "-world", "Dedicated",
      "-password", password,
      "-public", "1",
      "-crossplay"
    ], {
      cwd: valheimDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });

    if (!child.pid) throw new Error("Failed to spawn Valheim child process.");

    localProcesses.set(serverId, child);

    // Listen to stdout in real-time to extract PlayFab Crossplay Join Code
    child.stdout.on("data", (chunk) => {
      const logStr = chunk.toString();
      const match = logStr.match(/registered with join code (\w+)/i);
      if (match && match[1]) {
        const joinCode = match[1];
        logWriter(`[PlayFab] Success! Server registered with join code: ${joinCode}`);
        prisma.server.update({
          where: { id: serverId },
          data: { ipAddress: `Join Code: ${joinCode}` }
        }).catch(err => console.error("Error updating Valheim join code in DB:", err));
      }
    });

    await prisma.server.update({
      where: { id: serverId },
      data: { 
        status: "RUNNING", 
        pid: child.pid, 
        ipAddress: currentIp,
        cpuUsage: 0, 
        memoryUsage: 0 
      },
    });

    startMonitoring(serverId, child.pid);

    const logStream = fs.createWriteStream(logFile, { flags: "a" });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    child.on("exit", (code, signal) => handleProcessExit(serverId, code, signal, baseDir));

  } else if (game.toUpperCase() === "ENSHROUDED") {
    const enshroudedDir = getLocalServerDir(serverId, "enshrouded-server");
    const exePath = path.join(enshroudedDir, "enshrouded_server.exe");

    // Install Enshrouded if missing
    if (!fs.existsSync(exePath)) {
      try {
        await prisma.server.update({
          where: { id: serverId },
          data: { status: "STARTING" },
        });
        await installSteamCmdApp(serverId, "2278520", "Enshrouded Dedicated Server", enshroudedDir, "enshrouded_server.exe", logWriter);
      } catch (err: any) {
        logWriter(`Enshrouded Installation failed: ${err.message}`);
        throw new Error(`Enshrouded install failed: ${err.message}`);
      }
    }

    // Write JSON Config
    writeEnshroudedConfig(enshroudedDir, server.name, server.password || undefined);

    logWriter("Launching Enshrouded dedicated server...");
    
    // Spawn Enshrouded process
    const child = spawn(exePath, [], {
      cwd: enshroudedDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });

    if (!child.pid) throw new Error("Failed to spawn Enshrouded child process.");

    localProcesses.set(serverId, child);

    await prisma.server.update({
      where: { id: serverId },
      data: { 
        status: "RUNNING", 
        pid: child.pid, 
        ipAddress: currentIp, 
        cpuUsage: 0, 
        memoryUsage: 0 
      },
    });

    startMonitoring(serverId, child.pid);

    const logStream = fs.createWriteStream(logFile, { flags: "a" });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    child.on("exit", (code, signal) => handleProcessExit(serverId, code, signal, baseDir));

  } else if (game.toUpperCase() === "ZOMBOID") {
    const zomboidDir = getLocalServerDir(serverId, "zomboid-server");
    const batchPath = path.join(zomboidDir, "StartServer64.bat");

    // Install Zomboid if missing
    if (!fs.existsSync(batchPath)) {
      try {
        await prisma.server.update({
          where: { id: serverId },
          data: { status: "STARTING" },
        });
        await installSteamCmdApp(serverId, "380870", "Project Zomboid Dedicated Server", zomboidDir, "StartServer64.bat", logWriter);
      } catch (err: any) {
        logWriter(`Zomboid Installation failed: ${err.message}`);
        throw new Error(`Project Zomboid install failed: ${err.message}`);
      }
    }

    // Write INI Config inside zomboid-data/Server/servertest.ini
    writeZomboidConfig(zomboidDir, server.password || undefined);

    logWriter("Launching Project Zomboid dedicated server...");
    
    // Spawn Zomboid process using Cmd.exe to execute the batch file
    const child = spawn("cmd.exe", [
      "/c", "StartServer64.bat",
      "-cachedir=./zomboid-data",
      "-servername", "servertest"
    ], {
      cwd: zomboidDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });

    if (!child.pid) throw new Error("Failed to spawn Project Zomboid child process.");

    localProcesses.set(serverId, child);

    await prisma.server.update({
      where: { id: serverId },
      data: { 
        status: "RUNNING", 
        pid: child.pid, 
        ipAddress: currentIp, 
        cpuUsage: 0, 
        memoryUsage: 0 
      },
    });

    startMonitoring(serverId, child.pid);

    const logStream = fs.createWriteStream(logFile, { flags: "a" });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    child.on("exit", (code, signal) => handleProcessExit(serverId, code, signal, baseDir));

  } else if (game.toUpperCase() === "ARK") {
    const arkDir = getLocalServerDir(serverId, "ark-server");
    const exePath = path.join(arkDir, "ShooterGame", "Binaries", "Win64", "ShooterGameServer.exe");

    // Install ARK if missing
    if (!fs.existsSync(exePath)) {
      try {
        await prisma.server.update({
          where: { id: serverId },
          data: { status: "STARTING" },
        });
        await installSteamCmdApp(serverId, "376030", "ARK Dedicated Server", arkDir, "ShooterGame/Binaries/Win64/ShooterGameServer.exe", logWriter);
      } catch (err: any) {
        logWriter(`ARK Installation failed: ${err.message}`);
        throw new Error(`ARK dedicated server install failed: ${err.message}`);
      }
    }

    logWriter("Launching ARK: Survival Evolved dedicated server...");
    
    const arkParams = `TheIsland?SessionName=${server.name}${server.password ? `?ServerPassword=${server.password}` : ""}?Port=7777?QueryPort=27015?MaxPlayers=20`;
    
    // Spawn ARK Server process
    const child = spawn(exePath, [
      arkParams,
      "-server",
      "-nosound",
      "-QueryPort=27015"
    ], {
      cwd: path.join(arkDir, "ShooterGame", "Binaries", "Win64"),
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    });

    if (!child.pid) throw new Error("Failed to spawn ARK child process.");

    localProcesses.set(serverId, child);

    await prisma.server.update({
      where: { id: serverId },
      data: { 
        status: "RUNNING", 
        pid: child.pid, 
        ipAddress: currentIp, 
        cpuUsage: 0, 
        memoryUsage: 0 
      },
    });

    startMonitoring(serverId, child.pid);

    const logStream = fs.createWriteStream(logFile, { flags: "a" });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    child.on("exit", (code, signal) => handleProcessExit(serverId, code, signal, baseDir));

  } else if (game.toUpperCase() === "TERRARIA") {
    const terrariaDir = getLocalServerDir(serverId, "terraria-server");
    const exePath = path.join(terrariaDir, "TerrariaServer.exe");

    if (!fs.existsSync(exePath)) {
      try {
        await prisma.server.update({ where: { id: serverId }, data: { status: "STARTING" } });
        await installSteamCmdApp(serverId, "282440", "Terraria Dedicated Server", terrariaDir, "TerrariaServer.exe", logWriter);
      } catch (err: any) {
        logWriter(`Terraria Installation failed: ${err.message}`);
        throw new Error(`Terraria install failed: ${err.message}`);
      }
    }

    const worldsDir = path.join(terrariaDir, "worlds");
    if (!fs.existsSync(worldsDir)) fs.mkdirSync(worldsDir, { recursive: true });

    const password = server.password || "";
    const passwordArgs = password ? ["-pass", password] : [];
    logWriter(`Launching Terraria dedicated server on port 7777...`);

    const child = spawn(exePath, [
      "-port", "7777", "-players", "8", ...passwordArgs,
      "-autocreate", "1", "-worldname", server.name.replace(/[^a-zA-Z0-9]/g, "_"),
      "-world", path.join(worldsDir, `${server.name.replace(/[^a-zA-Z0-9]/g, "_")}.wld`),
    ], { cwd: terrariaDir, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });

    if (!child.pid) throw new Error("Failed to spawn Terraria child process.");
    localProcesses.set(serverId, child);

    await prisma.server.update({
      where: { id: serverId },
      data: { status: "RUNNING", pid: child.pid, ipAddress: currentIp, cpuUsage: 0, memoryUsage: 0 },
    });
    startMonitoring(serverId, child.pid);

    const logStream = fs.createWriteStream(logFile, { flags: "a" });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);
    child.on("exit", (code, signal) => handleProcessExit(serverId, code, signal, baseDir));

  } else if (game.toUpperCase() === "PALWORLD") {
    const palworldDir = getLocalServerDir(serverId, "palworld-server");
    const exePath = path.join(palworldDir, "PalServer.exe");

    if (!fs.existsSync(exePath)) {
      try {
        await prisma.server.update({ where: { id: serverId }, data: { status: "STARTING" } });
        await installSteamCmdApp(serverId, "2394010", "Palworld Dedicated Server", palworldDir, "PalServer.exe", logWriter);
      } catch (err: any) {
        logWriter(`Palworld Installation failed: ${err.message}`);
        throw new Error(`Palworld install failed: ${err.message}`);
      }
    }

    const password = server.password || "";
    const portArg = "?port=8211";
    const playersArg = "?players=16";
    const passwordArg = password ? `?AdminPassword=${password}` : "";
    logWriter(`Launching Palworld dedicated server on port 8211...`);

    const child = spawn(exePath, [
      `${portArg}${playersArg}${passwordArg}`, "-useperfthreads", "-NoAsyncLoadingThread", "-UseMultithreadForDS"
    ], { cwd: palworldDir, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });

    if (!child.pid) throw new Error("Failed to spawn Palworld child process.");
    localProcesses.set(serverId, child);

    await prisma.server.update({
      where: { id: serverId },
      data: { status: "RUNNING", pid: child.pid, ipAddress: currentIp, cpuUsage: 0, memoryUsage: 0 },
    });
    startMonitoring(serverId, child.pid);

    const logStream = fs.createWriteStream(logFile, { flags: "a" });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);
    child.on("exit", (code, signal) => handleProcessExit(serverId, code, signal, baseDir));

  } else if (game.toUpperCase() === "RUST") {
    const rustDir = getLocalServerDir(serverId, "rust-server");
    const exePath = path.join(rustDir, "RustDedicated.exe");

    if (!fs.existsSync(exePath)) {
      try {
        await prisma.server.update({ where: { id: serverId }, data: { status: "STARTING" } });
        await installSteamCmdApp(serverId, "258550", "Rust Dedicated Server", rustDir, "RustDedicated.exe", logWriter);
      } catch (err: any) {
        logWriter(`Rust Installation failed: ${err.message}`);
        throw new Error(`Rust install failed: ${err.message}`);
      }
    }

    const rconPassword = server.password || "changeme123";
    logWriter(`Launching Rust dedicated server on port 28015...`);

    const child = spawn(exePath, [
      "-batchmode", "+server.port", "28015", "+server.identity", "servertest",
      "+server.seed", "12345", "+server.worldsize", "3000", "+server.maxplayers", "10",
      "+server.hostname", server.name, "+rcon.port", "28016", "+rcon.password", rconPassword, "+rcon.web", "1"
    ], { cwd: rustDir, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });

    if (!child.pid) throw new Error("Failed to spawn Rust child process.");
    localProcesses.set(serverId, child);

    await prisma.server.update({
      where: { id: serverId },
      data: { status: "RUNNING", pid: child.pid, ipAddress: currentIp, cpuUsage: 0, memoryUsage: 0 },
    });
    startMonitoring(serverId, child.pid);

    const logStream = fs.createWriteStream(logFile, { flags: "a" });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);
    child.on("exit", (code, signal) => handleProcessExit(serverId, code, signal, baseDir));

  } else {
    throw new Error(`Local runner is not supported yet for game: ${game}`);
  }
}

// Clean up database on process exit — with crash detection & auto-restart
async function handleProcessExit(serverId: string, code: number | null, signal: string | null, baseDir: string) {
  localProcesses.delete(serverId);
  stopMonitoring(serverId);

  const wasIntentional = intentionalStops.has(serverId);
  intentionalStops.delete(serverId);

  const isCrash = !wasIntentional && code !== null && code !== 0;

  try {
    const serverRec = await prisma.server.findUnique({ where: { id: serverId } });
    if (!serverRec) return;

    if (isCrash) {
      // Check crash counter
      const now = Date.now();
      let counter = crashCounters.get(serverId);
      if (!counter || (now - counter.windowStart) > CRASH_WINDOW_MS) {
        counter = { count: 0, windowStart: now };
      }
      counter.count++;
      crashCounters.set(serverId, counter);

      appendLog(baseDir, `[Crash Detection] Server crashed with exit code ${code} (Attempt ${counter.count}/${CRASH_MAX_RETRIES})`);

      await prisma.activityLog.create({
        data: {
          userId: serverRec.userId,
          action: "STOP_SERVER",
          details: `Server '${serverRec.name}' (${serverRec.game}) CRASHED (Code: ${code}). Auto-restart attempt ${counter.count}/${CRASH_MAX_RETRIES}.`,
        }
      });

      if (counter.count < CRASH_MAX_RETRIES) {
        appendLog(baseDir, `[Crash Detection] Auto-restarting in 5 seconds...`);
        await prisma.server.update({
          where: { id: serverId },
          data: { status: "STARTING", pid: null, cpuUsage: 0, memoryUsage: 0 },
        });

        setTimeout(async () => {
          try {
            clearStatsHistory(serverId);
            await startLocalServer(serverId, serverRec.game, serverRec.ramAllocation);
          } catch (restartErr: any) {
            appendLog(baseDir, `[Crash Detection] Auto-restart failed: ${restartErr.message}`);
            await prisma.server.update({
              where: { id: serverId },
              data: { status: "CRASHED", pid: null, cpuUsage: 0, memoryUsage: 0 },
            }).catch(() => {});
          }
        }, 5000);
        return;
      } else {
        appendLog(baseDir, `[Crash Detection] Max retries (${CRASH_MAX_RETRIES}) exhausted. Marking server as CRASHED.`);
        await prisma.server.update({
          where: { id: serverId },
          data: { status: "CRASHED", pid: null, ipAddress: "127.0.0.1", cpuUsage: 0, memoryUsage: 0 },
        });
        return;
      }
    }

    // Normal (intentional or clean) exit
    await prisma.server.update({
      where: { id: serverId },
      data: { 
        status: "STOPPED",
        pid: null,
        ipAddress: "127.0.0.1",
        cpuUsage: 0,
        memoryUsage: 0
      },
    });

    await prisma.activityLog.create({
      data: {
        userId: serverRec.userId,
        action: "STOP_SERVER",
        details: `Local server '${serverRec.name}' (${serverRec.game}) exited (Code: ${code}, Signal: ${signal}).`,
      }
    });
  } catch (e) {
    console.error("Error updating DB on local process exit:", e);
  }
  appendLog(baseDir, `Process exited with code ${code} and signal ${signal}`);
}

// Main: Stop local game server gracefully
export async function stopLocalServer(serverId: string): Promise<void> {
  const child = localProcesses.get(serverId);
  const serverDir = path.join(process.cwd(), "local-servers", serverId);
  const server = await prisma.server.findUnique({ where: { id: serverId } });

  // Mark as intentional stop so crash detection doesn't trigger
  intentionalStops.add(serverId);
  // Reset crash counter on intentional stop
  crashCounters.delete(serverId);

  if (server && (server.enableUpnp || server.runnerType === "LOCAL")) {
    appendLog(serverDir, "[UPnP] Releasing router port mappings...");
    try {
      if (server.game.toUpperCase() === "MINECRAFT") {
        await unmapPort(25565, "TCP");
        await unmapPort(25565, "UDP");
      } else if (server.game.toUpperCase() === "VALHEIM") {
        await unmapPort(2456, "UDP");
        await unmapPort(2457, "UDP");
        await unmapPort(2458, "UDP");
      } else if (server.game.toUpperCase() === "ENSHROUDED") {
        await unmapPort(15636, "TCP");
        await unmapPort(15636, "UDP");
        await unmapPort(15637, "TCP");
        await unmapPort(15637, "UDP");
      } else if (server.game.toUpperCase() === "ZOMBOID") {
        await unmapPort(16261, "UDP");
        await unmapPort(16262, "UDP");
        await unmapPort(8766, "UDP");
      } else if (server.game.toUpperCase() === "ARK") {
        await unmapPort(7777, "UDP");
        await unmapPort(7778, "UDP");
        await unmapPort(27015, "UDP");
      } else if (server.game.toUpperCase() === "TERRARIA") {
        await unmapPort(7777, "TCP");
        await unmapPort(7777, "UDP");
      } else if (server.game.toUpperCase() === "PALWORLD") {
        await unmapPort(8211, "UDP");
      } else if (server.game.toUpperCase() === "RUST") {
        await unmapPort(28015, "UDP");
        await unmapPort(28016, "TCP");
      }
    } catch (e: any) {
      appendLog(serverDir, `[UPnP Error] Failed to release port forwarding: ${e.message}`);
    }
  }

  if (child) {
    appendLog(serverDir, "Termination request received. Terminating process tree...");

    if (server && server.game.toUpperCase() === "MINECRAFT") {
      // Minecraft graceful console stop
      try {
        child.stdin.write("stop\n");
      } catch (e) {
        child.kill("SIGTERM");
      }
    } else {
      // Valheim process tree kill
      exec(`taskkill /F /T /PID ${child.pid}`, (err) => {
        if (err) child.kill("SIGKILL");
      });
    }

    const timeout = setTimeout(() => {
      if (localProcesses.has(serverId)) {
        appendLog(serverDir, "Shutdown timed out. Force killing process...");
        child.kill("SIGKILL");
        // Force kill sub-processes on Windows
        exec(`taskkill /F /T /PID ${child.pid}`, () => {});
      }
    }, 7000);

    await new Promise<void>((resolve) => {
      child.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  } else {
    await prisma.server.update({
      where: { id: serverId },
      data: { 
        status: "STOPPED", 
        pid: null, 
        ipAddress: "127.0.0.1", 
        cpuUsage: 0, 
        memoryUsage: 0 
      }
    });
  }
}

// Reads tail logs of local server
export function getLocalServerLogs(serverId: string): string {
  const logFile = path.join(process.cwd(), "local-servers", serverId, "server.log");
  if (!fs.existsSync(logFile)) {
    return "No logs available. Start the server to generate logs.";
  }

  const content = fs.readFileSync(logFile, "utf-8");
  const lines = content.split("\n");
  return lines.slice(-150).join("\n");
}

// Update a game server via SteamCMD (re-runs app_update)
export async function updateGameServer(serverId: string): Promise<void> {
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server) throw new Error("Server not found");

  const steamInfo = getGameSteamInfo(server.game);
  if (!steamInfo) throw new Error(`No SteamCMD info for game: ${server.game}`);

  const baseDir = path.join(process.cwd(), "local-servers", serverId);
  const installDir = path.join(baseDir, steamInfo.installSubDir);
  const logWriter = (msg: string) => appendLog(baseDir, msg);

  try {
    await prisma.server.update({
      where: { id: serverId },
      data: { status: "UPDATING" },
    });

    logWriter(`[Update] Starting SteamCMD update for ${server.game} (App ID: ${steamInfo.appId})...`);

    const steamcmdExe = await setupSteamCMD(logWriter);
    await ensureSteamCmdUpdated(steamcmdExe, logWriter);

    const cleanInstallDir = installDir.replace(/\\/g, "/");

    await new Promise<void>((resolve, reject) => {
      // +app_info_update 1 forces a metadata cache refresh before app_update — without it a
      // cold SteamCMD cache yields "Missing configuration" (exit code 8).
      const child = spawn(steamcmdExe, [
        "+force_install_dir", cleanInstallDir,
        "+login", "anonymous",
        "+app_info_update", "1",
        "+app_update", steamInfo.appId,
        "validate",
        "+quit"
      ]);

      let steamErrorDetail = "";
      child.stdout.on("data", (data) => {
        const line = data.toString().trim();
        if (line) {
          const cleanLine = line.replace(/[\r\n]+/g, " ");
          if (/ERROR!|Failed to install|No subscription|Invalid Password|Disk write failure/i.test(cleanLine)) {
            steamErrorDetail = cleanLine;
            logWriter(`[Update Error] ${cleanLine}`);
          } else if (cleanLine.includes("progress") || cleanLine.includes("Downloading") || cleanLine.includes("Update state") || cleanLine.includes("Success")) {
            logWriter(`[Update Status] ${cleanLine}`);
          }
        }
      });

      child.stderr.on("data", (data) => {
        const line = data.toString().trim();
        if (line) {
          steamErrorDetail = line.replace(/[\r\n]+/g, " ");
          logWriter(`[Update Warning] ${line}`);
        }
      });

      child.on("close", (code) => {
        if (code === 0) {
          logWriter(`[Update] ${server.game} update completed successfully!`);
          resolve();
        } else {
          const detail = steamErrorDetail ? ` - ${steamErrorDetail}` : " (see steamcmd/logs/console_log.txt for details)";
          reject(new Error(`SteamCMD update exited with code ${code}${detail}`));
        }
      });
    });

    await prisma.server.update({
      where: { id: serverId },
      data: { status: "STOPPED" },
    });

    await prisma.activityLog.create({
      data: {
        userId: server.userId,
        action: "RESTORE_SERVER",
        details: `Updated ${server.game} server '${server.name}' via SteamCMD.`,
      },
    });
  } catch (err: any) {
    logWriter(`[Update] Update failed: ${err.message}`);
    await prisma.server.update({
      where: { id: serverId },
      data: { status: "STOPPED" },
    }).catch(() => {});
    throw err;
  }
}
