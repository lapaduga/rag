ALTER TABLE queries ADD COLUMN citations TEXT;
ALTER TABLE queries ADD COLUMN confidence_score REAL;
ALTER TABLE queries ADD COLUMN has_enough_context INTEGER DEFAULT 1;
ALTER TABLE queries ADD COLUMN is_dont_know INTEGER DEFAULT 0;
