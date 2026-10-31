"use client";
import { useState } from "react";
import { useSession } from "@/lib/session";
import { describeError } from "@/lib/documents";

export function SignInForm() {
  const s = useSession();
  const [user, setUser] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState<string | null>(null);
  return (
    <form className="mt-2 space-y-1" onSubmit={async (e) => {
      e.preventDefault(); setErr(null);
      try { await s.api.login(user, pw); s.set({ error: null, notice: null }); } catch (x) { setErr(describeError(x)); }
    }}>
      <input aria-label="Username" placeholder="Email" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} className="w-full rounded border px-2 py-1 dark:bg-neutral-800" />
      <input aria-label="Password" type="password" autoComplete="current-password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} className="w-full rounded border px-2 py-1 dark:bg-neutral-800" />
      <button className="rounded bg-brand-600 px-3 py-1 text-white">Sign in</button>
      {err && <p role="alert" className="text-xs text-red-600">{err}</p>}
    </form>
  );
}
