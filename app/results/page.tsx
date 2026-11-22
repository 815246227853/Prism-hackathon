import { createClient } from "@supabase/supabase-js";
import ResultsList, { type Interview } from "./ResultsList";

// Always fetch fresh on request (this reads from the database).
export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
  // Supabase is optional for now: render an empty state instead of crashing.
  if (!supabaseUrl || !supabaseSecret) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12 font-sans">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Interviews</h1>
        <ResultsList interviews={[]} />
      </div>
    );
  }

  const supabase = createClient(supabaseUrl, supabaseSecret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from("interviews")
    .select("id, participant_name, conversation_id, transcript, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 font-sans">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Interviews</h1>
      {error ? (
        <p className="text-red-600">Failed to load interviews: {error.message}</p>
      ) : (
        <ResultsList interviews={(data ?? []) as Interview[]} />
      )}
    </div>
  );
}
