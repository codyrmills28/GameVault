"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { 
  Server as ServerIcon, 
  Archive, 
  Cpu, 
  Database, 
  ShieldAlert, 
  ShieldCheck, 
  Zap, 
  Layers, 
  RefreshCw, 
  Sparkles, 
  ChevronDown, 
  Globe, 
  Users, 
  Coins, 
  Terminal, 
  Check 
} from "lucide-react";

// Mock games data for the interactive widget
const GAMES_LIST = [
  { id: "mc", name: "Minecraft", icon: "⛏️", color: "from-green-500 to-emerald-700", text: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30", description: "Survival Server", ram: "4 GB", port: "25565", activeText: "Mining blocks since 2011" },
  { id: "vh", name: "Valheim", icon: "⛵", color: "from-amber-500 to-amber-700", text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", description: "Odin's Realm", ram: "6 GB", port: "2456", activeText: "Conquering the 10th Norse world" },
  { id: "pz", name: "Project Zomboid", icon: "🧟", color: "from-red-500 to-rose-700", text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", description: "Muldraugh Hideout", ram: "8 GB", port: "16261", activeText: "This is how you died." },
  { id: "ark", name: "ARK: Survival Evolved", icon: "🦖", color: "from-cyan-500 to-blue-700", text: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/30", description: "T-Rex Taming Base", ram: "12 GB", port: "7777", activeText: "Surviving on the ARK" }
];

export default function LandingPage() {
  const [activeGame, setActiveGame] = useState(GAMES_LIST[0]);
  const [vaultedGames, setVaultedGames] = useState(GAMES_LIST.slice(1));
  const [transitioning, setTransitioning] = useState(false);
  const [transitionStep, setTransitionStep] = useState(""); // "archiving" or "restoring"
  const [activeStatus, setActiveStatus] = useState("Online");

  const handleSwap = (selectedGameId: string) => {
    if (transitioning) return;
    setTransitioning(true);
    setTransitionStep("archiving");
    setActiveStatus("Vaulting...");

    // Find the chosen game
    const nextGame = GAMES_LIST.find(g => g.id === selectedGameId)!;

    // Step 1: Slide down active server into Vault
    setTimeout(() => {
      setTransitionStep("restoring");
      setActiveStatus("Restoring...");
      
      // Swap items in list
      setVaultedGames(prev => {
        const remaining = prev.filter(g => g.id !== selectedGameId);
        return [...remaining, activeGame];
      });
      setActiveGame(nextGame);

      // Step 2: Slide up next server into Active Slot
      setTimeout(() => {
        setTransitioning(false);
        setTransitionStep("");
        setActiveStatus("Online");
      }, 900);
    }, 900);
  };

  // Mock CPU / Memory fluctuation
  const [cpu, setCpu] = useState(14.5);
  const [ram, setRam] = useState(62.3);
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeStatus === "Online") {
        setCpu(parseFloat((8 + Math.random() * 12).toFixed(1)));
        setRam(parseFloat((55 + Math.random() * 15).toFixed(1)));
      } else {
        setCpu(0);
        setRam(0);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [activeStatus]);

  // FAQ accordion state
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <div className="min-h-screen text-white flex flex-col">
      {/* Header / Navbar */}
      <header className="fixed top-0 left-0 right-0 z-50 glass-panel border-b border-borderDark px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="p-2 bg-accentPurple/20 border border-accentPurple/30 rounded-lg group-hover:box-glow-purple transition-all duration-300">
              <ServerIcon className="w-6 h-6 text-accentPurple" />
            </div>
            <span className="font-extrabold text-2xl tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-accentPurple">
              GAME<span className="text-accentPurple text-glow-purple">VAULT</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-mutedText">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#demo" className="hover:text-white transition-colors">The Vault Demo</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          </nav>

          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-semibold hover:text-accentPurple transition-colors px-3 py-2">
              Sign In
            </Link>
            <Link 
              href="/register" 
              className="bg-accentPurple hover:bg-accentPurpleHover text-white px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-200 shadow-md shadow-accentPurple/20 border border-accentPurple/30"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6 max-w-7xl mx-auto flex flex-col items-center text-center relative overflow-hidden">
        {/* Glow Spheres */}
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-accentPurple/10 rounded-full blur-[120px] pointer-events-none"></div>
        <div className="absolute top-40 right-1/4 w-96 h-96 bg-accentBlue/10 rounded-full blur-[120px] pointer-events-none"></div>

        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accentPurple/10 border border-accentPurple/20 text-xs font-semibold text-accentPurple mb-6 animate-float">
          <Sparkles className="w-3.5 h-3.5" />
          <span>The New Standard in Game Server Hosting</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight max-w-4xl leading-tight mb-6">
          One Subscription. <br />
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-accentPurple via-fuchsia-400 to-accentBlue text-glow-purple">
            Infinite Game Worlds.
          </span>
        </h1>

        <p className="text-mutedText text-lg sm:text-xl max-w-2xl mb-8 leading-relaxed">
          Ditch paying for multiple servers your friends only play half the time. Host a world, archive it in the Vault when you switch games, and restore it months later. Zero data loss, zero wasted cash.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center w-full max-w-md mb-16">
          <Link 
            href="/register" 
            className="flex-1 bg-accentPurple hover:bg-accentPurpleHover text-white px-8 py-4 rounded-xl text-base font-bold transition-all duration-300 shadow-lg shadow-accentPurple/30 border border-accentPurple/40 text-center"
          >
            Start Your Vault
          </Link>
          <a 
            href="#demo" 
            className="flex-1 glass-panel hover:bg-white/5 border border-white/10 text-white px-8 py-4 rounded-xl text-base font-bold transition-all duration-300 text-center"
          >
            See How It Works
          </a>
        </div>

        {/* Feature Highlights */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-5xl mt-8">
          {[
            { icon: Zap, label: "Instant Deployments", desc: "Online in 10 seconds" },
            { icon: Layers, label: "Active Game Swapping", desc: "No command line required" },
            { icon: Database, label: "Infinite Vault Storage", desc: "Keep old maps forever" },
            { icon: ShieldCheck, label: "Enterprise Compute", desc: "Ryzen 9 & NVMe SSDs" }
          ].map((item, i) => (
            <div key={i} className="glass-panel p-5 rounded-xl border border-white/5 flex flex-col items-center">
              <div className="p-3 bg-white/5 rounded-lg mb-3">
                <item.icon className="w-6 h-6 text-accentPurple" />
              </div>
              <span className="font-bold text-sm mb-1">{item.label}</span>
              <span className="text-xs text-mutedText text-center">{item.desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Interactive Demo Section */}
      <section id="demo" className="py-20 px-6 bg-[#0a0c12]/80 border-y border-borderDark relative">
        <div className="max-w-7xl mx-auto grid md:grid-cols-12 gap-12 items-center">
          
          <div className="md:col-span-5 flex flex-col justify-center">
            <div className="inline-flex items-center gap-1.5 text-accentPurple font-semibold text-sm mb-3">
              <RefreshCw className="w-4 h-4 animate-spin-slow" />
              <span>Interactive Swap Simulator</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold mb-6 leading-tight">
              Ditch the Config Files.<br />
              <span className="text-accentBlue">Swap in 2 Clicks.</span>
            </h2>
            <p className="text-mutedText mb-6 leading-relaxed">
              When your friend group finishes a Minecraft season and wants to hop on Valheim, you don't need a second subscription. 
            </p>
            <ol className="space-y-4 mb-8">
              {[
                "Select your running Minecraft server and click 'Vault'.",
                "Your world is packaged, zipped, and securely saved in the Vault.",
                "Choose Valheim from your Vault and restore it into the active slot.",
                "Your IP address updates, and you're ready to sail the seas!"
              ].map((step, idx) => (
                <li key={idx} className="flex gap-3 text-sm text-slate-300">
                  <span className="flex-shrink-0 w-6 h-6 bg-accentPurple/20 border border-accentPurple/30 text-accentPurple rounded-full flex items-center justify-center font-bold text-xs">
                    {idx + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <div className="flex gap-4">
              <Link href="/register" className="bg-accentBlue hover:bg-accentBlueHover text-black px-6 py-3 rounded-lg text-sm font-bold transition-all duration-200 shadow-lg shadow-accentBlue/20">
                Unlock Active Slots
              </Link>
            </div>
          </div>

          {/* Interactive Vault Animation Widget */}
          <div className="md:col-span-7 flex flex-col justify-center">
            <div className="glass-panel-purple rounded-2xl p-6 border border-accentPurple/20 relative overflow-hidden box-glow-purple">
              {/* Terminal-style header */}
              <div className="flex items-center justify-between border-b border-borderDark pb-4 mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span className="text-xs text-mutedText font-mono ml-2">Console: gamevault-slot-01</span>
                </div>
                <div className="text-xs font-semibold px-2.5 py-1 rounded bg-accentPurple/20 text-accentPurple">
                  1 Subscription Slot
                </div>
              </div>

              {/* Slot Bay */}
              <div className="mb-6">
                <span className="text-xs font-semibold text-mutedText tracking-wider uppercase block mb-3">
                  Active Server Slot
                </span>
                
                {/* Active Server Card */}
                <div className={`p-5 rounded-xl border relative transition-all duration-700 bg-slate-900/60 ${
                  transitionStep === "archiving" ? "scale-95 opacity-20 -translate-y-8 border-accentPurple" :
                  transitionStep === "restoring" ? "scale-95 opacity-20 translate-y-8 border-accentBlue" :
                  `border-white/10 ${activeGame.border}`
                }`}>
                  <div className="flex items-start justify-between">
                    <div className="flex gap-3.5">
                      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${activeGame.color} flex items-center justify-center text-2xl shadow-lg`}>
                        {activeGame.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-lg">{activeGame.name}</h3>
                          <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                            activeStatus === "Online" ? "bg-emerald-500/10 text-emerald-400" :
                            activeStatus === "Vaulting..." ? "bg-purple-500/10 text-purple-400 animate-pulse" :
                            "bg-cyan-500/10 text-cyan-400 animate-pulse"
                          }`}>
                            {activeStatus}
                          </span>
                        </div>
                        <p className="text-xs text-mutedText">{activeGame.description}</p>
                      </div>
                    </div>

                    {/* Stats display */}
                    <div className="text-right">
                      <span className="text-xs text-mutedText block">IP Address</span>
                      <span className="font-mono text-sm text-slate-300">162.254.204.18:{activeGame.port}</span>
                    </div>
                  </div>

                  {/* Resource meters */}
                  <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-white/5">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-mutedText">CPU Usage</span>
                        <span className="font-mono text-slate-300">{cpu}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-accentPurple transition-all duration-1000" 
                          style={{ width: `${activeStatus === "Online" ? cpu * 3.5 : 0}%` }}
                        ></div>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-mutedText">Memory ({activeGame.ram} Allocated)</span>
                        <span className="font-mono text-slate-300">{activeStatus === "Online" ? `${ram}%` : "0%"}</span>
                      </div>
                      <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-accentBlue transition-all duration-1000" 
                          style={{ width: `${activeStatus === "Online" ? ram : 0}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Transition Indicator Line */}
              <div className="flex items-center justify-center my-4 h-1">
                <div className={`h-full bg-accentPurple transition-all duration-700 ${transitioning ? "w-full opacity-60" : "w-0 opacity-0"}`}></div>
              </div>

              {/* The Vault */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-mutedText tracking-wider uppercase flex items-center gap-1.5">
                    <Archive className="w-3.5 h-3.5 text-accentPurple" />
                    <span>The Game History Vault</span>
                  </span>
                  <span className="text-xs text-mutedText">Unlimited slots</span>
                </div>

                {/* Vaulted worlds list */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {vaultedGames.map((game) => (
                    <div 
                      key={game.id} 
                      onClick={() => handleSwap(game.id)}
                      className={`p-3 rounded-xl border border-white/5 bg-[#151720]/60 hover:bg-cardHover cursor-pointer transition-all duration-300 hover:border-accentPurple/40 group ${
                        transitioning ? "opacity-40 pointer-events-none" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">{game.icon}</span>
                        <h4 className="font-bold text-xs truncate group-hover:text-accentPurple transition-colors">{game.name}</h4>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-mutedText">
                        <span>Size: 2.4 GB</span>
                        <span className="text-accentBlue font-bold group-hover:text-glow-cyan">Restore</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Features Grid Section */}
      <section id="features" className="py-20 px-6 max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-5xl font-extrabold mb-4">
            Built for Gamers. Optimized for Value.
          </h2>
          <p className="text-mutedText max-w-2xl mx-auto">
            Get top-tier server hardware without the enterprise price tag. Our custom orchestration layer handles archiving so you only pay for what you actually use.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              icon: Cpu,
              title: "Enterprise Grade Core",
              desc: "Every subscription slot runs on a high-frequency AMD Ryzen 9 7900X CPU. Say goodbye to block lag, tick drops, and rubber-banding."
            },
            {
              icon: Layers,
              title: "Instant Game Swapping",
              desc: "Archive your Minecraft world, deploy ARK, and play in under 60 seconds. Our automated systems pack, compress, and archive state seamlessly."
            },
            {
              icon: Database,
              title: "Zero-Loss Vault Storage",
              desc: "We back up your world saves, player files, configurations, and mods. Even if you cancel your subscription, your vault remains intact for 6 months."
            },
            {
              icon: Globe,
              title: "Global Server Nodes",
              desc: "Choose from nodes in Silicon Valley, Virginia, Frankfurt, or Singapore. Spin up in any region to guarantee optimal ping for your party."
            },
            {
              icon: RefreshCw,
              title: "Auto-Save Synchronization",
              desc: "Our servers automatically save progress every 15 minutes. When you hit archive, we run a final save sweep to ensure not a single block is lost."
            },
            {
              icon: Users,
              title: "Friend-Shared Access",
              desc: "Invite your gaming group as team members. Allow friends to boot, stop, or swap servers so you don't have to be online for them to play."
            }
          ].map((item, idx) => (
            <div key={idx} className="glass-panel p-8 rounded-2xl border border-white/5 hover:border-accentPurple/25 transition-all duration-300 group hover:box-glow-purple">
              <div className="w-12 h-12 rounded-xl bg-accentPurple/10 border border-accentPurple/20 flex items-center justify-center mb-6 group-hover:bg-accentPurple/20 transition-all duration-300">
                <item.icon className="w-6 h-6 text-accentPurple" />
              </div>
              <h3 className="font-bold text-xl mb-3 group-hover:text-accentPurple transition-colors">{item.title}</h3>
              <p className="text-mutedText text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-6 bg-[#0a0c12]/80 border-t border-borderDark relative">
        <div className="absolute top-10 right-1/4 w-80 h-80 bg-accentPurple/5 rounded-full blur-[100px] pointer-events-none"></div>

        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-5xl font-extrabold mb-4">
              Simple, Slot-Based Pricing
            </h2>
            <p className="text-mutedText max-w-2xl mx-auto">
              Every plan includes unlimited vault archives, complete automated backups, and global server deployments. Pick a plan based on how many servers you want online concurrently.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            
            {/* Starter Plan */}
            <div className="glass-panel p-8 rounded-2xl border border-white/5 flex flex-col justify-between hover:border-white/10 transition-all duration-200">
              <div>
                <span className="text-xs font-bold text-mutedText uppercase tracking-wider block mb-1">Starter</span>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-extrabold">$9</span>
                  <span className="text-mutedText text-sm">/ month</span>
                </div>
                <p className="text-xs text-mutedText mb-6">Perfect for small friend groups playing one game at a time.</p>
                <div className="border-t border-white/5 pt-6 mb-8">
                  <ul className="space-y-4">
                    <li className="flex items-center gap-3 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-accentPurple flex-shrink-0" />
                      <span className="font-bold">1 Active Server Slot</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-accentPurple flex-shrink-0" />
                      <span>Unlimited Vault Archives</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-accentPurple flex-shrink-0" />
                      <span>4GB RAM Allocation Slot</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-accentPurple flex-shrink-0" />
                      <span>Standard Global Nodes</span>
                    </li>
                  </ul>
                </div>
              </div>
              <Link 
                href="/register?plan=STARTER" 
                className="w-full text-center bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold py-3 rounded-xl transition-all duration-200 text-sm"
              >
                Choose Starter
              </Link>
            </div>

            {/* Party Plan */}
            <div className="glass-panel-purple p-8 rounded-2xl border border-accentPurple/40 flex flex-col justify-between hover:box-glow-purple transition-all duration-300 relative">
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-accentPurple text-white px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider shadow-md">
                Most Popular
              </div>
              <div>
                <span className="text-xs font-bold text-accentPurple uppercase tracking-wider block mb-1">Party</span>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-extrabold">$19</span>
                  <span className="text-mutedText text-sm">/ month</span>
                </div>
                <p className="text-xs text-slate-300 mb-6">Perfect for multi-game squads swapping back and forth.</p>
                <div className="border-t border-accentPurple/20 pt-6 mb-8">
                  <ul className="space-y-4">
                    <li className="flex items-center gap-3 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-accentPurple flex-shrink-0 font-bold" />
                      <span className="font-bold text-white">2 Active Server Slots</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-accentPurple flex-shrink-0" />
                      <span>Unlimited Vault Archives</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-accentPurple flex-shrink-0" />
                      <span>12GB Shared RAM Slot</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-accentPurple flex-shrink-0" />
                      <span>Premium Global Nodes</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-accentPurple flex-shrink-0" />
                      <span>Automated Mod Installers</span>
                    </li>
                  </ul>
                </div>
              </div>
              <Link 
                href="/register?plan=PARTY" 
                className="w-full text-center bg-accentPurple hover:bg-accentPurpleHover text-white font-bold py-3 rounded-xl transition-all duration-200 text-sm shadow-md shadow-accentPurple/10 border border-accentPurple/30"
              >
                Choose Party
              </Link>
            </div>

            {/* Guild Plan */}
            <div className="glass-panel p-8 rounded-2xl border border-white/5 flex flex-col justify-between hover:border-white/10 transition-all duration-200">
              <div>
                <span className="text-xs font-bold text-mutedText uppercase tracking-wider block mb-1">Guild</span>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-extrabold">$39</span>
                  <span className="text-mutedText text-sm">/ month</span>
                </div>
                <p className="text-xs text-mutedText mb-6">Perfect for gaming communities hosting multiple simultaneous maps.</p>
                <div className="border-t border-white/5 pt-6 mb-8">
                  <ul className="space-y-4">
                    <li className="flex items-center gap-3 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-accentPurple flex-shrink-0" />
                      <span className="font-bold">4 Active Server Slots</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-accentPurple flex-shrink-0" />
                      <span>Unlimited Vault Archives</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-accentPurple flex-shrink-0" />
                      <span>24GB Shared RAM Slot</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-accentPurple flex-shrink-0" />
                      <span>Dedicated CPU Cores</span>
                    </li>
                    <li className="flex items-center gap-3 text-sm text-slate-300">
                      <Check className="w-4 h-4 text-accentPurple flex-shrink-0" />
                      <span>Priority Support & Discord bot</span>
                    </li>
                  </ul>
                </div>
              </div>
              <Link 
                href="/register?plan=GUILD" 
                className="w-full text-center bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold py-3 rounded-xl transition-all duration-200 text-sm"
              >
                Choose Guild
              </Link>
            </div>

          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="py-20 px-6 max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-extrabold">Frequently Asked Questions</h2>
        </div>

        <div className="space-y-4">
          {[
            {
              q: "How does the Game History Vault actually work?",
              a: "When you archive a server, we run a command to shut down the server process, trigger a full world save, tar-compress your server folder (including world blocks, inventory, configuration files, and installed mods), and sync it to our off-site S3 vault storage. We then release the hardware resources and public IP. When you restore, we pull that archive back down, unpack it onto a hosting node, and boot it up. All your progress is exactly where you left it."
            },
            {
              q: "Is there any limit to the number of archives I can store?",
              a: "No! All plans come with unlimited Vault archives. You can preserve 50 different Minecraft maps, Valheim worlds, and Project Zomboid setups from years of friend-group gaming without paying a penny extra. You only pay for active slot execution."
            },
            {
              q: "Can I swap games instantly?",
              a: "Yes! The process is automated. Archiving a server takes roughly 15-30 seconds depending on size, and restoring takes roughly 30-45 seconds. It is completely hands-off."
            },
            {
              q: "Do I get a static IP address?",
              a: "Since subscription slots are shared hardware, your IP address may update when you restore a server from the Vault to an active slot. However, we provide a free custom subdomain (e.g. `yourparty.gamevault.gg`) that automatically updates to point to your active node IP so you don't have to keep sharing new IP addresses in Discord."
            },
            {
              q: "What happens to my Vaulted worlds if I cancel my subscription?",
              a: "If you pause or cancel your subscription, we keep all your Vault archives securely saved in cold storage for 6 months for free. You can reactivate your account at any time during this window to restore your worlds."
            }
          ].map((item, index) => (
            <div 
              key={index} 
              className="glass-panel rounded-xl border border-white/5 overflow-hidden transition-all duration-300"
            >
              <button 
                onClick={() => toggleFaq(index)}
                className="w-full px-6 py-5 text-left font-bold flex items-center justify-between hover:text-accentPurple transition-colors"
              >
                <span>{item.q}</span>
                <ChevronDown className={`w-5 h-5 text-mutedText transition-transform duration-300 ${openFaq === index ? "rotate-180 text-accentPurple" : ""}`} />
              </button>
              <div 
                className={`px-6 overflow-hidden transition-all duration-300 ease-in-out ${
                  openFaq === index ? "max-h-[300px] pb-5 opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                <p className="text-mutedText text-sm leading-relaxed">{item.a}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6 max-w-5xl mx-auto mb-20 text-center relative overflow-hidden rounded-3xl bg-gradient-to-br from-accentPurple/20 via-slate-900 to-accentBlue/20 border border-accentPurple/30">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-accentPurple/10 rounded-full blur-[100px] pointer-events-none"></div>
        
        <h2 className="text-3xl sm:text-5xl font-extrabold mb-4">
          Never Lose a Gaming Memory.
        </h2>
        <p className="text-mutedText max-w-2xl mx-auto mb-8">
          Join thousands of gamer friend groups hosting smarter. Get your GameVault online today and swap games at a moment's notice.
        </p>
        <Link 
          href="/register" 
          className="inline-block bg-accentPurple hover:bg-accentPurpleHover text-white px-8 py-4 rounded-xl text-base font-bold transition-all duration-200 shadow-lg shadow-accentPurple/20 border border-accentPurple/40"
        >
          Create Your Account Now
        </Link>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-borderDark bg-[#08090c] py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-accentPurple/20 border border-accentPurple/30 rounded-lg">
              <ServerIcon className="w-5 h-5 text-accentPurple" />
            </div>
            <span className="font-extrabold text-lg tracking-wider">
              GAME<span className="text-accentPurple">VAULT</span>
            </span>
          </div>

          <p className="text-xs text-mutedText">
            © 2026 GameVault. All rights reserved. Developed for gamers, by gamers.
          </p>

          <div className="flex items-center gap-6 text-sm text-mutedText">
            <a href="#" className="hover:text-white transition-colors">Terms</a>
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Discord Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
