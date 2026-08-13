-- ═══════════════════════════════════════════════════════════════════
-- 0033 — Vendor papers, simply shared (PRD Vendors correction).
-- · Client visibility becomes an EXPLICIT gesture: the old default
--   was true but the couple had no door to the file, so the flag was
--   never a deliberate choice. Every existing paper is set to
--   internal; Estelle shows each one to the couple by hand from the
--   vendor profile. Nothing is deleted, nothing moves.
-- · The suggested document types join the existing ones.
-- Safe to run twice.
-- ═══════════════════════════════════════════════════════════════════

alter table vendor_documents alter column client_visible set default false;
update vendor_documents set client_visible = false where client_visible;

alter type vendor_doc_type add value if not exists 'proposal_request';
alter type vendor_doc_type add value if not exists 'brochure';
alter type vendor_doc_type add value if not exists 'technical';

-- ── control ─────────────────────────────────────────────────────────
select 'papers' as ready, count(*) from vendor_documents
union all
select 'client_visible_now', count(*) from vendor_documents where client_visible;
