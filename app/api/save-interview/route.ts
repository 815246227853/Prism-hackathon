import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type TranscriptTurn = { role?: string; message?: string | null };

// Fetch the conversation details (including transcript) from ElevenLabs.
async function fetchConversation(conversationId: string, apiKey: string) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
    { headers: { "xi-api-key": apiKey } }
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs request failed (${res.status})`);
  }
  return res.json() as Promise<{ transcript?: TranscriptTurn[] }>;
}

function combineTranscript(turns: TranscriptTurn[] = []): string {
  return turns
    .filter((t) => t.message != null && t.message !== "")
    .map((t) => `${t.role ?? "unknown"}: ${t.message}`)
    .join("\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;

  if (!apiKey || !supabaseUrl || !supabaseSecret) {
    return NextResponse.json(
      { error: "Missing ELEVENLABS_API_KEY, NEXT_PUBLIC_SUPABASE_URL, or SUPABASE_SECRET_KEY" },
      { status: 500 }
    );
  }

  let body: { conversationId?: string; participantName?: string; studySlug?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { conversationId, participantName, studySlug } = body;
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  // The transcript can take a few seconds to be ready after the call ends.
  // If it comes back empty, wait 2s and retry once.
  let transcript = "";
  try {
    const data = await fetchConversation(conversationId, apiKey);
    transcript = combineTranscript(data.transcript);
    if (!transcript) {
      await sleep(2000);
      const retry = await fetchConversation(conversationId, apiKey);
      transcript = combineTranscript(retry.transcript);
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch transcript" },
      { status: 502 }
    );
  }

  // Server-side client using the secret key bypasses RLS.
  const supabase = createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Resolve the study from its share slug (if the link carried one).
  let studyId: string | null = null;
  if (studySlug) {
    const { data: study } = await supabase
      .from("studies")
      .select("id")
      .eq("slug", studySlug)
      .maybeSingle();
    studyId = study?.id ?? null;
  }

  const { error } = await supabase.from("interviews").insert({
    participant_name: participantName ?? null,
    conversation_id: conversationId,
    transcript,
    study_id: studyId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
