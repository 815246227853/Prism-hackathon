// Local JSON-file storage (replaces Supabase). Server-only.
// Everything lives in data/db.json; RAG search is cosine similarity in memory.
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

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
  return (await load()).studies.sort(byNewest);
}

export async function getStudyBySlug(slug: string): Promise<StudyRow | null> {
  return (await load()).studies.find((s) => s.slug === slug) ?? null;
}

export function createStudy(input: {
  name: string;
  objective: string;
  audience: string | null;
  questions: string[];
}): Promise<StudyRow> {
  return mutate((db) => {
    const study: StudyRow = { id: randomUUID(), slug: slugify(input.name), created_at: now(), ...input };
    db.studies.push(study);
    return study;
  });
}

// --- interviews ---

export async function listInterviews(): Promise<InterviewRow[]> {
  return (await load()).interviews.sort(byNewest);
}

export async function getInterview(id: string): Promise<InterviewRow | null> {
  return (await load()).interviews.find((i) => i.id === id) ?? null;
}

export function createInterview(input: {
  participant_name: string | null;
  conversation_id: string;
  transcript: string;
  study_id: string | null;
}): Promise<InterviewRow> {
  return mutate((db) => {
    const row: InterviewRow = { id: randomUUID(), analysis: null, created_at: now(), ...input };
    db.interviews.push(row);
    return row;
  });
}

export function updateInterview(
  id: string,
  patch: Partial<Pick<InterviewRow, "transcript" | "analysis">>
): Promise<boolean> {
  return mutate((db) => {
    const row = db.interviews.find((i) => i.id === id);
    if (!row) return false;
    Object.assign(row, patch);
    return true;
  });
}

// --- knowledge base (RAG) ---

export function addChunks(
  chunks: { content: string; embedding: number[] }[],
  studyId: string | null
): Promise<number> {
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
  for (const c of (await load()).doc_chunks) {
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
  return (await load()).doc_chunks
    .filter((c) => studyId == null || c.study_id === studyId)
    .map((c) => ({ content: c.content, similarity: cosine(embedding, c.embedding) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}
