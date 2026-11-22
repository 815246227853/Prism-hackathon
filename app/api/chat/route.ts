import { NextResponse } from "next/server";
import OpenAI from "openai";

// Text-interview fallback: used by /interview when ElevenLabs voice isn't
// configured. Takes the conversation so far and returns Prism's next turn.
type Turn = { source: "user" | "ai"; text: string };

export async function POST(request: Request) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
  }

  let body: { systemPrompt?: string; messages?: Turn[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt : "";
  const messages = Array.isArray(body.messages) ? body.messages.slice(-40) : [];
  if (!systemPrompt || messages.length === 0) {
    return NextResponse.json({ error: "systemPrompt and messages are required" }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey: openaiKey });
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content:
            systemPrompt +
            "\nThis interview is happening over text chat. Keep each reply to 1-3 short sentences and ask one question at a time.",
        },
        ...messages.map((m) => ({
          role: m.source === "ai" ? ("assistant" as const) : ("user" as const),
          content: String(m.text ?? "").slice(0, 4000),
        })),
      ],
    });
    const reply = completion.choices[0]?.message?.content?.trim() || "Thanks — could you tell me a bit more?";
    return NextResponse.json({ reply });
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      const status = err.status === 429 ? 429 : 502;
      return NextResponse.json({ error: `OpenAI error: ${err.message}` }, { status });
    }
    return NextResponse.json({ error: "Failed to generate reply" }, { status: 500 });
  }
}
