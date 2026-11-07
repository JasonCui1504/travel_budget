"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "./api";

const LINKS = [
  { href: "/", label: "Budget" },
  { href: "/trips", label: "Trips" },
];

export default function Header({ user }: { user: string }) {
  const path = usePathname();
  async function signOut() {
    await api("auth", "DELETE");
    window.location.href = "/login";
  }
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line pb-3">
      <span className="text-sm font-medium tracking-wide text-prose">Llama + Shrimp Travels</span>
      <nav className="flex gap-1">
        {LINKS.map((l) => {
          const active = l.href === "/" ? path === l.href : path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded px-2.5 py-1 text-sm transition-colors ${
                active ? "bg-lift text-prose" : "text-faint hover:text-subtle"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      <span className="ml-auto text-xs text-faint">
        signed in as <span className="text-subtle">{user}</span> ·{" "}
        <button onClick={signOut} className="hover:text-prose">
          sign out
        </button>
      </span>
    </div>
  );
}
