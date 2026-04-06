-- Migration: Initial schema
CREATE TABLE IF NOT EXISTS spot_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_name TEXT NOT NULL,
    item_group TEXT NOT NULL,
    session_average REAL NOT NULL,
    session_high REAL,
    session_low REAL,
    session_change TEXT,
    ref_time TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_item_time ON spot_prices (item_name, ref_time);
