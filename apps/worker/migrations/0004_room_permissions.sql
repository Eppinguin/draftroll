ALTER TABLE roll_history ADD COLUMN actor_json TEXT;
ALTER TABLE roll_history ADD COLUMN visibility_json TEXT;

ALTER TABLE roll_revisions ADD COLUMN actor_json TEXT;
ALTER TABLE roll_revisions ADD COLUMN visibility_json TEXT;
