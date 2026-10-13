/** Interpret form date/time values in the event's IANA timezone, independent of the device clock. */
export function dateTimeInZone(date: string, time: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(wallTime).toISOString().slice(0, 16) !== `${date}T${time}`) return null;

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    let instant = wallTime;
    // Re-evaluate the offset at the resulting instant to handle daylight-saving boundaries.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
      const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
      const adjustment = wallTime - rendered;
      if (adjustment === 0) return new Date(instant);
      instant += adjustment;
    }
    // A local time skipped by the spring clock change has no matching instant.
    return null;
  } catch {
    return null;
  }
}
