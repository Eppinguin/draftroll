CREATE TABLE IF NOT EXISTS roll_revisions (
  roll_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (roll_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_roll_revisions_room_sequence
  ON roll_revisions (room_id, sequence, revision);
