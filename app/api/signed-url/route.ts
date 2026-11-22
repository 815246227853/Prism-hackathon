import { NextResponse } from "next/server";

// Requests a signed WebSocket URL from ElevenLabs for the configured agent.
// The API key stays server-side and is never sent to the browser.
export async function GET() {
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!agentId || !apiKey) {
    return NextResponse.json(
      { error: "Missing ELEVENLABS_API_KEY or NEXT_PUBLIC_ELEVENLABS_AGENT_ID" },
      { status: 500 }
    );
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
    { headers: { "xi-api-key": apiKey } }
  );

  if (!res.ok) {
    return NextResponse.json(
      { error: `ElevenLabs request failed (${res.status})` },
      { status: 502 }
    );
  }

  const data = await res.json();
  return NextResponse.json({ signedUrl: data.signed_url });
}
