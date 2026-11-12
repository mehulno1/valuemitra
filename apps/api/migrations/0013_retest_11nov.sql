-- Universal retest of 11 Nov 2026.
-- #4: the valuer's title and full name as printed in reports ("Mr." + "Manoj Kumar Sharma"); the login name may be shorter.
ALTER TABLE users
  ADD COLUMN title VARCHAR(12) NULL AFTER name,
  ADD COLUMN print_name VARCHAR(160) NULL AFTER title;
-- #6: one person who is both coordinator and accounts (Universal: Soni).
ALTER TABLE users MODIFY role ENUM('coordinator','coord_accounts','maker','checker','valuer','accounts','admin') NOT NULL;
