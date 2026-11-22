"use client";

import { useEffect, useRef, useState } from "react";
import { VoiceOrb } from "@/components/VoiceOrb";
import { studyShareLink } from "@/lib/studyLink";

export type Interview = {
  id: string;
  participant_name: string | null;
  conversation_id: string;
  transcript: string | null;
  created_at: string;
  analysis: Insights | null;
  study_id: string | null;
};

export type Study = {
  id: string;
  name: string;
  objective: string;
  slug: string;
  questions?: string[];
  created_at: string;
};

type Insights = {
  summary: string;
  themes: { theme: string; quote: string }[];
  sentiment: string;
  pain_points: string[];
  context_used: string[];
};

type View = "studies" | "create" | "collecting" | "detail" | "interviews" | "insights" | "settings";

// Formats a date on the client only (avoids SSR locale hydration mismatch).
function ClientDate({ iso, opts }: { iso: string; opts?: Intl.DateTimeFormatOptions }) {
  const [t, setT] = useState("");
  useEffect(() => {
    setT(new Date(iso).toLocaleDateString(undefined, opts));
  }, [iso, opts]);
  return <>{t}</>;
}

function sentimentColor(s: string): string {
  const v = (s || "").toLowerCase();
  if (/(positive|happy|good|excited|satisf)/.test(v)) return "var(--green)";
  if (/(negative|frustrat|angry|upset|bad)/.test(v)) return "var(--pink)";
  if (/(neutral|mixed|ok)/.test(v)) return "var(--amber)";
  return "var(--violet)";
}

function initials(name: string | null): string {
  if (!name) return "?";
  const t = name.trim();
  if (t.includes("@")) return t[0].toUpperCase();
  const parts = t.split(/\s+/);
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

export default function ResearcherApp({
  interviews,
  studies,
  kbCountByStudy = {},
}: {
  interviews: Interview[];
  studies: Study[];
  kbCountByStudy?: Record<string, number>;
}) {
  const [view, setView] = useState<View>("studies");
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<"syn" | "int" | "kb">("syn");
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);

  // Study-scoped KB additions made on the detail page (real, via /api/ingest).
  const [kbAddText, setKbAddText] = useState("");
  const [kbAddStatus, setKbAddStatus] = useState<"idle" | "loading" | "error">("idle");
  const [kbAddError, setKbAddError] = useState("");
  const [kbCountOverride, setKbCountOverride] = useState<Record<string, number>>({});

  async function addStudyKnowledge() {
    const text = kbAddText.trim();
    if (!text || !selectedStudyId || kbAddStatus === "loading") return;
    setKbAddStatus("loading");
    setKbAddError("");
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, studyId: selectedStudyId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setKbAddStatus("error");
        setKbAddError(data.error ?? "Failed to add to knowledge base");
        return;
      }
      const sid = selectedStudyId;
      const base = kbCountOverride[sid] ?? kbCountByStudy[sid] ?? 0;
      setKbCountOverride((m) => ({ ...m, [sid]: base + (data.chunks ?? 0) }));
      setKbAddText("");
      setKbAddStatus("idle");
    } catch {
      setKbAddStatus("error");
      setKbAddError("Network error");
    }
  }
  // Create-study form (controlled, starts empty — prefills are placeholders).
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [audience, setAudience] = useState("");
  const [questions, setQuestions] = useState<string[]>([""]);

  // KB added during the wizard is QUEUED locally, then ingested + tagged with the
  // new study's id at creation time (chunks can't reference a study that doesn't
  // exist yet).
  const [kbQueue, setKbQueue] = useState<string[]>([]);
  const [kbText, setKbText] = useState("");

  // Create-study submission
  const [created, setCreated] = useState<{ name: string; slug: string; objective: string; questions: string[] } | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const validQuestions = questions.map((q) => q.trim()).filter(Boolean);
  const canCreateStep0 = name.trim().length > 0 && objective.trim().length > 0;
  const canCreate = canCreateStep0 && validQuestions.length > 0;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareLink = created
    ? studyShareLink(origin, created.slug, {
        name: created.name,
        objective: created.objective,
        questions: created.questions,
      })
    : "";

  function queueKnowledge() {
    const t = kbText.trim();
    if (!t) return;
    setKbQueue((q) => [...q, t]);
    setKbText("");
  }

  async function createStudy() {
    if (!canCreate || creating) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/studies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          objective: objective.trim(),
          audience: audience.trim(),
          questions: validQuestions,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error ?? "Failed to create study");
        setCreating(false);
        return;
      }
      // Ingest any queued KB text, tagged to the new study.
      for (const text of kbQueue) {
        await fetch("/api/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, studyId: data.id }),
        });
      }
      setCreated({ name: name.trim(), slug: data.slug, objective: objective.trim(), questions: validQuestions });
      setCreating(false);
      setView("collecting");
    } catch {
      setCreateError("Network error");
      setCreating(false);
    }
  }

  // --- real reader wiring ---
  const [selId, setSelId] = useState<string | null>(interviews[0]?.id ?? null);
  const [analysis, setAnalysis] = useState<Record<string, Insights>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errId, setErrId] = useState<Record<string, string>>({});

  // Transcript-not-ready handling: /api/analyze returns 202 {pending:true} while
  // ElevenLabs finishes preparing the transcript. Show a "preparing" state and
  // auto-retry with a countdown instead of a dead error.
  const RETRY_SECS = 12;
  const MAX_ATTEMPTS = 5;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingSecs, setPendingSecs] = useState(RETRY_SECS);
  const [pendingAttempt, setPendingAttempt] = useState(0);
  const analyzeRef = useRef<(id: string, isRetry?: boolean) => void>(() => {});

  async function analyze(id: string, isRetry = false) {
    setSelId(id);
    if (!isRetry && (analysis[id] || loadingId === id)) return;
    setLoadingId(id);
    setErrId((e) => ({ ...e, [id]: "" }));
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewId: id }),
      });
      const data = await res.json();
      if (res.status === 202 || data.pending) {
        setPendingId(id);
        setPendingAttempt((a) => a + 1);
      } else if (!res.ok) {
        setPendingId(null);
        setErrId((e) => ({ ...e, [id]: data.error ?? "Analysis failed" }));
      } else {
        setPendingId(null);
        setAnalysis((a) => ({ ...a, [id]: data as Insights }));
      }
    } catch {
      setErrId((e) => ({ ...e, [id]: "Network error" }));
    } finally {
      setLoadingId(null);
    }
  }
  analyzeRef.current = analyze;

  // Countdown + auto-retry while a transcript is still being prepared.
  useEffect(() => {
    if (!pendingId || pendingAttempt === 0 || pendingAttempt > MAX_ATTEMPTS) return;
    let left = RETRY_SECS;
    setPendingSecs(left);
    const iv = setInterval(() => {
      left -= 1;
      setPendingSecs(left);
      if (left <= 0) {
        clearInterval(iv);
        analyzeRef.current(pendingId, true);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [pendingId, pendingAttempt]);

  const STEPS = 4;
  const stepMeta = [
    { t: "Define", s: "Name & objective" },
    { t: "Questions", s: "What to ask" },
    { t: "Knowledge base", s: "Ground the AI" },
    { t: "Share", s: "Get the link" },
  ];

  const navItems: { key: View; label: string; icon: React.ReactNode; badge?: string }[] = [
    {
      key: "studies",
      label: "Studies",
      badge: String(studies.length),
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 5h16M4 12h16M4 19h10" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      key: "interviews",
      label: "Interviews",
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM6 11a6 6 0 0012 0M12 17v4" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      key: "insights",
      label: "Insights",
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 12h4l3 8 4-16 3 8h4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ];

  const navActiveKey: View =
    view === "create" || view === "collecting" || view === "detail" ? "studies" : view;

  const analysisFor = (iv: Interview): Insights | null => analysis[iv.id] ?? iv.analysis ?? null;
  const interviewCountFor = (sid: string) => interviews.filter((iv) => iv.study_id === sid).length;
  const openStudy = (id: string) => {
    setSelectedStudyId(id);
    const first = interviews.find((iv) => iv.study_id === id) ?? null;
    setSelId(first?.id ?? null);
    setTab("syn");
    setView("detail");
  };
  const openInterview = (id: string) => {
    const iv = interviews.find((i) => i.id === id) ?? null;
    setSelectedStudyId(iv?.study_id ?? null);
    setSelId(id);
    setTab("int");
    setView("detail");
  };

  const selectedStudy = studies.find((s) => s.id === selectedStudyId) ?? null;
  const studyInterviews = interviews.filter((iv) => iv.study_id === selectedStudyId);
  const sel = interviews.find((i) => i.id === selId) ?? null;
  const selA = sel ? analysisFor(sel) : null;
  const selErr = selId ? errId[selId] : undefined;
  const toAnalyzed = (list: Interview[]) =>
    list
      .map((iv) => ({ name: iv.participant_name || "Anonymous", a: analysisFor(iv) }))
      .filter((x): x is { name: string; a: Insights } => !!x.a);
  const allAnalyzedList = toAnalyzed(interviews);
  const studyAnalyzedList = toAnalyzed(studyInterviews);
  const analyzedCount = studyAnalyzedList.length;

  function Crumb() {
    if (view === "create" || view === "collecting")
      return (<><a onClick={() => setView("studies")}>Studies</a> / <b>New study</b></>);
    if (view === "detail")
      return (<><a onClick={() => setView("studies")}>Studies</a> / <b>{selectedStudy?.name || "Unscoped interviews"}</b></>);
    if (view === "interviews") return <b>Interviews</b>;
    if (view === "insights") return <b>Insights</b>;
    if (view === "settings") return <b>Settings</b>;
    return <b>Studies</b>;
  }

  return (
    <div className="prism-rs">
      <div className="app">
        <aside className="side">
          <div className="logo">
            <svg width="24" height="24" viewBox="0 0 30 30" fill="none">
              <defs>
                <linearGradient id="rslg" x1="0" y1="0" x2="30" y2="30">
                  <stop offset="0" stopColor="#7A5CFF" /><stop offset=".5" stopColor="#16C5E6" /><stop offset="1" stopColor="#FF5CA8" />
                </linearGradient>
              </defs>
              <path d="M15 3 L26 24 L4 24 Z" stroke="url(#rslg)" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
            <span className="wm">Prism</span>
          </div>
          {navItems.map((n) => (
            <div
              key={n.key}
              className={"nav-i" + (navActiveKey === n.key ? " act" : "")}
              onClick={() => setView(n.key)}
            >
              {n.icon}
              {n.label}
              {n.badge !== undefined && <span className="badge">{n.badge}</span>}
            </div>
          ))}
          <div className="sp"></div>
          <div className={"nav-i" + (view === "settings" ? " act" : "")} onClick={() => setView("settings")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
            </svg>
            Settings
          </div>
          <div className="me">
            <span className="avatar"></span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>Karthik</div>
              <div style={{ fontSize: 11.5, color: "var(--faint)" }}>Product designer</div>
            </div>
          </div>
        </aside>

        <div className="main">
          <div className="topbar">
            <div className="crumb"><Crumb /></div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <a className="btn btn-dark btn-sm" onClick={() => { setStep(0); setView("create"); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
                New study
              </a>
            </div>
          </div>

          <div className="content">
            {/* STUDIES HOME — real studies, newest first */}
            {view === "studies" && studies.length === 0 && (
              <section className="view on">
                <div className="page-h"><div><h1>Studies</h1></div></div>
                <div className="empty">
                  <div className="glyph"><VoiceOrb /></div>
                  <h2>Talk to your users — without scheduling a thing.</h2>
                  <p>Create your first study, share one link, and Prism interviews your users by voice and hands you the insight.</p>
                  <div className="mini"><div className="m"><b>1</b> Define a study</div><div className="m"><b>2</b> Share the link</div><div className="m"><b>3</b> Read the insight</div></div>
                  <a className="btn btn-dark" onClick={() => { setStep(0); setView("create"); }}>Create your first study →</a>
                </div>
              </section>
            )}

            {view === "studies" && studies.length > 0 && (
              <section className="view on">
                <div className="page-h"><div><h1>Studies</h1><div className="sub">Run AI voice interviews and read the insight — not the transcript.</div></div></div>
                <div className="toolbar">
                  <div className="search">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg>
                    <input placeholder="Search studies…" />
                  </div>
                </div>
                <div className="studies">
                  {studies.map((s) => {
                    const n = interviewCountFor(s.id);
                    return (
                      <div key={s.id} className="study" onClick={() => openStudy(s.id)}>
                        <div className="top"><span className="status"><i style={{ background: n > 0 ? "var(--green)" : "var(--amber)" }}></i>{n > 0 ? "Active" : "Collecting"}</span></div>
                        <h3>{s.name}</h3>
                        <p className="obj">{s.objective}</p>
                        <div className="meta tnum"><span><b>{n}</b> interview{n === 1 ? "" : "s"}</span><span>Created <ClientDate iso={s.created_at} opts={{ day: "numeric", month: "short", year: "numeric" }} /></span></div>
                      </div>
                    );
                  })}
                  <div className="study new" onClick={() => { setStep(0); setView("create"); }}>
                    <div className="plus"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.8"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg></div>
                    <b>New study</b><div style={{ fontSize: 13 }}>Define an objective and share a link</div>
                  </div>
                </div>
              </section>
            )}

            {/* CREATE WIZARD */}
            {view === "create" && (
              <section className="view on">
                <div className="page-h"><div><span className="eyebrow"><span className="pip"></span>New study</span><h1 style={{ marginTop: 9 }}>Create a study</h1></div></div>
                <div className="wizard">
                  <div className="wiz-rail">
                    <div className="stepper">
                      <span className="stepline" aria-hidden="true"><span className="stepline-fill" style={{ height: `${(step / (STEPS - 1)) * 100}%` }} /></span>
                      {stepMeta.map((m, i) => (
                        <div key={i} className={"stp" + (i === step ? " active" : "") + (i < step ? " done" : "")} onClick={() => setStep(i)}>
                          <span className="nd">
                            {i < step ? (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            ) : (
                              i + 1
                            )}
                          </span>
                          <div className="tx"><div className="t">{m.t}</div><div className="s">{m.s}</div></div>
                        </div>
                      ))}
                    </div>
                    <div className="study-preview">
                      <div className="sp-label">Study preview</div>
                      <div className="sp-name">{name.trim() ? name : <em>Untitled study</em>}</div>
                      {objective.trim() && <div className="sp-obj">{objective}</div>}
                      {audience.trim() && <span className="sp-chip"><i></i>{audience}</span>}
                      <div className="sp-counts">
                        <span className="bump" key={`q${validQuestions.length}`}>{validQuestions.length}</span> question{validQuestions.length === 1 ? "" : "s"} · <span className="bump" key={`s${kbQueue.length}`}>{kbQueue.length}</span> source{kbQueue.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                  <div className="form-card">
                    <div className="stepbody">
                      {step === 0 && (
                        <div className="step on">
                          <div className="step-h"><h2>Define the study</h2><p>What are you trying to learn?</p></div>
                          <div className="field"><label>Study name</label><input className="inp" placeholder="e.g. Understanding design system use in v0" value={name} onChange={(e) => setName(e.target.value)} /></div>
                          <div className="field"><label>Research objective <span className="hint">steers the conversation</span></label><textarea className="ta" placeholder="e.g. Understand how product teams adopt and struggle with the v0 design system." value={objective} onChange={(e) => setObjective(e.target.value)} /></div>
                          <div className="field"><label>Who are you talking to? <span className="hint">optional</span></label><input className="inp" placeholder="e.g. Product designers and PMs" value={audience} onChange={(e) => setAudience(e.target.value)} /></div>
                          {step === 0 && !canCreateStep0 && (name || objective) && (
                            <p style={{ color: "var(--faint)", fontSize: 12, marginTop: 12 }}>Name and objective are required to continue.</p>
                          )}
                        </div>
                      )}
                      {step === 1 && (
                        <div className="step on">
                          <div className="step-h"><h2>Questions &amp; topics</h2><p>Prism asks these one at a time and probes naturally based on each answer.</p></div>
                          <div>
                            {questions.map((q, i) => (
                              <div className="qrow" key={i}>
                                <span className="n">{String(i + 1).padStart(2, "0")}</span>
                                <input className="inp" placeholder="e.g. How do you currently use design systems day to day?" value={q} onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? e.target.value : x)))} />
                                <span className="x" onClick={() => setQuestions((qs) => (qs.length > 1 ? qs.filter((_, j) => j !== i) : qs))}>✕</span>
                              </div>
                            ))}
                          </div>
                          <button className="btn btn-out btn-sm" style={{ marginTop: 6 }} onClick={() => setQuestions((qs) => [...qs, ""])}>+ Add question</button>
                          {validQuestions.length === 0 && <p style={{ color: "var(--faint)", fontSize: 12, marginTop: 10 }}>Add at least one question to continue.</p>}
                        </div>
                      )}
                      {step === 2 && (
                        <div className="step on">
                          <div className="step-h"><h2>Knowledge base</h2><p>Upload context so Prism asks specific, grounded questions. Scoped to <b>this study only</b>.</p></div>
                          {/* PDF / drag-drop is a visual placeholder for now. PDF parsing
                              (extract text → POST to /api/ingest) would be wired here. */}
                          <div className="drop" title="PDF upload coming soon — paste text below for now">
                            <div className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="1.7"><path d="M12 16V4M7 9l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" /></svg></div>
                            <b>Drop a PDF, doc, or notes</b><div className="s">PDF parsing coming soon — paste text below for now</div>
                          </div>
                          <div className="or">or paste text</div>
                          <textarea
                            className="ta"
                            placeholder="Paste product notes, personas, prior research…"
                            value={kbText}
                            onChange={(e) => setKbText(e.target.value)}
                          />
                          <div style={{ marginTop: 10 }}>
                            <button
                              className="btn btn-out btn-sm"
                              onClick={queueKnowledge}
                              disabled={kbText.trim().length === 0}
                            >
                              Add to knowledge base
                            </button>
                          </div>
                          <div>
                            {kbQueue.length === 0 && (
                              <div style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 12 }}>No knowledge base sources yet.</div>
                            )}
                            {kbQueue.map((src, i) => (
                              <div className="source" key={i}>
                                <span className="fi"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.7"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg></span>
                                <div><div className="nm">Pasted text {i + 1}</div><div className="mt">{src.length} chars · indexes on create</div></div>
                                <span className="x" onClick={() => setKbQueue((q) => q.filter((_, j) => j !== i))} style={{ marginLeft: "auto", color: "var(--faint)", cursor: "pointer" }}>✕</span>
                              </div>
                            ))}
                          </div>
                          <div className="kb-note"><span className="pip"></span><div>Knowledge you add here is embedded and scoped to <b>this study</b> when you create it — Prism uses retrieval (RAG) to ground each question and the analysis in your context.</div></div>
                        </div>
                      )}
                      {step === 3 && (
                        <div className="step on">
                          <div className="step-h" style={{ textAlign: "center" }}><h2>Review &amp; create</h2><p>Create the study to generate a shareable link participants can open and talk to.</p></div>
                          <div className="ready">
                            <div className="orb"><VoiceOrb /></div>
                            <div style={{ fontSize: 13.5, color: "var(--ink-2)" }}>{name.trim() || "Untitled study"}</div>
                            <div style={{ marginTop: 13, fontSize: 12.5, color: "var(--faint)", fontFamily: "var(--fm)" }}>{validQuestions.length} question{validQuestions.length === 1 ? "" : "s"} · {kbQueue.length} knowledge source{kbQueue.length === 1 ? "" : "s"} · ~5 min</div>
                            {createError && <p style={{ color: "var(--pink)", fontSize: 12.5, marginTop: 12 }}>{createError}</p>}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="footer-actions">
                      <button className="btn btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} style={{ visibility: step === 0 ? "hidden" : "visible" }}>← Back</button>
                      {step === STEPS - 1 ? (
                        <button className="btn btn-dark" onClick={createStudy} disabled={!canCreate || creating}>{creating ? "Creating…" : "Create study →"}</button>
                      ) : (
                        <button
                          className="btn btn-dark"
                          onClick={() => setStep((s) => Math.min(STEPS - 1, s + 1))}
                          disabled={(step === 0 && !canCreateStep0) || (step === 1 && validQuestions.length === 0)}
                        >
                          Continue →
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* COLLECTING */}
            {view === "collecting" && (
              <section className="view on">
                <div className="page-h"><div><span className="eyebrow"><span className="pip"></span>Study created</span><h1 style={{ marginTop: 9 }}>{created?.name || "New study"}</h1></div></div>
                <div className="collect">
                  <div className="orb"><VoiceOrb /></div>
                  <h2>Waiting for your first interview</h2>
                  <p>Share your link below. As people complete interviews, their insight appears here automatically.</p>
                  <div className="lk"><input className="inp" readOnly value={shareLink} /><CopyButton label="Copy link" text={shareLink} /></div>
                  <div style={{ marginTop: 16 }}><a className="btn btn-out btn-sm" onClick={() => setView("studies")}>Back to studies →</a></div>
                  <div className="skel">
                    <div className="sk"><div className="l"></div><div className="b"></div><div className="b"></div><div className="b s"></div></div>
                    <div className="sk"><div className="l"></div><div className="b"></div><div className="b s"></div></div>
                    <div className="sk"><div className="l"></div><div className="b"></div><div className="b"></div><div className="b s"></div></div>
                  </div>
                </div>
              </section>
            )}

            {/* DETAIL */}
            {view === "detail" && (
              <section className="view on">
                <div className="detail-h">
                  <div><span className="eyebrow"><span className="pip"></span>Study</span><h1 style={{ marginTop: 9 }}>{selectedStudy?.name || "Unscoped interviews"}</h1><div className="sub">{selectedStudy?.objective ? selectedStudy.objective + " · " : ""}{studyInterviews.length} interview{studyInterviews.length === 1 ? "" : "s"} · {analyzedCount} analyzed</div></div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <a className="btn btn-out btn-sm">Export</a>
                    {selectedStudy ? (
                      <CopyButton
                        label="Share link"
                        className="btn btn-dark btn-sm"
                        text={studyShareLink(origin, selectedStudy.slug, {
                          name: selectedStudy.name,
                          objective: selectedStudy.objective,
                          questions: selectedStudy.questions ?? [],
                        })}
                      />
                    ) : (
                      <a className="btn btn-dark btn-sm">Share link</a>
                    )}
                  </div>
                </div>
                <div className="tabs">
                  <button className={tab === "syn" ? "on" : ""} onClick={() => setTab("syn")}>Synthesis</button>
                  <button className={tab === "int" ? "on" : ""} onClick={() => setTab("int")}>Interviews <span className="mono" style={{ color: "var(--faint)" }}>{studyInterviews.length}</span></button>
                  {selectedStudy && (
                    <button className={tab === "kb" ? "on" : ""} onClick={() => setTab("kb")}>Knowledge base <span className="mono" style={{ color: "var(--faint)" }}>{kbCountOverride[selectedStudy.id] ?? kbCountByStudy[selectedStudy.id] ?? 0}</span></button>
                  )}
                </div>

                {tab === "syn" && <SynthesisReal analyzed={studyAnalyzedList} />}

                {tab === "kb" && selectedStudy && (
                  <div className="tabview on">
                    <div className="panel">
                      <div className="ph"><h3>Knowledge base</h3><span className="sub">{kbCountOverride[selectedStudy.id] ?? kbCountByStudy[selectedStudy.id] ?? 0} chunks · this study</span></div>
                      <p style={{ color: "var(--muted)", fontSize: 13.5, lineHeight: 1.55 }}>Context scoped to <b>{selectedStudy.name}</b>. The interviewer and analysis retrieve only this study&apos;s knowledge (RAG).</p>
                      <textarea className="ta" style={{ marginTop: 14 }} placeholder="Paste product notes, personas, prior research…" value={kbAddText} onChange={(e) => setKbAddText(e.target.value)} />
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                        <button className="btn btn-dark btn-sm" onClick={addStudyKnowledge} disabled={kbAddStatus === "loading" || kbAddText.trim().length === 0}>
                          {kbAddStatus === "loading" ? "Indexing…" : "Add to knowledge base"}
                        </button>
                        {kbAddStatus === "error" && <span style={{ color: "var(--pink)", fontSize: 12.5 }}>{kbAddError}</span>}
                      </div>
                    </div>
                  </div>
                )}

                {tab === "int" && (
                  <div className="tabview on">
                    <div className="reader">
                      <div className="ilist">
                        <div className="lh">{studyInterviews.length} interviews</div>
                        {studyInterviews.length === 0 && <div style={{ padding: "14px", color: "var(--faint)", fontSize: 13 }}>No interviews in this study yet.</div>}
                        {studyInterviews.map((iv) => {
                          const a = analysisFor(iv);
                          return (
                            <div key={iv.id} className={"irow" + (selId === iv.id ? " sel" : "")} onClick={() => setSelId(iv.id)}>
                              <span className="av">{initials(iv.participant_name)}</span>
                              <div><div className="nm">{iv.participant_name || "Anonymous"}</div><div className="mt"><ClientDate iso={iv.created_at} opts={{ day: "numeric", month: "short" }} /></div></div>
                              <span className="sd" style={{ background: a ? sentimentColor(a.sentiment) : "var(--faint)" }}></span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="ipane">
                        {!sel && <div style={{ color: "var(--faint)" }}>Select an interview to view its insight.</div>}
                        {sel && (
                          <>
                            <div className="ih"><h3>{sel.participant_name || "Anonymous"}</h3><div className="mt"><ClientDate iso={sel.created_at} opts={{ day: "numeric", month: "short" }} /></div></div>
                            {selA ? (
                              <>
                                <div className="ilabel"><i style={{ background: "var(--violet)" }}></i>Summary</div>
                                <p className="isum" style={{ marginTop: 9 }}>{selA.summary}</p>
                                {selA.themes?.length > 0 && (
                                  <div className="blk"><div className="ilabel"><i style={{ background: "var(--blue)" }}></i>Themes</div>
                                    {selA.themes.map((t, i) => (
                                      <div className="theme-r" key={i}><h4><i style={{ background: "var(--cyan)" }}></i>{t.theme}</h4>{t.quote && <blockquote>{t.quote}</blockquote>}</div>
                                    ))}
                                  </div>
                                )}
                                <div className="blk"><div className="ilabel"><i style={{ background: sentimentColor(selA.sentiment) }}></i>Sentiment</div>
                                  <div style={{ fontSize: 17, fontWeight: 600, display: "flex", alignItems: "center", gap: 9, marginTop: 9, color: "var(--ink)" }}>
                                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: sentimentColor(selA.sentiment) }}></span>{selA.sentiment}
                                  </div>
                                </div>
                                {selA.pain_points?.length > 0 && (
                                  <div className="blk"><div className="ilabel"><i style={{ background: "var(--pink)" }}></i>Pain points</div>{selA.pain_points.map((p, i) => (<div className="pin" key={i}>{p}</div>))}</div>
                                )}
                                <div className="rag"><div className="ilabel"><i style={{ background: "var(--violet)" }}></i>Company context used · RAG</div>
                                  {selA.context_used?.length > 0 ? selA.context_used.map((c, i) => (
                                    <div className="chunk" key={i}><span className="t">Retrieved</span>{c}</div>
                                  )) : <div className="chunk" style={{ color: "var(--faint)" }}>No company context retrieved.</div>}
                                </div>
                              </>
                            ) : (
                              <div className="blk" style={{ marginTop: 0 }}>
                                {loadingId === sel.id ? (
                                  <div style={{ color: "var(--muted)" }}>Analyzing…</div>
                                ) : pendingId === sel.id ? (
                                  <>
                                    <p style={{ color: "var(--ink-2)", fontWeight: 600, marginBottom: 6 }}>Preparing the transcript…</p>
                                    <p style={{ color: "var(--muted)", fontSize: 12.5, marginBottom: 14, lineHeight: 1.5 }}>
                                      The recording is still being transcribed by ElevenLabs (usually under a minute).
                                      {pendingAttempt <= MAX_ATTEMPTS
                                        ? ` Retrying automatically in ${pendingSecs}s…`
                                        : " This is taking longer than usual — you can retry."}
                                    </p>
                                    <button className="btn btn-out btn-sm" onClick={() => analyze(sel.id, true)}>Retry now</button>
                                  </>
                                ) : (
                                  <>
                                    <p style={{ color: "var(--muted)", marginBottom: 14 }}>This interview hasn&apos;t been analyzed yet.</p>
                                    <button className="btn btn-dark btn-sm" onClick={() => analyze(sel.id)}>Analyze</button>
                                    {selErr && <p style={{ color: "var(--pink)", fontSize: 12.5, marginTop: 10 }}>{selErr}</p>}
                                  </>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* INTERVIEWS (cross-study) — real data */}
            {view === "interviews" && (
              <section className="view on">
                <div className="page-h"><div><h1>Interviews</h1><div className="sub">Every conversation across your studies, in one place.</div></div></div>
                <div className="toolbar">
                  <div className="search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" strokeLinecap="round" /></svg><input placeholder="Search interviews…" /></div>
                  <div className="seg"><button className="on">All</button><button>Positive</button><button>Neutral</button><button>Frustrated</button></div>
                </div>
                <table className="tbl">
                  <thead><tr><th>Participant</th><th>Conversation</th><th>Date</th><th>Transcript</th></tr></thead>
                  <tbody>
                    {interviews.length === 0 && (
                      <tr><td colSpan={4} style={{ color: "var(--faint)" }}>No interviews yet.</td></tr>
                    )}
                    {interviews.map((iv) => (
                      <tr key={iv.id} onClick={() => { setView("detail"); setTab("int"); analyze(iv.id); }}>
                        <td><div className="who"><span className="av">{initials(iv.participant_name)}</span><span className="nm">{iv.participant_name || "Anonymous"}</span></div></td>
                        <td className="num">{iv.conversation_id.slice(0, 12)}…</td>
                        <td className="num"><ClientDate iso={iv.created_at} opts={{ day: "numeric", month: "short" }} /></td>
                        <td className="num">{iv.transcript ? `${iv.transcript.length} chars` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* INSIGHTS (cross-study) — computed from real saved analyses */}
            {view === "insights" && (
              <section className="view on">
                <div className="page-h"><div><h1>Insights</h1><div className="sub">Patterns across all analyzed interviews.</div></div></div>
                <div style={{ marginTop: 22 }}><SynthesisReal analyzed={allAnalyzedList} /></div>
              </section>
            )}

            {/* SETTINGS (shell) */}
            {view === "settings" && <SettingsShell />}
          </div>
        </div>
      </div>
    </div>
  );
}

function CopyButton({
  label = "Copy",
  text = "",
  className = "btn btn-dark",
}: {
  label?: string;
  text?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={className}
      onClick={() => {
        if (text && navigator.clipboard) navigator.clipboard.writeText(text);
        setCopied(true);
      }}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

function Bar({ label, count, w, color }: { label: string; count: number; w: string; color: string }) {
  return (
    <div className="barrow"><div className="bl"><span>{label}</span><span className="c tnum">{count}</span></div><div className="track"><div style={{ width: w, background: color }}></div></div></div>
  );
}

function bucketSentiment(s: string): "pos" | "neu" | "fr" | "other" {
  const v = (s || "").toLowerCase();
  if (/(positive|happy|good|excited|satisf|love|delight)/.test(v)) return "pos";
  if (/(negative|frustrat|angry|upset|bad|confus|annoy|disappoint)/.test(v)) return "fr";
  if (/(neutral|mixed|ok|fine)/.test(v)) return "neu";
  return "other";
}

const THEME_COLORS = ["var(--violet)", "var(--cyan)", "var(--green)", "var(--blue)", "var(--pink)", "var(--amber)"];

// Synthesis computed entirely from real saved analyses. Anything that can't be
// computed (no analyzed interviews, no quotes) renders as a clear empty state —
// never fabricated.
function SynthesisReal({ analyzed }: { analyzed: { name: string; a: Insights }[] }) {
  if (analyzed.length === 0) {
    return (
      <div className="tabview on">
        <div className="exec">
          <div className="ilabel"><i style={{ background: "var(--violet)" }}></i>Cross-interview synthesis</div>
          <p>No analyzed interviews yet. Analyze interviews to see theme frequency, sentiment split, and common pain points here.</p>
        </div>
      </div>
    );
  }

  const total = analyzed.length;

  // Theme frequency
  const themeMap = new Map<string, number>();
  analyzed.forEach(({ a }) =>
    a.themes?.forEach((t) => {
      const k = (t.theme || "").trim();
      if (k) themeMap.set(k, (themeMap.get(k) || 0) + 1);
    })
  );
  const themes = [...themeMap.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((x, y) => y.count - x.count)
    .slice(0, 6);
  const maxTheme = themes[0]?.count || 1;

  // Sentiment split
  const sb = { pos: 0, neu: 0, fr: 0, other: 0 };
  analyzed.forEach(({ a }) => { sb[bucketSentiment(a.sentiment)]++; });
  const segs = [
    { key: "pos", label: "Positive", count: sb.pos, color: "var(--green)" },
    { key: "neu", label: "Neutral", count: sb.neu, color: "var(--amber)" },
    { key: "fr", label: "Frustrated", count: sb.fr, color: "var(--pink)" },
    { key: "other", label: "Other", count: sb.other, color: "var(--violet)" },
  ].filter((s) => s.count > 0);

  // Common pain points (dedupe case-insensitively, keep first-seen casing)
  const painMap = new Map<string, { label: string; count: number }>();
  analyzed.forEach(({ a }) =>
    a.pain_points?.forEach((p) => {
      const key = (p || "").trim().toLowerCase();
      if (!key) return;
      const prev = painMap.get(key);
      if (prev) prev.count++;
      else painMap.set(key, { label: p.trim(), count: 1 });
    })
  );
  const pains = [...painMap.values()].sort((x, y) => y.count - x.count).slice(0, 5);

  // Representative quotes (real, from theme quotes)
  const quotes: { quote: string; theme: string; name: string }[] = [];
  analyzed.forEach(({ name, a }) =>
    a.themes?.forEach((t) => {
      if (t.quote && quotes.length < 4) quotes.push({ quote: t.quote, theme: t.theme, name });
    })
  );

  return (
    <div className="tabview on">
      <div className="exec">
        <div className="ilabel"><i style={{ background: "var(--violet)" }}></i>Cross-interview synthesis</div>
        <p>Across <b>{total}</b> analyzed interview{total === 1 ? "" : "s"}{themes[0] ? <> the most common theme is <b>{themes[0].label}</b></> : null}.</p>
      </div>
      <div className="syn-grid">
        <div className="panel"><div className="ph"><h3>Top themes</h3><span className="sub">N={total}</span></div>
          <div className="bars">
            {themes.length === 0 && <div style={{ color: "var(--faint)", fontSize: 13 }}>No themes found.</div>}
            {themes.map((t, i) => (
              <Bar key={t.label} label={t.label} count={t.count} w={`${Math.round((t.count / maxTheme) * 100)}%`} color={THEME_COLORS[i % THEME_COLORS.length]} />
            ))}
          </div>
        </div>
        <div className="panel"><div className="ph"><h3>Sentiment</h3><span className="sub">N={total}</span></div>
          <div className="senti-bar">
            {segs.map((s) => (<div key={s.key} style={{ width: `${Math.round((s.count / total) * 100)}%`, background: s.color }}></div>))}
          </div>
          <div className="senti-leg tnum">
            {segs.map((s) => (<span key={s.key}><i style={{ background: s.color }}></i>{s.label} · {s.count}</span>))}
          </div>
          <div className="ph" style={{ borderTop: "1px solid var(--line-2)", marginTop: 18, paddingTop: 16 }}><h3 style={{ fontSize: 14 }}>Common pain points</h3></div>
          <div className="pain-list">
            {pains.length === 0 && <div style={{ color: "var(--faint)", fontSize: 13 }}>No pain points recorded.</div>}
            {pains.map((p, i) => (
              <div className="pain-r" key={p.label}><span className="rank">{i + 1}</span>{p.label}<span className="cnt tnum">{p.count}</span></div>
            ))}
          </div>
        </div>
      </div>
      <div className="panel"><div className="ph"><h3>Representative quotes</h3><span className="sub">From analyses</span></div>
        {quotes.length === 0 ? (
          <div style={{ color: "var(--faint)", fontSize: 13 }}>No quotes captured yet.</div>
        ) : (
          <div className="quotes">
            {quotes.map((q, i) => (
              <div className="qcard" key={i}><p>&ldquo;{q.quote}&rdquo;</p><div className="by"><i style={{ background: "var(--violet)" }}></i>{q.theme} · {q.name}</div></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsShell() {
  const Toggle = ({ on }: { on?: boolean }) => {
    const [v, setV] = useState(!!on);
    return <div className={"sw" + (v ? " on" : "")} onClick={() => setV((x) => !x)}></div>;
  };
  return (
    <section className="view on">
      <div className="page-h"><div><h1>Settings</h1><div className="sub">Workspace, interviewer voice, and study defaults.</div></div></div>
      <div className="set-grid">
        <div className="set-card"><h3>Profile</h3>
          <div className="field"><label>Name</label><input className="inp" defaultValue="Karthik" /></div>
          <div className="field"><label>Role</label><input className="inp" defaultValue="Product designer" /></div>
          <div className="field"><label>Email</label><input className="inp" defaultValue="karthik@prism.app" /></div>
        </div>
        <div className="set-card"><h3>Interviewer voice</h3><div className="cap">Defaults applied to every new study.</div>
          <div className="set-row"><div className="lab">Voice<span>The agent&apos;s spoken voice</span></div><select className="sel"><option>Aria — warm, neutral</option><option>Sage — calm</option><option>Ren — energetic</option></select></div>
          <div className="set-row"><div className="lab">Follow-up depth<span>How much it probes each answer</span></div><select className="sel"><option>Balanced</option><option>Light</option><option>Deep</option></select></div>
          <div className="set-row"><div className="lab">Max interview length</div><select className="sel"><option>5 minutes</option><option>10 minutes</option><option>15 minutes</option></select></div>
        </div>
        <div className="set-card"><h3>Analysis</h3>
          <div className="set-row"><div className="lab">Ground analysis in the knowledge base (RAG)<span>Recommended — keeps insight grounded</span></div><Toggle on /></div>
          <div className="set-row"><div className="lab">Auto-summarize each interview</div><Toggle on /></div>
          <div className="set-row"><div className="lab">Email me when a study reaches 10 interviews</div><Toggle /></div>
        </div>
        <div className="set-card"><h3>Connected services</h3><div className="cap">Powering live voice, analysis, and storage.</div>
          <div className="conn"><span className="dotok"></span>ElevenLabs <span className="svc">· live voice</span><span className="pill">Connected</span></div>
          <div className="conn"><span className="dotok"></span>Claude (Anthropic) <span className="svc">· analysis</span><span className="pill">Connected</span></div>
          <div className="conn"><span className="dotok"></span>Local storage <span className="svc">· data/db.json + RAG</span><span className="pill">Connected</span></div>
        </div>
      </div>
    </section>
  );
}
