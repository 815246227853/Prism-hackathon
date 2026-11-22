import { NextResponse } from "next/server";
import { getStudyBySlug } from "@/lib/db";

// Public-facing: resolve a study by its share slug so the interview page can
// build a per-study interviewer prompt. Returns only what the interviewer needs.
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const study = await getStudyBySlug(slug);

  if (!study) {
    return NextResponse.json({ error: "Study not found" }, { status: 404 });
  }

  return NextResponse.json({
    name: study.name,
    objective: study.objective,
    questions: Array.isArray(study.questions) ? study.questions : [],
  });
}
