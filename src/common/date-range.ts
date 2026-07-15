const GUATEMALA_UTC_OFFSET = "-06:00";
const GUATEMALA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const parseGuatemalaDate = (value?: string | null, endOfDay = false) => {
  const text = `${value || ""}`.trim();
  if (!DATE_ONLY_RE.test(text)) return null;
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const date = new Date(`${text}T${time}${GUATEMALA_UTC_OFFSET}`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getGuatemalaDateInput = (date = new Date()) =>
  new Date(date.getTime() - GUATEMALA_OFFSET_MS).toISOString().slice(0, 10);

export const getGuatemalaDayRange = (value?: string | null) => {
  const dateInput = DATE_ONLY_RE.test(`${value || ""}`.trim())
    ? `${value}`.trim()
    : getGuatemalaDateInput();
  return {
    start: parseGuatemalaDate(dateInput) as Date,
    end: parseGuatemalaDate(dateInput, true) as Date,
  };
};
