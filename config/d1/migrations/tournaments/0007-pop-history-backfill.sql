-- Fills the history index (pop_history, see config/d1/tournaments.sql) with
-- the players of every sanctioned event stored before the functions kept it.
-- Run after the deploy that starts keeping it, so events changed between the
-- migration and the deploy are covered too. Rerunning is safe.
--
-- A TOM event is always sanctioned. An event stored before the setting
-- existed has no `sanctioned` and reads as sanctioned, as DEFAULT_SETTINGS
-- does (shared/tournament/view.ts).
INSERT OR IGNORE INTO pop_history (pop_id, code)
SELECT json_extract(player.value, '$.id'), tournaments.code
  FROM tournaments, json_each(tournaments.state, '$.players') AS player
 WHERE tournaments.mode = 'tom'
    OR json_extract(tournaments.settings, '$.sanctioned') IS NOT 0;
