# Fuel theft & partnership leakage detection

Three checks were added so the ERP can answer:

1. **Is a driver siphoning fuel?**
2. **Where does a lease-to-own (partnership) truck's balance stand?**
3. **Is the partner under-declaring what he earns / over-declaring his costs?**

All three are API endpoints under an authenticated session (Super Admin / Admin /
Finance Manager / Operations Manager). Nothing is inserted straight into the
database — the settlement engine runs the same automations as the rest of the app.

---

## 1. Fuel integrity audit — `GET /api/fuel/integrity-audit`

**Idea:** every litre a truck draws should be justified by the distance it
covered before the next fill. `expected litres = km driven / expected km-per-litre`
(default **3.5 km/L** loaded — override with `?kmpl=`). Anything drawn well above
that, consistently, is the signature of siphoning.

### Per fill it flags

| flag | meaning |
|---|---|
| `FUEL_OVER_BENCHMARK` | drew far more than the leg's distance justifies (severity scales with the %) |
| `IMPLAUSIBLE_LOW_KMPL` | < 2 km/L on the leg — more than a loaded truck can physically burn |
| `IMPLAUSIBLE_HIGH_KMPL` | > 7 km/L — fill likely booked against the wrong truck, or odometer over-stated |
| `TANK_OVER_CAPACITY` | single fill above the tank size (`?tank=`, default 500 L) |
| `ODOMETER_ROLLBACK` | odometer went backwards since the last fill |
| `ODOMETER_JUMP` | > 3000 km in < 24 h |
| `RAPID_REFILL` | same truck refuelled twice within 3 h |
| `NIGHT_REFILL` | booked 22:00–05:00 |
| `FUEL_WITHOUT_TRIP` | fuel drawn with no trip linked and no active trip that day |

### Per driver it returns

`litresDrawn`, `expectedLitres`, `overdrawLitres`, `overdrawPercent`,
`impliedKmPerLitre`, **`estimatedLossValue`** (over-drawn litres × avg rate),
`flaggedFills`, `riskLevel` (Low / Medium / High). Drivers are sorted by the
rupee value of the loss, so the worst offender is row 1.

The last fill on each truck is excluded from the ratio (its fuel is still in the
tank), otherwise every driver looks over-drawn by one tank.

**Params:** `from`, `to` (ISO), `kmpl`, `tank`, `tolerance` (% over that is still
"ok", default 12), `raise=1` (also writes `fuel_alerts` rows for High/Critical
findings so they show on the existing Fuel Theft screen).

### Worked example (seeded)

`node scripts/seed-audit-scenarios.mjs` plants a clean driver, a borderline one
and a siphoning one, then runs the audit:

| driver | drawn | expected | over-draw | est. loss | risk |
|---|---|---|---|---|---|
| Ghulam Murtaza (siphoning) | 3 345 L | 2 087 L | **+1 258 L (60 %)** | **PKR 361 849** | **High** |
| Naveed Akhtar (borderline) | 2 085 L | 1 890 L | +195 L (10 %) | PKR 56 085 | Medium |
| Shahid Mehmood (clean) | 2 225 L | 2 304 L | −79 L (−3 %) | PKR 0 | Low |

His individual fills carry `FUEL_OVER_BENCHMARK (Critical)`,
`IMPLAUSIBLE_LOW_KMPL`, `TANK_OVER_CAPACITY` (a 640 L fill at 1.0 km/L),
`FUEL_WITHOUT_TRIP` and `NIGHT_REFILL`.

---

## 2. Partnership / lease-to-own trucks

A partner buys one of our trucks over time: `agreedPrice`, an `advancePaid`
down-payment, and the `openingBalance` (= price − advance) is recovered out of
each trip's **net earnings** (`companySharePercent`, default **100** = all net to
the company) until it hits zero, when the agreement auto-settles.

### Endpoints

| method | path | purpose |
|---|---|---|
| `GET/POST` | `/api/partnerships/partners` | partner master |
| `GET/POST` | `/api/partnerships/agreements` | one per truck; computes `openingBalance` / `currentBalance`, marks the vehicle `Third-Party` |
| `POST` | `/api/partnerships/agreements/:id/settlements` | **the core** — partner declares gross revenue + his expenses; engine computes net, pays down the balance, runs the leakage check |
| `GET` | `/api/partnerships/agreements/:id/ledger` | full running statement + totals + skim-to-date |
| `GET` | `/api/partnerships/agreements/:id/leakage` | standalone leakage check for a date range (no settlement written) |
| `GET` | `/api/partnerships/summary` | portfolio: financed, recovered, outstanding, total estimated skim, agreements with flags |

### A settlement

```
POST /api/partnerships/agreements/1/settlements
{
  "periodFrom": "2026-08-24", "periodTo": "2026-09-07",
  "grossRevenue": 900000,
  "expenses": [
    { "type": "Fuel", "amount": 760000, "note": "claimed diesel" },
    { "type": "Repairs", "amount": 220000, "note": "engine work - no job card" },
    { "type": "Toll", "amount": 130000 }, { "type": "Misc", "amount": 90000 }
  ]
}
```

returns the settlement (net, amount to company, balance before/after) **and** an
`analysis` block — see below.

---

## 3. Under-reporting / expense-padding detection

Runs automatically inside every settlement and standalone via
`GET /api/partnerships/agreements/:id/leakage`.

It builds two **independent** estimates of what the truck really earned in the
window and takes the higher one:

* **GPS / trip history** — completed trips for that vehicle × the route rate card
  → `gps.expectedRevenue`.
* **Fuel drawn** — litres from our fuel cards × 3.5 km/L (and the odometer
  distance) × the revenue-per-km of the routes that truck runs →
  `fuel.impliedRevenue`.

Then:

| field | meaning |
|---|---|
| `expectedRevenue` | `max(gps, fuel)` — the harder floor |
| `revenueVariancePercent` | `(expected − declared) / expected × 100`; **positive = partner told us less than reality** |
| `expenseRatioPercent` | declared expenses ÷ declared revenue; compared to `expenseRatioBenchmark` (default 55 %) |
| `estimatedPartnerSkim` | `(expected − declared)` + `(expenses − healthy expenses)` — roughly how much better off the partner is than what we were told |

### Flags

`UNDER_REPORTED_REVENUE` (> 15 % variance) · `SEVERE_UNDER_REPORTING` (> 35 %) ·
`EXPENSE_INFLATION` (expense ratio > benchmark + 15) · `NEGATIVE_NET` (claims a loss).

### Worked example (seeded)

Truck sold for **PKR 5 000 000**, **2 000 000** advance, **3 000 000** balance.

| settlement | gross declared | expenses | flags | outcome |
|---|---|---|---|---|
| PS-2026-0001 (honest) | 1 750 000 | 920 000 | *none* | net 830 000 → company; balance 3 000 000 → 2 170 000 |
| PS-2026-0002 (skimming) | 900 000 | 1 200 000 | `SEVERE_UNDER_REPORTING`, `EXPENSE_INFLATION`, `NEGATIVE_NET` | GPS+fuel imply ≈ 2 041 000; **56 % under-reported**; expense ratio **133 %** vs 55 %; **estimated skim PKR 1 846 030** |

Portfolio summary then shows `totalEstimatedSkim` and `agreementsWithFlags` for
the whole partner book, sorted worst-first.

---

## Seeding the scenarios

```bash
node scripts/seed-audit-scenarios.mjs
```

Needs the dev server up (`DEV_AUTH_BYPASS=true`) and Postgres reachable. It
soft-clears prior demo fuel rows, plants the clean/borderline/siphoning drivers
and the partnership, then prints both results and writes
`audit-scenarios-report.json`.
