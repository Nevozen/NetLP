import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const standalone = resolve(".next/standalone");
if (!existsSync(standalone))
  throw new Error("Next.js standalone output is missing.");
cpSync(resolve(".next/static"), resolve(standalone, ".next/static"), {
  recursive: true,
});
if (existsSync(resolve("public")))
  cpSync(resolve("public"), resolve(standalone, "public"), { recursive: true });
