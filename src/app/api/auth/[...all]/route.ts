import { auth } from "@/server/auth";

const allowed = new Set(["/api/auth/sign-in/email", "/api/auth/sign-out"]);

export function POST(request: Request) {
  if (!allowed.has(new URL(request.url).pathname))
    return new Response(null, { status: 404 });
  return auth().handler(request);
}
