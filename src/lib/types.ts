// Row types for the Inner House schema (hand-kept, matching supabase/migrations).

export type PublishStatus = "draft" | "published";
export type AppRole = "client" | "coordinator" | "team";

export interface Wedding {
  id: string;
  slug: string;
  couple_display_name: string;
  partner_a: string;
  partner_b: string;
  destination: string;
  venue: string | null;
  date_start: string | null;
  date_end: string | null;
  timezone: string;
  default_locale: string;
  languages: string[];
  entrance_media_url: string | null;
  entrance_plaque_url: string | null;
  budget_total: number | null;
  budget_analysis: string | null;
  budget_analysis_at: string | null;
  drive_folder_shared_id: string | null;
  drive_folder_internal_id: string | null;
  first_toast_at: string | null;
}

export interface Profile {
  id: string;
  full_name: string;
  role: AppRole;
  is_principal: boolean;
  is_teamwork: boolean;
  locale: string;
  timezone: string;
}

export interface Ceremony {
  id: string;
  wedding_id: string;
  kind: string;
  title: string | null;
  ceremony_date: string | null;
  start_time: string | null;
  venue: string | null;
  officiant: string | null;
  notes: string | null;
  sort: number;
}

export interface WeddingEvent {
  id: string;
  wedding_id: string;
  name: string;
  event_date: string | null;
  sort: number;
}

export interface Milestone {
  id: string;
  wedding_id: string;
  month: string;
  label: string;
  done: boolean;
  status: PublishStatus;
  sort: number;
}

export interface MonthlyNote {
  id: string;
  wedding_id: string;
  month: string;
  subjects_raw: string | null;
  composed_text: string | null;
  preview_text: string | null;
  status: PublishStatus;
}

export type AttentionStatus = "awaiting_word" | "at_leisure" | "attended";

export interface Attention {
  id: string;
  wedding_id: string;
  title: string;
  due_date: string | null;
  status: AttentionStatus;
  milestone_id: string | null;
  /** A document to sign, a page to visit (migration 0010). */
  link_url?: string | null;
}

export interface InternalTask {
  id: string;
  wedding_id: string;
  assignee: string | null;
  title: string;
  due_date: string | null;
  done: boolean;
}

export type BoardType =
  | "global" | "floral" | "tablescape" | "welcome" | "cocktail"
  | "dinner" | "reception" | "farewell" | "stationery" | "custom";
export type BoardStatus = "in_creation" | "to_review" | "approved";

export interface Board {
  id: string;
  wedding_id: string;
  type: BoardType;
  title: string;
  subtitle: string | null;
  status: BoardStatus;
  palette: string[];
  cover_url: string | null;
  sort: number;
  /* editorial sheet (migration 0008) */
  eyebrow?: string | null;
  concept_title?: string | null;
  concept_text?: string | null;
  materials?: string[];
  photos?: Record<string, string>;
  backdrop_path?: string | null;
  footer_ref?: string | null;
}

export interface SubBoard {
  id: string;
  board_id: string;
  wedding_id: string;
  kind: "rental" | "stationery" | "invitations" | "day_of";
  title: string | null;
  status: BoardStatus;
  content: Record<string, unknown>;
}

export type VendorStage = "scouted" | "contacted" | "proposal" | "contracted";

export interface Vendor {
  id: string;
  wedding_id: string;
  name: string;
  category: string;
  stage: VendorStage;
  client_visible: boolean;
}

export interface VendorDocument {
  id: string;
  vendor_id: string;
  wedding_id: string;
  type: "proposal" | "contract" | "invoice";
  label: string;
  storage_path: string | null;
  extraction: Record<string, unknown> | null;
  client_visible: boolean;
}

export interface BudgetEnvelope {
  id: string;
  wedding_id: string;
  label: string;
  percent: number | null;
  sort: number;
  /** Scope v2 (migration 0011). */
  priority?: "high" | "standard";
  locked?: boolean;
}

export interface EnvelopeNote {
  envelope_id: string;
  wedding_id: string;
  body: string;
  status: PublishStatus;
}

export interface BudgetLine {
  id: string;
  wedding_id: string;
  envelope_id: string | null;
  vendor_id: string | null;
  label: string;
  budgeted: number | null;
  committed: number | null;
  committed_note: string | null;
  paid: number;
  next_payment_label: string | null;
  status: PublishStatus;
  sort: number;
  /** Budget v2 (migration 0011): nested credits under a parent line. */
  parent_line_id?: string | null;
  line_kind?: "line" | "credit" | "included";
}

/** One line of a vendor's quote, grouped by event (migration 0011). */
export interface BudgetLineItem {
  id: string;
  wedding_id: string;
  budget_line_id: string;
  event_label: string | null;
  label: string;
  qty: number | null;
  unit_price: number | null;
  total_ht: number | null;
  vat_pct: number | null;
  total_ttc: number | null;
  notes: string | null;
  sort: number;
}

export interface Payment {
  id: string;
  wedding_id: string;
  budget_line_id: string | null;
  label: string;
  amount: number;
  due_date: string | null;
  paid_at: string | null;
  reminder_sent_at: string | null;
  /** Budget v2 (migration 0011). */
  currency?: string;
  amount_eur?: number | null;
  method?: string | null;
  payer?: string | null;
  refundable?: boolean;
  reveal_banking?: boolean;
  notified_at?: string | null;
}

/** The risk buffer, as in the house's Excel (migration 0011). */
export interface BudgetRisk {
  id: string;
  wedding_id: string;
  label: string;
  description: string | null;
  exposure: number | null;
  probability: number | null;
  owner: string | null;
  mitigation: string | null;
  sort: number;
}

export interface Guest {
  id: string;
  wedding_id: string;
  title: string | null;
  first_names: string | null;
  surname: string | null;
  invitation_line: string | null;
  address: string | null;
  locale: string;
  travel: string | null;
  dietary: string | null;
  stationer_flag: string | null;
  /** Household composition (migration 0010). */
  party_adults: number | null;
  party_children: number | null;
  /** The household's own word — set by hand or by phone (migration 0010). */
  rsvp?: Rsvp | null;
}

export type Rsvp = "pending" | "confirmed" | "declined";

export interface GuestEvent {
  guest_id: string;
  event_id: string;
  wedding_id: string;
  rsvp: Rsvp;
}

export interface HotelBlock {
  id: string;
  wedding_id: string;
  hotel: string;
  rooms_held: number;
  cutoff_date: string | null;
  booking_code: string | null;
  active: boolean;
}

export interface Message {
  id: string;
  wedding_id: string;
  channel: "client" | "teamwork";
  author_id: string;
  body: string;
  created_at: string;
  /** Conversation subject (migration 0010) — null = the general thread. */
  subject?: string | null;
}

export interface FormRow {
  id: string;
  wedding_id: string;
  title: string;
  status: "completed" | "awaiting" | "to_come";
  due_label: string | null;
  schema: { name: string; label: string; type?: "text" | "textarea" }[];
  sort: number;
}

export interface AvailabilityProposal {
  id: string;
  wedding_id: string;
  proposed_by: string | null;
  duration_minutes: 30 | 60;
  slots: { date: string; time: string }[];
  status: "sent" | "confirmed" | "declined";
  confirmed_slot: { date: string; time: string } | null;
  meet_url: string | null;
}

export interface RunSheet {
  id: string;
  wedding_id: string;
  event_id: string | null;
  title: string;
  items: { time: string; label: string }[];
}

export interface ContactSheet {
  id: string;
  wedding_id: string;
  rows: { vendor: string; on_site: string; reach: string }[];
}

export interface VaultContract {
  id: string;
  wedding_id: string | null;
  label: string;
  storage_path: string | null;
  schedule_label: string | null;
  instalments: { label: string; amount: number; due_date: string; paid: boolean }[];
}

export interface Correspondence {
  id: string;
  wedding_id: string;
  kind: "save_the_date" | "travel_booklet" | "week_of_letter" | "custom";
  title: string;
  body_by_locale: Record<string, string>;
  status: "draft" | "scheduled" | "sent";
  scheduled_label: string | null;
  sent_at: string | null;
}

export interface HospitalityItem {
  id: string;
  wedding_id: string;
  label: string;
  scope: string | null;
  status: string;
  sort: number;
}

export interface DocumentRow {
  id: string;
  wedding_id: string;
  label: string;
  url: string | null;
  internal: boolean;
  /** "bucket/path…" of the filed original (migration 0010). */
  storage_path?: string | null;
}
