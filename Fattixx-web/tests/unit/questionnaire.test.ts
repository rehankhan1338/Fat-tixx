import { describe, expect, it } from "vitest";
import { QUESTIONS, allOptions, answerLabels, readAnswers, type QuestionName } from "@/lib/applications/questionnaire";

/** column sizes from db/migrations/0011_organizer_questionnaire.sql */
const COLUMN: Record<QuestionName, number> = { event_types: 255, expected_revenue: 20, events_per_year: 20, typical_attendance: 20, attendee_ages: 100, audiences: 255 };

describe("organizer sign-up questionnaire", () => {
  it("keeps known answers in list order and drops the rest", () => {
    const fd = new FormData();
    for (const v of ["seasonal", "music", "bogus", "music", "nightlife"]) fd.append("event_types", v);
    fd.append("expected_revenue", "free");
    fd.append("expected_revenue", "under_5k");
    fd.append("typical_attendance", "lots");
    const a = readAnswers(fd);
    expect(a.event_types).toBe("music,seasonal,nightlife");
    expect(a.expected_revenue).toBe("under_5k"); // one answer for a single-choice question
    expect(a.typical_attendance).toBeNull();
    expect(a.audiences).toBeNull();
  });

  it("labels stored answers for the admin review", () => {
    const q = QUESTIONS.find((x) => x.name === "event_types")!;
    expect(answerLabels(q, "nightlife,music")).toEqual(["Music", "Nightlife"]);
    expect(answerLabels(q, null)).toEqual([]);
  });

  it("fits every answer in its column, with unique keys", () => {
    for (const q of QUESTIONS) {
      const keys = allOptions(q).map((x) => x.value);
      expect(new Set(keys).size).toBe(keys.length);
      const longest = q.multiple ? keys.join(",").length : Math.max(...keys.map((k) => k.length));
      expect(longest, q.name).toBeLessThanOrEqual(COLUMN[q.name]);
    }
  });
});
