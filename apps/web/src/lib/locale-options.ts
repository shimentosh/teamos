import type { PickerOption } from "@/components/ui/option-picker";

// Shown first; the rest follow alphabetically. Bangladesh and its usual
// trading and remittance partners lead.
const COMMON_CURRENCIES = [
  "BDT",
  "USD",
  "EUR",
  "GBP",
  "INR",
  "AED",
  "SAR",
  "QAR",
  "KWD",
  "MYR",
  "SGD",
  "CAD",
  "AUD",
  "JPY",
  "CNY",
  "PKR",
  "NPR",
  "LKR",
];

const COMMON_ZONES = [
  "Asia/Dhaka",
  "Asia/Kolkata",
  "Asia/Karachi",
  "Asia/Kathmandu",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

function supported(kind: "currency" | "timeZone", fallback: string[]) {
  try {
    return Intl.supportedValuesOf(kind);
  } catch {
    return fallback;
  }
}

function currencySymbol(code: string, locale: string) {
  try {
    return (
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
        currencyDisplay: "narrowSymbol",
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value ?? ""
    );
  } catch {
    return "";
  }
}

function withCommonFirst(all: string[], common: string[], current: string) {
  const known = new Set(all);
  const first = common.filter((value) => known.has(value) || value === "UTC");
  const rest = all.filter((value) => !first.includes(value)).sort();
  // Keep whatever is saved selectable, even if this browser doesn't list it.
  const extra =
    current && !known.has(current) && !first.includes(current) ? [current] : [];
  return [...extra, ...first, ...rest];
}

export function currencyOptions(locale: string, current = ""): PickerOption[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: "currency" });
  } catch {}
  return withCommonFirst(
    supported("currency", COMMON_CURRENCIES),
    COMMON_CURRENCIES,
    current,
  ).map((code) => {
    const name = names?.of(code);
    const symbol = currencySymbol(code, locale);
    return {
      value: code,
      label: name && name !== code ? `${code} — ${name}` : code,
      hint: symbol && symbol !== code ? symbol : undefined,
    };
  });
}

/** "GMT+6" for Asia/Dhaka, right now. */
export function zoneOffset(timeZone: string) {
  try {
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "shortOffset",
      })
        .formatToParts(new Date())
        .find((part) => part.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

export function timeZoneOptions(current = ""): PickerOption[] {
  return withCommonFirst(
    supported("timeZone", COMMON_ZONES),
    COMMON_ZONES,
    current,
  ).map((zone) => ({
    value: zone,
    label: zone.replace(/_/g, " "),
    hint: zoneOffset(zone),
  }));
}
