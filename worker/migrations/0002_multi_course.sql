-- One progress document per (user, course) instead of a single blob on the
-- user row, so one account can hold several courses' progress independently.
CREATE TABLE progress (
  user_id    INTEGER NOT NULL,
  course     TEXT NOT NULL,
  doc        TEXT NOT NULL DEFAULT '{}',
  rev        INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, course)
);

-- Preserve any existing (EE) progress under the course slug 'ee'.
INSERT INTO progress (user_id, course, doc, rev, updated_at)
  SELECT id, 'ee', progress, rev, updated_at FROM users WHERE progress != '{}';

ALTER TABLE users DROP COLUMN progress;
ALTER TABLE users DROP COLUMN rev;
