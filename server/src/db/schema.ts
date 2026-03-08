export const schemaSql = `
CREATE TABLE IF NOT EXISTS og_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL UNIQUE,
  sol_amount REAL NOT NULL,
  verified_at TEXT,
  tx_signature TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  creator_wallet TEXT NOT NULL,
  launched_at TEXT,
  fee_share_config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  action TEXT NOT NULL,
  tx_sig TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_og_members_wallet ON og_members(wallet);
CREATE INDEX IF NOT EXISTS idx_tokens_mint ON tokens(mint);
CREATE INDEX IF NOT EXISTS idx_signatures_wallet ON signatures(wallet);
`;
