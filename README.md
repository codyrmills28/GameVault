# GameVault MVP

GameVault is a premium game server hosting platform centered on the **"Game History Vault"** differentiator: **One subscription, many game worlds.** 

Instead of paying for multiple servers that sit idle, users rent a set of "active server slots" (Starter: 1, Party: 2, Guild: 4). They can easily pause one game, compress it into the secure "Vault" (freeing up the active slot), and deploy another game world instantly, with the option to restore their old world weeks or months later.

This MVP also includes a fully functional **Local PC Runner (Free)** option which allows hosting Minecraft and Valheim servers directly on your own computer without using cloud slots.

---

## ⚡ Quick Start

Follow these steps to run the application locally.

### Prerequisites (For Local PC Runner)
- **For Minecraft:** You must have the **Java Runtime Environment (JRE) 17 or higher** installed and registered in your system PATH. Run `java -version` to check.
- **For Valheim:** No external software is required. The runner will automatically download SteamCMD and download Valheim dedicated server binaries for you.

### 1. Install Dependencies
```bash
npm install
```

### 2. Initialize and Seed Database
The MVP uses a file-backed SQLite database by default, requiring zero configuration or active database servers.
```bash
npx prisma db push
npx prisma db seed
```
This commands will:
- Generate the Prisma Client libraries in `src/generated/client` to avoid system EPERM file locking.
- Create a local SQLite database file at `prisma/dev.db`.
- Seed a demo account, active servers, vaulted world saves, and console logs.

### 3. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 🔑 Demo Credentials
- **Email:** `demo@gamevault.gg`
- **Password:** `password123`

---

## 💻 Local PC Runner Mechanics
When you deploy a game server using the **Local PC Runner** option and press **Start**:

### ⛏️ Minecraft:
1. **Binaries Cache:** The Node.js server creates a directory `local-servers/[serverId]` in the project root and downloads the official Mojang Vanilla Minecraft 1.20.4 `server.jar` (44MB) if it doesn't already exist.
2. **EULA & Properties:** The runner writes `eula.txt` agreeing to Mojang's terms and creates a custom `server.properties` file binding the game port to `25565` and turning online auth validation off for local network testing.
3. **Execution:** Node spawns the JRE process: `java -Xms512M -Xmx[Allocated]G -jar server.jar` and records the OS PID.
4. **Connectivity:** Connect to the running server by opening your Minecraft Client (version 1.20.4) and joining server address **`localhost:25565`**.

### ⛵ Valheim:
1. **SteamCMD Auto-Setup:** If SteamCMD is not found in the project root, the runner downloads `steamcmd.zip` and extracts it using Windows PowerShell `Expand-Archive` to a `steamcmd/` folder.
2. **Valheim Download:** The runner triggers SteamCMD as a child process to install the Valheim Dedicated Server (App ID `896660`) to `local-servers/[serverId]/valheim-server`. **Note: This is a ~2.5GB background download and logs live progress to the console log file.**
3. **Execution:** Once downloaded, it spawns `valheim_server.exe -nographics -batchmode -name [name] -port 2456 -world Dedicated -password viking123 -public 1` (default password is `viking123`).
4. **Shutdown:** Pressing **Stop** runs Windows `taskkill` to cleanly terminate the Valheim process and all its Unity subprocesses, preventing orphaned memory handles.
5. **Connectivity:** Open your Valheim game client, go to join server, type IP **`127.0.0.1:2456`**, and use password **`viking123`**.

---

## 📂 Project Structure

```text
GameVault/
├── prisma/
│   ├── schema.prisma   # SQLite-based Prisma Database Schema
│   ├── seed.js         # Seeding script for mock data
│   └── dev.db          # SQLite local database (created after db push)
├── src/
│   ├── generated/
│   │   └── client/     # Generated Prisma Client
│   ├── app/
│   │   ├── api/        # REST API Routes
│   │   │   ├── auth/   # JWT Authentication routes (login, register, logout, reset)
│   │   │   ├── servers/# Server lifecycle control (create, start, stop, restart, archive)
│   │   │   └── archives# Vault control (restore, delete)
│   │   ├── dashboard/  # Dashboard views (mods, backups, team, logs, billing placeholders)
│   │   ├── login/      # Sign-in Form
│   │   ├── register/   # Registration Form
│   │   ├── forgot-password/
│   │   ├── globals.css # Global stylesheet (custom scrollbars, grid, glows)
│   │   └── layout.tsx  # Root Layout HTML frame
│   ├── components/
│   │   ├── DashboardView.tsx    # Interactivity, stats, power actions, log polling modal
│   │   └── CreateServerView.tsx # Local/Cloud deployment option toggles, region selector
│   └── lib/
│       ├── auth.ts     # Password hashing, JWT cookie getters
│       ├── db.ts       # Global Prisma Client instance singleton
│       └── localRunner.ts # SteamCMD, JRE, Minecraft & Valheim spawner, and vault directories
├── steamcmd/           # Cached SteamCMD executable client (ignored/created at runtime)
├── local-servers/      # Holds directories of running local servers (ignored/created at runtime)
├── local-archives/     # Holds directories of vaulted local servers (ignored/created at runtime)
├── tailwind.config.js  # Gaming Obsidian/Purple/Cyan color scheme tokens
└── package.json        # Project scripts & package registry
```
