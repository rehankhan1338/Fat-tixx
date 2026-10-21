/*
 * Content of the public homepage, the pricing page and the shared footer: the design handoff's copy, kept as data so
 * the components stay presentational. Strings may use tokens such as {fee} that are filled in from the live fee
 * settings and branding when the page renders (see index.ts), so marketing copy always matches checkout.
 */

import type { SocialNetwork } from "../home/types";

export type Link = { label: string; href: string };
export type Step = { title: string; text: string; dot: string };
export type Stat = { big: string; text: string };
export type Rule = { big: string; title: string; text: string };
export type Faq = { q: string; a: string };
export type Social = { network: SocialNetwork; href: string };
export type FooterColumn = { title: string; links: Link[] };

export type HomeContent = {
  meta: { title: string; description: string };
  hero: {
    /** screen-reader page heading */
    heading: string;
    go: { word: string; lead: string; cta: Link; image: string | null };
    host: { word: string; lead: string; cta: Link; image: string | null };
    hint: string;
    hintSub: string;
  };
  how: { show: boolean; eyebrow: string; title: string; lead: string; steps: Step[] };
  featured: { show: boolean };
  browse: { show: boolean; eyebrow: string; title: string; link: Link };
  host: { show: boolean; eyebrow: string; title: string; lead: string; cta: Link; stats: Stat[]; pricingLink: Link };
};

export type PricingContent = {
  meta: { title: string; description: string };
  hero: {
    eyebrow: string;
    title: string;
    lead: string;
    ticketLabel: string;
    ticketType: string;
    ticketTagline: string;
    feeLabel: string;
    payerQuestion: string;
    payerBuyer: string;
    payerOrganizer: string;
    buyerNote: string;
    organizerNote: string;
    taxNote: string;
  };
  rules: { show: boolean; items: Rule[] };
  compare: {
    show: boolean;
    eyebrow: string;
    title: string;
    lead: string;
    /** the other platform's published rates, per paid ticket */
    competitor: { label: string; servicePercent: number; serviceFixedCents: number; processingPercent: number; checked: string };
    saveNote: string;
    footnote: string;
  };
  faq: { show: boolean; eyebrow: string; title: string; lead: string; items: Faq[] };
  cta: { show: boolean; title: string; lead: string; primary: Link; secondaryLabel: string };
};

export type FooterContent = {
  blurb: string;
  social: Social[];
  columns: FooterColumn[];
  copyright: string;
  legal: Link[];
};

export type SiteContent = { home: HomeContent; pricing: PricingContent; footer: FooterContent };

export const DEFAULT_HOME: HomeContent = {
  meta: {
    title: "FATTIXX | Do it all.",
    description: "Find concerts, parties, workshops, fundraisers and more near you, and get your tickets on Fattixx.",
  },
  hero: {
    heading: "Fattixx: tickets for everything. Go out, or throw one.",
    go: {
      word: "GO\nOUT.",
      lead: "Concerts, parties, pop-ups and more. Find what’s on this week and grab your tickets.",
      cta: { label: "Find events", href: "/events" },
      image: null,
    },
    host: {
      word: "THROW\nONE.",
      lead: "Create an event page, sell tickets, and check guests in at the door, all on Fattixx.",
      cta: { label: "Start hosting", href: "/sell" },
      image: null,
    },
    hint: "Same night. Two perspectives.",
    hintSub: "Drag the divider to explore",
  },
  how: {
    show: true,
    eyebrow: "For organizers",
    title: "Host your first event\nin four steps.",
    lead: "Create, sell and share on fattixx.com from your phone or computer. The free scanner app handles the door.",
    steps: [
      { title: "Create your event.", text: "Add a cover, name, date and venue on one simple page, from your phone or computer. Nothing to download, and your draft saves as you go.", dot: "Create" },
      { title: "Set your tickets.", text: "General, VIP or tables. Set prices and limits, choose who covers the fee, and see exactly what buyers pay and what you keep.", dot: "Tickets" },
      { title: "Share one link.", text: "Your event gets its own page. Post it, text it, put it in your bio, and watch sales come in live.", dot: "Share" },
      { title: "Check people in.", text: "At the door, scan tickets with the free Fattixx Scanner app and see who’s arrived in real time.", dot: "Check in" },
    ],
  },
  featured: { show: true },
  browse: { show: true, eyebrow: "On sale now", title: "Upcoming events", link: { label: "Browse all events", href: "/events" } },
  host: {
    show: true,
    eyebrow: "For organizers",
    title: "Hosting something?\nDo it all with FATTIXX.",
    lead: "Build your event page, set your ticket tiers and check guests in at the door, with one simple fee.",
    cta: { label: "Create an event", href: "/create" },
    stats: [
      { big: "6.5% + $1.29", text: "One flat fee per paid ticket, with card processing included." },
      { big: "$19.95", text: "The most you’ll ever pay in fees on a single ticket." },
      { big: "$0", text: "To create an event or list free tickets." },
    ],
    pricingLink: { label: "See the full pricing breakdown", href: "/pricing" },
  },
};

export const DEFAULT_PRICING: PricingContent = {
  meta: {
    title: "Pricing",
    description: "One simple fee: {fee} per paid ticket{processing_clause}. Free events cost nothing.",
  },
  hero: {
    eyebrow: "Pricing",
    title: "Every ticket,\nbroken down.",
    lead: "Pick a price and see exactly where the money goes. One fee per paid ticket{processing_clause}. Free tickets cost nothing.",
    ticketLabel: "Admit one",
    ticketType: "General admission",
    ticketTagline: "Your event, your venue, your night.",
    feeLabel: "Fattixx fee",
    payerQuestion: "Who covers the fee?",
    payerBuyer: "Buyers pay it",
    payerOrganizer: "I’ll cover it",
    buyerNote: "The fees are added to the ticket price at checkout.",
    organizerNote: "The fees come out of your ticket price.",
    taxNote: "Sales tax, where it applies, is added at the venue’s rate.",
  },
  rules: {
    show: true,
    items: [
      { big: "$0", title: "Free events", text: "Create an event and list free tickets without paying a thing." },
      { big: "{fee}", title: "Paid tickets", text: "One fee per ticket sold. Add it to the ticket price or cover it yourself, per event." },
      { big: "{processing_rate}", title: "Card processing", text: "Charged once per order when money moves, never on free tickets." },
    ],
  },
  compare: {
    show: true,
    eyebrow: "Compare",
    title: "More for you. Less for your buyers.",
    lead: "See what a ticket costs in fees on Fattixx next to another platform’s published rates. Pass the difference on to your buyers, or keep it yourself.",
    competitor: { label: "Other platform", servicePercent: 3.7, serviceFixedCents: 179, processingPercent: 2.9, checked: "October 2026" },
    saveNote: "More in your pocket when you cover the fee, or less for your buyers to pay when they cover it.",
    footnote:
      "{competitor}: a leading ticketing platform’s published US fees as of {competitor_checked}, {competitor_rate} per paid ticket. Fattixx: {fee} per paid ticket{processing_clause}. Fees per ticket on a single-ticket order, before sales tax.",
  },
  faq: {
    show: true,
    eyebrow: "Questions",
    title: "Pricing, answered.",
    lead: "Something else on your mind? [Contact us](mailto:{support_email}).",
    items: [
      { q: "Does it cost anything to create an event?", a: "No. Creating an event and listing free tickets is $0. You only pay when you sell a paid ticket." },
      { q: "Is card processing extra?", a: "Card processing is {processing}, charged once per paid order. The {fee} fee is per ticket." },
      { q: "Who pays the fee, me or my buyers?", a: "You choose for each event: add the fees to the ticket price at checkout, or cover them yourself. Either way, buyers see the full price up front." },
      { q: "What about sales tax?", a: "Admissions or sales tax, where it applies, is set per venue or event and shown in the all-in price buyers see." },
      { q: "When do I get paid?", a: "Ticket sales are paid out to your bank account through Stripe once your organizer account is verified, with a settlement statement for every event." },
      {
        q: "What happens to the fee if I refund a ticket?",
        a: "You set the refund policy for your event. When you refund a ticket, the buyer gets the ticket price back and the Fattixx fee isn’t refunded, except when the event is cancelled. [Read the refund rules](/terms#s-5-4).",
      },
    ],
  },
  cta: {
    show: true,
    title: "Your first event is free to set up.",
    lead: "Set up your event in minutes. You only pay when you sell.",
    primary: { label: "Create an event", href: "/create" },
    secondaryLabel: "Contact us",
  },
};

export const DEFAULT_FOOTER: FooterContent = {
  blurb: "Tickets for everything. Find your next night out or throw one. Do it all.",
  social: [],
  columns: [
    {
      title: "Discover",
      links: [
        { label: "Browse events", href: "/events" },
        { label: "This weekend", href: "/events?when=weekend" },
        { label: "Free events", href: "/events?price=free" },
      ],
    },
    {
      title: "Host",
      links: [
        { label: "Create an event", href: "/create" },
        { label: "Pricing", href: "/pricing" },
        { label: "Fattixx Pro", href: "/pro" },
      ],
    },
    {
      title: "Help",
      links: [
        { label: "Find my tickets", href: "/tickets/find" },
        { label: "Contact us", href: "mailto:{support_email}" },
        { label: "Refunds", href: "/terms#s-5-4" },
        { label: "Organizer agreement", href: "/terms#organizer-agreement" },
      ],
    },
  ],
  copyright: "© {year} Fattixx · All prices include mandatory fees.",
  legal: [
    { label: "Terms of service", href: "/terms" },
    { label: "Privacy policy", href: "/privacy" },
    { label: "Your privacy choices", href: "/privacy#s-9" },
  ],
};

export const DEFAULTS: SiteContent = { home: DEFAULT_HOME, pricing: DEFAULT_PRICING, footer: DEFAULT_FOOTER };
