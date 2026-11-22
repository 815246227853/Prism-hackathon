import { NextResponse } from "next/server";
import { createStudy } from "@/lib/db";

// Creates a study (no auth — shared pool for now).
export async function POST(request: Request) {
  let body: { name?: string; objective?: string; audience?: string; questions?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim();
  const objective = body.objective?.trim();
  const audience = typeof body.audience === "string" ? body.audience.trim() : "";
  const questions = Array.isArray(body.questions)
    ? body.questions.map((q) => String(q).trim()).filter(Boolean)
    : [];

  if (!name || !objective) {
    return NextResponse.json({ error: "name and objective are required" }, { status: 400 });
  }
  if (questions.length === 0) {
    return NextResponse.json({ error: "at least one question is required" }, { status: 400 });
  }

  try {
    const study = await createStudy({ name, objective, audience: audience || null, questions });
    return NextResponse.json({ id: study.id, slug: study.slug });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create study" },
      { status: 500 }
    );
  }
}
