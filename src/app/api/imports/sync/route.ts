import { auth } from "@/server/auth";
import { database } from "@/server/db";
import { classifyPancake } from "@/server/onchain/pancake-v3";
import { watchKey } from "@/server/onchain/wallet-store";
import { createWalletSync, walletProvider } from "@/server/onchain/wallet-sync";

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const origin = process.env.BETTER_AUTH_URL?.replace(/\/$/, "");
  if (!origin || request.headers.get("origin") !== origin)
    return new Response(null, { status: 403, headers });
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401, headers });
  const provider = walletProvider(
    AbortSignal.any([request.signal, AbortSignal.timeout(32_000)]),
  );
  try {
    const db = database();
    await createWalletSync(db, {
      ...provider,
      classify: classifyPancake,
      signal: request.signal,
    })(session.user.id);
    const watch = await db.walletWatch.findUnique({
      where: watchKey(session.user.id),
      select: { updatedAt: true, leaseUntil: true },
    });
    return Response.json(
      {
        updatedAt: watch ? +watch.updatedAt : 0,
        busy: watch?.leaseUntil ? +watch.leaseUntil > Date.now() : false,
      },
      { headers },
    );
  } catch (error) {
    console.error(
      "LPStacks wallet sync failed",
      error instanceof Error ? error.name : "Unknown error",
    );
    return new Response(null, { status: 503, headers });
  }
}
