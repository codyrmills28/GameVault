"use client";

import React from "react";
import Link from "next/link";
import { 
  Activity, 
  Wifi, 
  Save, 
  PlusCircle, 
  Terminal, 
  Settings, 
  Share2, 
  BadgeCent 
} from "lucide-react";

export function HealthSidebar({ 
  servers, 
  actions 
}: { 
  servers: any[],
  actions: any
}) {
  const isHealthy = servers.every(s => s.healthStatus !== "DEGRADED" && s.status !== "CRASHED");
  
  // Assume some active server to base quick actions on, or just first one
  const activeServer = servers.find(s => s.status === "RUNNING") || servers[0];

  return (
    <div className="w-80 shrink-0 flex flex-col gap-6">
      
      {/* Server Health Panel */}
      <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-[18px] shadow-xl overflow-hidden">
        <div className="p-4 border-b border-white/5 bg-slate-950/40">
          <h3 className="text-sm font-extrabold text-white tracking-wide">Server Health</h3>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-xl ${isHealthy ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-200">Performance</div>
              <div className="text-xs text-slate-400">{isHealthy ? 'Everything looks good' : 'Issues detected'}</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
              <Wifi className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-200">Network</div>
              <div className="text-xs text-slate-400">No routing issues</div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-accentPurple/10 text-accentPurple">
              <Save className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-200">Backups</div>
              <div className="text-xs text-slate-400">Vault configured</div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions Widget */}
      {activeServer && (
        <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-[18px] shadow-xl overflow-hidden">
          <div className="p-4 border-b border-white/5 bg-slate-950/40">
            <h3 className="text-sm font-extrabold text-white tracking-wide">Quick Actions</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">For {activeServer.name}</p>
          </div>
          <div className="p-2 grid grid-cols-2 gap-2">
            <button className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-white/5 transition-colors text-slate-400 hover:text-white">
              <PlusCircle className="w-5 h-5 text-emerald-400" />
              <span className="text-[10px] font-bold">Backup</span>
            </button>
            <Link href={`/dashboard/console?server=${activeServer.id}`} className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-white/5 transition-colors text-slate-400 hover:text-white text-center">
              <Terminal className="w-5 h-5 text-sky-400" />
              <span className="text-[10px] font-bold">Console</span>
            </Link>
            <Link href={`/dashboard/config?server=${activeServer.id}`} className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-white/5 transition-colors text-slate-400 hover:text-white text-center">
              <Settings className="w-5 h-5 text-amber-400" />
              <span className="text-[10px] font-bold">Settings</span>
            </Link>
            <button 
              onClick={() => {
                if (activeServer.inviteCode) {
                  navigator.clipboard.writeText(`realmsync://${activeServer.inviteCode}`);
                } else {
                  actions.handleGenerateInvite(activeServer.id);
                }
              }}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl hover:bg-white/5 transition-colors text-slate-400 hover:text-white"
            >
              <Share2 className="w-5 h-5 text-accentPurple" />
              <span className="text-[10px] font-bold">Invite</span>
            </button>
          </div>
        </div>
      )}

      {/* RealmSync Feature Card */}
      {activeServer && (
        <div className="relative overflow-hidden rounded-[18px] border border-accentPurple/30 bg-gradient-to-br from-slate-900 to-slate-950 shadow-[0_0_30px_rgba(167,139,250,0.15)] group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-accentPurple/20 blur-3xl rounded-full -translate-y-10 translate-x-10"></div>
          <div className="p-5 relative z-10">
            <div className="flex items-center gap-2 mb-3">
              <BadgeCent className="w-5 h-5 text-accentPurple" />
              <h3 className="font-extrabold text-white tracking-wide">RealmSync</h3>
            </div>
            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Share your server with friends. They can sync mods and join instantly using the companion app.
            </p>
            {activeServer.inviteCode ? (
              <div className="bg-black/40 rounded-xl p-3 border border-white/5 flex flex-col gap-2">
                <div className="text-[10px] text-accentPurple font-bold uppercase tracking-widest">Deep Link</div>
                <div className="font-mono text-xs text-slate-300 truncate select-all">realmsync://{activeServer.inviteCode}</div>
                <button
                  onClick={() => navigator.clipboard.writeText(`realmsync://${activeServer.inviteCode}`)}
                  className="mt-1 w-full py-2 bg-white/5 hover:bg-white/10 text-white text-xs font-bold rounded-lg transition-colors"
                >
                  Copy Link
                </button>
              </div>
            ) : (
              <button
                onClick={() => actions.handleGenerateInvite(activeServer.id)}
                className="w-full py-2.5 bg-accentPurple hover:bg-accentPurple/90 text-white font-bold text-xs rounded-xl transition-all shadow-lg shadow-accentPurple/25 hover:shadow-accentPurple/40"
              >
                Generate Link
              </button>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
