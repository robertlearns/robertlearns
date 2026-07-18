-- Complete stored dataset: no email, no IP, nothing else.
CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT NOT NULL UNIQUE,          -- stored lowercase
  pw_salt     TEXT NOT NULL,                 -- base64
  pw_hash     TEXT NOT NULL,                 -- base64 PBKDF2-SHA256 output
  rc_salt     TEXT NOT NULL,                 -- recovery-code salt
  rc_hash     TEXT NOT NULL,
  token_epoch INTEGER NOT NULL DEFAULT 0,
  progress    TEXT NOT NULL DEFAULT '{}',
  rev         INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
