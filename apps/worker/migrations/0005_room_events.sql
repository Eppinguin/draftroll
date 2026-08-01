CREATE TABLE IF NOT EXISTS room_events (
  room_id TEXT NOT NULL,
  event_sequence INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (room_id, event_sequence)
);

CREATE INDEX IF NOT EXISTS idx_room_events_created_at
  ON room_events (room_id, created_at);
