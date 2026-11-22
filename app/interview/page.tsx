"use client";

import { useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { VoiceOrb } from "@/components/VoiceOrb";
import { decodeStudy } from "@/lib/studyLink";
import "./interview.css";

type Screen = "consent" | "interview" | "done";
type Msg = { source: "user" | "ai"; text: string };
type Study = { name: string; objective: string; questions: string[] };

const TriLogo = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 30 30" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="ivlg" x1="0" y1="0" x2="30" y2="30">
        <stop offset="0" stopColor="#7A5CFF" />
        <stop offset=".5" stopColor="#16C5E6" />
        <stop offset="1" stopColor="#FF5CA8" />
      </linearGradient>
    </defs>
    <path d="M15 4 L25 23 L5 23 Z" stroke="url(#ivlg)" strokeWidth="2.4" strokeLinejoin="round" />
  </svg>
);

// Builds ElevenLabs startSession overrides from the study (Layer B).
// Returns {} when there's no study so the dashboard-default agent is used.
function buildStudyOverrides(study: Study | null) {
  if (!study) return {};
  const qs = study.questions.map((q) => q.trim()).filter(Boolean);
  const questionList = qs.map((q, i) => `${i + 1}. ${q}`).join("\n");
  const systemPrompt =
    `You are Prism, a warm, curious user researcher conducting a short voice interview. ` +
    `Your objective: ${study.objective}. ` +
    `Cover these questions naturally, one at a time, asking follow-ups based on answers:\n${questionList}\n` +
    `Don't read them like a form; be conversational. When you've covered them, thank the person and wrap up.`;
  const firstMessage = qs.length
    ? `Hi! Thanks so much for taking the time to chat. To start — ${qs[0]}`
    : `Hi! Thanks so much for taking the time to chat. To start, could you tell me a bit about your experience?`;
  return { overrides: { agent: { prompt: { prompt: systemPrompt }, firstMessage } } };
}

function InterviewInner() {
  // --- voice + saving state (unchanged logic) ---
  const conversationIdRef = useRef<string | null>(null);
  const emailRef = useRef<string>("");

  // --- UI state ---
  const [screen, setScreen] = useState<Screen>("consent");
  const [email, setEmail] = useState("");
  const [consented, setConsented] = useState(false);
  const [mode, setMode] = useState<"voice" | "type">("voice");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [secs, setSecs] = useState(0);
  const [typed, setTyped] = useState("");
  const tmrRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Study context for this interview link (?study=<slug>). Loaded before the
  // call so we can build a per-study interviewer prompt. Null = generic fallback.
  const [study, setStudy] = useState<Study | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const embedded = params.get("d");
    const slug = params.get("study");
    if (!embedded && !slug) return;
    (async () => {
      // Preferred: the study is embedded in the link itself (?d=...).
      const fromLink = embedded ? decodeStudy(embedded) : null;
      if (fromLink) {
        setStudy(fromLink);
        return;
      }
      // Fallback for older links: look the study up by slug.
      if (!slug) return;
      try {
        const res = await fetch(`/api/study?slug=${encodeURIComponent(slug)}`);
        if (res.ok) setStudy(await res.json());
      } catch {
        // fall back to a generic interview if the study can't be loaded
      }
    })();
  }, []);

  async function saveInterview() {
    const conversationId = conversationIdRef.current;
    if (!conversationId) return;
    // The share link may carry ?study=<slug>; tag the saved interview with it.
    const studySlug =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("study") || undefined
        : undefined;
    try {
      await fetch("/api/save-interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          participantName: emailRef.current || undefined,
          studySlug,
        }),
      });
    } catch {
      // saving is best-effort; the thank-you screen still shows
    }
  }

  const conversation = useConversation({
    onConnect: ({ conversationId }) => {
      conversationIdRef.current = conversationId;
      setSecs(0);
      if (tmrRef.current) clearInterval(tmrRef.current);
      tmrRef.current = setInterval(() => setSecs((s) => s + 1), 1000);
    },
    onMessage: ({ message, source }: { message: string; source: "user" | "ai" }) => {
      setMessages((m) => [...m, { source, text: message }]);
    },
    onDisconnect: () => {
      if (tmrRef.current) clearInterval(tmrRef.current);
      saveInterview();
      setScreen("done");
    },
  });
  const { status, startSession, endSession, isSpeaking, isListening, sendUserMessage } =
    conversation;

  useEffect(() => {
    return () => {
      if (tmrRef.current) clearInterval(tmrRef.current);
    };
  }, []);

  useEffect(() => {
    const t = threadRef.current;
    if (t) t.scrollTop = t.scrollHeight;
  }, [messages, isSpeaking]);

  async function startInterview() {
    // Mic permission first, then signed URL, then start the session (unchanged).
    await navigator.mediaDevices.getUserMedia({ audio: true });
    emailRef.current = email;
    setMessages([]);
    setScreen("interview");
    const res = await fetch("/api/signed-url");
    const { signedUrl } = await res.json();

    // Per-study interviewer prompt (Layer B). If no study loaded, start plain
    // so the dashboard-default agent behavior applies (generic fallback).
    startSession({ signedUrl, connectionType: "websocket", ...buildStudyOverrides(study) });
  }

  function sendTyped() {
    const v = typed.trim();
    if (!v) return;
    sendUserMessage(v);
    setMessages((m) => [...m, { source: "user", text: v }]);
    setTyped("");
  }

  const emailOk = /\S+@\S+\.\S+/.test(email.trim());
  const mmss =
    String(Math.floor(secs / 60)).padStart(2, "0") + ":" + String(secs % 60).padStart(2, "0");

  const stageClass =
    "stage" + (isSpeaking ? " speaking" : "") + (isListening ? " listening" : "");
  const vstatus =
    status === "connecting"
      ? "Connecting…"
      : isSpeaking
        ? "<b>Prism is speaking</b>"
        : isListening
          ? "Listening…"
          : status === "connected"
            ? "Connected"
            : "—";

  // ---------- CONSENT ----------
  if (screen === "consent") {
    return (
      <div className="prism-iv">
        <section className="screen on">
          <div className="center">
            <div className="hero">
              <div className="host-chip">
                <span className="logo">V</span>
                <span><b>Virtual Internships</b></span>
                <span className="dot"></span>
                <span className="via">via <TriLogo size={11} /> Prism</span>
              </div>

              <div className="orb"><VoiceOrb /></div>

              <span className="eyebrow"><span className="pip"></span>User interview · ~5 min</span>
              <h1>You shared feedback. Can we hear a bit more?</h1>

              <div className="from">
                <span className="fav">MC</span>
                <span className="fmeta"><b>Maya Chen</b> · Product Designer at Virtual Internships</span>
              </div>

              <p className="sub">
                Hi! Thanks for the feedback you left us recently — it genuinely helps. I&apos;d love
                to understand it a little better, so I&apos;ve set up a short AI interview you can do
                whenever suits you. About 5 minutes, and there are no right answers.
              </p>

              <div className="capture">
                <input
                  className="inp"
                  type="email"
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && emailOk && consented) startInterview();
                  }}
                />
                <button
                  className="btn btn-dark"
                  disabled={!(emailOk && consented)}
                  onClick={startInterview}
                >
                  Start interview →
                </button>
              </div>

              <label
                className={"consent-mini" + (consented ? " checked" : "")}
                onClick={() => setConsented((c) => !c)}
              >
                <span className="cbox">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="ct">
                  I&apos;m okay with this conversation being <b>recorded &amp; transcribed</b> for
                  this research. I can stop anytime.
                </span>
              </label>

              <p className="privacy">
                Used only for this research by the Virtual Internships team — never sold or shared.
              </p>
              <details className="whatis">
                <summary>What is this AI interview?</summary>
                <p>
                  Instead of scheduling a call, you&apos;ll chat with Prism — our AI interviewer. It
                  simply asks a few questions and listens, so you can answer in your own time.
                  Everything you share goes only to the Virtual Internships design team.
                </p>
              </details>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // ---------- THANK YOU ----------
  if (screen === "done") {
    return (
      <div className="prism-iv">
        <section className="screen on">
          <div className="center">
            <div className="done-wrap">
              <div className="done-orb">
                <VoiceOrb />
                <div className="done-check">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6">
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
              <h1>Thank you!</h1>
              <p className="msg-p">
                Your answers are on their way to Maya and the Virtual Internships team. This is
                exactly the kind of detail that helps us fix the right things — we really appreciate
                it.
              </p>
              <div className="recap">
                <span className="rl">What we covered</span>
                <span>Your goal</span>
                <span>What frustrated you</span>
                <span>Your top fix</span>
              </div>
              <div className="done-note">
                <span className="pip"></span>
                <div>
                  Your responses are used only for this research. Nothing you shared is published or
                  tied to you publicly.
                </div>
              </div>
              <div className="done-close">You can safely close this tab.</div>
              <a className="learn" href="/">Curious what Prism is? →</a>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // ---------- INTERVIEW ----------
  return (
    <div className="prism-iv">
      <section className={"screen on interview " + mode}>
        <div className="ivbar">
          <div className="study">
            <span className="tri"><TriLogo size={16} /></span>
            <span>Virtual Internships · User interview</span>
          </div>
          <span className="rec"><span className="d"></span><span>{mmss}</span></span>
          <div className="ctrls">
            <button
              className="linkbtn"
              onClick={() => setMode((m) => (m === "voice" ? "type" : "voice"))}
            >
              {mode === "voice" ? (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="3" y="6" width="18" height="12" rx="2" />
                    <path d="M8 14h8" strokeLinecap="round" />
                  </svg>
                  Prefer to type
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM6 11a6 6 0 0012 0M12 17v4" strokeLinecap="round" />
                  </svg>
                  Prefer to talk
                </>
              )}
            </button>
            <button className="endbtn" onClick={() => endSession()}>End</button>
          </div>
        </div>

        <div className="ivbody">
          <div className={stageClass}>
            <div className="orbwrap">
              <span className="glow"></span>
              <span className="ring c"></span>
              <span className="ring b"></span>
              <span className="ring a"></span>
              <div className="bigorb"><VoiceOrb /></div>
            </div>
            <div className="vstatus" dangerouslySetInnerHTML={{ __html: vstatus }} />
            <div className="wave">
              <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
            </div>
          </div>

          <div className="conv">
            <div className="conv-head">
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span className="conv-presence"><span className="pdot"></span>Prism</span>
                <span className="t">Conversation</span>
              </div>
              <span className="p">{status === "connected" ? "Live" : "Getting started…"}</span>
            </div>
            <div className="progbar"><div style={{ width: status === "connected" ? "100%" : "0%" }} /></div>
            <div className="thread" ref={threadRef}>
              {messages.map((m, i) => (
                <div key={i} className={"msg " + (m.source === "ai" ? "ai" : "me")}>
                  {m.source === "ai" && <div className="ava"></div>}
                  <div className="bubble">{m.text}</div>
                </div>
              ))}
              {isSpeaking && (
                <div className="msg ai">
                  <div className="ava"></div>
                  <div className="bubble">
                    <div className="typing"><span></span><span></span><span></span></div>
                  </div>
                </div>
              )}
            </div>
            <div className="composer">
              <textarea
                rows={1}
                placeholder="Type your answer…"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendTyped();
                  }
                }}
              />
              <button className="send" onClick={sendTyped} aria-label="Send" disabled={!typed.trim()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function InterviewPage() {
  return (
    <ConversationProvider>
      <InterviewInner />
    </ConversationProvider>
  );
}
