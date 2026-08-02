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
  /** The ceremony's own life (migration 0028). */
  status?: CeremonyStatus;
  duration_min?: number | null;
  plan_b?: string | null;
  archived?: boolean;
  updated_at?: string;
  /** Readiness marks: check key → required | optional | na (§16). */
  checklist?: Record<string, "required" | "optional" | "na">;
  milestone_id?: string | null;
}

export type CeremonyStatus = "draft" | "ready_for_review" | "approved" | "published" | "completed";

/** A person of the ceremony — referenced, never duplicated (0028). */
export interface CeremonyParticipant {
  id: string;
  wedding_id: string;
  ceremony_id: string;
  person_id: string | null;
  vendor_id: string | null;
  name: string | null;
  role: string;
  note_internal: string | null;
  client_visible: boolean;
  sort: number;
}

export interface CeremonyFlowItem {
  id: string;
  wedding_id: string;
  ceremony_id: string;
  block_type: string;
  title: string;
  description: string | null;
  participant_id: string | null;
  duration_min: number | null;
  note_internal: string | null;
  note_client: string | null;
  archived: boolean;
  sort: number;
}

export interface CeremonyMusic {
  id: string;
  wedding_id: string;
  ceremony_id: string;
  slot: string;
  title: string;
  artist: string | null;
  version: string | null;
  performer: string | null;
  vendor_id: string | null;
  duration_min: number | null;
  document_id: string | null;
  cue: string | null;
  flow_id: string | null;
  note_internal: string | null;
  status: "proposed" | "approved";
  archived: boolean;
  sort: number;
}

export interface CeremonyReading {
  id: string;
  wedding_id: string;
  ceremony_id: string;
  title: string;
  excerpt: string | null;
  reader_participant_id: string | null;
  language: string | null;
  duration_min: number | null;
  document_id: string | null;
  note_internal: string | null;
  note_client: string | null;
  status: "proposed" | "approved";
  archived: boolean;
  sort: number;
}

export interface CeremonyLogistic {
  id: string;
  wedding_id: string;
  ceremony_id: string;
  item: string;
  detail: string | null;
  qty: number | null;
  owner: string | null;
  vendor_id: string | null;
  budget_line_id: string | null;
  document_id: string | null;
  status: "open" | "ready" | "not_required";
  note_internal: string | null;
  sort: number;
}

/** One canonical file, linked — never copied (0028 §11). */
export interface CeremonyDocumentLink {
  id: string;
  wedding_id: string;
  ceremony_id: string;
  document_id: string;
  role: string;
}

export interface WeddingEvent {
  id: string;
  wedding_id: string;
  name: string;
  event_date: string | null;
  sort: number;
  /** The event file (migration 0024) — the module manages its columns. */
  internal_name?: string | null;
  event_type?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  venue?: string | null;
  venue_address?: string | null;
  dress_code?: string | null;
  capacity?: number | null;
  rsvp_deadline?: string | null;
  visibility?: "client" | "team";
  notes?: string | null;
  archived?: boolean;
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
  /** Enhanced attentions (migration 0029). */
  urgency?: "high" | "standard";
  owner?: string | null;
  module?: string | null;
  snoozed_until?: string | null;
  dismissed?: boolean;
}

/** The operational life of a milestone — a separate team-only table
    (migration 0029), so the couple's API never carries it. */
export interface MilestoneOps {
  milestone_id: string;
  wedding_id: string;
  op_status: "draft" | "planned" | "waiting" | "in_progress" | "blocked" | "ready" | "completed" | "archived";
  priority: "high" | "standard";
  owner: string | null;
  description: string | null;
  due_date: string | null;
  depends_on: string | null;
  module: string | null;
  vendor_id: string | null;
  budget_line_id: string | null;
  document_id: string | null;
  ceremony_id: string | null;
  note_internal: string | null;
  source: string | null;
  source_id: string | null;
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

export type VendorStage =
  | "scouted" | "contacted" | "proposal" | "proposal_requested"
  | "proposal_received" | "in_review" | "shortlisted" | "selected"
  | "contracted" | "completed" | "archived";

export interface Vendor {
  id: string;
  wedding_id: string;
  name: string;
  category: string;
  stage: VendorStage;
  client_visible: boolean;
  /** The vendor's budget home — the category its new lines inherit (0019). */
  envelope_id?: string | null;
  /** The wedding relationship file (migration 0026). */
  registry_id?: string | null;
  role?: string | null;
  lead_planner?: string | null;
  contacted_on?: string | null;
  proposal_requested_on?: string | null;
  proposal_received_on?: string | null;
  selected_on?: string | null;
  contracted_on?: string | null;
  completed?: boolean;
  archived?: boolean;
  notes_internal?: string | null;
  last_activity_at?: string;
}

/** The permanent profile a vendor keeps across weddings (0026). */
export interface VendorRegistry {
  id: string;
  legal_name: string;
  trading_name: string | null;
  category: string;
  country: string | null;
  city: string | null;
  languages: string[];
  website: string | null;
  instagram: string | null;
  portfolio_url: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  timezone: string | null;
  vat_number: string | null;
  rating: number | null;
  tags: string[];
  notes_internal: string | null;
}

export type VendorContactRole = "main" | "sales" | "production" | "accounts" | "emergency" | "other";

export interface VendorContact {
  id: string;
  registry_id: string;
  contact_role: VendorContactRole;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  notes: string | null;
  sort: number;
}

export interface VendorNote {
  id: string;
  wedding_id: string;
  vendor_id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface VendorDocument {
  id: string;
  vendor_id: string;
  wedding_id: string;
  type: "proposal" | "contract" | "invoice" | "insurance" | "licence" | "bank_details" | "portfolio" | "other";
  label: string;
  storage_path: string | null;
  extraction: Record<string, unknown> | null;
  client_visible: boolean;
  archived?: boolean;
}

export interface BudgetEnvelope {
  id: string;
  wedding_id: string;
  label: string;
  /** Forecast — the allocation arbitrated with the couple. */
  percent: number | null;
  sort: number;
  /** Scope v2 (migration 0011). */
  priority?: "high" | "standard";
  locked?: boolean;
  /** Recommended by the house — the counsel (migration 0014). */
  recommended_pct?: number | null;
  /** Archived, never hard-deleted (migration 0027). */
  archived?: boolean;
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
  /** Financial foundations (migration 0017): the engagement's own
      denomination and its TRACED euro equivalent (§1.1, §1.2). */
  currency?: string;
  committed_eur?: number | null;
  fx_rate_id?: string | null;
  /** Archived, never hard-deleted (migration 0027). */
  archived?: boolean;
}

/** One line of a vendor's quote, grouped by event (migration 0011). */
export interface BudgetLineItem {
  id: string;
  wedding_id: string;
  budget_line_id: string;
  event_label: string | null;
  /** The post's own category (0020) — null follows the line. */
  envelope_id?: string | null;
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
  /** Payment lifecycle (migration 0027) — only confirmed movements
      count in paid totals. Absent pre-0027: paid_at speaks alone. */
  status?: PaymentStatus;
  kind?: PaymentKind;
  reference?: string | null;
  invoice_id?: string | null;
}

export type PaymentStatus =
  | "draft"
  | "expected"
  | "pending_verification"
  | "confirmed"
  | "rejected"
  | "reversed"
  | "refunded"
  | "partially_refunded";

export type PaymentKind = "payment" | "deposit" | "refund" | "credit_note";

/** A record of account (migration 0027): invoice, proposal,
    commitment or credit note — never just an editable total. */
export interface Invoice {
  id: string;
  wedding_id: string;
  vendor_id: string | null;
  budget_line_id: string | null;
  document_id: string | null;
  kind: "invoice" | "proposal" | "commitment" | "credit_note";
  number: string | null;
  label: string;
  issue_date: string | null;
  due_date: string | null;
  amount_ht: number | null;
  vat_amount: number | null;
  amount_ttc: number | null;
  currency: string;
  status: "draft" | "received" | "approved" | "disputed" | "cancelled";
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

/** One settlement spread over invoices, lines or a deposit (0027). */
export interface PaymentAllocation {
  id: string;
  wedding_id: string;
  payment_id: string;
  invoice_id: string | null;
  budget_line_id: string | null;
  kind: "invoice" | "line" | "deposit";
  amount: number;
  created_at: string;
}

/** A saved envelope set — compared, then published or kept (0027). */
export interface BudgetScenario {
  id: string;
  wedding_id: string;
  label: string;
  status: "draft" | "published";
  data: {
    label: string;
    percent: number;
    recommended_pct: number | null;
    priority: "high" | "standard";
    locked: boolean;
    sort: number;
  }[];
  created_by: string | null;
  created_at: string;
  published_at: string | null;
}

/** A programmable reminder on an instalment (migration 0018). */
export interface PaymentReminder {
  id: string;
  wedding_id: string;
  payment_id: string;
  /** Negative = before the due date, positive = after. */
  offset_days: number | null;
  /** A fixed date instead of an offset, when more convenient. */
  fixed_date: string | null;
  channel: "email" | "in_app" | "both";
  label: string | null;
  sent_at: string | null;
  created_by: string;
  created_at: string;
}

/** One recorded departure — or failure — from the send ledger (0018). */
export interface ReminderSend {
  id: string;
  wedding_id: string;
  reminder_id: string;
  payment_id: string;
  channel: "email" | "in_app";
  recipient: string;
  sent_on: string;
  status: "sent" | "failed" | "abandoned";
  attempt: number;
  error: string | null;
  subject: string | null;
  group_key: string | null;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  rfc822_message_id: string | null;
  created_at: string;
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
  /** The household's full address book (migration 0023). */
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  /** American stationery fields (migration 0021). */
  suffix?: string | null;
  and_guest?: boolean;
  /** couple · import · house — whose hand wrote the row last (0021). */
  provenance?: string;
  house_touched_at?: string | null;
  /** The household file, American standard (migration 0024). */
  address_line2?: string | null;
  region?: string | null;
  side?: "hers" | "his" | "mutual" | null;
  relationship?: string | null;
  category?: string | null;
  vip?: boolean;
  accommodation_wished?: boolean;
  tags?: string[];
  notes_internal?: string | null;
  archived?: boolean;
}

export type Rsvp = "pending" | "confirmed" | "declined";

/** A person inside a household — who attends, eats and needs looking
    after (migration 0024). */
export interface GuestPerson {
  id: string;
  wedding_id: string;
  household_id: string;
  full_name: string | null;
  kind: "adult" | "child";
  age: number | null;
  dietary: string | null;
  accessibility: string | null;
  sort: number;
  created_at?: string;
}

/** The person's word for one event — never a stored global (0024).
    'invited' is legacy, read as pending. */
export interface PersonEventStatus {
  person_id: string;
  event_id: string;
  wedding_id: string;
  status: "attending" | "declined" | "pending" | "invited";
  updated_at?: string;
}

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
  /** Legacy trio joined by the card statuses (migration 0031). */
  status:
    | "completed"
    | "awaiting"
    | "to_come"
    | "draft"
    | "ready"
    | "shared"
    | "in_progress"
    | "submitted"
    | "updated";
  due_label: string | null;
  schema: { name: string; label: string; type?: "text" | "textarea" }[];
  sort: number;
  /** Card library fields (0031) — absent before the migration. */
  internal_title?: string | null;
  category_id?: string | null;
  description?: string | null;
  cover_path?: string | null;
  cover_focal?: string | null;
  provider?: string | null;
  external_url?: string | null;
  cta_label?: string | null;
  client_visible?: boolean | null;
  shared_at?: string | null;
  due_date?: string | null;
  submitted_at?: string | null;
  last_checked_at?: string | null;
  note_internal?: string | null;
  note_client?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  archived?: boolean | null;
  archived_at?: string | null;
}

export interface FormCategory {
  id: string;
  wedding_id: string;
  name: string;
  sort: number;
  archived: boolean;
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
  /** Linked Timeline milestone — done means sent (migration 0025). */
  milestone_id?: string | null;
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
  /** contracts · proposals · invoices · design · practical · from_couple (0012). */
  category?: string | null;
  size_bytes?: number | null;
  mime?: string | null;
  /** 'house' — placed by the house · 'client' — transmitted by the couple (0012). */
  source?: string | null;
  created_at?: string;
}

/* ── Lot C — the great house (migration 0025) ── */

/** The figure given to a recipient, dated — the recorded count (C2). */
export interface EventCountGiven {
  id: string;
  wedding_id: string;
  event_id: string;
  recipient: string;
  figure: number;
  given_on: string;
  created_by: string;
  created_at?: string;
}

/** A couple's edit awaiting the house's word once the pen is taken (C3). */
export interface GuestChangeProposal {
  id: string;
  wedding_id: string;
  household_id: string | null;
  kind: "add" | "update" | "delete" | "rsvp";
  payload: Record<string, unknown>;
  status: "proposed" | "applied" | "dismissed";
  created_by: string;
  created_at: string;
  decided_at?: string | null;
}

/** A house that sleeps guests (C4). */
export interface Property {
  id: string;
  wedding_id: string;
  name: string;
  property_type: "hotel" | "villa" | "residence";
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  check_in: string | null;
  check_out: string | null;
  notes: string | null;
  sort: number;
}

export interface RoomBlock {
  id: string;
  wedding_id: string;
  property_id: string;
  name: string;
  date_start: string | null;
  date_end: string | null;
  booking_deadline: string | null;
  booking_code: string | null;
  booking_link: string | null;
  rate: number | null;
  rate_currency: string;
  allocated: number;
  sort: number;
}

export type AssignmentStatus =
  | "not_requested" | "requested" | "reserved" | "confirmed" | "paid" | "cancelled";

export interface RoomAssignment {
  id: string;
  wedding_id: string;
  block_id: string;
  household_id: string;
  room_type: string | null;
  room_number: string | null;
  date_start: string | null;
  date_end: string | null;
  status: AssignmentStatus;
  confirmation_no: string | null;
  created_at?: string;
}
