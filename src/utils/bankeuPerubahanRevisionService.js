/**
 * Service bersama untuk riwayat versi dokumen & ronde revisi/anotasi Bankeu Perubahan.
 * Dipakai oleh controller Desa, Kecamatan, dan DPMD (masing-masing melakukan
 * pengecekan kepemilikan/akses sendiri sebelum memanggil ini). Pakai Prisma.
 */

const prisma = require('../config/prisma');

const STORAGE_BASE = '/storage/uploads/bankeu-perubahan';

function num(v) {
  return v === null || v === undefined ? null : Number(v);
}

/**
 * Daftar versi dokumen Desa (urut menaik).
 */
async function fetchVersions(proposalId) {
  const rows = await prisma.bankeu_perubahan_proposal_versions.findMany({
    where: { proposal_id: BigInt(proposalId) },
    orderBy: { version_number: 'asc' },
    include: { users: { select: { name: true } } },
  });
  return rows.map(r => ({
    id: num(r.id),
    version_number: r.version_number,
    file_proposal: r.file_proposal,
    file_url: `${STORAGE_BASE}/${r.file_proposal}`,
    file_size: r.file_size,
    source: r.source,
    uploaded_by_name: r.users?.name || null,
    created_at: r.created_at,
  }));
}

/**
 * Daftar ronde revisi/anotasi Kecamatan (urut menaik).
 */
async function fetchRevisions(proposalId) {
  const rows = await prisma.bankeu_perubahan_revisions.findMany({
    where: { proposal_id: BigInt(proposalId) },
    orderBy: { round_number: 'asc' },
    include: {
      users: { select: { name: true } },
      bankeu_perubahan_proposal_versions: { select: { version_number: true } },
    },
  });
  return rows.map(r => ({
    id: num(r.id),
    round_number: r.round_number,
    version_id: num(r.version_id),
    version_number: r.bankeu_perubahan_proposal_versions?.version_number ?? null,
    decision: r.decision,
    catatan: r.catatan,
    annotation_data: r.annotation_data || null,
    annotated_pdf_path: r.annotated_pdf_path,
    annotated_pdf_url: r.annotated_pdf_path ? `${STORAGE_BASE}/${r.annotated_pdf_path}` : null,
    annotated_by_name: r.users?.name || null,
    created_at: r.created_at,
  }));
}

module.exports = { fetchVersions, fetchRevisions, STORAGE_BASE };
