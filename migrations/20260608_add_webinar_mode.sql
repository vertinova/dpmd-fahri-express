-- Webinar mode untuk video meeting (hybrid: panggung SFU + penonton view-only/HLS).
-- mode='webinar' => hanya peserta on_stage yang boleh publish audio/video; sisanya penonton.
-- Idempoten-ish: jalankan sekali. Jika kolom sudah ada, abaikan errornya.

ALTER TABLE video_meetings
  ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'meeting' AFTER status;

ALTER TABLE video_meeting_participants
  ADD COLUMN hand_raised TINYINT(1) NOT NULL DEFAULT 0 AFTER role,
  ADD COLUMN on_stage    TINYINT(1) NOT NULL DEFAULT 0 AFTER hand_raised,
  ADD COLUMN hand_raised_at DATETIME NULL AFTER on_stage;
