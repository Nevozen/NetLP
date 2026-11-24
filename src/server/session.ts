import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { database } from "./db";

export const preferences = {
  timezone: "Asia/Jakarta",
  theme: "system",
  denomination: "USD",
};

export const getSession = cache(async () =>
  auth().api.getSession({ headers: await headers() }),
);

export const requireUser = cache(async () => {
  const session = await getSession();
  if (!session) redirect("/login");
  const settings = await database().preference.findUnique({
    where: { userId: session.user.id },
  });
  return { ...session.user, settings: settings ?? preferences };
});
