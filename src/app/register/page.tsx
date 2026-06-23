"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Server as ServerIcon, User, Mail, Lock, ShieldAlert } from "lucide-react";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [plan, setPlan] = useState("STARTER");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Pre-select plan from query parameter
  useEffect(() => {
    const planParam = searchParams.get("plan");
    if (planParam && ["STARTER", "PARTY", "GUILD"].includes(planParam.toUpperCase())) {
      setPlan(planParam.toUpperCase());
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) {
      setError("Please fill in all fields.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, plan }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to register");
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Registration failed. Try again.");
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-2xl">
      {/* Logo Header */}
      <div className="flex flex-col items-center mb-8">
        <Link href="/" className="flex items-center gap-2 mb-2 group">
          <div className="p-2.5 bg-accentPurple/20 border border-accentPurple/30 rounded-xl group-hover:box-glow-purple transition-all duration-300">
            <ServerIcon className="w-7 h-7 text-accentPurple" />
          </div>
          <span className="font-extrabold text-2xl tracking-wider">
            GAME<span className="text-accentPurple text-glow-purple">VAULT</span>
          </span>
        </Link>
        <p className="text-sm text-mutedText font-medium">Create your account to unlock your game server slots</p>
      </div>

      {/* Form Card */}
      <div className="glass-panel-purple p-8 rounded-2xl border border-accentPurple/20 box-glow-purple">
        {error && (
          <div className="p-3 mb-6 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="grid md:grid-cols-12 gap-8">
          
          {/* Step 1: User details (Left side) */}
          <div className="md:col-span-6 space-y-4">
            <h3 className="font-bold text-base text-white border-b border-white/5 pb-2 mb-3">1. Account Details</h3>
            
            <div>
              <label className="text-xs font-semibold text-mutedText tracking-wider uppercase block mb-1.5">
                Display Name
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-950/60 border border-white/5 focus:border-accentPurple focus:ring-1 focus:ring-accentPurple outline-none transition-all duration-200 text-sm text-slate-200"
                  required
                />
                <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-mutedText tracking-wider uppercase block mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@domain.com"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-950/60 border border-white/5 focus:border-accentPurple focus:ring-1 focus:ring-accentPurple outline-none transition-all duration-200 text-sm text-slate-200"
                  required
                />
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-mutedText tracking-wider uppercase block mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-950/60 border border-white/5 focus:border-accentPurple focus:ring-1 focus:ring-accentPurple outline-none transition-all duration-200 text-sm text-slate-200"
                  required
                />
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
              </div>
            </div>
          </div>

          {/* Step 2: Plan Select (Right side) */}
          <div className="md:col-span-6 flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-base text-white border-b border-white/5 pb-2 mb-4">2. Select Hosting Tier</h3>
              
              <div className="space-y-3">
                {[
                  { id: "STARTER", name: "Starter Tier", price: "$9/mo", slots: "1 Active Slot", ram: "4GB RAM" },
                  { id: "PARTY", name: "Party Tier", price: "$19/mo", slots: "2 Active Slots", ram: "12GB RAM" },
                  { id: "GUILD", name: "Guild Tier", price: "$39/mo", slots: "4 Active Slots", ram: "24GB RAM" }
                ].map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setPlan(p.id)}
                    className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all duration-200 flex justify-between items-center ${
                      plan === p.id 
                        ? `${p.id === "STARTER" ? "border-slate-300 bg-slate-400/5" : p.id === "PARTY" ? "border-accentPurple bg-accentPurple/5" : "border-accentBlue bg-accentBlue/5"}`
                        : "border-white/5 bg-slate-950/40 hover:bg-slate-950/60"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        plan === p.id ? "border-accentPurple" : "border-slate-500"
                      }`}>
                        {plan === p.id && <div className="w-2 h-2 rounded-full bg-accentPurple"></div>}
                      </div>
                      <div>
                        <span className="font-bold text-xs block text-slate-200">{p.name}</span>
                        <span className="text-[10px] text-mutedText block">{p.slots} • {p.ram}</span>
                      </div>
                    </div>
                    <span className="font-extrabold text-sm text-slate-100">{p.price}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 md:mt-0">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-accentPurple hover:bg-accentPurpleHover disabled:bg-accentPurple/50 disabled:cursor-not-allowed text-white font-bold transition-all duration-200 text-sm shadow-lg shadow-accentPurple/10 border border-accentPurple/30"
              >
                {loading ? "Creating Account..." : "Create Account & Register"}
              </button>
            </div>
          </div>

        </form>
      </div>

      {/* Footer Link */}
      <p className="text-center text-xs text-mutedText mt-6">
        Already have an account?{" "}
        <Link href="/login" className="text-accentPurple hover:text-accentPurpleHover font-semibold transition-colors">
          Log In Here
        </Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 relative overflow-hidden bg-background">
      {/* Background Glows */}
      <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-accentPurple/5 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-accentBlue/5 rounded-full blur-[100px] pointer-events-none"></div>

      <Suspense fallback={
        <div className="text-center p-8 bg-card rounded-2xl border border-white/5">
          <div className="w-8 h-8 border-2 border-accentPurple border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <span className="text-xs text-mutedText">Loading registration portal...</span>
        </div>
      }>
        <RegisterForm />
      </Suspense>
    </div>
  );
}
