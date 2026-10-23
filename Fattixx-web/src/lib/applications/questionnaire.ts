/**
 * Organizer sign-up questionnaire: the multiple-choice steps at the start of the /sell application (project plan,
 * "Organizer Sign Up"). Every question can be skipped. Answers are stored on organizer_applications as option keys,
 * one column per question (questions that take several answers keep a comma-separated list), and shown to platform
 * staff in Admin → Organizer applications. Keys must fit their columns (migration 0011).
 */

export type QuestionName = "event_types" | "expected_revenue" | "events_per_year" | "typical_attendance" | "attendee_ages" | "audiences";
export type Option = { value: string; label: string };
export type Question = {
  /** form field and organizer_applications column */
  name: QuestionName;
  title: string;
  /** label on the admin review card */
  label: string;
  multiple: boolean;
  options: Option[];
  /** further options shown after "More" */
  more?: Option[];
};

const o = (value: string, label: string): Option => ({ value, label });

export const QUESTIONS: Question[] = [
  {
    name: "event_types", title: "What types of events do you organize?", label: "Event types", multiple: true,
    options: [o("music", "Music"), o("food_drink", "Food and drink"), o("community_culture", "Community and culture"), o("business", "Business"), o("performing_arts", "Performing and visual art"), o("seasonal", "Seasonal")],
    more: [o("nightlife", "Nightlife"), o("comedy", "Comedy"), o("sports_fitness", "Sports and fitness"), o("classes", "Classes and workshops"), o("fundraisers", "Fundraisers and charity"), o("fashion_beauty", "Fashion and beauty"), o("family", "Family and kids"), o("other", "Other")],
  },
  {
    name: "expected_revenue", title: "How much revenue do you expect from ticket sales this year?", label: "Expected revenue", multiple: false,
    options: [o("under_5k", "Under $5k"), o("5k_10k", "$5k–10k"), o("10k_50k", "$10k–50k"), o("50k_250k", "$50k–250k"), o("250k_1m", "$250k–1M"), o("1m_plus", "$1M+"), o("unsure", "Unsure, but I do sell tickets"), o("free", "None, my events are free")],
  },
  {
    name: "events_per_year", title: "How many events do you plan to organize in the next 12 months?", label: "Events in 12 months", multiple: false,
    options: [o("1", "1"), o("2_5", "2–5"), o("6_10", "6–10"), o("11_25", "11–25"), o("26_50", "26–50"), o("51_plus", "51+")],
  },
  {
    name: "typical_attendance", title: "How many people usually attend your events?", label: "Typical attendance", multiple: false,
    options: [o("1_250", "1–250"), o("251_1000", "251–1,000"), o("1001_10000", "1,001–10,000"), o("10001_25000", "10,001–25,000"), o("25001_100000", "25,001–100,000"), o("100001_200000", "100,001–200,000"), o("200001_plus", "200,001+")],
  },
  {
    name: "attendee_ages", title: "What’s the typical age range of your attendees?", label: "Attendee ages", multiple: true,
    options: [o("under_18", "Under 18"), o("18_25", "18–25"), o("26_35", "26–35"), o("36_50", "36–50"), o("over_50", "Over 50")],
  },
  {
    name: "audiences", title: "How would you describe your primary audience?", label: "Audience", multiple: true,
    options: [
      o("families", "Families"), o("singles", "Singles"), o("couples", "Couples"), o("party_goers", "Party-goers"), o("music_lovers", "Music lovers"), o("professionals", "Professionals"), o("students", "Students"),
      o("parents", "Parents"), o("travelers", "Travelers"), o("foodies", "Foodies"), o("fitness", "Fitness enthusiasts"), o("local_community", "Local community"), o("other", "Other"),
    ],
  },
];

/** Every option of a question, including those behind "More". */
export const allOptions = (q: Question): Option[] => [...q.options, ...(q.more ?? [])];

export type QuestionnaireAnswers = Record<QuestionName, string | null>;

/** The answers posted with an application: known keys only, in list order, one for single-choice questions; null when skipped. */
export function readAnswers(fd: FormData): QuestionnaireAnswers {
  const out = {} as QuestionnaireAnswers;
  for (const q of QUESTIONS) {
    const posted = new Set(fd.getAll(q.name).map(String));
    const picked = allOptions(q).map((x) => x.value).filter((v) => posted.has(v));
    out[q.name] = (q.multiple ? picked : picked.slice(0, 1)).join(",") || null;
  }
  return out;
}

/** Labels for a stored answer, in list order. */
export function answerLabels(q: Question, stored: string | null | undefined): string[] {
  const keys = new Set((stored ?? "").split(",").filter(Boolean));
  return allOptions(q).filter((x) => keys.has(x.value)).map((x) => x.label);
}
