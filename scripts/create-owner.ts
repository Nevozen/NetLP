import "dotenv/config";
import { z } from "zod";
import { makeAuth } from "@/server/auth";
import { database } from "@/server/db";

const owner = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.email().max(254),
    password: z.string().min(12).max(128),
  })
  .safeParse({
    name: process.env.LPSTACKS_OWNER_NAME,
    email: process.env.LPSTACKS_OWNER_EMAIL,
    password: process.env.LPSTACKS_OWNER_PASSWORD,
  });

if (!owner.success) {
  console.error(
    "Set LPSTACKS_OWNER_NAME, LPSTACKS_OWNER_EMAIL and a 12-128 character LPSTACKS_OWNER_PASSWORD.",
  );
  process.exitCode = 1;
} else {
  try {
    await makeAuth(true).api.signUpEmail({ body: owner.data });
    console.log(
      "Owner account created. Clear LPSTACKS_OWNER_PASSWORD from your shell.",
    );
  } catch {
    console.error(
      "Could not create the owner. Verify migrations, auth settings, and email uniqueness.",
    );
    process.exitCode = 1;
  } finally {
    await database().$disconnect();
  }
}
