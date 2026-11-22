import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

type TranscriptTurn = { role?: string; message?: string | null };

// On-demand transcript fetch from ElevenLabs (same combine logic as
// save-interview). Returns "" if the transcript isn't ready yet.
async function fetchElevenLabsTranscript(
  conversationId: string,
  apiKey: string
): Promise<string> {
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
      { headers: { "xi-api-key": apiKey } }
    );
    if (!res.ok) return "";
    const data = (await res.json()) as { transcript?: TranscriptTurn[] };
    return (data.transcript ?? [])
      .filter((t) => t.message != null && t.message !== "")
      .map((t) => `${t.role ?? "unknown"}: ${t.message}`)
      .join("\n");
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;

  if (!supabaseUrl || !supabaseSecret || !openaiKey) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, or OPENAI_API_KEY" },
      { status: 500 }
    );
  }

  let body: { interviewId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { interviewId } = body;
  if (!interviewId) {
    return NextResponse.json({ error: "interviewId is required" }, { status: 400 });
  }

  // Fetch the transcript (server client with secret key bypasses RLS).
  const supabase = createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: interview, error: dbError } = await supabase
    .from("interviews")
    .select("conversation_id, transcript, study_id")
    .eq("id", interviewId)
    .single();

  if (dbError || !interview) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }

  // Self-heal: transcripts sometimes aren't ready at save time. If the stored
  // transcript is empty, fetch it on demand from ElevenLabs and backfill the row.
  let transcript: string = interview.transcript ?? "";
  if (!transcript) {
    if (elevenLabsKey && interview.conversation_id) {
      transcript = await fetchElevenLabsTranscript(interview.conversation_id, elevenLabsKey);
      if (transcript) {
        await supabase.from("interviews").update({ transcript }).eq("id", interviewId);
      }
    }
    if (!transcript) {
      // Still not ready — tell the client to show a "preparing" state and retry.
      return NextResponse.json(
        {
          pending: true,
          error:
            "The transcript is still being prepared. This usually takes under a minute — try again shortly.",
        },
        { status: 202 }
      );
    }
  }

  const openai = new OpenAI({ apiKey: openaiKey });

  // Maps OpenAI errors to a clear response (quota/billing handled explicitly).
  function openAiError(err: unknown) {
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
    return null;
  }

  // RAG retrieval: embed (the first ~1000 words of) the transcript, then fetch
  // the most relevant company-context chunks via the match_chunks RPC.
  const queryText = transcript.split(/\s+/).slice(0, 1000).join(" ");

  let queryEmbedding: number[];
  try {
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: queryText,
    });
    queryEmbedding = embedding.data[0].embedding;
  } catch (err) {
    return openAiError(err) ?? NextResponse.json({ error: "Failed to create embedding" }, { status: 502 });
  }

  // Scope retrieval to this interview's study KB (null = global, all chunks).
  const { data: matches, error: matchError } = await supabase.rpc("match_chunks", {
    query_embedding: queryEmbedding,
    match_count: 3,
    filter_study_id: interview.study_id ?? null,
  });
  if (matchError) {
    return NextResponse.json(
      { error: `Context retrieval failed: ${matchError.message}` },
      { status: 500 }
    );
  }

  const contextChunks = ((matches ?? []) as { content: string }[]).map((m) => m.content);
  const companyContext = contextChunks.length
    ? contextChunks.map((c, i) => `[${i + 1}] ${c}`).join("\n\n")
    : "(no relevant company context found)";

  let content: string | null;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a UX research analyst. Analyze the user interview transcript and respond with ONLY valid JSON (no markdown, no prose) matching exactly this shape: " +
            '{"summary": string (2-3 sentences), "themes": [{"theme": string, "quote": string (a short verbatim quote from the transcript)}], "sentiment": string (one word), "pain_points": [string]}.' +
            "\n\nCompany context (use this to make the insights more specific and grounded):\n" +
            companyContext,
        },
        { role: "user", content: transcript },
      ],
    });
    content = completion.choices[0]?.message?.content ?? null;
  } catch (err) {
    return openAiError(err) ?? NextResponse.json({ error: "Failed to call OpenAI" }, { status: 502 });
  }

  if (!content) {
    return NextResponse.json({ error: "OpenAI returned an empty response" }, { status: 502 });
  }

  // Parse the JSON safely.
  let insights;
  try {
    insights = JSON.parse(content);
  } catch {
    return NextResponse.json(
      { error: "OpenAI did not return valid JSON" },
      { status: 502 }
    );
  }

  const result = { ...insights, context_used: contextChunks };

  // Persist the generated insights into the interview's analysis column.
  const { error: saveError } = await supabase
    .from("interviews")
    .update({ analysis: result })
    .eq("id", interviewId);
  if (saveError) {
    return NextResponse.json(
      { error: `Analysis generated but failed to save: ${saveError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json(result);
}
