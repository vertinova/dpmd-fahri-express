-- Jenis peristiwa Smart CCTV baru: `person` — orang terdeteksi tanpa wajah yang
-- bisa dikenali (membelakangi kamera, jauh, atau di tepi bingkai).
-- MODIFY ke definisi yang sama aman dijalankan berulang (idempoten).
ALTER TABLE `cctv_events`
    MODIFY `type` ENUM('known', 'unknown', 'fall', 'fall_warning', 'immobility', 'other', 'person') NOT NULL;
