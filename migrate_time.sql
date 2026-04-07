-- Migration: Convert old ref_time format (e.g., "Apr.3 2026 18:10") to ISO format (e.g., "2026-04-03 18:10")
-- Handles both 1-digit and 2-digit days for April and March.

-- 1. Fix April (Apr.)
UPDATE spot_prices 
SET ref_time = '2026-04-' || printf('%02d', CAST(TRIM(SUBSTR(ref_time, 5, 2)) AS INT)) || ' ' || SUBSTR(ref_time, -5)
WHERE ref_time LIKE 'Apr.%';

-- 2. Fix March (Mar.)
UPDATE spot_prices 
SET ref_time = '2026-03-' || printf('%02d', CAST(TRIM(SUBSTR(ref_time, 5, 2)) AS INT)) || ' ' || SUBSTR(ref_time, -5)
WHERE ref_time LIKE 'Mar.%';

-- 3. Verification: Select any records that were NOT converted
-- SELECT * FROM spot_prices WHERE ref_time NOT LIKE '2026-%';