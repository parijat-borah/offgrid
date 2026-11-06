import {
  balances,
  formatPaise,
  parseRupees,
  settleUp,
  sharesOf,
  upiLink,
  validateExpense,
  type Expense,
  type ExpenseMember,
  type PlannerData,
  type TripDto,
} from "@offgrid/core";
import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Callout } from "../../design/Badge";
import { Button } from "../../design/Button";
import { Card, SectionTitle } from "../../design/Card";
import { Dialog } from "../../design/Dialog";
import { Chip, Segmented } from "../../design/Fields";
import { EmptyState, ErrorState, Skeleton } from "../../design/States";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { db, type StoredLedger } from "../../lib/db";

const input = "min-h-11 w-full rounded-xl border border-line bg-surface px-3";
const SETTLE_PREFIX = "Settle-up: ";

type Draft = { id: string | null; description: string; amount: string; paidBy: string; mode: "equal" | "exact"; among: string[]; exact: Record<string, string> };

function emptyDraft(members: ExpenseMember[]): Draft {
  return { id: null, description: "", amount: "", paidBy: members[0]?.id ?? "", mode: "equal", among: members.map((m) => m.id), exact: {} };
}

/**
 * Group expense splitter. Local-first: everything lives in IndexedDB on this phone, so it works with
 * no signal and friends don't need accounts. Settle-up uses a greedy match (largest debtor pays largest
 * creditor), which needs at most n−1 payments. UPI links only open the payer's UPI app; OFFGRID never
 * sees or moves money, so "Mark paid" is the user's own record.
 */
export function ExpensesView({ data, tripId, onBack }: { data: PlannerData; tripId: string; onBack: () => void }) {
  const auth = useAuth();
  const [ledger, setLedger] = useState<StoredLedger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tripName, setTripName] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newUpi, setNewUpi] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const nameId = useId();
  const upiId = useId();
  const descId = useId();
  const amountId = useId();
  const paidId = useId();

  const load = useCallback(async () => {
    setError(null);
    try {
      const saved = await db.ledgers.get(tripId);
      setLedger(saved ?? { tripId, members: [{ id: crypto.randomUUID(), name: auth.me ? `${auth.me.displayName} (you)` : "You" }], expenses: [], updatedAt: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "This browser blocked local storage.");
    }
  }, [tripId, auth.me]);
  useEffect(() => {
    if (!ledger) void load();
  }, [ledger, load]);

  // The trip name is a nicety; the splitter itself never needs the network.
  useEffect(() => {
    api<TripDto>(`/trips/${tripId}`)
      .then((t) => setTripName(data.places.find((p) => p.id === t.placeId)?.name ?? null))
      .catch(() => undefined);
  }, [tripId, data.places]);

  const save = async (next: Omit<StoredLedger, "tripId" | "updatedAt">) => {
    const full = { ...next, tripId, updatedAt: Date.now() };
    setLedger(full);
    try {
      await db.ledgers.put(full);
    } catch {
      setError("Couldn't save on this device. Your browser may be in private mode or out of space.");
    }
  };

  const nameOf = useCallback((id: string) => ledger?.members.find((m) => m.id === id)?.name ?? "Someone", [ledger]);
  const bal = useMemo(() => (ledger ? balances(ledger.members, ledger.expenses) : new Map<string, number>()), [ledger]);
  const transfers = useMemo(() => settleUp(bal), [bal]);

  if (error && !ledger) return <ErrorState title="Couldn't open the expense splitter" detail={error} onRetry={() => void load()} />;
  if (!ledger) return <Skeleton className="h-80" />;
  const { members, expenses } = ledger;
  const total = expenses.filter((e) => !e.description.startsWith(SETTLE_PREFIX)).reduce((s, e) => s + e.amountPaise, 0);
  const title = tripName ?? "this trip";

  const addMember = (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    const upi = newUpi.trim();
    if (!name) return;
    if (members.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      setNotice(`${name} is already in the group.`);
      return;
    }
    if (upi && !upiLink({ id: "x", name, upi }, 100, "")) {
      setNotice("That UPI ID doesn't look right. It should look like name@bank.");
      return;
    }
    setNotice(null);
    void save({ members: [...members, { id: crypto.randomUUID(), name, ...(upi ? { upi } : {}) }], expenses });
    setNewName("");
    setNewUpi("");
  };

  const removeMember = (id: string) => {
    const used = expenses.some((x) => x.paidBy === id || sharesOf(x).has(id));
    if (used) {
      setNotice(`${nameOf(id)} is part of an expense. Edit or delete those first.`);
      return;
    }
    void save({ members: members.filter((m) => m.id !== id), expenses });
  };

  const openEdit = (x: Expense) => {
    setDraftError(null);
    setDraft({
      id: x.id,
      description: x.description,
      amount: String(x.amountPaise / 100),
      paidBy: x.paidBy,
      mode: x.split.type,
      among: x.split.type === "equal" ? x.split.among : members.map((m) => m.id),
      exact: x.split.type === "exact" ? Object.fromEntries(Object.entries(x.split.shares).map(([k, v]) => [k, String(v / 100)])) : {},
    });
  };

  const submitDraft = (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const amountPaise = parseRupees(draft.amount);
    if (amountPaise === null) {
      setDraftError("Enter the amount in rupees, like 450 or 450.50.");
      return;
    }
    let split: Expense["split"];
    if (draft.mode === "equal") split = { type: "equal", among: members.map((m) => m.id).filter((id) => draft.among.includes(id)) };
    else {
      const shares: Record<string, number> = {};
      for (const m of members) {
        const raw = draft.exact[m.id]?.trim();
        if (!raw) continue;
        const p = parseRupees(raw);
        if (p === null) {
          setDraftError(`Check ${m.name}'s share.`);
          return;
        }
        if (p > 0) shares[m.id] = p;
      }
      split = { type: "exact", shares };
    }
    const old = draft.id ? expenses.find((x) => x.id === draft.id) : undefined;
    const exp: Expense = { id: draft.id ?? crypto.randomUUID(), description: draft.description.trim(), amountPaise, paidBy: draft.paidBy, split, createdAt: old?.createdAt ?? new Date().toISOString() };
    const problem = validateExpense(exp, members);
    if (problem) {
      setDraftError(problem);
      return;
    }
    void save({ members, expenses: old ? expenses.map((x) => (x.id === exp.id ? exp : x)) : [...expenses, exp] });
    setDraft(null);
  };

  const deleteExpense = (id: string) => {
    if (!confirm("Delete this expense?")) return;
    void save({ members, expenses: expenses.filter((x) => x.id !== id) });
    setDraft(null);
  };

  /** Recording a payment is just another expense: the debtor "pays" and only the creditor owes it. */
  const markPaid = (from: string, to: string, amountPaise: number) => {
    const exp: Expense = {
      id: crypto.randomUUID(),
      description: `${SETTLE_PREFIX}${nameOf(from)} paid ${nameOf(to)}`,
      amountPaise,
      paidBy: from,
      split: { type: "exact", shares: { [to]: amountPaise } },
      createdAt: new Date().toISOString(),
    };
    void save({ members, expenses: [...expenses, exp] });
  };

  const summary = () => {
    const lines = [`OFFGRID expenses for ${title}`, `Total spent: ${formatPaise(total)} (${formatPaise(Math.round(total / Math.max(1, members.length)))} per person)`, ""];
    if (transfers.length === 0) lines.push("All settled up! 🎉");
    else {
      lines.push("To settle up:");
      for (const t of transfers) {
        const to = members.find((m) => m.id === t.to);
        lines.push(`• ${nameOf(t.from)} pays ${nameOf(t.to)} ${formatPaise(t.amountPaise)}${to?.upi ? ` (UPI: ${to.upi})` : ""}`);
      }
    }
    return lines.join("\n");
  };
  const share = async () => {
    const text = summary();
    try {
      if (navigator.share) await navigator.share({ title: "Trip expenses", text });
      else {
        await navigator.clipboard.writeText(text);
        setNotice("Summary copied. Paste it in your group chat.");
      }
    } catch {
      /* cancelled */
    }
  };

  const draftAmount = draft ? parseRupees(draft.amount) : null;
  const exactSum = draft ? members.reduce((s, m) => s + (parseRupees(draft.exact[m.id] ?? "") ?? 0), 0) : 0;

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack} className="-ml-3">
        ← Trip
      </Button>
      <div>
        <h1 className="text-2xl font-extrabold">
          <span aria-hidden="true">🧾 </span>Split expenses
        </h1>
        <p className="text-sm text-muted">For {title}. Saved on this phone only, and works offline.</p>
      </div>

      {error && <Callout tone="danger">{error}</Callout>}
      {notice && (
        <p role="status" className="rounded-xl bg-paper p-2 text-sm">
          {notice}
        </p>
      )}

      <Card>
        <SectionTitle hint="Add everyone who's sharing costs. A UPI ID lets others pay them in one tap.">Group ({members.length})</SectionTitle>
        <ul className="flex flex-wrap gap-2">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-1 rounded-full border border-line bg-paper py-1 pr-1 pl-3 text-sm">
              <span className="font-semibold">{m.name}</span>
              {m.upi && <span className="text-xs text-muted">· {m.upi}</span>}
              {members.length > 1 && (
                <button type="button" onClick={() => removeMember(m.id)} className="grid size-8 place-items-center rounded-full hover:bg-line" aria-label={`Remove ${m.name}`}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={addMember} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <label htmlFor={nameId} className="sr-only">
            Name
          </label>
          <input id={nameId} value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} placeholder="Name" className={input} autoComplete="off" />
          <label htmlFor={upiId} className="sr-only">
            UPI ID (optional)
          </label>
          <input id={upiId} value={newUpi} maxLength={60} onChange={(e) => setNewUpi(e.target.value)} placeholder="UPI ID (optional)" className={input} autoComplete="off" inputMode="email" />
          <Button type="submit" variant="secondary" disabled={!newName.trim() || members.length >= 20}>
            + Add
          </Button>
        </form>
      </Card>

      <Card>
        <div className="mb-3 flex items-start justify-between gap-2">
          <SectionTitle hint={expenses.length ? `Total ${formatPaise(total)} · ${formatPaise(Math.round(total / members.length))} per person` : undefined}>Expenses</SectionTitle>
          <Button
            onClick={() => {
              setDraftError(null);
              setDraft(emptyDraft(members));
            }}
          >
            + Add expense
          </Button>
        </div>
        {expenses.length === 0 ? (
          <EmptyState icon="🧾" title="No expenses yet">
            Add the cab, the homestay, the Maggi at the top. Everyone sees who owes whom.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {[...expenses].reverse().map((x) => {
              const settle = x.description.startsWith(SETTLE_PREFIX);
              return (
                <li key={x.id}>
                  <button type="button" onClick={() => openEdit(x)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-pine-50">
                    <span className="min-w-0">
                      <span className={`block truncate font-semibold ${settle ? "text-pine-700" : ""}`}>
                        {settle ? "✅ " : ""}
                        {x.description}
                      </span>
                      <span className="block text-xs text-muted">
                        {settle ? "Payment recorded" : `${nameOf(x.paidBy)} paid · ${x.split.type === "equal" ? `split ${x.split.among.length} ways` : "custom split"}`}
                      </span>
                    </span>
                    <span className="shrink-0 font-bold tabular-nums">{formatPaise(x.amountPaise)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {expenses.length > 0 && (
        <Card>
          <SectionTitle hint="Fewest payments that square everyone up.">Settle up</SectionTitle>
          <ul className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {members.map((m) => {
              const b = bal.get(m.id) ?? 0;
              return (
                <li key={m.id} className="rounded-xl bg-paper p-2.5">
                  <p className="truncate text-xs text-muted">{m.name}</p>
                  <p className={`font-extrabold tabular-nums ${b > 0 ? "text-pine-700" : b < 0 ? "text-danger-700" : ""}`}>
                    {b > 0 ? `gets ${formatPaise(b)}` : b < 0 ? `owes ${formatPaise(-b)}` : "settled"}
                  </p>
                </li>
              );
            })}
          </ul>
          {transfers.length === 0 ? (
            <Callout tone="good">All settled up! 🎉</Callout>
          ) : (
            <ul className="space-y-2">
              {transfers.map((t) => {
                const to = members.find((m) => m.id === t.to)!;
                const link = upiLink(to, t.amountPaise, `OFFGRID ${title}`);
                return (
                  <li key={`${t.from}-${t.to}`} className="rounded-xl border border-line p-3">
                    <p className="text-sm">
                      <span className="font-bold">{nameOf(t.from)}</span> pays <span className="font-bold">{to.name}</span>{" "}
                      <span className="font-extrabold tabular-nums">{formatPaise(t.amountPaise)}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {link && (
                        <a href={link} className="inline-flex min-h-11 items-center rounded-xl bg-pine-700 px-4 text-sm font-semibold text-white hover:bg-pine-800">
                          Pay via UPI
                        </a>
                      )}
                      <Button variant="secondary" onClick={() => markPaid(t.from, t.to, t.amountPaise)}>
                        Mark paid
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <Button variant="ghost" className="mt-2 -ml-2" onClick={() => void share()}>
            📤 Share summary with the group
          </Button>
          <p className="mt-1 text-xs text-muted">“Pay via UPI” opens your UPI app with the amount filled in. You confirm the payment there; OFFGRID never handles money.</p>
        </Card>
      )}

      <Dialog open={draft !== null} title={draft?.id ? "Edit expense" : "Add expense"} onClose={() => setDraft(null)}>
        {draft && (
          <form onSubmit={submitDraft} className="space-y-3 text-sm">
            <div>
              <label htmlFor={descId} className="mb-1 block font-semibold">
                What for?
              </label>
              <input id={descId} value={draft.description} maxLength={80} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Cab from Manali" className={input} autoComplete="off" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={amountId} className="mb-1 block font-semibold">
                  Amount (₹)
                </label>
                <input id={amountId} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder="1200" inputMode="decimal" className={input} autoComplete="off" />
              </div>
              <div>
                <label htmlFor={paidId} className="mb-1 block font-semibold">
                  Paid by
                </label>
                <select id={paidId} value={draft.paidBy} onChange={(e) => setDraft({ ...draft, paidBy: e.target.value })} className={input}>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Segmented
              label="Split"
              value={draft.mode}
              options={[
                { value: "equal", label: "Equally" },
                { value: "exact", label: "Exact amounts" },
              ]}
              onChange={(mode) => setDraft({ ...draft, mode })}
            />
            {draft.mode === "equal" ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Split between">
                {members.map((m) => (
                  <Chip
                    key={m.id}
                    selected={draft.among.includes(m.id)}
                    onToggle={() => setDraft({ ...draft, among: draft.among.includes(m.id) ? draft.among.filter((x) => x !== m.id) : [...draft.among, m.id] })}
                  >
                    {m.name}
                  </Chip>
                ))}
                {draftAmount !== null && draft.among.length > 0 && (
                  <p className="w-full text-xs text-muted">≈ {formatPaise(Math.floor(draftAmount / draft.among.length))} each</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {members.map((m) => (
                  <label key={m.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{m.name}</span>
                    <input
                      value={draft.exact[m.id] ?? ""}
                      onChange={(e) => setDraft({ ...draft, exact: { ...draft.exact, [m.id]: e.target.value } })}
                      inputMode="decimal"
                      placeholder="0"
                      className={`${input} w-32 text-right`}
                      aria-label={`${m.name}'s share in rupees`}
                    />
                  </label>
                ))}
                <p className={`text-xs ${draftAmount !== null && exactSum !== draftAmount ? "text-danger-700" : "text-muted"}`}>
                  Shares: {formatPaise(exactSum)}
                  {draftAmount !== null && ` of ${formatPaise(draftAmount)}`}
                  {draftAmount !== null && exactSum !== draftAmount && ` (${formatPaise(Math.abs(draftAmount - exactSum))} ${exactSum < draftAmount ? "left" : "too much"})`}
                </p>
              </div>
            )}
            {draftError && <Callout tone="danger">{draftError}</Callout>}
            <div className="flex gap-2">
              <Button type="submit" block>
                {draft.id ? "Save" : "Add expense"}
              </Button>
              {draft.id && (
                <Button variant="secondary" onClick={() => deleteExpense(draft.id!)}>
                  Delete
                </Button>
              )}
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
