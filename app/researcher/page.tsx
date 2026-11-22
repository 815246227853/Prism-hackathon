import { createClient } from "@supabase/supabase-js";
import ResearcherApp, { type Interview, type Study } from "./ResearcherApp";
import "./researcher.css";

// Reads from the database on each request (secret key bypasses RLS).
export const dynamic = "force-dynamic";

export default async function ResearcherPage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: interviews } = await supabase
    .from("interviews")
    .select("id, participant_name, conversation_id, transcript, created_at, analysis, study_id")
    .order("created_at", { ascending: false });

  const { data: studies } = await supabase
    .from("studies")
    .select("id, name, objective, slug, created_at")
    .order("created_at", { ascending: false });

  // Per-study knowledge-base size (chunks tagged with each study_id).
  const { data: chunkRows } = await supabase.from("doc_chunks").select("study_id");
  const kbCountByStudy: Record<string, number> = {};
  for (const row of chunkRows ?? []) {
    const sid = (row as { study_id: string | null }).study_id;
    if (sid) kbCountByStudy[sid] = (kbCountByStudy[sid] ?? 0) + 1;
  }

  return (
    <ResearcherApp
      interviews={(interviews ?? []) as Interview[]}
      studies={(studies ?? []) as Study[]}
      kbCountByStudy={kbCountByStudy}
    />
  );
}
