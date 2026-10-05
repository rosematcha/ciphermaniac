-- Lets the sweep that ends idle events find the ones not yet ended without a
-- scan (see config/d1/tournaments.sql). Rerunning is safe.
CREATE INDEX IF NOT EXISTS tournaments_by_finished ON tournaments (coalesce(json_extract(settings, '$.finished'), 0));
