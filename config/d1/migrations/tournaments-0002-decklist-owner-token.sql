-- Adds the column for the token a submitting device keeps to read its own
-- decklist back (see config/d1/tournaments.sql), for decklists without
-- accounts, to a database made before it existed. Run once; SQLite refuses
-- to add a column twice.
ALTER TABLE decklists ADD COLUMN owner_token TEXT;
