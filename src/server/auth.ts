import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { database } from "./db";

export function makeAuth(enrollment = false) {
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (
    !secret ||
    secret.length < 32 ||
    secret.startsWith("replace-") ||
    !baseURL
  ) {
    throw new Error(
      "Configure BETTER_AUTH_URL and a random BETTER_AUTH_SECRET of at least 32 characters.",
    );
  }
  const url = new URL(baseURL);
  if (
    url.origin !== baseURL.replace(/\/$/, "") ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  ) {
    throw new Error(
      "BETTER_AUTH_URL must be an HTTPS origin (HTTP is allowed on loopback).",
    );
  }
  return betterAuth({
    appName: "LPStacks",
    baseURL: url.origin,
    secret,
    database: prismaAdapter(database(), { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !enrollment,
      autoSignIn: false,
      minPasswordLength: 12,
    },
    session: { expiresIn: 60 * 60 * 24 * 7 },
    advanced: {
      useSecureCookies: url.protocol === "https:",
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
  });
}

let instance: ReturnType<typeof makeAuth> | undefined;
export function auth() {
  return (instance ??= makeAuth());
}
