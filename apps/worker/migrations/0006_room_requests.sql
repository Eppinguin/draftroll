CREATE TABLE IF NOT EXISTS room_requests (
  room_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  event_sequence INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (room_id, session_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_room_requests_created_at
  ON room_requests (room_id, created_at);
