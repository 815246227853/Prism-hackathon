import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const CHUNK_SIZE = 500; // words per chunk
const OVERLAP = 50; // words shared between consecutive chunks

// Split text into ~500-word chunks with a ~50-word overlap.
function chunkText(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  const step = CHUNK_SIZE - OVERLAP;
  for (let start = 0; start < words.length; start += step) {
    chunks.push(words.slice(start, start + CHUNK_SIZE).join(" "));
    if (start + CHUNK_SIZE >= words.length) break;
  }
  return chunks;
}

export async function POST(request: Request) {
  const openaiKey = process.env.OPENAI_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;

  if (!openaiKey || !supabaseUrl || !supabaseSecret) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, or SUPABASE_SECRET_KEY" },
      { status: 500 }
    );
  }

  let body: { text?: string; studyId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const studyId = body.studyId ?? null;
  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return NextResponse.json({ error: "No content to ingest" }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey: openaiKey });

  // One embeddings call for all chunks (the API accepts an array of inputs).
  let embeddings: number[][];
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: chunks,
    });
    embeddings = response.data.map((d) => d.embedding);
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      if (err.status === 429 || err.code === "insufficient_quota") {
        return NextResponse.json(
          { error: "OpenAI quota/billing limit reached. Check your OpenAI plan and billing." },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: `OpenAI error: ${err.message}` },
        { status: err.status ?? 502 }
      );
    }
    return NextResponse.json({ error: "Failed to create embeddings" }, { status: 502 });
  }

  // Secret-key server client bypasses RLS.
  const supabase = createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const rows = chunks.map((content, i) => ({
    content,
    embedding: embeddings[i],
    study_id: studyId,
  }));

  const { error } = await supabase.from("doc_chunks").insert(rows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ chunks: chunks.length });
}
