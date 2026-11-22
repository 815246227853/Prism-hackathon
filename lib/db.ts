// Storage layer. Server-only.
// Uses Supabase when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY are set;
// otherwise falls back to a local JSON file (data/db.json) with in-memory
// cosine search for RAG.
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type StudyRow = {
  id: string;
  name: string;
  objective: string;
  audience: string | null;
  questions: string[];
  slug: string;
  created_at: string;
};

export type InterviewRow = {
  id: string;
  participant_name: string | null;
  conversation_id: string;
  transcript: string;
  analysis: unknown | null;
  study_id: string | null;
  created_at: string;
};

export type ChunkRow = {
  id: string;
  content: string;
  embedding: number[];
  study_id: string | null;
  created_at: string;
};

type Db = { studies: StudyRow[]; interviews: InterviewRow[]; doc_chunks: ChunkRow[] };

// ---------- Supabase (used when configured) ----------

let sbClient: SupabaseClient | null | undefined;
function sb(): SupabaseClient | null {
  if (sbClient !== undefined) return sbClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  sbClient =
    url && secret
      ? createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } })
      : null;
  return sbClient;
}

export const storageBackend = () => (sb() ? "supabase" : "json");

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Supabase ${what} failed: ${res.error.message}`);
  return res.data;
}

const STUDY_COLS = "id, name, objective, audience, questions, slug, created_at";
const INTERVIEW_COLS =
  "id, participant_name, conversation_id, transcript, analysis, study_id, created_at";

// ---------- Local JSON file (fallback) ----------

// Vercel's filesystem is read-only except /tmp (and /tmp is wiped between
// cold starts, so data there is temporary). Locally, use ./data.
const DATA_DIR = process.env.VERCEL
  ? path.join("/tmp", "prism-data")
  : path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

async function load(): Promise<Db> {
  try {
    const raw = JSON.parse(await fs.readFile(DB_FILE, "utf8")) as Partial<Db>;
    return {
      studies: raw.studies ?? [],
      interviews: raw.interviews ?? [],
      doc_chunks: raw.doc_chunks ?? [],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { studies: [], interviews: [], doc_chunks: [] };
    }
    throw err;
  }
}

async function save(db: Db): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db));
  await fs.rename(tmp, DB_FILE); // atomic replace
}

// Serialize read-modify-write cycles so concurrent requests don't clobber each other.
let queue: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: (db: Db) => T): Promise<T> {
  const run = queue.then(async () => {
    const db = await load();
    const result = fn(db);
    await save(db);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

const now = () => new Date().toISOString();
const byNewest = <T extends { created_at: string }>(a: T, b: T) =>
  b.created_at.localeCompare(a.created_at);

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "study"}-${randomUUID().slice(0, 6)}`;
}

// --- studies ---

export async function listStudies(): Promise<StudyRow[]> {
  const s = sb();
  if (s) {
    const res = await s.from("studies").select(STUDY_COLS).order("created_at", { ascending: false });
    return (check(res, "list studies") ?? []) as StudyRow[];
  }
  return (await load()).studies.sort(byNewest);
}

export async function getStudyBySlug(slug: string): Promise<StudyRow | null> {
  const s = sb();
  if (s) {
    const res = await s.from("studies").select(STUDY_COLS).eq("slug", slug).maybeSingle();
    return check(res, "get study") as StudyRow | null;
  }
  return (await load()).studies.find((st) => st.slug === slug) ?? null;
}

export async function createStudy(input: {
  name: string;
  objective: string;
  audience: string | null;
  questions: string[];
}): Promise<StudyRow> {
  const s = sb();
  if (s) {
    const res = await s
      .from("studies")
      .insert({ ...input, slug: slugify(input.name) })
      .select(STUDY_COLS)
      .single();
    return check(res, "create study") as StudyRow;
  }
  return mutate((db) => {
    const study: StudyRow = { id: randomUUID(), slug: slugify(input.name), created_at: now(), ...input };
    db.studies.push(study);
    return study;
  });
}

// --- interviews ---

export async function listInterviews(): Promise<InterviewRow[]> {
  const s = sb();
  if (s) {
    const res = await s
      .from("interviews")
      .select(INTERVIEW_COLS)
      .order("created_at", { ascending: false });
    return (check(res, "list interviews") ?? []) as InterviewRow[];
  }
  return (await load()).interviews.sort(byNewest);
}

export async function getInterview(id: string): Promise<InterviewRow | null> {
  const s = sb();
  if (s) {
    const res = await s.from("interviews").select(INTERVIEW_COLS).eq("id", id).maybeSingle();
    return check(res, "get interview") as InterviewRow | null;
  }
  return (await load()).interviews.find((i) => i.id === id) ?? null;
}

export async function createInterview(input: {
  participant_name: string | null;
  conversation_id: string;
  transcript: string;
  study_id: string | null;
}): Promise<InterviewRow> {
  const s = sb();
  if (s) {
    const res = await s.from("interviews").insert(input).select(INTERVIEW_COLS).single();
    return check(res, "save interview") as InterviewRow;
  }
  return mutate((db) => {
    const row: InterviewRow = { id: randomUUID(), analysis: null, created_at: now(), ...input };
    db.interviews.push(row);
    return row;
  });
}

export async function updateInterview(
  id: string,
  patch: Partial<Pick<InterviewRow, "transcript" | "analysis">>
): Promise<boolean> {
  const s = sb();
  if (s) {
    const res = await s.from("interviews").update(patch).eq("id", id).select("id");
    return (check(res, "update interview") ?? []).length > 0;
  }
  return mutate((db) => {
    const row = db.interviews.find((i) => i.id === id);
    if (!row) return false;
    Object.assign(row, patch);
    return true;
  });
}

// --- knowledge base (RAG) ---

export async function addChunks(
  chunks: { content: string; embedding: number[] }[],
  studyId: string | null
): Promise<number> {
  const s = sb();
  if (s) {
    const rows = chunks.map((c) => ({ ...c, study_id: studyId }));
    check(await s.from("doc_chunks").insert(rows), "save knowledge base");
    return chunks.length;
  }
  return mutate((db) => {
    const created_at = now();
    for (const c of chunks) {
      db.doc_chunks.push({ id: randomUUID(), study_id: studyId, created_at, ...c });
    }
    return chunks.length;
  });
}

export async function chunkCountByStudy(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const s = sb();
  const rows: { study_id: string | null }[] = s
    ? ((check(await s.from("doc_chunks").select("study_id"), "count chunks") ?? []) as {
        study_id: string | null;
      }[])
    : (await load()).doc_chunks;
  for (const c of rows) {
    if (c.study_id) counts[c.study_id] = (counts[c.study_id] ?? 0) + 1;
  }
  return counts;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// Top-k chunks by similarity. studyId null = search all chunks.
export async function matchChunks(
  embedding: number[],
  k: number,
  studyId: string | null
): Promise<{ content: string; similarity: number }[]> {
  const s = sb();
  if (s) {
    const res = await s.rpc("match_chunks", {
      query_embedding: embedding,
      match_count: k,
      filter_study_id: studyId,
    });
    return (check(res, "search knowledge base") ?? []) as { content: string; similarity: number }[];
  }
  return (await load()).doc_chunks
    .filter((c) => studyId == null || c.study_id === studyId)
    .map((c) => ({ content: c.content, similarity: cosine(embedding, c.embedding) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}
