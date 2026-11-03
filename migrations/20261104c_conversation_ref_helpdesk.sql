-- Percakapan Pesan yang terhubung ke tiket Helpdesk (urusan akun → PIC program).
-- Lihat src/services/helpdeskJembatan.service.js. Idempoten.
ALTER TABLE `conversations`
  MODIFY COLUMN `reference_type` ENUM('bankeu_lpj', 'bankeu_proposal', 'bantuan_provinsi_lpj', 'helpdesk') NULL;
