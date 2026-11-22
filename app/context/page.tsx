"use client";

import { useState } from "react";

export default function ContextPage() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function ingest() {
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong");
      } else {
        setStatus("success");
        setMessage(`Added ${data.chunks} chunks to the knowledge base`);
        setText("");
      }
    } catch {
      setStatus("error");
      setMessage("Network error");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 font-sans">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Knowledge Base</h1>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste document text here…"
        className="h-72 w-full resize-y rounded-xl border border-zinc-300 bg-white p-4 text-sm leading-6 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
      />

      <div className="mt-4 flex items-center gap-4">
        <button
          onClick={ingest}
          disabled={status === "loading" || text.trim().length === 0}
          className="rounded-full bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {status === "loading" ? "Adding…" : "Add to knowledge base"}
        </button>

        {message && (
          <p
            className={
              status === "error"
                ? "text-sm text-red-600"
                : "text-sm text-green-600"
            }
          >
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
