-- Add DPMD verification fields to bankeu_lpj table
-- Flow: Desa uploads → DPMD verifies (approve/reject/revision)

ALTER TABLE bankeu_lpj
  ADD COLUMN status ENUM('pending', 'approved', 'rejected', 'revision') NOT NULL DEFAULT 'pending' AFTER keterangan,
  ADD COLUMN dpmd_catatan TEXT NULL AFTER status,
  ADD COLUMN dpmd_verified_by BIGINT UNSIGNED NULL AFTER dpmd_catatan,
  ADD COLUMN dpmd_verified_at TIMESTAMP NULL AFTER dpmd_verified_by;

-- Index for filtering by status
ALTER TABLE bankeu_lpj ADD INDEX idx_bankeu_lpj_status (status);
