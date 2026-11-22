import { chunkCountByStudy, listInterviews, listStudies } from "@/lib/db";
import ResearcherApp, { type Interview, type Study } from "./ResearcherApp";
import "./researcher.css";

// Reads from the local data store on each request.
export const dynamic = "force-dynamic";

export default async function ResearcherPage() {
  const [interviews, studies, kbCountByStudy] = await Promise.all([
    listInterviews(),
    listStudies(),
    chunkCountByStudy(),
  ]);

  return (
    <ResearcherApp
      interviews={interviews as Interview[]}
      studies={studies as Study[]}
      kbCountByStudy={kbCountByStudy}
    />
  );
}
