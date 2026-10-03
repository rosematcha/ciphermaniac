ALTER TABLE live_report_outbox ADD COLUMN last_attempted INTEGER NOT NULL DEFAULT 0;
