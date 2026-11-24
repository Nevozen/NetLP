import { D } from "@/domain/values";

export function decimal(
  text: string | null | undefined,
  places?: number,
  signed = false,
) {
  if (text == null) return "N/A";
  const value = new D(text);
  const fixed = places === undefined ? value.toFixed() : value.toFixed(places);
  const [whole, fraction] = fixed.replace(/^-/, "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${value.lt(0) ? "-" : signed && value.gt(0) ? "+" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

export function usd(text: string | null | undefined, signed = false) {
  return text == null
    ? "N/A"
    : decimal(text, 2, signed).replace(/^([+-]?)/, "$1$$");
}

export function equivalent(text: string | null, label: string, signed = false) {
  return text === null
    ? "N/A"
    : label === "USD"
      ? usd(text, signed)
      : `${decimal(text, 8, signed)} ${label}`;
}

export function sign(text: string | null | undefined) {
  return text == null
    ? ""
    : new D(text).gt(0)
      ? "gain"
      : new D(text).lt(0)
        ? "loss"
        : "";
}

export function human(text: string) {
  return text
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^[a-z]/, (letter) => letter.toUpperCase());
}
