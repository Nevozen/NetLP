export function isolatedDatabase(name: "test" | "e2e") {
  const key =
    name === "test"
      ? "LPSTACKS_TEST_DATABASE_URL"
      : "LPSTACKS_E2E_DATABASE_URL";
  const url = process.env[key];
  if (!url) throw new Error(`Set ${key} to an isolated PostgreSQL database.`);
  const connection = new URL(url);
  const dbName = decodeURIComponent(connection.pathname.slice(1));
  if (
    !new RegExp(`^lpstacks_${name}(?:_[a-z0-9]+)*$`).test(dbName) ||
    !["postgres:", "postgresql:"].includes(connection.protocol)
  ) {
    throw new Error(
      `${key} must point to a database named lpstacks_${name} or lpstacks_${name}_<suffix>.`,
    );
  }
  return url;
}
