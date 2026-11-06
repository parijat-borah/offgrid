/**
 * Group expenses and settle-up. All money is integer paise, so ₹100 split three ways is
 * 3334 + 3333 + 3333 paise exactly, never 33.333… rupees that won't add back up.
 */

export interface ExpenseMember {
  id: string;
  name: string;
  /** Optional UPI ID, used only to build a payment link on the payer's own phone. */
  upi?: string | undefined;
}

export type ExpenseSplit = { type: "equal"; among: string[] } | { type: "exact"; shares: Record<string, number> };

export interface Expense {
  id: string;
  description: string;
  amountPaise: number;
  paidBy: string;
  split: ExpenseSplit;
  createdAt: string;
}

export interface Transfer {
  from: string;
  to: string;
  amountPaise: number;
}

/** Who owes what for one expense. Leftover paise from an equal split go to the first people listed. */
export function sharesOf(e: Expense): Map<string, number> {
  const out = new Map<string, number>();
  if (e.split.type === "exact") {
    for (const [id, p] of Object.entries(e.split.shares)) if (p > 0) out.set(id, p);
    return out;
  }
  const n = e.split.among.length;
  const base = Math.floor(e.amountPaise / n);
  let rest = e.amountPaise - base * n;
  for (const id of e.split.among) {
    out.set(id, base + (rest > 0 ? 1 : 0));
    if (rest > 0) rest--;
  }
  return out;
}

export function validateExpense(e: Expense, members: ExpenseMember[]): string | null {
  const ids = new Set(members.map((m) => m.id));
  if (!Number.isInteger(e.amountPaise) || e.amountPaise <= 0) return "Enter an amount above zero.";
  if (e.amountPaise > 100_000_000) return "That's more than ₹10 lakh; check the amount.";
  if (!ids.has(e.paidBy)) return "Choose who paid.";
  if (!e.description.trim()) return "Add a short description.";
  if (e.split.type === "equal") {
    if (e.split.among.length === 0) return "Choose at least one person to split with.";
    if (e.split.among.some((id) => !ids.has(id))) return "Someone in the split isn't in the group.";
    if (new Set(e.split.among).size !== e.split.among.length) return "Someone is listed twice.";
  } else {
    const entries = Object.entries(e.split.shares);
    if (entries.some(([id, p]) => !ids.has(id) || !Number.isInteger(p) || p < 0)) return "Check each person's share.";
    const sum = entries.reduce((s, [, p]) => s + p, 0);
    if (sum !== e.amountPaise) return `Shares add up to ${formatPaise(sum)}, but the expense is ${formatPaise(e.amountPaise)}.`;
  }
  return null;
}

/** Net position per member: positive = is owed money, negative = owes money. Always sums to zero. */
export function balances(members: ExpenseMember[], expenses: Expense[]): Map<string, number> {
  const bal = new Map(members.map((m) => [m.id, 0]));
  for (const e of expenses) {
    bal.set(e.paidBy, (bal.get(e.paidBy) ?? 0) + e.amountPaise);
    for (const [id, owed] of sharesOf(e)) bal.set(id, (bal.get(id) ?? 0) - owed);
  }
  return bal;
}

/**
 * Greedy settle-up: the biggest debtor pays the biggest creditor as much as possible, repeat.
 * Never more than n−1 payments; usually far fewer than everyone paying everyone back.
 */
export function settleUp(bal: Map<string, number>): Transfer[] {
  const debtors = [...bal].filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
  const creditors = [...bal].filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
  const byAmount = (a: { id: string; v: number }, b: { id: string; v: number }) => b.v - a.v || a.id.localeCompare(b.id);
  const out: Transfer[] = [];
  while (debtors.length && creditors.length) {
    debtors.sort(byAmount);
    creditors.sort(byAmount);
    const d = debtors[0]!;
    const c = creditors[0]!;
    const amount = Math.min(d.v, c.v);
    out.push({ from: d.id, to: c.id, amountPaise: amount });
    d.v -= amount;
    c.v -= amount;
    if (d.v === 0) debtors.shift();
    if (c.v === 0) creditors.shift();
  }
  return out;
}

export function formatPaise(p: number): string {
  const rupees = Math.abs(p) / 100;
  const s = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: p % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(rupees);
  return p < 0 ? `−${s}` : s;
}

/** Parse "1,250.50" or "₹1250" into paise; null if it isn't a sensible amount. */
export function parseRupees(input: string): number | null {
  const clean = input.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/**
 * A UPI deep link that opens the payer's own UPI app (GPay, PhonePe, BHIM…) with the amount filled in.
 * OFFGRID never touches the money, so no payment licence is involved.
 */
export function upiLink(to: ExpenseMember, amountPaise: number, note: string): string | null {
  if (!to.upi || !/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(to.upi)) return null;
  // Built by hand: URLSearchParams would write "@" as %40 and spaces as "+", which some UPI apps show
  // literally. The VPA has already been checked to contain only safe characters.
  const enc = encodeURIComponent;
  return `upi://pay?pa=${to.upi}&pn=${enc(to.name)}&am=${(amountPaise / 100).toFixed(2)}&cu=INR&tn=${enc(note.slice(0, 50))}`;
}
