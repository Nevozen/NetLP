import { Temporal } from "@js-temporal/polyfill";
import { AccountingError, requireFact } from "@/domain/values";

export function isTimezone(zone: string) {
  try {
    return (
      !/^[+-]/.test(zone) &&
      Boolean(
        new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions()
          .timeZone,
      )
    );
  } catch {
    return false;
  }
}

export function fromLocal(text: string, zone: string) {
  requireFact(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?$/.test(text),
    "Enter a date and time.",
  );
  let ms: number;
  try {
    ms = Temporal.PlainDateTime.from(text).toZonedDateTime(zone, {
      disambiguation: "reject",
    }).epochMilliseconds;
  } catch {
    throw new AccountingError(
      "Choose a valid local time; daylight-saving gaps and ambiguous times are not accepted.",
    );
  }
  requireFact(
    ms <= Date.now(),
    "An observation or event cannot be in the future.",
  );
  return new Date(ms).toISOString();
}

export function localInput(at: string, zone: string) {
  return Temporal.Instant.from(at)
    .toZonedDateTimeISO(zone)
    .toPlainDateTime()
    .toString({ smallestUnit: "millisecond" });
}

export function displayTime(at: string | Date, zone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
}
