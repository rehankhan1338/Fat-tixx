import type { CityCoords, EventItem, Organizer } from "./types";

/*
 * SAMPLE DATA for the homepage preview.
 * Kerafena, Nairobi Professional, SHEEN Magazine and Chapman Foundation are real Fattixx organizers,
 * but every event below (titles, dates, venues, prices) is a placeholder.
 * Upstate Run Club, Laugh Lab, Rooftop Sessions, Sunday Supper Club and Afterglow Events are made up.
 * Replace this file with data from the API / database (see README "Wiring the data").
 */


export const ORGANIZERS: Record<string, Organizer> = {
  kerafena: { id: "kerafena", name: "Kerafena", initials: "KF" },
  nairobi: { id: "nairobi", name: "Nairobi Professional", initials: "NP" },
  sheen: { id: "sheen", name: "SHEEN Magazine", initials: "SM" },
  chapman: { id: "chapman", name: "Chapman Foundation", initials: "CF" },
  upstaterun: { id: "upstaterun", name: "Upstate Run Club", initials: "UR" }, // sample organizer
  laughlab: { id: "laughlab", name: "Laugh Lab", initials: "LL" }, // sample organizer
  rooftop: { id: "rooftop", name: "Rooftop Sessions", initials: "RS" }, // sample organizer
  supper: { id: "supper", name: "Sunday Supper Club", initials: "SC" }, // sample organizer
  afterglow: { id: "afterglow", name: "Afterglow Events", initials: "AE" }, // sample organizer
};

export const EVENTS: EventItem[] = [
  {"id": 1, "organizerId": "kerafena", "title": "Keratin Smoothing Masterclass", "category": "Beauty & hair", "date": "2026-10-10", "time": "10:00", "venue": "Studio 9", "city": "Greenville, SC", "price": 149, "featured": true, "tag": "Few spots left", "image": "conf"},
  {"id": 2, "organizerId": "kerafena", "title": "Kerafena Pro Certification Day", "category": "Education", "date": "2026-10-24", "time": "09:00", "venue": "Studio 9", "city": "Greenville, SC", "price": 199, "featured": false},
  {"id": 3, "organizerId": "kerafena", "title": "Salon Owners Business Brunch", "category": "Education", "date": "2026-11-07", "time": "11:00", "venue": "The Terrace", "city": "Greenville, SC", "price": 45, "featured": false},
  {"id": 4, "organizerId": "kerafena", "title": "Silk Press & Smoothing Live Demo", "category": "Beauty & hair", "date": "2026-11-21", "time": "13:00", "venue": "Main Street Hall", "city": "Fountain Inn, SC", "price": null, "featured": false},
  {"id": 5, "organizerId": "nairobi", "title": "Nairobi Pro Stylist Summit", "category": "Beauty & hair", "date": "2026-10-17", "time": "09:00", "venue": "Grand Ballroom", "city": "Atlanta, GA", "price": 85, "featured": true, "tag": "Selling fast", "image": "conf"},
  {"id": 6, "organizerId": "nairobi", "title": "Nairobi Shine Workshop", "category": "Education", "date": "2026-10-31", "time": "11:00", "venue": "Studio 9", "city": "Greenville, SC", "price": 65, "featured": false},
  {"id": 7, "organizerId": "nairobi", "title": "Natural Hair Care Clinic", "category": "Beauty & hair", "date": "2026-11-14", "time": "12:00", "venue": "Community Center", "city": "Spartanburg, SC", "price": null, "featured": false},
  {"id": 8, "organizerId": "nairobi", "title": "Nairobi Holiday Hair Show", "category": "Beauty & hair", "date": "2026-12-05", "time": "19:00", "venue": "Grand Ballroom", "city": "Atlanta, GA", "price": 35, "featured": true, "image": "party"},
  {"id": 9, "organizerId": "sheen", "title": "SHEEN Soundstage Live", "category": "Music", "date": "2026-10-09", "time": "20:00", "venue": "The Warehouse", "city": "Atlanta, GA", "price": 40, "featured": true, "tag": "Selling fast", "image": "club"},
  {"id": 10, "organizerId": "sheen", "title": "SHEEN Women Who Lead Brunch", "category": "Community", "date": "2026-10-25", "time": "11:00", "venue": "The Terrace", "city": "Greenville, SC", "price": 75, "featured": false},
  {"id": 11, "organizerId": "sheen", "title": "SHEEN Beauty Panel & Market", "category": "Beauty & hair", "date": "2026-11-08", "time": "14:00", "venue": "Old Mill Hall", "city": "Greenville, SC", "price": 25, "featured": false},
  {"id": 12, "organizerId": "sheen", "title": "SHEEN Cover Casting Call", "category": "Community", "date": "2026-11-15", "time": "12:00", "venue": "Main Street Hall", "city": "Fountain Inn, SC", "price": null, "featured": false},
  {"id": 13, "organizerId": "sheen", "title": "SHEEN Holiday Mixer", "category": "Nightlife", "date": "2026-12-12", "time": "19:00", "venue": "The Warehouse", "city": "Atlanta, GA", "price": 30, "featured": false},
  {"id": 14, "organizerId": "chapman", "title": "Ta Ta’s & Tequila Casino Night", "category": "Fundraisers", "date": "2026-10-16", "time": "19:00", "venue": "Main Street Hall", "city": "Fountain Inn, SC", "price": 100, "featured": true, "tag": "Few tickets left", "image": "party"},
  {"id": 15, "organizerId": "chapman", "title": "Pynkalycious Festival", "category": "Community", "date": "2026-10-17", "time": "12:00", "venue": "Downtown Fountain Inn", "city": "Fountain Inn, SC", "price": null, "featured": false},
  {"id": 16, "organizerId": "chapman", "title": "Scholarship Golf Classic", "category": "Fundraisers", "date": "2026-10-30", "time": "08:00", "venue": "Fairway Club", "city": "Greenville, SC", "price": 150, "featured": false},
  {"id": 17, "organizerId": "chapman", "title": "Chapman Scholars Gala", "category": "Fundraisers", "date": "2026-11-20", "time": "18:30", "venue": "Grand Ballroom", "city": "Greenville, SC", "price": 125, "featured": true, "image": "gala"},
  {"id": 18, "organizerId": "chapman", "title": "Community Thanksgiving Drive", "category": "Community", "date": "2026-11-21", "time": "10:00", "venue": "Community Center", "city": "Fountain Inn, SC", "price": null, "featured": false},
  {"id": 19, "organizerId": "upstaterun", "title": "Saturday Social 5K", "category": "Fitness", "date": "2026-09-26", "time": "08:00", "venue": "Riverside Park", "city": "Greenville, SC", "price": null, "featured": false},
  {"id": 20, "organizerId": "upstaterun", "title": "Halloween Glow Run", "category": "Fitness", "date": "2026-10-31", "time": "19:00", "venue": "City Greenway", "city": "Greenville, SC", "price": 35, "featured": false},
  {"id": 21, "organizerId": "laughlab", "title": "Late Night Comedy Hour", "category": "Comedy", "date": "2026-09-25", "time": "21:30", "venue": "Main Street Theater", "city": "Greenville, SC", "price": 15, "featured": false, "tag": "Selling fast"},
  {"id": 22, "organizerId": "laughlab", "title": "Comedy Showcase", "category": "Comedy", "date": "2026-11-13", "time": "20:00", "venue": "Main Street Theater", "city": "Greenville, SC", "price": 20, "featured": false},
  {"id": 23, "organizerId": "rooftop", "title": "Rooftop Jazz Night", "category": "Music", "date": "2026-10-10", "time": "20:00", "venue": "The Terrace", "city": "Greenville, SC", "price": 25, "featured": true, "image": "fest"},
  {"id": 24, "organizerId": "rooftop", "title": "Vinyl & Vibes", "category": "Music", "date": "2026-10-22", "time": "19:00", "venue": "Groove Records", "city": "Spartanburg, SC", "price": 10, "featured": false},
  {"id": 25, "organizerId": "rooftop", "title": "Afrobeats Day Party", "category": "Nightlife", "date": "2026-09-27", "time": "15:00", "venue": "The Warehouse", "city": "Greenville, SC", "price": 20, "featured": false, "tag": "Selling fast"},
  {"id": 26, "organizerId": "supper", "title": "Fall Harvest Supper", "category": "Food & drink", "date": "2026-10-18", "time": "18:00", "venue": "Old Mill Hall", "city": "Greenville, SC", "price": 65, "featured": false},
  {"id": 27, "organizerId": "supper", "title": "Fall Food Truck Rally", "category": "Food & drink", "date": "2026-10-11", "time": "12:00", "venue": "Riverside Park", "city": "Greenville, SC", "price": null, "featured": false},
  {"id": 28, "organizerId": "afterglow", "title": "Halloween Masquerade", "category": "Nightlife", "date": "2026-10-31", "time": "21:00", "venue": "The Warehouse", "city": "Greenville, SC", "price": 30, "featured": false},
  {"id": 29, "organizerId": "afterglow", "title": "Friendsgiving Market", "category": "Food & drink", "date": "2026-11-22", "time": "12:00", "venue": "Old Mill Hall", "city": "Greenville, SC", "price": null, "featured": false},
  {"id": 30, "organizerId": "afterglow", "title": "New Year’s Eve Countdown", "category": "Nightlife", "date": "2026-12-31", "time": "21:00", "venue": "Grand Ballroom", "city": "Greenville, SC", "price": 60, "featured": false}
];

/* Map position of each city used above (for "events near you"). */
export const CITY_COORDS: Record<string, CityCoords> = {
  "Greenville, SC": { lat: 34.8526, lon: -82.394 },
  "Fountain Inn, SC": { lat: 34.689, lon: -82.1957 },
  "Spartanburg, SC": { lat: 34.9496, lon: -81.932 },
  "Atlanta, GA": { lat: 33.749, lon: -84.388 },
};

export { CATEGORIES } from "../event-categories";
