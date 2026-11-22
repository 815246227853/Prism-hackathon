import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Creates a study (no auth — shared pool for now). Server-side service key.
export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecret) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY" },
      { status: 500 }
    );
  }

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

  const supabase = createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from("studies")
    .insert({ name, objective, audience: audience || null, questions })
    .select("id, slug")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data); // { id, slug }
}
