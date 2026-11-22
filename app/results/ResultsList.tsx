"use client";

import { useEffect, useState } from "react";

// Formats the date only on the client to avoid a server/client locale
// (and timezone) hydration mismatch. Renders a stable placeholder during SSR.
function LocalDateTime({ iso }: { iso: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(new Date(iso).toLocaleString());
  }, [iso]);
  return <>{text}</>;
}

export type Interview = {
  id: string;
  participant_name: string | null;
  conversation_id: string;
  transcript: string | null;
  created_at: string;
};

type Insights = {
  summary: string;
  themes: { theme: string; quote: string }[];
  sentiment: string;
  pain_points: string[];
  context_used: string[];
};

export default function ResultsList({ interviews }: { interviews: Interview[] }) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [insights, setInsights] = useState<Record<string, Insights>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function analyze(id: string) {
    setLoadingId(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors((e) => ({ ...e, [id]: data.error ?? "Analysis failed" }));
      } else {
        setInsights((prev) => ({ ...prev, [id]: data as Insights }));
      }
    } catch {
      setErrors((e) => ({ ...e, [id]: "Network error" }));
    } finally {
      setLoadingId(null);
    }
  }

  if (interviews.length === 0) {
    return <p className="text-zinc-500">No interviews yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-6">
      {interviews.map((interview) => {
        const result = insights[interview.id];
        const error = errors[interview.id];
        const isLoading = loadingId === interview.id;

        return (
          <li
            key={interview.id}
            className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-zinc-500">
                  <LocalDateTime iso={interview.created_at} />
                  {interview.participant_name ? ` · ${interview.participant_name}` : ""}
                </p>
                <p className="mt-1 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-300">
                  {interview.transcript
                    ? interview.transcript.slice(0, 160) +
                      (interview.transcript.length > 160 ? "…" : "")
                    : "(no transcript)"}
                </p>
              </div>
              <button
                onClick={() => analyze(interview.id)}
                disabled={isLoading}
                className="shrink-0 rounded-full bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              >
                {isLoading ? "Analyzing…" : "Analyze"}
              </button>
            </div>

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

            {result && (
              <div className="mt-4 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
                <div className="mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Summary
                  </h3>
                  <p className="mt-1 text-sm">{result.summary}</p>
                </div>

                <div className="mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Sentiment
                  </h3>
                  <p className="mt-1 text-sm capitalize">{result.sentiment}</p>
                </div>

                {result.themes?.length > 0 && (
                  <div className="mb-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Themes
                    </h3>
                    <ul className="mt-1 flex flex-col gap-2">
                      {result.themes.map((t, i) => (
                        <li key={i} className="text-sm">
                          <span className="font-medium">{t.theme}</span>
                          {t.quote && (
                            <span className="mt-0.5 block border-l-2 border-zinc-300 pl-2 italic text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                              “{t.quote}”
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.pain_points?.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Pain Points
                    </h3>
                    <ul className="mt-1 list-disc pl-5 text-sm">
                      {result.pain_points.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Company context used (RAG retrieved)
                  </h3>
                  {result.context_used?.length > 0 ? (
                    <ul className="mt-1 flex flex-col gap-2">
                      {result.context_used.map((c, i) => (
                        <li
                          key={i}
                          className="border-l-2 border-zinc-300 pl-2 text-sm italic text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                        >
                          “{c}”
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-zinc-500">No company context retrieved.</p>
                  )}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
