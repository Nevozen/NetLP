import { notFound } from "next/navigation";
import { database } from "./db";
import { createJournal, MissingRecord } from "./journal";
import { requireUser } from "./session";

export async function getWorkspace() {
  const user = await requireUser();
  const journal = createJournal(database());
  return { user, journal, requestTime: Date.now() };
}

export async function getCycle(id: string) {
  const context = await getWorkspace();
  try {
    const cycle = await context.journal.get(context.user.id, id);
    return { ...context, cycle };
  } catch (error) {
    if (error instanceof MissingRecord) notFound();
    throw error;
  }
}
