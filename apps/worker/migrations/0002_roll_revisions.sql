ALTER TABLE roll_history ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE roll_history ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_roll_history_updated_at
  ON roll_history (updated_at DESC);
