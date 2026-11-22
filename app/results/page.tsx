import { listInterviews } from "@/lib/db";
import ResultsList, { type Interview } from "./ResultsList";

// Always fetch fresh on request (reads from the local data store).
export const dynamic = "force-dynamic";

export default async function ResultsPage() {
  let interviews: Interview[] = [];
  let error: string | null = null;
  try {
    interviews = await listInterviews();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 font-sans">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Interviews</h1>
      {error ? (
        <p className="text-red-600">Failed to load interviews: {error}</p>
      ) : (
        <ResultsList interviews={interviews} />
      )}
    </div>
  );
}
