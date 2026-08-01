CREATE TABLE IF NOT EXISTS roll_history (
  roll_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  authority TEXT NOT NULL,
  expression TEXT,
  total REAL NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roll_history_room_sequence
  ON roll_history (room_id, sequence);

CREATE INDEX IF NOT EXISTS idx_roll_history_created_at
  ON roll_history (created_at DESC);
