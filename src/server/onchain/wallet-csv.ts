import { parse } from "csv-parse/sync";
import { hash } from "@/domain/model";
import { AccountingError } from "@/domain/values";

export const MAX_CSV_BYTES = 512 * 1024;
export const MAX_CSV_HASHES = 500;
const MAX_ROWS = 5000;

export function csvHashes(text: string) {
  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      max_record_size: 16_384,
      to: MAX_ROWS + 2,
    });
  } catch {
    throw new AccountingError(
      "Use a valid BaseScan CSV export with a transaction hash column.",
    );
  }
  const [headers, ...rows] = records;
  const choices = headers
    ?.map((name) => name.toLowerCase().replace(/[^a-z]/g, ""))
    .flatMap((name, i) =>
      ["txhash", "txnhash", "transactionhash"].includes(name) ? [i] : [],
    );
  if (choices?.length !== 1)
    throw new AccountingError(
      "The CSV needs exactly one transaction hash column.",
    );
  if (rows.length > MAX_ROWS)
    throw new AccountingError(`Use a CSV with at most ${MAX_ROWS} rows.`);
  const hashes = new Set<string>();
  let invalid = 0;
  let duplicates = 0;
  for (const row of rows) {
    const candidate = hash.safeParse(row[choices[0]]);
    if (!candidate.success) invalid++;
    else if (hashes.has(candidate.data)) duplicates++;
    else hashes.add(candidate.data);
  }
  if (hashes.size > MAX_CSV_HASHES)
    throw new AccountingError(
      `Use at most ${MAX_CSV_HASHES} distinct hashes per CSV.`,
    );
  return { hashes: [...hashes], invalid, duplicates };
}
