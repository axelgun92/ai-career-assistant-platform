-- Task 8 completion pass: record follow-up reschedules/rewording in the
-- append-only application history. Additive only.
ALTER TYPE "ApplicationEventType" ADD VALUE 'FOLLOW_UP_UPDATED';
