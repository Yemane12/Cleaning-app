-- Two customers can hold REQUESTED bookings for the same cleaner and slot; the
-- clash only matters once one is confirmed. Checking for an overlap in
-- application code leaves a window between the check and the insert, so the
-- rule is enforced by the database instead: Postgres rejects the second
-- confirmed booking no matter how the two requests interleave.
--
-- btree_gist lets a plain equality column ("cleanerId") sit in the same GiST
-- index as the range operator.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "cleanerId" WITH =,
    tstzrange("scheduledStart", "scheduledEnd", '[)') WITH &&
  )
  WHERE (status IN ('ACCEPTED', 'IN_PROGRESS'));
