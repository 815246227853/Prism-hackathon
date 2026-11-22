// Self-contained study share links. The study's name, objective and questions
// are encoded into the URL (?d=...), so the interview page works even if the
// server no longer has the study (e.g. Vercel's temporary /tmp storage).
// Safe to use on client and server.

export type LinkStudy = { name: string; objective: string; questions: string[] };

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeStudy(study: LinkStudy): string {
  return toBase64Url(JSON.stringify({ n: study.name, o: study.objective, q: study.questions }));
}

export function decodeStudy(data: string): LinkStudy | null {
  try {
    const raw = JSON.parse(fromBase64Url(data)) as { n?: unknown; o?: unknown; q?: unknown };
    if (typeof raw.n !== "string" || typeof raw.o !== "string" || !Array.isArray(raw.q)) return null;
    return { name: raw.n, objective: raw.o, questions: raw.q.map(String) };
  } catch {
    return null;
  }
}

export function studyShareLink(origin: string, slug: string, study: LinkStudy): string {
  return `${origin}/interview?study=${encodeURIComponent(slug)}&d=${encodeStudy(study)}`;
}
