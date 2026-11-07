"use client";

import { useEffect, useState } from "react";
import { api, btnCls, ghostCls, inputCls } from "../../api";
import { Linkified } from "./Linkified";

/** Inline text: **bold** and links. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        /^\*\*[^*]+\*\*$/.test(part) ? (
          <strong key={i} className="font-medium text-prose">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Linkified key={i} text={part} />
        )
      )}
    </>
  );
}

/**
 * A small markdown subset: "# " / "## " / "### " headings, "- " bullets
 * (with "[ ] " / "[x] " checkboxes), blank lines between paragraphs.
 */
function Rendered({ doc }: { doc: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    const items = bullets;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="flex flex-col gap-1">
        {items.map((b, i) => {
          const box = b.match(/^\[( |x|X)\]\s+(.*)$/);
          return (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 text-faint">{box ? (box[1] === " " ? "☐" : "☑") : "•"}</span>
              <span className={box && box[1] !== " " ? "text-faint line-through" : ""}>
                <Inline text={box ? box[2] : b} />
              </span>
            </li>
          );
        })}
      </ul>
    );
    bullets = [];
  };
  for (const raw of doc.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const cls =
        h[1].length === 1
          ? "mt-2 text-base font-medium text-prose"
          : h[1].length === 2
            ? "mt-2 text-xs font-medium uppercase tracking-wide text-faint"
            : "mt-1 text-sm font-medium text-subtle";
      blocks.push(
        <p key={`h-${blocks.length}`} className={cls}>
          {h[2]}
        </p>
      );
    } else {
      blocks.push(
        <p key={`p-${blocks.length}`}>
          <Inline text={line} />
        </p>
      );
    }
  }
  flush();
  return <div className="flex flex-col gap-2 text-sm leading-relaxed text-subtle [overflow-wrap:anywhere]">{blocks}</div>;
}

/** The trip's living doc: ideas, thoughts, links. Its own edit / save, in any mode. */
export default function TripDoc({ tripId, doc, onSaved }: { tripId: number; doc: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(doc);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const dirty = editing && text !== doc;

  // Don't lose unsaved writing to a closed tab.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      await api(`trips/${tripId}`, "PUT", { doc: text });
      setSavedAt(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  // Nothing written yet: one quiet line instead of a whole card.
  if (!editing && !doc.trim()) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-dashed border-line px-4 py-2.5 text-sm text-faint">
        Trip doc · empty
        <button
          className={`${ghostCls} ml-auto`}
          onClick={() => {
            setText("");
            setEditing(true);
          }}
        >
          + start writing
        </button>
      </p>
    );
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium text-subtle">Trip doc</h2>
        <span className="text-xs text-faint">
          {dirty ? "unsaved changes" : savedAt ? `saved ${savedAt}` : "ideas, thoughts, links"}
        </span>
        {!editing && (
          <button
            className={`${ghostCls} ml-auto`}
            onClick={() => {
              setText(doc);
              setEditing(true);
            }}
          >
            edit doc
          </button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                save();
              }
            }}
            rows={Math.min(30, Math.max(10, text.split("\n").length + 2))}
            placeholder={"## Restaurants\n- Somewhere good — https://…\n\n## To book\n- [ ] Rental car"}
            className={`${inputCls} w-full font-mono text-[13px] leading-relaxed`}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={saving || !dirty} onClick={save} className={btnCls}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              className={ghostCls}
              onClick={() => {
                if (dirty && !confirm("Discard your changes?")) return;
                setEditing(false);
              }}
            >
              cancel
            </button>
            <span className="text-xs text-faint">## heading · - bullet · [ ] to-do · links become clickable · ⌘S saves</span>
            {error && <span className="text-sm text-red-400">{error}</span>}
          </div>
        </div>
      ) : doc.trim() ? (
        <Rendered doc={doc} />
      ) : (
        <p className="text-sm text-faint">Nothing yet — hit &ldquo;edit doc&rdquo; to start jotting down ideas.</p>
      )}
    </section>
  );
}
