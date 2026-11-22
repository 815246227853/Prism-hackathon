import { NextResponse } from "next/server";
import { createInterview, getStudyBySlug } from "@/lib/db";

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

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ELEVENLABS_API_KEY" },
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

  // Resolve the study from its share slug (if the link carried one).
  const studyId = studySlug ? (await getStudyBySlug(studySlug))?.id ?? null : null;

  try {
    await createInterview({
      participant_name: participantName ?? null,
      conversation_id: conversationId,
      transcript,
      study_id: studyId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save interview" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
