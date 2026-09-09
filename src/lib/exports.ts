// ─── Export helpers: ICS calendar, plain text, download blob ────────────────
import type { Experience, TripPlan } from "./types";

function icsDate(base: Date, slot: string, addDays: number): string {
  const [h, m] = slot.split(":").map(Number);
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(h, m, 0, 0);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}T${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00`;
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Single-place .ics (detail dialog "add to calendar"). */
export function icsForPlace(exp: Experience): string {
  const now = new Date();
  const start = new Date(now.getTime() + 24 * 3600 * 1000);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + exp.durationMinutes * 60000);
  const f = (d: Date): string =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}00`;
  return wrapIcs([
    "BEGIN:VEVENT",
    `UID:${exp.id}@roam.app`,
    `DTSTAMP:${f(now)}`,
    `DTSTART:${f(start)}`,
    `DTEND:${f(end)}`,
    `SUMMARY:${esc(exp.name)}`,
    `LOCATION:${esc(exp.lat !== undefined ? `${exp.lat},${exp.lon}` : exp.address)}`,
    `DESCRIPTION:${esc(`${exp.description ?? ""}\n${exp.gmapsUrl ?? ""}`.trim())}`,
    "END:VEVENT",
  ]);
}

/** Whole-trip .ics (day plan export). */
export function icsForPlan(plan: TripPlan): string {
  const now = new Date();
  const events: string[] = [];
  plan.days.forEach((day, di) => {
    for (const s of day.stops) {
      events.push(
        [
          "BEGIN:VEVENT",
          `UID:${plan.id}-${di}-${s.experienceId}@roam.app`,
          `DTSTAMP:${icsDate(now, "00:00", 0)}`,
          `DTSTART:${icsDate(now, s.slotStart, di)}`,
          `DTEND:${icsDate(now, s.slotEnd, di)}`,
          `SUMMARY:${esc(s.name)}`,
          `LOCATION:${esc(s.lat !== undefined && s.lon !== undefined ? `${s.lat},${s.lon}` : "")}`,
          `DESCRIPTION:${esc(s.note ?? "")}`,
          "END:VEVENT",
        ].join("\r\n"),
      );
    }
  });
  return wrapIcs(events);
}

function wrapIcs(events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Roam//Open Data Travel//EN",
    "CALSCALE:GREGORIAN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

export function planToText(plan: TripPlan): string {
  const lines: string[] = [
    `Roam trip — ${plan.cityLabel}`,
    `Created ${new Date(plan.createdAt).toLocaleString()}`,
    plan.feasibility.message,
    "",
  ];
  plan.days.forEach((d, i) => {
    lines.push(`── Day ${i + 1} (${d.totalHours} h, ~${d.walkKm ?? "?"} km walking) ──`);
    for (const s of d.stops) {
      lines.push(
        `${s.slotStart}–${s.slotEnd}  ${s.name}${s.travelMinFromPrev ? `  (+${s.travelMinFromPrev} min travel)` : ""}${s.pricePerPerson !== undefined ? `  ₹${s.pricePerPerson}` : ""}`,
      );
    }
    lines.push("");
  });
  lines.push(`Estimated total: ₹${Intl.NumberFormat("en-IN").format(plan.budgetTotal ?? 0)} per person`);
  return lines.join("\n");
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
