-- Rate limiting for email login codes: remember which IP asked for each code, so one client
-- can't request codes for many addresses. Additive only (older app versions keep working).

ALTER TABLE otp_codes ADD COLUMN requested_ip text;
CREATE INDEX otp_codes_ip_created_idx ON otp_codes (requested_ip, created_at DESC);
