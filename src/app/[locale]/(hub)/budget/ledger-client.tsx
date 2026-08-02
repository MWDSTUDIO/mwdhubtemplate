"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import type { BudgetEnvelope, BudgetLine, BudgetLineItem, EnvelopeNote, Payment } from "@/lib/types";
import {
  updateBudgetLine,
  setLineFxRate,
  addBudgetLine,
  duplicateBudgetLine,
  deleteBudgetLineWithUndo,
  restoreBudgetLine,
  setLineEnvelope,
  setLineVendor,
  saveLineItem,
  deleteLineItem
} from "@/app/actions/budget";

/**
 * Two readings of the same budget (brief §5): THE LEDGER — the rigour
 * of a spreadsheet without looking like one — and THE HOUSE BOOK — the
 * couple's reading, a card per envelope, everything breathing. One
 * truth underneath; the selector remembers each reader's preference.
 *
 * Manual entry is the reference mode, that the automatic reading
 * merely assists (ajout-lignes brief): lines and sub-lines are added
 * in place, at the keyboard, in both views — one set of server
 * actions, nothing to synchronise.
 */

type LineField = "label" | "committed" | "paid" | "currency";
type ItemField = "label" | "ht" | "vat" | "ttc";

type UndoEntry =
  | { kind: "editLine"; id: string; field: LineField; prev: string | number | null }
  | { kind: "editItem"; id: string; lineId: string; field: ItemField; prev: string | number | null }
  | { kind: "createLine"; id: string }
  | { kind: "deleteLine"; row: Record<string, unknown>; items: Record<string, unknown>[] }
  | { kind: "createItem"; id: string; lineId: string }
  | { kind: "deleteItem"; item: BudgetLineItem };

type ViewKind = "ledger" | "housebook";
type SortKey = "label" | "committed" | "paid" | "remaining" | null;

const money = (format: ReturnType<typeof useFormatter>, n: number | null | undefined, currency = "EUR") =>
  n == null ? "—" : format.number(n, { style: "currency", currency, maximumFractionDigits: 0 });

export function BudgetViews({
  weddingId,
  lines,
  items,
  payments,
  envelopes,
  envelopeNotes,
  vendors,
  nextByLine,
  isTeam
}: {
  weddingId: string;
  lines: BudgetLine[];
  items: BudgetLineItem[];
  payments: Payment[];
  envelopes: BudgetEnvelope[];
  envelopeNotes: EnvelopeNote[];
  vendors: { id: string; name: string }[];
  nextByLine: Record<string, string>;
  isTeam: boolean;
}) {
  const t = useTranslations("budget.views");
  const defaultView: ViewKind = isTeam ? "ledger" : "housebook";
  const [view, setView] = useState<ViewKind>(defaultView);
  useEffect(() => {
    const saved = window.localStorage.getItem("mwd-budget-view") as ViewKind | null;
    if (saved === "ledger" || saved === "housebook") setView(saved);
  }, []);
  const pick = (v: ViewKind) => {
    setView(v);
    window.localStorage.setItem("mwd-budget-view", v);
  };

  // The optimistic layer, shared by BOTH views so what is created in
  // one appears in the other without any reload (ajout-lignes §3):
  // ghosts are client-minted rows the server action is writing with
  // the very same id; gone ids are optimistic removals. Server truth
  // absorbs both as soon as fresh props arrive.
  // The undo history lives here so switching views never forgets it.
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);

  const [ghostLines, setGhostLines] = useState<BudgetLine[]>([]);
  const [ghostItems, setGhostItems] = useState<BudgetLineItem[]>([]);
  const [gone, setGone] = useState<Set<string>>(new Set());
  useEffect(() => {
    setGhostLines((g) => g.filter((x) => !lines.some((l) => l.id === x.id)));
    setGhostItems((g) => g.filter((x) => !items.some((i) => i.id === x.id)));
    setGone((g) => {
      const still = [...g].filter(
        (id) => lines.some((l) => l.id === id) || items.some((i) => i.id === id)
      );
      return still.length === g.size ? g : new Set(still);
    });
  }, [lines, items]);

  // Deduped at merge time: the instant the server row lands, the ghost
  // yields — never two rows with one id, not even for a frame.
  const mergedLines = useMemo(() => {
    const have = new Set(lines.map((l) => l.id));
    return [...lines.filter((l) => !gone.has(l.id)), ...ghostLines.filter((g) => !have.has(g.id))];
  }, [lines, ghostLines, gone]);
  const mergedItems = useMemo(() => {
    const have = new Set(items.map((i) => i.id));
    return [...items.filter((i) => !gone.has(i.id)), ...ghostItems.filter((g) => !have.has(g.id))];
  }, [items, ghostItems, gone]);

  const ghosts = {
    addLine: (line: BudgetLine) => setGhostLines((g) => [...g, line]),
    addItem: (item: BudgetLineItem) => setGhostItems((g) => [...g, item]),
    remove: (id: string) => {
      setGone((g) => new Set(g).add(id));
      setGhostLines((g) => g.filter((x) => x.id !== id));
      setGhostItems((g) => g.filter((x) => x.id !== id));
    },
    unremove: (id: string) =>
      setGone((g) => {
        const n = new Set(g);
        n.delete(id);
        return n;
      })
  };

  return (
    <>
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }} role="tablist" aria-label={t("switch")}>
        <button
          role="tab"
          aria-selected={view === "ledger"}
          className={`viewpick${view === "ledger" ? " on" : ""}`}
          onClick={() => pick("ledger")}
        >
          {t("ledger")}
        </button>
        <button
          role="tab"
          aria-selected={view === "housebook"}
          className={`viewpick${view === "housebook" ? " on" : ""}`}
          onClick={() => pick("housebook")}
        >
          {t("housebook")}
        </button>
      </div>
      {view === "ledger" ? (
        <Ledger
          weddingId={weddingId}
          lines={mergedLines}
          items={mergedItems}
          envelopes={envelopes}
          vendors={vendors}
          nextByLine={nextByLine}
          isTeam={isTeam}
          ghosts={ghosts}
          undoStack={undoStack}
          redoStack={redoStack}
        />
      ) : (
        <HouseBook
          weddingId={weddingId}
          lines={mergedLines}
          items={mergedItems}
          payments={payments}
          envelopes={envelopes}
          envelopeNotes={envelopeNotes}
          isTeam={isTeam}
          ghosts={ghosts}
        />
      )}
    </>
  );
}

/* ════════════════ VUE A — THE LEDGER ════════════════ */

interface Row {
  id: string;
  kind: "line" | "child" | "item";
  /** The owning line — itself for lines, the parent for items. */
  lineId: string;
  parentId: string | null;
  envelopeId: string | null;
  vendorId: string | null;
  label: string;
  budgeted: number | null;
  currency: string;
  ht: number | null;
  vatPct: number | null;
  committed: number | null;
  committedNote: string | null;
  paid: number;
  next: string;
  status: string;
  draft: boolean;
  /** The traced EUR equivalent of a foreign engagement (§1.1). */
  committedEur: number | null;
  hasFxRate: boolean;
  /** Items: read from a document, or entered by the house (§4.3). */
  sourceRead?: boolean;
}

const LINE_EDITABLE: Record<string, LineField> = { "1": "label", "2": "currency", "5": "committed", "6": "paid" };
const ITEM_EDITABLE: Record<string, ItemField> = { "1": "label", "3": "ht", "4": "vat", "5": "ttc" };

interface Ghosts {
  addLine: (line: BudgetLine) => void;
  addItem: (item: BudgetLineItem) => void;
  remove: (id: string) => void;
  unremove: (id: string) => void;
}

function Ledger({
  weddingId,
  lines,
  items,
  envelopes,
  vendors,
  nextByLine,
  isTeam,
  ghosts,
  undoStack,
  redoStack
}: {
  weddingId: string;
  lines: BudgetLine[];
  items: BudgetLineItem[];
  envelopes: BudgetEnvelope[];
  vendors: { id: string; name: string }[];
  nextByLine: Record<string, string>;
  isTeam: boolean;
  ghosts: Ghosts;
  undoStack: React.MutableRefObject<UndoEntry[]>;
  redoStack: React.MutableRefObject<UndoEntry[]>;
}) {
  const t = useTranslations("budget.views");
  const tm = useTranslations("budget.mgmt");
  const tmaster = useTranslations("budget.master");
  const format = useFormatter();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [local, setLocal] = useState<Record<string, Partial<Row>>>({});
  const [localItems, setLocalItems] = useState<Record<string, Partial<BudgetLineItem>>>({});
  const [editing, setEditing] = useState<{ id: string; col: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 1 });
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: null, dir: 1 });
  const [statusFilter, setStatusFilter] = useState("all");
  const [dense, setDense] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // When an edit commits its input unmounts — the keyboard must land
  // back on the grid, or the next shortcut dies in silence (§2).
  const refocusGrid = () => requestAnimationFrame(() => wrapRef.current?.focus());

  const itemsByLine = useMemo(() => {
    const m = new Map<string, BudgetLineItem[]>();
    for (const it of items) {
      const merged = { ...it, ...(localItems[it.id] ?? {}) };
      m.set(it.budget_line_id, [...(m.get(it.budget_line_id) ?? []), merged]);
    }
    return m;
  }, [items, localItems]);

  const rows: Row[] = useMemo(
    () =>
      lines.map((l) => {
        const own = itemsByLine.get(l.id) ?? [];
        const ht = own.length ? own.reduce((s, it) => s + Number(it.total_ht ?? 0), 0) : null;
        const vat = own.length
          ? (() => {
              const t1 = own.reduce((s, it) => s + Number(it.total_ttc ?? it.total_ht ?? 0), 0);
              return ht && t1 > ht ? Math.round(((t1 - ht) / ht) * 1000) / 10 : null;
            })()
          : null;
        const o = local[l.id] ?? {};
        const committed = (o.committed !== undefined ? o.committed : l.committed) as number | null;
        const paid = (o.paid !== undefined ? o.paid : l.paid ?? 0) as number;
        const status = l.committed_note
          ? "awaiting"
          : committed != null && committed - paid <= 0 && paid > 0
            ? "paid"
            : committed != null
              ? "committed"
              : "open";
        return {
          id: l.id,
          kind: (l.parent_line_id ? "child" : "line") as Row["kind"],
          lineId: l.id,
          parentId: l.parent_line_id ?? null,
          envelopeId: l.envelope_id ?? null,
          vendorId: l.vendor_id ?? null,
          label: (o.label !== undefined ? o.label : l.label) as string,
          budgeted: l.budgeted ?? null,
          currency: ((o.currency !== undefined ? o.currency : (l as { currency?: string }).currency) ?? "EUR") as string,
          ht,
          vatPct: vat,
          committed,
          committedNote: l.committed_note ?? null,
          paid,
          next: l.next_payment_label ?? nextByLine[l.id] ?? "",
          status,
          draft: l.status === "draft",
          committedEur: (l as { committed_eur?: number | null }).committed_eur ?? null,
          hasFxRate: Boolean((l as { fx_rate_id?: string | null }).fx_rate_id)
        };
      }),
    [lines, itemsByLine, nextByLine, local]
  );

  const itemRow = (it: BudgetLineItem, line: Row): Row => ({
    id: it.id,
    kind: "item",
    lineId: line.id,
    parentId: line.id,
    envelopeId: line.envelopeId,
    vendorId: null,
    label: it.label,
    budgeted: null,
    currency: "EUR",
    ht: it.total_ht != null ? Number(it.total_ht) : null,
    vatPct: it.vat_pct != null ? Number(it.vat_pct) : null,
    committed: it.total_ttc != null ? Number(it.total_ttc) : it.total_ht != null ? Number(it.total_ht) : null,
    committedNote: null,
    paid: 0,
    next: "",
    status: "item",
    draft: false,
    committedEur: null,
    hasFxRate: false,
    sourceRead: Boolean((it as { source_document_id?: string | null }).source_document_id)
  });

  // Envelope groups: EVERY envelope appears — an empty one still
  // offers its "+ add a line" (§2). Unassigned lines close the list.
  const groups = useMemo(() => {
    let parents = rows.filter((r) => r.kind === "line");
    if (statusFilter !== "all") parents = parents.filter((r) => r.status === statusFilter);
    if (sort.key) {
      const value = (r: Row): string | number => {
        if (sort.key === "label") return r.label;
        if (sort.key === "remaining") return (r.committed ?? 0) - r.paid;
        if (sort.key === "committed") return r.committed ?? 0;
        return r.paid;
      };
      parents = [...parents].sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        if (typeof va === "string" && typeof vb === "string") return sort.dir * va.localeCompare(vb);
        return sort.dir * (Number(va) - Number(vb));
      });
    }
    const byEnv = new Map<string, Row[]>();
    for (const e of envelopes) byEnv.set(e.id, []);
    for (const p of parents) {
      const k = p.envelopeId ?? "";
      byEnv.set(k, [...(byEnv.get(k) ?? []), p]);
    }
    const envLabel = (id: string) => envelopes.find((e) => e.id === id)?.label ?? t("noEnvelope");
    return [...byEnv.entries()]
      .filter(([envId, ps]) => envId !== "" || ps.length > 0 || isTeam)
      .sort((a, b) => {
        if (a[0] === "") return 1;
        if (b[0] === "") return -1;
        return envLabel(a[0]).localeCompare(envLabel(b[0]));
      })
      .map(([envId, ps]) => ({
        envId,
        label: envId ? envLabel(envId) : t("noEnvelope"),
        parents: ps
      }));
  }, [rows, statusFilter, sort, envelopes, t, isTeam]);

  // The flat visible row list — the keyboard's geometry. Items ride
  // just under their line when it is unfolded, before the child lines.
  const flat: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const g of groups) {
      if (collapsed.has(g.envId)) continue;
      for (const p of g.parents) {
        out.push(p);
        if (expanded.has(p.id)) {
          for (const it of itemsByLine.get(p.id) ?? []) out.push(itemRow(it, p));
        }
        for (const c of rows.filter((r) => r.parentId === p.id && r.kind === "child")) out.push(c);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, rows, collapsed, expanded, itemsByLine]);

  const COLS = 9;

  const editableFor = (row: Row, col: number): LineField | ItemField | null => {
    if (!isTeam) return null;
    if (row.kind === "item") return ITEM_EDITABLE[String(col)] ?? null;
    return LINE_EDITABLE[String(col)] ?? null;
  };

  // The pen lands in the label of whatever was just created (§2) —
  // instantly, because creation is optimistic: the ghost row is
  // already in flat while the action writes the same id.
  useEffect(() => {
    if (!pendingFocusId) return;
    const ri = flat.findIndex((f) => f.id === pendingFocusId);
    if (ri < 0) return;
    setFocus({ r: ri, c: 1 });
    const row = flat[ri];
    setEditing({ id: row.id, col: "1" });
    setEditVal(row.label === "—" ? "" : row.label);
    setPendingFocusId(null);
  }, [flat, pendingFocusId]);

  function persistLine(id: string, field: LineField, value: string | number | null, recordUndo = true) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const prev = row[field];
    if (prev === value) return;
    if (recordUndo) {
      undoStack.current.push({ kind: "editLine", id, field, prev: prev as string | number | null });
      redoStack.current = [];
    }
    setLocal((m) => ({ ...m, [id]: { ...m[id], [field]: value } }));
    setSaved("saving");
    startTransition(async () => {
      const fresh = { ...row, [field]: value };
      await updateBudgetLine({
        id,
        label: String(fresh.label),
        budgeted: fresh.budgeted ?? null,
        committed: fresh.committed != null ? Number(fresh.committed) : null,
        paid: Number(fresh.paid ?? 0),
        nextPaymentLabel: fresh.next ?? "",
        currency: String(fresh.currency ?? "EUR")
      });
      setSaved("saved");
      router.refresh();
    });
  }

  function persistItem(itemId: string, lineId: string, field: ItemField, value: string | number | null, recordUndo = true) {
    const source = (itemsByLine.get(lineId) ?? []).find((it) => it.id === itemId);
    if (!source) return;
    const prevMap: Record<ItemField, string | number | null> = {
      label: source.label,
      ht: source.total_ht != null ? Number(source.total_ht) : null,
      vat: source.vat_pct != null ? Number(source.vat_pct) : null,
      ttc: source.total_ttc != null ? Number(source.total_ttc) : null
    };
    if (prevMap[field] === value) return;
    if (recordUndo) {
      undoStack.current.push({ kind: "editItem", id: itemId, lineId, field, prev: prevMap[field] });
      redoStack.current = [];
    }
    const patch: Partial<BudgetLineItem> = {};
    if (field === "label") patch.label = String(value ?? "—");
    if (field === "ht") { patch.total_ht = value as number | null; patch.total_ttc = null; }
    if (field === "vat") { patch.vat_pct = value as number | null; patch.total_ttc = null; }
    if (field === "ttc") patch.total_ttc = value as number | null;
    setLocalItems((m) => ({ ...m, [itemId]: { ...m[itemId], ...patch } }));
    setSaved("saving");
    startTransition(async () => {
      const merged = { ...source, ...patch };
      await saveLineItem({
        id: itemId,
        weddingId,
        budgetLineId: lineId,
        eventLabel: merged.event_label ?? "",
        label: merged.label,
        qty: merged.qty != null ? Number(merged.qty) : null,
        unitPrice: merged.unit_price != null ? Number(merged.unit_price) : null,
        vatPct: merged.vat_pct != null ? Number(merged.vat_pct) : null,
        totalHt: merged.total_ht != null ? Number(merged.total_ht) : null,
        totalTtc: merged.total_ttc != null ? Number(merged.total_ttc) : null
      });
      setSaved("saved");
      router.refresh();
    });
  }

  function commitEdit(move: "down" | "right" | "stay" = "stay") {
    if (!editing) return;
    const row = flat.find((f) => f.id === editing.id);
    const field = row ? editableFor(row, Number(editing.col)) : null;
    if (row && field) {
      if (field === "currency") {
        const code = editVal.trim().toUpperCase();
        if (/^[A-Z]{3}$/.test(code)) persistLine(row.id, "currency", code);
      } else {
        const isText = field === "label";
        const value = isText ? editVal : editVal.trim() === "" ? null : Number(editVal.replace(/[^\d.-]/g, "")) || 0;
        if (row.kind === "item") {
          persistItem(row.id, row.lineId, field as ItemField, value);
        } else {
          persistLine(row.id, field as LineField, field === "paid" && value == null ? 0 : value);
        }
      }
    }
    setEditing(null);
    if (move === "down") setFocus((f) => ({ ...f, r: Math.min(flat.length - 1, f.r + 1) }));
    if (move === "right") setFocus((f) => ({ ...f, c: Math.min(COLS - 1, f.c + 1) }));
    refocusGrid();
  }

  function beginEdit(r: number, c: number) {
    const row = flat[r];
    if (!row) return;
    const field = editableFor(row, c);
    if (!field) return;
    setEditing({ id: row.id, col: String(c) });
    const current =
      row.kind === "item"
        ? field === "label" ? row.label
          : field === "ht" ? row.ht
          : field === "vat" ? row.vatPct
          : row.committed
        : field === "currency" ? row.currency : row[field as LineField];
    setEditVal(current != null ? String(current) : "");
  }

  /**
   * A new line lands in draft, in its envelope, pen in the label,
   * within the same frame (§2) — the id is minted here and the server
   * writes the very same one.
   */
  function insertLine(envelopeId: string | null) {
    if (!isTeam) return;
    const id = crypto.randomUUID();
    ghosts.addLine({
      id, wedding_id: weddingId, envelope_id: envelopeId, parent_line_id: null,
      vendor_id: null, label: "—", budgeted: null, committed: null,
      committed_note: null, paid: 0, next_payment_label: null,
      status: "draft", sort: 999
    } as unknown as BudgetLine);
    setPendingFocusId(id);
    undoStack.current.push({ kind: "createLine", id });
    setSaved("saving");
    startTransition(async () => {
      const r = await addBudgetLine(weddingId, "—", null, { id, envelopeId });
      if (!r.ok) ghosts.remove(id);
      setSaved("saved");
      router.refresh();
    });
  }

  function insertItem(lineId: string) {
    if (!isTeam) return;
    const id = crypto.randomUUID();
    setExpanded((s) => new Set(s).add(lineId));
    ghosts.addItem({
      id, wedding_id: weddingId, budget_line_id: lineId, event_label: null,
      label: "—", qty: null, unit_price: null, vat_pct: null,
      total_ht: null, total_ttc: null, sort: 999
    } as unknown as BudgetLineItem);
    setPendingFocusId(id);
    undoStack.current.push({ kind: "createItem", id, lineId });
    setSaved("saving");
    startTransition(async () => {
      const r = await saveLineItem({
        createId: id,
        weddingId,
        budgetLineId: lineId,
        eventLabel: "",
        label: "—",
        qty: null,
        unitPrice: null,
        vatPct: null,
        totalHt: null,
        totalTtc: null
      });
      if (!r.ok) ghosts.remove(id);
      setSaved("saved");
      router.refresh();
    });
  }

  function duplicateActive() {
    const row = flat[focus.r];
    if (!row || row.kind === "item" || !isTeam) return;
    const id = crypto.randomUUID();
    ghosts.addLine({
      id, wedding_id: weddingId, envelope_id: row.envelopeId, parent_line_id: row.parentId,
      vendor_id: row.vendorId, label: row.label, budgeted: row.budgeted,
      committed: row.committed, committed_note: null, paid: 0,
      next_payment_label: null, status: "draft", sort: 999
    } as unknown as BudgetLine);
    setPendingFocusId(id);
    undoStack.current.push({ kind: "createLine", id });
    setSaved("saving");
    startTransition(async () => {
      const r = await duplicateBudgetLine(row.lineId, id);
      if (!r.ok) ghosts.remove(id);
      setSaved("saved");
      router.refresh();
    });
  }

  /** Delete in place — a draft asks no confirmation, undo suffices (§2). */
  function removeRow(row: Row) {
    if (!isTeam) return;
    refocusGrid();
    if (row.kind === "item") {
      const source = (itemsByLine.get(row.lineId) ?? []).find((it) => it.id === row.id);
      ghosts.remove(row.id);
      setSaved("saving");
      startTransition(async () => {
        if (source) undoStack.current.push({ kind: "deleteItem", item: source });
        await deleteLineItem(row.id, row.lineId);
        setSaved("saved");
        router.refresh();
      });
      return;
    }
    if (!row.draft && !window.confirm(t("confirmRemovePublished", { label: row.label }))) {
      return;
    }
    ghosts.remove(row.id);
    setSaved("saving");
    startTransition(async () => {
      const r = await deleteBudgetLineWithUndo(row.id);
      if (r.ok && r.row) undoStack.current.push({ kind: "deleteLine", row: r.row, items: r.items });
      setSaved("saved");
      router.refresh();
    });
  }

  function undo(redo: boolean) {
    const stack = redo ? redoStack.current : undoStack.current;
    const entry = stack.pop();
    if (!entry) return;
    if (entry.kind === "editLine") {
      const row = rows.find((r) => r.id === entry.id);
      if (row) {
        (redo ? undoStack.current : redoStack.current).push({
          kind: "editLine", id: entry.id, field: entry.field, prev: row[entry.field] as string | number | null
        });
        persistLine(entry.id, entry.field, entry.prev, false);
      }
      return;
    }
    if (entry.kind === "editItem") {
      const source = (itemsByLine.get(entry.lineId) ?? []).find((it) => it.id === entry.id);
      if (source) {
        const currentMap: Record<ItemField, string | number | null> = {
          label: source.label,
          ht: source.total_ht != null ? Number(source.total_ht) : null,
          vat: source.vat_pct != null ? Number(source.vat_pct) : null,
          ttc: source.total_ttc != null ? Number(source.total_ttc) : null
        };
        (redo ? undoStack.current : redoStack.current).push({
          kind: "editItem", id: entry.id, lineId: entry.lineId, field: entry.field, prev: currentMap[entry.field]
        });
        persistItem(entry.id, entry.lineId, entry.field, entry.prev, false);
      }
      return;
    }
    // Structural gestures reverse optimistically too, without
    // entering the redo stack.
    if (entry.kind === "createLine" || entry.kind === "createItem") ghosts.remove(entry.id);
    if (entry.kind === "deleteLine") {
      ghosts.unremove(String(entry.row.id));
      ghosts.addLine(entry.row as unknown as BudgetLine);
    }
    if (entry.kind === "deleteItem") {
      ghosts.unremove(entry.item.id);
      ghosts.addItem(entry.item);
    }
    setSaved("saving");
    startTransition(async () => {
      if (entry.kind === "createLine") await deleteBudgetLineWithUndo(entry.id);
      if (entry.kind === "deleteLine") await restoreBudgetLine(entry.row, entry.items);
      if (entry.kind === "createItem") await deleteLineItem(entry.id, entry.lineId);
      if (entry.kind === "deleteItem") {
        const it = entry.item;
        await saveLineItem({
          createId: it.id,
          weddingId,
          budgetLineId: it.budget_line_id,
          eventLabel: it.event_label ?? "",
          label: it.label,
          qty: it.qty != null ? Number(it.qty) : null,
          unitPrice: it.unit_price != null ? Number(it.unit_price) : null,
          vatPct: it.vat_pct != null ? Number(it.vat_pct) : null,
          totalHt: it.total_ht != null ? Number(it.total_ht) : null,
          totalTtc: it.total_ttc != null ? Number(it.total_ttc) : null
        });
      }
      setSaved("saved");
      router.refresh();
    });
  }

  function onKey(e: React.KeyboardEvent) {
    // The spreadsheet gestures (§2): insert below, insert a sub-line,
    // duplicate — the difference between a table and a sheet.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (editing) commitEdit();
      const row = flat[focus.r];
      if (e.shiftKey) {
        if (row) insertItem(row.lineId);
      } else {
        insertLine(row?.envelopeId ?? null);
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicateActive();
      return;
    }
    if (editing) {
      if (e.key === "Enter") { e.preventDefault(); commitEdit("down"); }
      if (e.key === "Tab") { e.preventDefault(); commitEdit("right"); }
      if (e.key === "Escape") { setEditing(null); refocusGrid(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setEditing(null);
        undo(e.shiftKey);
        refocusGrid();
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo(e.shiftKey);
      return;
    }
    if (e.key === "Delete" || (e.key === "Backspace" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      const row = flat[focus.r];
      if (row) removeRow(row);
      return;
    }
    const nav: Record<string, [number, number]> = {
      ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1]
    };
    if (nav[e.key]) {
      e.preventDefault();
      setFocus((f) => ({
        r: Math.max(0, Math.min(flat.length - 1, f.r + nav[e.key][0])),
        c: Math.max(1, Math.min(COLS - 1, f.c + nav[e.key][1]))
      }));
    }
    if (e.key === "Enter") { e.preventDefault(); beginEdit(focus.r, focus.c); }
    if (e.key === "Tab") { e.preventDefault(); setFocus((f) => ({ ...f, c: f.c >= COLS - 1 ? 1 : f.c + 1 })); }
  }

  /** Multi-cell paste from Excel or Sheets: TSV, anchored at the focus. */
  function onPaste(e: React.ClipboardEvent) {
    if (!isTeam || editing) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
    e.preventDefault();
    const matrix = text.replace(/\r/g, "").split("\n").filter((l) => l.length).map((l) => l.split("\t"));
    const editCols = [1, 5, 6];
    const startCol = editCols.includes(focus.c) ? focus.c : 5;
    matrix.forEach((cells, dr) => {
      const row = flat[focus.r + dr];
      if (!row || row.kind === "item") return;
      cells.forEach((cell, dc) => {
        const col = startCol + dc;
        const field = LINE_EDITABLE[String(col)];
        if (!field) return;
        const value = field === "label" ? cell : cell.trim() === "" ? null : Number(cell.replace(/[^\d.-]/g, "")) || 0;
        persistLine(row.id, field, field === "paid" && value == null ? 0 : value);
      });
    });
  }

  async function exportSheet(kind: "csv" | "xlsx") {
    const header = [t("colLine"), t("colCurrency"), "HT", t("colVat"), "TTC", t("colPaid"), t("colRemaining"), t("colNext"), t("colStatus")];
    const data = flat.map((r) => [
      (r.kind === "child" ? "  ↳ " : r.kind === "item" ? "    · " : "") + r.label,
      r.currency,
      r.ht,
      r.vatPct != null ? `${r.vatPct}%` : null,
      r.committed,
      r.kind === "item" ? null : r.paid,
      r.kind === "item" ? null : r.committed != null ? r.committed - r.paid : null,
      r.next || null,
      r.kind === "item" ? null : t(`status.${r.status}`)
    ]);
    if (kind === "csv") {
      const csv = [header, ...data]
        .map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";"))
        .join("\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "budget-ledger.csv";
      a.click();
      return;
    }
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    const n = data.length;
    XLSX.utils.sheet_add_aoa(ws, [[t("total"), null, null, null, null, null, null, null, null]], { origin: n + 1 });
    ws[XLSX.utils.encode_cell({ r: n + 1, c: 4 })] = { t: "n", f: `SUM(E2:E${n + 1})` };
    ws[XLSX.utils.encode_cell({ r: n + 1, c: 5 })] = { t: "n", f: `SUM(F2:F${n + 1})` };
    ws[XLSX.utils.encode_cell({ r: n + 1, c: 6 })] = { t: "n", f: `SUM(G2:G${n + 1})` };
    ws["!cols"] = [{ wch: 38 }, { wch: 6 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ledger");
    XLSX.writeFile(wb, "budget-ledger.xlsx");
  }

  const th = (label: string, key: SortKey, num = false) => (
    <th
      className={num ? "num" : undefined}
      style={{ cursor: key ? "pointer" : undefined, whiteSpace: "nowrap" }}
      onClick={key ? () => setSort((s) => ({ key, dir: s.key === key && s.dir === 1 ? -1 : 1 })) : undefined}
      aria-sort={key && sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
    >
      {label}
      {key && sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  const cell = (row: Row, ri: number, col: number, content: React.ReactNode, num = false) => {
    const isEditing = editing && editing.id === row.id && editing.col === String(col);
    const isFocus = !isEditing && focus.r === ri && focus.c === col;
    const editable = editableFor(row, col);
    return (
      <td
        className={`${num ? "num " : ""}${isFocus ? "cell-focus" : ""}${isEditing ? "cell-editing" : ""}`}
        style={editable ? { cursor: "text" } : undefined}
        onClick={() => { setFocus({ r: ri, c: col }); if (editable) beginEdit(ri, col); }}
      >
        {isEditing ? (
          <input
            autoFocus
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={() => commitEdit()}
            style={{ width: "100%", border: "none", background: "transparent", font: "inherit", padding: 0, textAlign: num ? "right" : "left", outline: "none" }}
          />
        ) : (
          content
        )}
      </td>
    );
  };

  const renderLineRow = (r: Row, ri: number, isActiveRow: boolean) => {
    const own = itemsByLine.get(r.id) ?? [];
    const isOpen = expanded.has(r.id);
    const sum = own.reduce((s, it) => s + Number(it.total_ttc ?? it.total_ht ?? 0), 0);
    const diverges = own.length > 0 && r.committed != null && Math.round(sum) !== Math.round(r.committed);
    return (
      <tr
        key={r.id}
        className={isActiveRow ? "row-active" : undefined}
        style={r.kind === "child" ? { color: "var(--ink2)", fontSize: "0.94em" } : undefined}
      >
        <td style={{ textAlign: "center", paddingRight: 4 }}>
          {r.draft && (
            <span className="draft-dot" role="img" aria-label={t("status.draftAria")} title={t("status.draft")}>
              <span className="sr-only">{t("status.draftAria")}</span>
            </span>
          )}
        </td>
        {cell(
          r, ri, 1,
          <>
            {r.kind === "line" && (
              <button
                className="ledger-fold"
                aria-expanded={isOpen}
                aria-label={t("unfold", { label: r.label })}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((s) => {
                    const n = new Set(s);
                    if (n.has(r.id)) n.delete(r.id); else n.add(r.id);
                    return n;
                  });
                }}
              >
                {isOpen ? "▾" : "▸"}
              </button>
            )}
            {r.kind === "child" && "↳ "}
            {r.label}
            {diverges && (
              <span className="tag int" style={{ marginLeft: 8 }} title={t("sublinesGap", { sum: money(format, sum), committed: money(format, r.committed) })}>
                {t("gapShort")}
              </span>
            )}
            {r.vendorId && r.kind === "line" && (
              <Link className="addnote" style={{ marginLeft: 8, fontSize: 12 }} href={`/budget/vendor/${r.vendorId}`}>
                {tmaster("sheet")}
              </Link>
            )}
            {isTeam && isActiveRow && (
              <button
                className="addnote team-only ledger-remove"
                title={t("removeLine")}
                aria-label={t("removeLine")}
                onClick={(e) => { e.stopPropagation(); removeRow(r); }}
              >
                ×
              </button>
            )}
          </>
        )}
        {cell(r, ri, 2, r.currency)}
        {cell(r, ri, 3, r.ht != null ? money(format, r.ht, r.currency) : "—", true)}
        {cell(r, ri, 4, r.vatPct != null ? `${r.vatPct} %` : "—", true)}
        {cell(
          r, ri, 5,
          r.committed != null ? (
            <>
              {money(format, r.committed, r.currency)}
              {r.currency !== "EUR" && r.committedEur != null && (
                <span style={{ display: "block", fontSize: 11.5, color: "var(--ink2)" }}>≈ {money(format, r.committedEur)}</span>
              )}
            </>
          ) : (
            r.committedNote ?? "—"
          ),
          true
        )}
        {cell(r, ri, 6, r.paid ? money(format, r.paid, r.currency) : "—", true)}
        {cell(r, ri, 7, r.committed != null ? money(format, r.committed - r.paid, r.currency) : "—", true)}
        {cell(r, ri, 8, r.next || "—")}
      </tr>
    );
  };

  const renderItemRow = (r: Row, ri: number, isActiveRow: boolean) => (
    <tr key={r.id} className={`ledger-item${isActiveRow ? " row-active" : ""}`}>
      <td></td>
      {cell(
        r, ri, 1,
        <>
          <span style={{ color: "var(--champagne)" }}>· </span>
          <span title={r.sourceRead ? t("provenanceRead") : t("provenanceManual")}>{r.label}</span>
          {isTeam && isActiveRow && (
            <button
              className="addnote team-only ledger-remove"
              title={t("removeSubline")}
              aria-label={t("removeSubline")}
              onClick={(e) => { e.stopPropagation(); removeRow(r); }}
            >
              ×
            </button>
          )}
        </>
      )}
      {cell(r, ri, 2, "")}
      {cell(r, ri, 3, r.ht != null ? money(format, r.ht) : "—", true)}
      {cell(r, ri, 4, r.vatPct != null ? `${r.vatPct} %` : "—", true)}
      {cell(r, ri, 5, r.committed != null ? money(format, r.committed) : "—", true)}
      {cell(r, ri, 6, "", true)}
      {cell(r, ri, 7, "", true)}
      {cell(r, ri, 8, "")}
    </tr>
  );

  /** The unfolded line's quiet toolbelt: regime, envelope, sub-line add. */
  const renderLineTools = (r: Row) => {
    const own = itemsByLine.get(r.id) ?? [];
    const sum = own.reduce((s, it) => s + Number(it.total_ttc ?? it.total_ht ?? 0), 0);
    const diverges = own.length > 0 && r.committed != null && Math.round(sum) !== Math.round(r.committed);
    return (
      <tr key={`${r.id}-tools`} className="ledger-tools team-only">
        <td></td>
        <td colSpan={8}>
          <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap", padding: "2px 0 6px" }}>
            {isTeam && (
              <button className="addnote" onClick={() => insertItem(r.id)}>
                {t("addSubline")}
              </button>
            )}
            {own.length === 0 && r.vendorId && (
              <span style={{ fontSize: 12.5, color: "var(--bronze)" }}>{t("noDetailRead")}</span>
            )}
            {own.length > 0 && (
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                {t("sumRegime")}
                {diverges && (
                  <strong style={{ color: "var(--bronze)", marginLeft: 8 }}>
                    {t("sublinesGap", { sum: money(format, sum), committed: money(format, r.committed) })}
                  </strong>
                )}
              </span>
            )}
            {own.length === 0 && !r.vendorId && (
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>{t("freeRegime")}</span>
            )}
            {isTeam && r.currency !== "EUR" && (
              <FxHolder
                lineId={r.id}
                weddingId={weddingId}
                currency={r.currency}
                committedEur={r.committedEur}
                hasRate={r.hasFxRate}
              />
            )}
            {isTeam && (
              <label style={{ fontSize: 12, color: "var(--ink2)", display: "inline-flex", gap: 6, alignItems: "baseline" }}>
                {t("envelope")}
                <select
                  value={r.envelopeId ?? ""}
                  onChange={(e) =>
                    startTransition(async () => {
                      await setLineEnvelope(r.id, e.target.value || null);
                      router.refresh();
                    })
                  }
                  style={{ padding: "3px 6px", border: "1px solid var(--line)", background: "#fff", fontSize: 12 }}
                >
                  <option value="">{t("noEnvelope")}</option>
                  {envelopes.map((e) => (
                    <option key={e.id} value={e.id}>{e.label}</option>
                  ))}
                </select>
              </label>
            )}
            {/* A line names its vendor in place — the fiche link appears,
                and a homeless line inherits the vendor's category. */}
            {isTeam && (
              <label style={{ fontSize: 12, color: "var(--ink2)", display: "inline-flex", gap: 6, alignItems: "baseline" }}>
                {t("vendor")}
                <select
                  value={r.vendorId ?? ""}
                  onChange={(e) =>
                    startTransition(async () => {
                      await setLineVendor(r.id, e.target.value || null);
                      router.refresh();
                    })
                  }
                  style={{ padding: "3px 6px", border: "1px solid var(--line)", background: "#fff", fontSize: 12 }}
                >
                  <option value="">{t("noVendor")}</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="card">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <div className="eyebrow" style={{ marginRight: "auto" }}>{tm("lineByLine")}</div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: "8px 10px", border: "1px solid var(--line)", background: "#fff", fontSize: 12.5 }} aria-label={t("filter")}>
          <option value="all">{t("status.all")}</option>
          <option value="committed">{t("status.committed")}</option>
          <option value="awaiting">{t("status.awaiting")}</option>
          <option value="paid">{t("status.paid")}</option>
          <option value="open">{t("status.open")}</option>
        </select>
        {isTeam && (
          <button className="addnote team-only" onClick={() => setDense((v) => !v)} aria-pressed={dense}>
            {dense ? t("comfortable") : t("compact")}
          </button>
        )}
        <button className="addnote" onClick={() => exportSheet("csv")}>CSV</button>
        <button className="addnote" onClick={() => exportSheet("xlsx")}>XLSX</button>
        {isTeam && (
          <span style={{ fontSize: 12.5, color: saved === "saving" ? "var(--bronze)" : "var(--ink2)" }} role="status" aria-live="polite">
            {saved === "saving" ? t("saving") : saved === "saved" ? t("savedNote") : ""}
          </span>
        )}
      </div>

      <div ref={wrapRef} className="ledger-wrap" onKeyDown={onKey} onPaste={onPaste} tabIndex={0} role="grid" aria-label={tm("lineByLine")}>
        <table className={`sheet-table ledger${dense ? " dense" : ""}`} ref={gridRef}>
          <thead>
            <tr>
              <th aria-label={t("colStatus")} style={{ width: 20 }}></th>
              {th(t("colLine"), "label")}
              {th(t("colCurrency"), null)}
              {th("HT", null, true)}
              {th(t("colVat"), null, true)}
              {th("TTC", "committed", true)}
              {th(t("colPaid"), "paid", true)}
              {th(t("colRemaining"), "remaining", true)}
              {th(t("colNext"), null)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const groupLineRows = g.parents.flatMap((p) => [p, ...rows.filter((r) => r.parentId === p.id && r.kind === "child")]);
              const sub = groupLineRows.reduce(
                (a, r) => ({ ttc: a.ttc + Number(r.committed ?? 0), paid: a.paid + Number(r.paid ?? 0) }),
                { ttc: 0, paid: 0 }
              );
              const isCollapsed = collapsed.has(g.envId);
              return (
                <React.Fragment key={g.envId || "none"}>
                  <tr className="ledger-group">
                    <td colSpan={5}>
                      <button
                        className="addnote"
                        onClick={() =>
                          setCollapsed((s) => {
                            const n = new Set(s);
                            if (n.has(g.envId)) n.delete(g.envId); else n.add(g.envId);
                            return n;
                          })
                        }
                        aria-expanded={!isCollapsed}
                      >
                        {isCollapsed ? "▸" : "▾"} {g.label}
                      </button>
                    </td>
                    <td className="num" style={{ fontWeight: 500 }}>{money(format, sub.ttc)}</td>
                    <td className="num">{money(format, sub.paid)}</td>
                    <td className="num">{money(format, sub.ttc - sub.paid)}</td>
                    <td></td>
                  </tr>
                  {!isCollapsed &&
                    g.parents.flatMap((p) => {
                      const out: React.ReactNode[] = [];
                      const pi = flat.findIndex((f) => f.id === p.id);
                      out.push(renderLineRow(p, pi, flat[focus.r]?.id === p.id));
                      if (expanded.has(p.id)) {
                        for (const it of itemsByLine.get(p.id) ?? []) {
                          const r = itemRow(it, p);
                          const ri = flat.findIndex((f) => f.id === r.id);
                          out.push(renderItemRow(r, ri, flat[focus.r]?.id === r.id));
                        }
                        out.push(renderLineTools(p));
                      }
                      for (const c of rows.filter((r) => r.parentId === p.id && r.kind === "child")) {
                        const ci = flat.findIndex((f) => f.id === c.id);
                        out.push(renderLineRow(c, ci, flat[focus.r]?.id === c.id));
                      }
                      return out;
                    })}
                  {!isCollapsed && isTeam && (
                    <tr className="ledger-addrow team-only">
                      <td></td>
                      <td colSpan={8}>
                        <button className="addnote" onClick={() => insertLine(g.envId || null)}>
                          {t("addLine")}
                        </button>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {isTeam && (
        <p className="team-only" style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 10 }}>
          <span className="draft-dot" aria-hidden="true" style={{ marginRight: 6 }} />
          {t("draftLegend")} — {t("ledgerHint")} {t("insertHint")}
        </p>
      )}
    </div>
  );
}

/**
 * A foreign engagement holds its rate here (§1.2): value, source —
 * dated today, written to fx_rates, referenced by the line. Without
 * it the line stands apart from every total, and says so.
 */
function FxHolder({
  lineId,
  weddingId,
  currency,
  committedEur,
  hasRate
}: {
  lineId: string;
  weddingId: string;
  currency: string;
  committedEur: number | null;
  hasRate: boolean;
}) {
  const t = useTranslations("budget.views");
  const format = useFormatter();
  const router = useRouter();
  const [openForm, setOpenForm] = useState(false);
  const [rate, setRate] = useState("");
  const [source, setSource] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const go = () =>
    startTransition(async () => {
      const r = await setLineFxRate(lineId, weddingId, {
        rate: Number(rate.replace(",", ".")),
        source: source.trim()
      });
      if (!r.ok) setNote("needsMigration" in r && r.needsMigration ? t("fxNeedsMigration") : t("fxBadRate"));
      else {
        setNote(null);
        setOpenForm(false);
        router.refresh();
      }
    });

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 12 }}>
      {!hasRate && (
        <span style={{ color: "var(--bronze)", fontWeight: 500 }}>{t("fxMissing", { currency })}</span>
      )}
      {hasRate && committedEur != null && (
        <span style={{ color: "var(--ink2)" }}>{t("fxHeld", { eur: money(format, committedEur) })}</span>
      )}
      {!openForm ? (
        <button className="addnote" onClick={() => setOpenForm(true)}>
          {hasRate ? t("fxRevise") : t("fxSet")}
        </button>
      ) : (
        <>
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder={t("fxRatePlaceholder", { currency })}
            inputMode="decimal"
            style={{ width: 110, padding: "3px 6px", border: "1px solid var(--line)", fontSize: 12 }}
          />
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={t("fxSourcePlaceholder")}
            style={{ width: 140, padding: "3px 6px", border: "1px solid var(--line)", fontSize: 12 }}
          />
          <button className="addnote" disabled={pending || !(Number(rate.replace(",", ".")) > 0) || !source.trim()} onClick={go}>
            {pending ? "…" : t("hold")}
          </button>
          <button className="addnote" onClick={() => setOpenForm(false)}>{t("leave")}</button>
        </>
      )}
      {note && <span style={{ color: "var(--bronze)" }}>{note}</span>}
    </span>
  );
}

/* ════════════════ VUE B — THE HOUSE BOOK ════════════════ */

function HouseBook({
  weddingId,
  lines,
  items,
  payments,
  envelopes,
  envelopeNotes,
  isTeam,
  ghosts
}: {
  weddingId: string;
  lines: BudgetLine[];
  items: BudgetLineItem[];
  payments: Payment[];
  envelopes: BudgetEnvelope[];
  envelopeNotes: EnvelopeNote[];
  isTeam: boolean;
  ghosts: Ghosts;
}) {
  const t = useTranslations("budget.views");
  const format = useFormatter();
  const [open, setOpen] = useState<string | null>(null);

  const groups = useMemo(() => {
    const parents = lines.filter((l) => !l.parent_line_id);
    const byEnv = new Map<string | null, BudgetLine[]>();
    for (const e of envelopes) byEnv.set(e.id, []);
    for (const p of parents) byEnv.set(p.envelope_id ?? null, [...(byEnv.get(p.envelope_id ?? null) ?? []), p]);
    return [...byEnv.entries()]
      .filter(([envId, ps]) => envId !== null || ps.length > 0)
      .map(([envId, ps]) => {
        const env = envelopes.find((e) => e.id === envId) ?? null;
        const note = envelopeNotes.find((n) => n.envelope_id === envId && n.status === "published") ?? null;
        const kids = (p: BudgetLine) => lines.filter((l) => l.parent_line_id === p.id);
        const all = ps.flatMap((p) => [p, ...kids(p)]);
        const committed = all.reduce((s, l) => s + Number(l.committed ?? 0), 0);
        const paid = all.reduce((s, l) => s + Number(l.paid ?? 0), 0);
        return { env, note, parents: ps, committed, paid };
      });
  }, [lines, envelopes, envelopeNotes]);

  const totalCommitted = groups.reduce((s, g) => s + g.committed, 0);
  const placed = [...groups].filter((g) => g.committed > 0).sort((a, b) => b.committed - a.committed);
  const notPlaced = groups.filter((g) => g.committed === 0);
  const maxCommitted = placed[0]?.committed ?? 0;

  return (
    <>
      {/* Where the money goes (chiffres-visuels §4): one horizontal
          rule per envelope, sorted, the paid visible inside each —
          never a pie, and never a colour without its words. */}
      {placed.length > 0 && (
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 12 }}>{t("distribution.title")}</div>
          {placed.map((g, gi) => {
            const share = totalCommitted > 0 ? Math.round((g.committed / totalCommitted) * 100) : 0;
            const widthPct = maxCommitted > 0 ? (g.committed / maxCommitted) * 100 : 0;
            const paidPct = g.committed > 0 ? (g.paid / g.committed) * 100 : 0;
            return (
              <div className="dist-row" key={g.env?.id ?? `p-${gi}`}>
                <div className="dist-head">
                  <span>{g.env?.label ?? t("noEnvelope")}</span>
                  <span className="num" style={{ color: "var(--ink2)" }}>
                    {t("distribution.share", { amount: money(format, g.committed), pct: share })}
                  </span>
                </div>
                <div className="dist-bar" role="img" aria-label={t("distribution.aria", { label: g.env?.label ?? t("noEnvelope"), paid: money(format, g.paid), committed: money(format, g.committed) })}>
                  <span className="dist-committed" style={{ width: `${widthPct}%` }}>
                    <span className="dist-paid" style={{ width: `${paidPct}%` }} />
                  </span>
                </div>
              </div>
            );
          })}
          {notPlaced.length > 0 && (
            <p style={{ fontSize: 13, color: "var(--ink2)", margin: "10px 0 0" }}>
              {t("distribution.notYet", { labels: notPlaced.map((g) => g.env?.label ?? t("noEnvelope")).join(" · ") })}
            </p>
          )}
        </div>
      )}
      <div className="housebook">
      {groups.map((g, gi) => {
        const pct = g.committed > 0 ? Math.min(100, Math.round((g.paid / g.committed) * 100)) : 0;
        return (
          <div className="card hb-card" key={g.env?.id ?? `none-${gi}`}>
            <div className="serif" style={{ fontSize: 19 }}>{g.env?.label ?? t("noEnvelope")}</div>
            {g.note?.body && (
              <p className="envnote" style={{ marginTop: 4 }}>&ldquo;{g.note.body}&rdquo; — Estelle</p>
            )}
            <div className="serif num" style={{ fontSize: 26, marginTop: 10 }}>
              {g.committed > 0 ? money(format, g.committed) : <em style={{ fontSize: 16, color: "var(--ink2)" }}>{t("notYetPlaced")}</em>}
            </div>
            {g.committed > 0 && (
              <>
                <div className="hb-gauge" role="img" aria-label={t("gauge", { pct })}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink2)", marginTop: 4 }}>
                  <span>{t("paidShort", { amount: money(format, g.paid) })}</span>
                  <span>{t("remainingShort", { amount: money(format, g.committed - g.paid) })}</span>
                </div>
              </>
            )}
            <div style={{ marginTop: 12 }}>
              {g.parents.map((p) => {
                const own = items.filter((it) => it.budget_line_id === p.id);
                const sched = payments.filter((x) => x.budget_line_id === p.id);
                const openable = own.length > 0 || sched.length > 0 || isTeam;
                const isOpen = open === p.id;
                return (
                  <div key={p.id} className="hb-line">
                    <button
                      className="hb-linehead"
                      onClick={() => openable && setOpen(isOpen ? null : p.id)}
                      aria-expanded={isOpen}
                      style={{ cursor: openable ? "pointer" : "default" }}
                    >
                      <span>
                        {p.label}
                        {isTeam && p.status === "draft" && <span className="tag int" style={{ marginLeft: 8 }}>{t("status.draft")}</span>}
                      </span>
                      <span className="num">
                        {p.committed != null ? money(format, p.committed) : p.committed_note ?? "—"}
                        {openable && <span style={{ marginLeft: 8, color: "var(--ink2)" }}>{isOpen ? "▾" : "▸"}</span>}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="hb-detail">
                        {own.length > 0 && (
                          <div style={{ marginBottom: sched.length ? 10 : 0 }}>
                            {own.map((it) => (
                              <div key={it.id} className="hb-item">
                                <span title={isTeam ? ((it as { source_document_id?: string | null }).source_document_id ? t("provenanceRead") : t("provenanceManual")) : undefined}>
                                  {it.event_label ? <em style={{ color: "var(--bronze)" }}>{it.event_label} · </em> : null}
                                  {it.label}
                                </span>
                                <span className="num">{money(format, it.total_ttc ?? it.total_ht)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {own.length === 0 && isTeam && p.vendor_id && (
                          <p className="team-only" style={{ fontSize: 12.5, color: "var(--bronze)", margin: "0 0 8px" }}>
                            {t("noDetailRead")}
                          </p>
                        )}
                        {isTeam && (
                          <HouseBookAdd
                            weddingId={weddingId}
                            budgetLineId={p.id}
                            kind="detail"
                            ghosts={ghosts}
                          />
                        )}
                        {sched.length > 0 && (
                          <div>
                            <div className="eyebrow" style={{ marginBottom: 4 }}>{t("scheduleTitle")}</div>
                            {sched.map((x) => (
                              <div key={x.id} className="hb-item">
                                <span>
                                  {x.label}
                                  {x.paid_at && <span className="tag ok" style={{ marginLeft: 8 }}>{t("settled")}</span>}
                                </span>
                                <span className="num">
                                  {format.number(x.amount, { style: "currency", currency: x.currency || "EUR", maximumFractionDigits: 0 })}
                                  {x.due_date && (
                                    <span style={{ marginLeft: 8, color: "var(--ink2)", fontSize: 12 }}>
                                      {format.dateTime(new Date(x.due_date), { day: "numeric", month: "short", year: "numeric" })}
                                    </span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {isTeam && (
                <HouseBookAdd
                  weddingId={weddingId}
                  envelopeId={g.env?.id ?? null}
                  kind="line"
                  ghosts={ghosts}
                />
              )}
            </div>
          </div>
        );
      })}
      </div>
    </>
  );
}

/**
 * Adding in The House Book: one field at a time, calmly — the ledger
 * is for series entry, this view is for the poised gesture (§3).
 * Team-only by server-checked session; the render gate is isTeam.
 */
function HouseBookAdd({
  weddingId,
  envelopeId,
  budgetLineId,
  kind,
  ghosts
}: {
  weddingId: string;
  envelopeId?: string | null;
  budgetLineId?: string;
  kind: "line" | "detail";
  ghosts: Ghosts;
}) {
  const t = useTranslations("budget.views");
  const router = useRouter();
  const [openForm, setOpenForm] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, startTransition] = useTransition();

  if (!openForm) {
    return (
      <button className="addnote team-only" style={{ marginTop: kind === "line" ? 10 : 0 }} onClick={() => setOpenForm(true)}>
        {kind === "line" ? t("addLine") : t("addDetail")}
      </button>
    );
  }

  const go = () => {
    const n = amount.trim() === "" ? null : Number(amount.replace(/[^\d.-]/g, "")) || 0;
    const id = crypto.randomUUID();
    // The gesture shows itself at once, in both views (§3): the ghost
    // carries the same id the server is writing.
    if (kind === "line") {
      ghosts.addLine({
        id, wedding_id: weddingId, envelope_id: envelopeId ?? null, parent_line_id: null,
        vendor_id: null, label: label.trim() || "—", budgeted: null, committed: n,
        committed_note: null, paid: 0, next_payment_label: null, status: "draft", sort: 999
      } as unknown as BudgetLine);
    } else if (budgetLineId) {
      ghosts.addItem({
        id, wedding_id: weddingId, budget_line_id: budgetLineId, event_label: null,
        label: label.trim() || "—", qty: null, unit_price: null, vat_pct: null,
        total_ht: null, total_ttc: n, sort: 999
      } as unknown as BudgetLineItem);
    }
    startTransition(async () => {
      if (kind === "line") {
        await addBudgetLine(weddingId, label.trim() || "—", null, { id, envelopeId: envelopeId ?? null, committed: n });
      } else if (budgetLineId) {
        await saveLineItem({
          createId: id,
          weddingId,
          budgetLineId,
          eventLabel: "",
          label: label.trim() || "—",
          qty: null,
          unitPrice: null,
          vatPct: null,
          totalHt: null,
          totalTtc: n
        });
      }
      router.refresh();
    });
    setLabel("");
    setAmount("");
    setOpenForm(false);
  };

  return (
    <div className="team-only" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0" }}>
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={kind === "line" ? t("addLinePlaceholder") : t("addDetailPlaceholder")}
        onKeyDown={(e) => { if (e.key === "Enter" && label.trim()) go(); if (e.key === "Escape") setOpenForm(false); }}
        style={{ flex: 2, minWidth: 160, padding: "8px 10px", border: "1px solid var(--line)", fontSize: 14 }}
      />
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder={t("amountPlaceholder")}
        inputMode="decimal"
        onKeyDown={(e) => { if (e.key === "Enter" && label.trim()) go(); if (e.key === "Escape") setOpenForm(false); }}
        style={{ width: 110, padding: "8px 10px", border: "1px solid var(--line)", fontSize: 14, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
      />
      <button className="btn ghost sm" disabled={pending || !label.trim()} onClick={go}>
        {pending ? "…" : t("hold")}
      </button>
      <button className="addnote" onClick={() => setOpenForm(false)}>{t("leave")}</button>
    </div>
  );
}
