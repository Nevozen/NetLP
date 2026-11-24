import { auth } from "@/server/auth";
import { database } from "@/server/db";
import { strategyCsv } from "@/server/export";
import { createJournal, MissingRecord } from "@/server/journal";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401, headers: noStore });
  try {
    const cycle = await createJournal(database()).get(
      session.user.id,
      (await params).id,
    );
    return new Response(strategyCsv(cycle), {
      headers: {
        ...noStore,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="lpstacks-journal.csv"',
      },
    });
  } catch (error) {
    if (error instanceof MissingRecord)
      return new Response(null, { status: 404, headers: noStore });
    throw error;
  }
}
