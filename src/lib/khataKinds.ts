/**
 * What a truck khata row IS, in the words HFK uses — the same choices in Truck Ledger
 * "Add entry" and in the Daily Cash Book when a truck is picked:
 *
 *   Aamdani · آمدن            freight / money the truck earned          (in)
 *   Kharcha · خرچہ            what the truck spent: diesel, tyre, visa… (out)
 *   Shakhsi bardasht · شخصی برداشت  money taken from the truck for home — not a truck expense (out)
 *   Safi bachat · صافی بچت     the net saving taken out / the hisaab closed  (out)
 *   Malik ka paisa · سرمایہ    the owner's own money put in or taken back (in / out)
 *
 * Each one is stored as the row's category; the truck's real profit is Aamdani − Kharcha,
 * and Shakhsi / Safi bachat / Capital are counted apart from it.
 */
export type KhataKind = "income" | "expense" | "shakhsi" | "safi" | "capital" | "qist";

export const SHAKHSI = "Shakhsi";
/** A lease instalment the partner paid toward the truck's price: money in, but not the truck's income. */
export const QIST = "Qist";

export const INCOME_CATS = ["Freight", "Other"];
export const EXPENSE_CATS = ["Diesel", "TripCash", "Tyre", "PartsBill", "Garage", "MobilOil", "Battery", "Salary", "Visa", "Carnet", "Permit", "Insurance", "TomanFX", "OnlineTransfer", "Freight", "Other"];

/** Every category a truck khata row can carry. */
export const ALL_TRUCK_CATS = ["Freight", "Diesel", "TripCash", "Tyre", "Visa", "Carnet", "TomanFX", "PartsBill", "Garage", "Salary", "Battery", "Insurance", "MobilOil", "Permit", "OnlineTransfer", "Capital", SHAKHSI, "SafiBachat", QIST, "Other"];

export const KHATA_KINDS: Array<{ kind: KhataKind; en: string; ur: string; dir: "In" | "Out" | "either"; cats: string[]; hint: string }> = [
  { kind: "income", en: "Income", ur: "آمدن", dir: "In", cats: INCOME_CATS, hint: "Freight / money the truck earned" },
  { kind: "expense", en: "Expense", ur: "خرچہ", dir: "Out", cats: EXPENSE_CATS, hint: "Diesel, tyre, visa, garage… what the truck spent" },
  { kind: "shakhsi", en: "Shakhsi bardasht", ur: "شخصی برداشت", dir: "Out", cats: [SHAKHSI], hint: "Taken from the truck for home — not a truck expense" },
  { kind: "safi", en: "Safi bachat", ur: "صافی بچت", dir: "either", cats: ["SafiBachat"], hint: "The net saving taken out, or the hisaab closed here" },
  { kind: "capital", en: "Owner's money", ur: "سرمایہ", dir: "either", cats: ["Capital"], hint: "The owner's own money put in or taken back" },
  { kind: "qist", en: "Qist received", ur: "قسط وصول", dir: "In", cats: [QIST], hint: "A lease instalment paid toward the truck's price — not income" },
];

export const CAT_LABEL: Record<string, string> = {
  TripCash: "Trip cash",
  TomanFX: "Toman FX",
  PartsBill: "Parts bill",
  MobilOil: "Mobil oil",
  OnlineTransfer: "Online transfer",
  SafiBachat: "Safi bachat",
  [SHAKHSI]: "Shakhsi bardasht",
  [QIST]: "Qist (lease)",
  Freight: "Freight / kiraya",
};
export const catLabel = (c: string) => CAT_LABEL[c] || c;

/** Which of the five a stored row is. */
export function kindOf(category: string | null | undefined, received = 0, paid = 0): KhataKind {
  if (category === "SafiBachat") return "safi";
  if (category === SHAKHSI) return "shakhsi";
  if (category === "Capital") return "capital";
  if (category === QIST) return "qist";
  return received > 0 && !(paid > 0) ? "income" : "expense";
}

/** The five totals from a per-category sum (received / paid per category). */
export function bucketTotals(byCategory: Array<{ category: string | null; received: number; paid: number }>) {
  const t = { income: 0, expense: 0, profit: 0, shakhsi: 0, safi: 0, capitalIn: 0, capitalOut: 0, qist: 0 };
  for (const c of byCategory || []) {
    const r = Number(c.received) || 0;
    const p = Number(c.paid) || 0;
    if (c.category === SHAKHSI) t.shakhsi += p - r;
    else if (c.category === "SafiBachat") t.safi += p - r;
    else if (c.category === QIST) t.qist += r - p;
    else if (c.category === "Capital") {
      t.capitalIn += r;
      t.capitalOut += p;
    } else {
      t.income += r;
      t.expense += p;
    }
  }
  t.profit = t.income - t.expense;
  return t;
}
