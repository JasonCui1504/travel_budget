/** JSON fetch for the travel API; throws the server's error message on failure. */
export async function api<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = "/login";
  }
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const usd = (v: number, digits = 2) =>
  v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export const inputCls =
  "rounded border border-line bg-canvas px-2 py-1.5 text-sm text-prose outline-none placeholder:text-faint focus:border-accent";
export const btnCls =
  "rounded border border-accent bg-accent-dim px-3 py-1.5 text-sm text-prose transition-colors hover:bg-accent disabled:opacity-50";
export const ghostCls = "text-xs text-faint transition-colors hover:text-prose";
