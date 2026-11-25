import { expect, it } from "vitest";
import { csvCell } from "@/server/export";

it("quotes multiline fields and neutralizes spreadsheet formulas without changing computed negatives", () => {
  expect(csvCell('An "observed" value\nwith a note')).toBe(
    '"An ""observed"" value\nwith a note"',
  );
  for (const text of [
    "=SUM(1,2)",
    " \t+HYPERLINK(1)",
    "\r-1+1",
    "@command",
    "\uFEFF=1",
  ]) {
    expect(csvCell(text)).toMatch(/^"'/);
  }
  expect(csvCell({ decimal: "-10.20" })).toBe('"-10.20"');
  expect(csvCell(null)).toBe('""');
});
