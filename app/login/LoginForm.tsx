"use client";

import { useState } from "react";

export default function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Invalid username or password");
      setPassword("");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const field =
    "w-full rounded-sm border border-line bg-lift px-4 py-2.5 text-sm text-prose placeholder:text-faint focus:border-accent focus:outline-none";
  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        autoFocus
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        autoComplete="username"
        className={field}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="current-password"
        className={field}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        disabled={loading || !username || !password}
        className="w-full rounded-sm bg-accent py-2.5 text-sm text-prose transition-opacity disabled:opacity-50"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
