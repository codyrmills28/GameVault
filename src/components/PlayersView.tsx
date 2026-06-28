"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import {
  UserCog,
  Plus,
  Ban,
  ShieldCheck,
  Trash2,
  X,
  ChevronRight,
  Clock,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Loader2,
  LogOut,
  LayoutDashboard,
  History,
} from "lucide-react";
import { DASHBOARD_NAV_LINKS } from "@/components/dashboardNavLinks";
import { useModal } from "@/components/ModalProvider";
import { useToast } from "@/components/ToastProvider";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BanRow {
  id: string;
  reason: string;
  expiresAt: string | null;
  active: boolean;
}

interface WhitelistRow {
  id: string;
  serverId: string | null;
  all: boolean;
}

interface PlayerRow {
  id: string;
  displayName: string;
  status: string;
  steamId: string | null;
  xboxId: string | null;
  minecraftUuid: string | null;
  minecraftName: string | null;
  discordId: string | null;
  notes: string | null;
  bans: BanRow[];
  whitelists: WhitelistRow[];
}

interface ServerRow {
  id: string;
  name: string;
  game: string;
}

interface EnforcementRow {
  serverId: string;
  type: string;
  status: "APPLIED" | "PENDING" | "UNSUPPORTED" | "FAILED";
  detail: string | null;
}

interface DetailData {
  player: PlayerRow & { events: any[] };
  enforcement: EnforcementRow[];
}

// ─── Badge helpers ─────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const color =
    status === "BANNED"
      ? "bg-red-500"
      : status === "TRUSTED"
      ? "bg-emerald-500"
      : "bg-slate-500";
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${color}`} />;
}

function EnforcementBadge({ status }: { status: string }) {
  switch (status) {
    case "APPLIED":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3" />
          Applied
        </span>
      );
    case "PENDING":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30">
          <Clock className="w-3 h-3" />
          Pending
        </span>
      );
    case "UNSUPPORTED":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-500/20 text-slate-400 border border-slate-500/30">
          <HelpCircle className="w-3 h-3" />
          Unsupported
        </span>
      );
    case "FAILED":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/30">
          <XCircle className="w-3 h-3" />
          Failed
        </span>
      );
    default:
      return <span className="text-xs text-slate-500">{status}</span>;
  }
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "BANNED"
      ? "bg-red-500/20 text-red-400 border-red-500/30"
      : status === "TRUSTED"
      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
      : "bg-slate-500/20 text-slate-400 border-slate-500/30";
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${cls}`}>
      {status}
    </span>
  );
}

// ─── Inline Modal Overlay ──────────────────────────────────────────────────────

function ModalOverlay({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md glass-panel rounded-2xl border border-accentPurple/30 box-glow-purple p-6 shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-extrabold text-white text-lg">{title}</h3>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Sidebar Nav (reused across dashboard views) ───────────────────────────────

function Sidebar({ userName }: { userName: string }) {
  return (
    <aside className="w-64 border-r border-borderDark bg-[#0a0c12] flex flex-col justify-between hidden md:flex flex-shrink-0">
      <div>
        <div className="p-6 border-b border-borderDark flex items-center gap-2">
          <img
            src="/logo.png"
            alt="RealmSwap"
            className="h-8 w-auto scale-[7] origin-left -translate-x-16 translate-y-2 pointer-events-none select-none"
          />
        </div>
        <nav className="p-4 space-y-1">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-white/5 text-slate-300 hover:text-white transition-all"
          >
            <LayoutDashboard className="w-4 h-4 text-slate-500" />
            <span>Dashboard</span>
          </Link>
          <div className="pt-4 pb-2 px-3">
            <span className="text-[10px] font-bold text-mutedText uppercase tracking-wider">Features</span>
          </div>
          {DASHBOARD_NAV_LINKS.map((link, i) => {
            const active = link.href === "/dashboard/players";
            return (
              <Link
                key={i}
                href={link.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all group ${
                  active
                    ? "bg-accentPurple/10 text-white border border-accentPurple/20"
                    : "hover:bg-white/5 text-slate-400 hover:text-white"
                }`}
              >
                <link.icon
                  className={`w-4 h-4 ${
                    active ? "text-accentPurple" : "text-slate-500 group-hover:text-white transition-colors"
                  }`}
                />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="p-4 border-t border-borderDark bg-slate-950/40">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1 pr-2">
            <span className="font-bold text-sm block truncate text-slate-200">{userName}</span>
          </div>
          <Link
            href="/login"
            className="p-2 hover:bg-white/5 text-slate-400 hover:text-red-400 rounded-lg transition-colors flex-shrink-0"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </aside>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function PlayersView({
  initialPlayers,
  servers,
  userName,
}: {
  initialPlayers: PlayerRow[];
  servers: ServerRow[];
  userName: string;
}) {
  const [players, setPlayers] = useState<PlayerRow[]>(initialPlayers);
  const [focusedId, setFocusedId] = useState<string | null>(initialPlayers[0]?.id ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Modal states
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [showBanModal, setShowBanModal] = useState(false);
  const [showWhitelistModal, setShowWhitelistModal] = useState(false);

  // Form state — Add Player
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newSteamId, setNewSteamId] = useState("");
  const [newXboxId, setNewXboxId] = useState("");
  const [newMinecraftUuid, setNewMinecraftUuid] = useState("");
  const [newMinecraftName, setNewMinecraftName] = useState("");
  const [newDiscordId, setNewDiscordId] = useState("");
  const [newNotes, setNewNotes] = useState("");

  // Form state — Ban
  const [banReason, setBanReason] = useState("");
  const [banDuration, setBanDuration] = useState("permanent");
  const [banCustomDays, setBanCustomDays] = useState("7");

  // Form state — Whitelist
  const [whitelistAll, setWhitelistAll] = useState(false);
  const [whitelistServerIds, setWhitelistServerIds] = useState<Set<string>>(new Set());

  // Submitting guard
  const [submitting, setSubmitting] = useState(false);

  const { showModal } = useModal();
  const { addToast } = useToast();

  // ── Data refresh ─────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    const res = await fetch("/api/players");
    if (res.ok) {
      const data = await res.json();
      setPlayers(data.players);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/players/${id}`);
      if (res.ok) {
        setDetail(await res.json());
      }
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (focusedId) {
      loadDetail(focusedId);
    } else {
      setDetail(null);
    }
  }, [focusedId, loadDetail]);

  // ── Core mutate helper ────────────────────────────────────────────────────

  async function mutate(url: string, method: string, body?: object): Promise<boolean> {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      addToast("error", json.error || "Action failed");
      return false;
    }
    await refresh();
    if (focusedId) await loadDetail(focusedId);
    return true;
  }

  // ── Selection helpers ─────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === players.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(players.map((p) => p.id)));
    }
  }

  // ── Bulk actions ──────────────────────────────────────────────────────────

  async function bulkAction(action: "ban" | "whitelist" | "delete") {
    const playerIds = Array.from(selected);
    if (playerIds.length === 0) return;

    if (action === "delete") {
      showModal({
        type: "error",
        title: "Delete Players",
        message: `Permanently delete ${playerIds.length} player(s)? This cannot be undone.`,
        confirmText: "Delete",
        cancelText: "Cancel",
        onConfirm: async () => {
          const ok = await mutate("/api/players/bulk", "POST", { playerIds, action });
          if (ok) {
            setSelected(new Set());
            if (focusedId && playerIds.includes(focusedId)) setFocusedId(null);
            addToast("success", `Deleted ${playerIds.length} player(s)`);
          }
        },
      });
    } else if (action === "ban") {
      showModal({
        type: "warning",
        title: "Bulk Ban",
        message: `Ban ${playerIds.length} player(s)? They will be banned with reason "Bulk ban".`,
        confirmText: "Ban All",
        cancelText: "Cancel",
        onConfirm: async () => {
          const ok = await mutate("/api/players/bulk", "POST", {
            playerIds,
            action,
            reason: "Bulk ban",
          });
          if (ok) {
            setSelected(new Set());
            addToast("success", `Banned ${playerIds.length} player(s)`);
          }
        },
      });
    } else if (action === "whitelist") {
      showModal({
        type: "info",
        title: "Bulk Whitelist",
        message: `Whitelist ${playerIds.length} player(s) on all servers?`,
        confirmText: "Whitelist All",
        cancelText: "Cancel",
        onConfirm: async () => {
          const ok = await mutate("/api/players/bulk", "POST", {
            playerIds,
            action,
            all: true,
          });
          if (ok) {
            setSelected(new Set());
            addToast("success", `Whitelisted ${playerIds.length} player(s)`);
          }
        },
      });
    }
  }

  // ── Add Player submit ─────────────────────────────────────────────────────

  async function handleAddPlayer(e: React.FormEvent) {
    e.preventDefault();
    if (!newDisplayName.trim()) return;
    setSubmitting(true);
    const body: Record<string, string> = { displayName: newDisplayName.trim() };
    if (newSteamId.trim()) body.steamId = newSteamId.trim();
    if (newXboxId.trim()) body.xboxId = newXboxId.trim();
    if (newMinecraftUuid.trim()) body.minecraftUuid = newMinecraftUuid.trim();
    if (newMinecraftName.trim()) body.minecraftName = newMinecraftName.trim();
    if (newDiscordId.trim()) body.discordId = newDiscordId.trim();
    if (newNotes.trim()) body.notes = newNotes.trim();
    const res = await fetch("/api/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSubmitting(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      addToast("error", json.error || "Failed to create player");
      return;
    }
    const data = await res.json();
    addToast("success", `Player "${newDisplayName.trim()}" created`);
    setShowAddPlayer(false);
    setNewDisplayName("");
    setNewSteamId("");
    setNewXboxId("");
    setNewMinecraftUuid("");
    setNewMinecraftName("");
    setNewDiscordId("");
    setNewNotes("");
    await refresh();
    setFocusedId(data.player?.id ?? null);
  }

  // ── Ban submit ────────────────────────────────────────────────────────────

  async function handleBan(e: React.FormEvent) {
    e.preventDefault();
    if (!focusedId) return;
    setSubmitting(true);
    let expiresAt: string | undefined;
    if (banDuration !== "permanent") {
      const days = banDuration === "custom" ? Number(banCustomDays) : Number(banDuration);
      const d = new Date();
      d.setDate(d.getDate() + days);
      expiresAt = d.toISOString();
    }
    const body: Record<string, string> = { reason: banReason.trim() || "No reason provided" };
    if (expiresAt) body.expiresAt = expiresAt;
    const ok = await mutate(`/api/players/${focusedId}/ban`, "POST", body);
    setSubmitting(false);
    if (ok) {
      addToast("success", "Player banned");
      setShowBanModal(false);
      setBanReason("");
      setBanDuration("permanent");
    }
  }

  // ── Unban ─────────────────────────────────────────────────────────────────

  function handleUnban() {
    if (!focusedId) return;
    showModal({
      type: "warning",
      title: "Unban Player",
      message: `Remove the active ban for ${detail?.player.displayName}?`,
      confirmText: "Unban",
      cancelText: "Cancel",
      onConfirm: async () => {
        const ok = await mutate(`/api/players/${focusedId}/ban`, "DELETE");
        if (ok) addToast("success", "Player unbanned");
      },
    });
  }

  // ── Whitelist submit ──────────────────────────────────────────────────────

  async function handleWhitelist(e: React.FormEvent) {
    e.preventDefault();
    if (!focusedId) return;
    setSubmitting(true);
    const body = whitelistAll
      ? { all: true }
      : { serverIds: Array.from(whitelistServerIds) };
    const ok = await mutate(`/api/players/${focusedId}/whitelist`, "POST", body);
    setSubmitting(false);
    if (ok) {
      addToast("success", "Whitelist updated");
      setShowWhitelistModal(false);
      setWhitelistAll(false);
      setWhitelistServerIds(new Set());
    }
  }

  // ── Revoke whitelist ──────────────────────────────────────────────────────

  function handleRevokeWhitelist() {
    if (!focusedId) return;
    showModal({
      type: "error",
      title: "Revoke Whitelist",
      message: `Remove all whitelist entries for ${detail?.player.displayName}?`,
      confirmText: "Revoke",
      cancelText: "Cancel",
      onConfirm: async () => {
        const ok = await mutate(`/api/players/${focusedId}/whitelist`, "DELETE");
        if (ok) addToast("success", "Whitelist revoked");
      },
    });
  }

  // ── Delete player ─────────────────────────────────────────────────────────

  function handleDeletePlayer() {
    if (!focusedId) return;
    showModal({
      type: "error",
      title: "Delete Player",
      message: `Permanently delete "${detail?.player.displayName}"? This cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: async () => {
        const ok = await mutate(`/api/players/${focusedId}`, "DELETE");
        if (ok) {
          addToast("success", "Player deleted");
          setFocusedId(players.find((p) => p.id !== focusedId)?.id ?? null);
        }
      },
    });
  }

  // ── Whitelist server toggle ───────────────────────────────────────────────

  function toggleWhitelistServer(id: string) {
    setWhitelistServerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Focused player (from list or detail) ─────────────────────────────────

  const focusedPlayer = players.find((p) => p.id === focusedId) ?? null;
  const activeBan = detail?.player.bans.find((b) => b.active) ?? focusedPlayer?.bans?.[0] ?? null;
  const hasWhitelist = (detail?.player.whitelists ?? focusedPlayer?.whitelists ?? []).length > 0;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex bg-background text-slate-100 font-sans">
      <Sidebar userName={userName} />

      <main className="flex-1 overflow-y-auto px-6 py-8 min-w-0">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-2">
              <UserCog className="w-6 h-6 text-accentPurple" />
              <span>Player Management</span>
            </h1>
            <p className="text-sm text-mutedText mt-1">
              Manage cross-server player bans, whitelists, and identities.
            </p>
          </div>
          <button
            onClick={() => setShowAddPlayer(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accentPurple hover:bg-accentPurpleHover text-white text-sm font-bold transition-colors shadow-lg"
          >
            <Plus className="w-4 h-4" />
            Add Player
          </button>
        </div>

        {/* Bulk Action Bar */}
        {selected.size > 0 && (
          <div className="mb-4 flex items-center gap-3 p-3 rounded-xl bg-accentPurple/10 border border-accentPurple/20 animate-slide-down">
            <span className="text-xs font-bold text-slate-300">{selected.size} selected</span>
            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => bulkAction("ban")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold transition-colors border border-red-500/30"
              >
                <Ban className="w-3.5 h-3.5" />
                Ban
              </button>
              <button
                onClick={() => bulkAction("whitelist")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-bold transition-colors border border-emerald-500/30"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Whitelist
              </button>
              <button
                onClick={() => bulkAction("delete")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 text-xs font-bold transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </div>
          </div>
        )}

        {/* Master / Detail layout */}
        <div className="flex gap-4 h-[calc(100vh-200px)] min-h-[500px]">
          {/* ── Master List ─────────────────────────────────────────────── */}
          <div className="w-72 flex-shrink-0 glass-panel rounded-2xl border border-white/5 flex flex-col overflow-hidden">
            <div className="p-3 border-b border-white/5 flex items-center gap-2">
              <input
                type="checkbox"
                checked={players.length > 0 && selected.size === players.length}
                onChange={toggleSelectAll}
                className="rounded border-white/20 bg-slate-900 accent-accentPurple cursor-pointer"
              />
              <span className="text-[10px] font-bold text-mutedText uppercase tracking-wider">
                {players.length} Player{players.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-white/5">
              {players.length === 0 ? (
                <div className="p-6 text-center text-xs text-mutedText">
                  No players yet. Click "Add Player" to create one.
                </div>
              ) : (
                players.map((player) => (
                  <button
                    key={player.id}
                    onClick={() => setFocusedId(player.id)}
                    className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-colors group ${
                      focusedId === player.id
                        ? "bg-accentPurple/10 border-l-2 border-accentPurple"
                        : "hover:bg-white/[0.03]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(player.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleSelect(player.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border-white/20 bg-slate-900 accent-accentPurple cursor-pointer flex-shrink-0"
                    />
                    <StatusDot status={player.status} />
                    <span
                      className={`text-sm font-semibold truncate flex-1 ${
                        focusedId === player.id ? "text-white" : "text-slate-300"
                      }`}
                    >
                      {player.displayName}
                    </span>
                    <ChevronRight
                      className={`w-3.5 h-3.5 flex-shrink-0 ${
                        focusedId === player.id ? "text-accentPurple" : "text-slate-600"
                      }`}
                    />
                  </button>
                ))
              )}
            </div>
          </div>

          {/* ── Detail Panel ────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto space-y-4">
            {!focusedPlayer ? (
              <div className="glass-panel rounded-2xl border border-white/5 p-8 text-center">
                <UserCog className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <span className="font-bold text-sm block text-slate-400">No player selected</span>
                <p className="text-xs text-mutedText mt-1">
                  Select a player from the list to view details.
                </p>
              </div>
            ) : (
              <>
                {/* Player Header */}
                <div className="glass-panel rounded-2xl border border-white/5 p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                        {focusedPlayer.displayName}
                        <StatusBadge status={focusedPlayer.status} />
                      </h2>
                      <p className="text-xs text-mutedText mt-0.5">Player ID: {focusedPlayer.id}</p>
                    </div>
                    <div className="flex gap-2">
                      {activeBan ? (
                        <button
                          onClick={handleUnban}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-bold border border-emerald-500/30 transition-colors"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Unban
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setBanReason("");
                            setBanDuration("permanent");
                            setShowBanModal(true);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold border border-red-500/30 transition-colors"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          Ban
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setWhitelistAll(false);
                          setWhitelistServerIds(new Set());
                          setShowWhitelistModal(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 text-xs font-bold border border-blue-500/30 transition-colors"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Whitelist
                      </button>
                      {hasWhitelist && (
                        <button
                          onClick={handleRevokeWhitelist}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-amber-500/20 text-slate-400 hover:text-amber-400 text-xs font-bold transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                          Revoke WL
                        </button>
                      )}
                      <button
                        onClick={handleDeletePlayer}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 text-xs font-bold transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>

                {/* Identity Fields */}
                <div className="glass-panel rounded-2xl border border-white/5 p-5">
                  <h3 className="font-extrabold text-sm text-white mb-3 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-accentPurple" />
                    Identity
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {[
                      { label: "Steam ID", value: focusedPlayer.steamId },
                      { label: "Xbox ID", value: focusedPlayer.xboxId },
                      { label: "Minecraft UUID", value: focusedPlayer.minecraftUuid },
                      { label: "Minecraft Name", value: focusedPlayer.minecraftName },
                      { label: "Discord ID", value: focusedPlayer.discordId },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <span className="text-[10px] font-bold text-mutedText uppercase tracking-wider block mb-0.5">
                          {label}
                        </span>
                        <span className="text-slate-300 font-mono truncate block">
                          {value || <span className="text-slate-600 font-sans">—</span>}
                        </span>
                      </div>
                    ))}
                    {focusedPlayer.notes && (
                      <div className="col-span-2">
                        <span className="text-[10px] font-bold text-mutedText uppercase tracking-wider block mb-0.5">
                          Notes
                        </span>
                        <span className="text-slate-300">{focusedPlayer.notes}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Active Ban */}
                {activeBan && (
                  <div className="glass-panel rounded-2xl border border-red-500/20 p-5 bg-red-950/10">
                    <h3 className="font-extrabold text-sm text-red-400 mb-3 flex items-center gap-2">
                      <Ban className="w-4 h-4" />
                      Active Ban
                    </h3>
                    <div className="text-xs space-y-1">
                      <div>
                        <span className="text-mutedText font-bold">Reason: </span>
                        <span className="text-slate-300">{activeBan.reason}</span>
                      </div>
                      <div>
                        <span className="text-mutedText font-bold">Expires: </span>
                        <span className="text-slate-300">
                          {activeBan.expiresAt
                            ? new Date(activeBan.expiresAt).toLocaleString()
                            : "Never (permanent)"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Enforcement Matrix */}
                {loadingDetail ? (
                  <div className="glass-panel rounded-2xl border border-white/5 p-5 text-center">
                    <Loader2 className="w-5 h-5 text-accentPurple animate-spin mx-auto" />
                  </div>
                ) : detail && detail.enforcement.length > 0 ? (
                  <div className="glass-panel rounded-2xl border border-white/5 p-5">
                    <h3 className="font-extrabold text-sm text-white mb-3 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      Enforcement Status
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-950/30 text-mutedText font-bold uppercase border-b border-white/5">
                            <th className="p-2 text-left">Server</th>
                            <th className="p-2 text-left">Type</th>
                            <th className="p-2 text-left">Status</th>
                            <th className="p-2 text-left">Detail</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {detail.enforcement.map((row, i) => {
                            const srv = servers.find((s) => s.id === row.serverId);
                            return (
                              <tr key={i} className="hover:bg-white/[0.02]">
                                <td className="p-2 font-semibold text-slate-300">
                                  {srv ? srv.name : row.serverId}
                                </td>
                                <td className="p-2 text-mutedText uppercase">{row.type}</td>
                                <td className="p-2">
                                  <EnforcementBadge status={row.status} />
                                </td>
                                <td className="p-2 text-mutedText truncate max-w-[200px]">
                                  {row.detail || "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {/* Events History */}
                {detail && detail.player.events && detail.player.events.length > 0 && (
                  <div className="glass-panel rounded-2xl border border-white/5 p-5">
                    <h3 className="font-extrabold text-sm text-white mb-3 flex items-center gap-2">
                      <History className="w-4 h-4 text-accentPurple" />
                      Event History
                    </h3>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {detail.player.events.map((ev: any, i: number) => (
                        <div
                          key={ev.id ?? i}
                          className="flex items-start gap-3 text-xs py-2 border-b border-white/5 last:border-0"
                        >
                          <Clock className="w-3.5 h-3.5 text-mutedText flex-shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <span className="font-semibold text-slate-300 capitalize">
                              {ev.type?.toLowerCase().replace(/_/g, " ")}
                            </span>
                            {ev.description && (
                              <p className="text-mutedText truncate">{ev.description}</p>
                            )}
                            <p className="text-slate-600 text-[10px]">
                              {ev.createdAt ? new Date(ev.createdAt).toLocaleString() : ""}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      {/* ── Add Player Modal ──────────────────────────────────────────────── */}
      {showAddPlayer && (
        <ModalOverlay title="Add Player" onClose={() => setShowAddPlayer(false)}>
          <form onSubmit={handleAddPlayer} className="space-y-3">
            <div>
              <label className="text-[10px] font-bold text-mutedText uppercase tracking-wider block mb-1">
                Display Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder="e.g. Steve"
                required
                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-white/10 text-slate-200 outline-none focus:border-accentPurple transition-colors"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-mutedText uppercase tracking-wider block mb-1">Steam ID</label>
                <input
                  type="text"
                  value={newSteamId}
                  onChange={(e) => setNewSteamId(e.target.value)}
                  placeholder="76561198..."
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-white/10 text-slate-200 outline-none focus:border-accentPurple transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-mutedText uppercase tracking-wider block mb-1">Xbox ID</label>
                <input
                  type="text"
                  value={newXboxId}
                  onChange={(e) => setNewXboxId(e.target.value)}
                  placeholder="Gamertag..."
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-white/10 text-slate-200 outline-none focus:border-accentPurple transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-mutedText uppercase tracking-wider block mb-1">Minecraft UUID</label>
                <input
                  type="text"
                  value={newMinecraftUuid}
                  onChange={(e) => setNewMinecraftUuid(e.target.value)}
                  placeholder="xxxxxxxx-xxxx..."
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-white/10 text-slate-200 outline-none focus:border-accentPurple transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-mutedText uppercase tracking-wider block mb-1">Minecraft Name</label>
                <input
                  type="text"
                  value={newMinecraftName}
                  onChange={(e) => setNewMinecraftName(e.target.value)}
                  placeholder="Username..."
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-white/10 text-slate-200 outline-none focus:border-accentPurple transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-mutedText uppercase tracking-wider block mb-1">Discord ID</label>
                <input
                  type="text"
                  value={newDiscordId}
                  onChange={(e) => setNewDiscordId(e.target.value)}
                  placeholder="123456789..."
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-white/10 text-slate-200 outline-none focus:border-accentPurple transition-colors"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-mutedText uppercase tracking-wider block mb-1">Notes</label>
              <textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Optional notes..."
                rows={2}
                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-white/10 text-slate-200 outline-none focus:border-accentPurple transition-colors resize-none"
              />
            </div>
            <div className="flex justify-end gap-3 pt-3 border-t border-white/5">
              <button
                type="button"
                onClick={() => setShowAddPlayer(false)}
                className="px-4 py-2 rounded-lg bg-transparent hover:bg-white/5 text-sm font-bold text-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !newDisplayName.trim()}
                className="px-6 py-2 rounded-lg bg-accentPurple hover:bg-accentPurpleHover disabled:opacity-50 disabled:cursor-not-allowed text-sm font-bold text-white transition-colors flex items-center gap-1.5"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create Player
              </button>
            </div>
          </form>
        </ModalOverlay>
      )}

      {/* ── Ban Modal ─────────────────────────────────────────────────────── */}
      {showBanModal && (
        <ModalOverlay
          title={`Ban ${focusedPlayer?.displayName ?? "Player"}`}
          onClose={() => setShowBanModal(false)}
        >
          <form onSubmit={handleBan} className="space-y-3">
            <div>
              <label className="text-[10px] font-bold text-mutedText uppercase tracking-wider block mb-1">
                Reason
              </label>
              <input
                type="text"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="No reason provided"
                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-white/10 text-slate-200 outline-none focus:border-accentPurple transition-colors"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-mutedText uppercase tracking-wider block mb-1">
                Duration
              </label>
              <select
                value={banDuration}
                onChange={(e) => setBanDuration(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-white/10 text-slate-200 outline-none focus:border-accentPurple transition-colors cursor-pointer font-bold"
              >
                <option value="permanent">Permanent</option>
                <option value="1">1 Day</option>
                <option value="7">7 Days</option>
                <option value="30">30 Days</option>
                <option value="custom">Custom (days)</option>
              </select>
            </div>
            {banDuration === "custom" && (
              <div>
                <label className="text-[10px] font-bold text-mutedText uppercase tracking-wider block mb-1">
                  Days
                </label>
                <input
                  type="number"
                  min="1"
                  value={banCustomDays}
                  onChange={(e) => setBanCustomDays(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-white/10 text-slate-200 outline-none focus:border-accentPurple transition-colors"
                />
              </div>
            )}
            <div className="flex justify-end gap-3 pt-3 border-t border-white/5">
              <button
                type="button"
                onClick={() => setShowBanModal(false)}
                className="px-4 py-2 rounded-lg bg-transparent hover:bg-white/5 text-sm font-bold text-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-bold text-white transition-colors shadow-lg shadow-red-500/20 flex items-center gap-1.5"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Ban Player
              </button>
            </div>
          </form>
        </ModalOverlay>
      )}

      {/* ── Whitelist Modal ───────────────────────────────────────────────── */}
      {showWhitelistModal && (
        <ModalOverlay
          title={`Whitelist ${focusedPlayer?.displayName ?? "Player"}`}
          onClose={() => setShowWhitelistModal(false)}
        >
          <form onSubmit={handleWhitelist} className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={whitelistAll}
                onChange={(e) => setWhitelistAll(e.target.checked)}
                className="rounded border-white/20 bg-slate-900 accent-accentPurple"
              />
              <span className="text-sm font-semibold text-slate-300">All servers (global whitelist)</span>
            </label>
            {!whitelistAll && servers.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                <span className="text-[10px] font-bold text-mutedText uppercase tracking-wider block mb-1">
                  Select Servers
                </span>
                {servers.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer select-none py-1">
                    <input
                      type="checkbox"
                      checked={whitelistServerIds.has(s.id)}
                      onChange={() => toggleWhitelistServer(s.id)}
                      className="rounded border-white/20 bg-slate-900 accent-accentPurple"
                    />
                    <span className="text-xs text-slate-300">
                      {s.name}{" "}
                      <span className="text-mutedText">({s.game})</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {!whitelistAll && servers.length === 0 && (
              <p className="text-xs text-mutedText">No servers found. Use "All servers" or add a server first.</p>
            )}
            <div className="flex justify-end gap-3 pt-3 border-t border-white/5">
              <button
                type="button"
                onClick={() => setShowWhitelistModal(false)}
                className="px-4 py-2 rounded-lg bg-transparent hover:bg-white/5 text-sm font-bold text-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || (!whitelistAll && whitelistServerIds.size === 0)}
                className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-bold text-white transition-colors shadow-lg shadow-emerald-500/20 flex items-center gap-1.5"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Apply Whitelist
              </button>
            </div>
          </form>
        </ModalOverlay>
      )}
    </div>
  );
}
