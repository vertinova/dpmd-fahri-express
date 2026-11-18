-- Smart CCTV: zona pantau (poligon per kamera, koordinat relatif 0..1) dan jam pantau (WIB).
-- PostgreSQL, idempoten. zona = array maks 8 {nama, titik}; jam_pantau = {mulai, selesai} atau NULL (24 jam).

ALTER TABLE cctv_cameras ADD COLUMN IF NOT EXISTS zona JSONB NULL;
ALTER TABLE cctv_cameras ADD COLUMN IF NOT EXISTS jam_pantau JSONB NULL;
