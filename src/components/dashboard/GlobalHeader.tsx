"use client";

import React from "react";
import { Search } from "lucide-react";

export function GlobalHeader() {
  return (
    <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-xl border-b border-white/5 h-16 flex items-center px-8 justify-between">
      <div className="flex-1 max-w-2xl">
        <div className="relative group">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
            <Search className="w-4 h-4 text-slate-500 group-focus-within:text-accentPurple transition-colors" />
          </div>
          <input
            type="text"
            placeholder="Search servers, worlds, logs..."
            className="w-full bg-slate-900/50 border border-white/10 rounded-xl pl-10 pr-16 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-accentPurple/50 focus:border-accentPurple/50 transition-all hover:bg-slate-900 shadow-inner"
          />
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <kbd className="inline-flex items-center px-2 py-0.5 rounded border border-white/10 bg-slate-800/50 text-[10px] font-medium text-slate-400">
              Ctrl K
            </kbd>
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        {/* Placeholder for future top-right actions like Notifications or Status */}
      </div>
    </header>
  );
}
