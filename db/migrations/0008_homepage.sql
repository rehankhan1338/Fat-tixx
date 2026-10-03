-- Fat Tixx — migration 0008: data the public homepage design needs.
--   events.category  : homepage category pills (Music, Nightlife, ...). NULL = uncategorized.
--   events.featured  : shown in the homepage featured strip; set by a Super Admin.
--   venues.latitude / longitude : "events near you" in the homepage location search.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS category VARCHAR(40) NULL AFTER summary,
  ADD COLUMN IF NOT EXISTS featured TINYINT(1) NOT NULL DEFAULT 0 AFTER category,
  ADD KEY IF NOT EXISTS idx_event_category (category);

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS latitude  DECIMAL(9,6) NULL AFTER country,
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(9,6) NULL AFTER latitude;
