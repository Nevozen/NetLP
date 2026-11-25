import { redirect } from "next/navigation";
import { Brand } from "@/components/ui";
import { SignIn } from "@/components/sign-in";
import { getSession } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function Login() {
  if (await getSession()) redirect("/");
  return (
    <main className="login">
      <section className="login-cover">
        <Brand />
        <div>
          <p className="eyebrow">01 / THE LP JOURNAL</p>
          <h1>
            Put your LP strategy
            <br />
            in perspective.
          </h1>
          <p>
            Track the tokens, the costs, and what holding would have earned
            instead.
          </p>
        </div>
        <small>LPStacks by Wardana Dev</small>
      </section>
      <section className="login-form">
        <div>
          <p className="eyebrow">PRIVATE WORKSPACE</p>
          <h2>Sign in</h2>
          <p className="muted">
            Use the account provisioned by your workspace administrator.
          </p>
          <SignIn />
        </div>
      </section>
    </main>
  );
}
