import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Public-facing: resolve a study by its share slug so the interview page can
// build a per-study interviewer prompt. Returns only what the interviewer needs.
export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecret) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY" },
      { status: 500 }
    );
  }

  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Same slug -> study lookup pattern used by save-interview.
  const { data: study } = await supabase
    .from("studies")
    .select("name, objective, questions")
    .eq("slug", slug)
    .maybeSingle();

  if (!study) {
    return NextResponse.json({ error: "Study not found" }, { status: 404 });
  }

  return NextResponse.json({
    name: study.name,
    objective: study.objective,
    questions: Array.isArray(study.questions) ? study.questions : [],
  });
}
