---
name: petty-cash-accounting
description: >-
  Strict accounting, financial reconciliation, and data integrity guidelines for modifying the Petty Cash Manager
  (نظام إدارة العُهد النقدية اليومية - دولة قطر QAR). Enforces mathematical reconciliation across daily, monthly,
  annual, employee ledger, and custody safe balances, preserving historical data, Arabic RTL layout, and senior-friendly UX.
---

# Petty Cash Accounting & Data Integrity Skill

This project-specific skill governs all modifications to the **Petty Cash Manager (نظام إدارة العُهد النقدية اليومية - QAR)**.
It establishes mandatory invariants for accounting math, data persistence, schema evolution, and localization.

---

## 1. System & Architecture Overview

Before making any modifications, agents must adhere to the verified system architecture:

* **Tech Stack:** Pure Vanilla JavaScript (ES6+), Semantic HTML5 with `dir="rtl"`, and custom CSS3 (CSS Variables). No external framework (no React, Vue, Angular), and no build/bundling pipeline.
* **Hosting & Runtime:** Static file execution served via Vercel or local static HTTP server (`server.js`).
* **Persistence Engine:** Browser `window.localStorage` under the primary key:
  ```javascript
  const STORAGE_KEY = 'petty_cash_clean_v2';
  ```
  *(Legacy key `petty_cash_manager_v1` is permanently deprecated and purged on initialization).*
* **Localization & Currency:** Qatari Riyal (`ر.ق` / `QAR`), Arabic RTL UI, Cairo typography, with Left-to-Right Mark (`\u200E-`) for negative currency values in Arabic text.
* **Target User:** Senior Fleet & Petty Cash Operations Manager (64 years old). High contrast, large tactile hit targets, zero confusing accounting jargon, and zero unconfirmed destructive actions.

---

## 2. Data Schema & Persistence Model

All state is rooted in the single reactive `state.data` object:

```javascript
{
  people: [
    {
      id: "p_1727000000_1",      // Stable unique identifier
      num: 1,                    // Display sequence number (1-indexed)
      name: "اسم السائق أو الموظف",
      role: "driver" | "staff",   // Operational classification
      meta: "رقم السيارة / التريلا / القسم"
    }
  ],
  dailyReceipts: {
    // Cash received into the daily float from treasury
    "YYYY-MM-DD": 1500.00
  },
  dailyExtras: {
    // General operational or outside petty expenses
    "YYYY-MM-DD": { amount: 150.00, note: "نثريات مكتب / رسوم تصاريح" }
  },
  entries: {
    // Transactions per day per person
    "YYYY-MM-DD": {
      [personId]: {
        cash: 500.00,            // Cash advance given to the person
        invoice: 450.00,         // Invoices/receipts submitted by the person
        note: "بترول ديزل وطريق"  // Transaction memo / category tags
      }
    }
  },
  custodyReceipts: [
    // Main company custody replenishment disbursements
    {
      id: "cr_1727000000",
      date: "YYYY-MM-DD",
      amount: 50000.00,
      ref: "سند صرف رقم 1042",
      note: "استعاضة عهدة بترول وصيانة"
    }
  ]
}
```

---

## 3. The 12 Mandatory Rules

Whenever inspecting, extending, or refactoring the petty-cash manager, you MUST enforce these twelve rules:

### Rule 1: Preserve Existing Features and Historical Records
* Never wipe, reset, or restructure `localStorage` keys without explicit user request.
* Backward compatibility is mandatory: existing date keys (`YYYY-MM-DD`), person IDs, and amounts must load without loss or corruption.
* Any schema evolution must provide non-destructive defaults (e.g., `parsed.custodyReceipts || []`).

### Rule 2: Verify All Accounting Formulas Before Changing Them
* Never alter financial calculation logic without verifying against the canonical formulas in Section 4.
* Clearly distinguish between **cash flow** (actual liquidity moved) and **accrual reconciliation** (cash vs invoices).

### Rule 3: Distinguish the 5 Core Financial Concepts
Every financial variable and card in the UI must represent exactly one of these five concepts without conflation:
1. **Daily Cash Received (`dailyReceipts`):** Liquidity handed to the custodian for today's operational float.
2. **Company Custody Receipts (`custodyReceipts`):** Master float disbursements from Finance/Treasury into the safe.
3. **Cash Distributed (`entries.cash` + `dailyExtras.amount`):** Operational cash advances given to drivers or spent on expenses.
4. **Invoices Submitted (`entries.invoice`):** Official receipts returned by drivers to substantiate expenses.
5. **Outstanding Advance vs Cash Remaining:**
   * **Individual Advance Balance (ذمة السائق):** $\text{Advance} = \text{Cash Given} - \text{Invoices Returned}$.
   * **Safe Cash in Hand (سيولة الخزنة):** $\text{Safe Balance} = \sum \text{Custody Receipts} - \sum \text{Total Cash Distributed}$.

### Rule 4: Ensure Multi-Level Mathematical Reconciliation
The four reporting levels must reconcile across all dimensions:
$$\begin{aligned}
\text{Daily Totals} &\longleftrightarrow \text{Monthly Matrix} \\
\text{Monthly Matrix} &\longleftrightarrow \text{Individual Person Ledger} \\
\text{Individual Person Ledger} &\longleftrightarrow \text{Annual Multi-Month Summary} \\
\text{Annual Summary} &\longleftrightarrow \text{Company Custody Safe (Tab 6)}
\end{aligned}$$
* The sum of all individual monthly cash advances must equal the monthly total cash distributed.
* The sum of all individual monthly invoices must equal the monthly total invoices.
* The annual sum of a person's monthly totals must exactly match their year-scope ledger sheet.

### Rule 5: Correct Date Boundaries and Month/Year Transitions
* Use calendar-accurate days per month:
  ```javascript
  function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }
  ```
* Format date keys consistently as `YYYY-MM-DD` (e.g. `2026-10-05`). Month and day must always be zero-padded to two digits.
* Days of the week must match Arabic localized calendars (`Friday = 5` as weekend/holiday).
* Year transitions (December to January) must maintain separated custody and transactional keys.

### Rule 6: Reliable Monetary Calculations & Precision
* Numeric conversion must always sanitize and fallback safely:
  ```javascript
  const num = Number(val) || 0;
  ```
* Eliminate floating-point inaccuracies using epsilon comparisons and fixed precision:
  ```javascript
  const isSettled = Math.abs(cash - invoice) < 0.001;
  const rounded = Number((val).toFixed(2));
  ```
* Avoid compounding fractional math; calculate running balances directly from source entries.

### Rule 7: Never Silently Overwrite, Delete, or Migrate Financial Data
* No automatic cleanup scripts may run without user initiation.
* Deleting a person with existing financial records (`cash > 0` or `invoice > 0`) must require explicit, high-friction confirmation warning the user that linked historical records will be affected.
* Zero "factory reset" or "tasefeer" buttons may be exposed on standard operational screens.

### Rule 8: Validate Inputs and Prevent Duplicate Submissions
* Validate all monetary inputs: reject negative numbers where only positive inflows/outflows are allowed (`min="0"`).
* Avoid double-counting when modifying cell inputs: input listeners must debounce or update state immutably per `dateKey` and `personId`.
* Unique ID generation must combine timestamps with high-entropy suffixes:
  ```javascript
  id = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  ```

### Rule 9: Preserve Arabic RTL Layout & QAR Formatting
* Maintain HTML document direction `dir="rtl"`.
* Format all monetary values using `formatNumber(val)` with standard thousands separators.
* Negative currency numbers in RTL must prepend the Left-to-Right Mark (`\u200E-`) so the minus sign stays on the left:
  ```javascript
  function formatNumber(val) {
    const num = Number(val) || 0;
    if (num < 0) {
      return '\u200E-' + Math.abs(num).toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  ```
* Currency unit is always Qatari Riyals: `ر.ق` / `QAR`.

### Rule 10: Test Changes Against Known Examples and Edge Cases
Before marking any financial or UI change complete, test against:
1. **Zero State:** Empty table, no entries, zero division safety.
2. **Exact Settlement:** $\text{Cash} = \text{Invoice}$ ($\text{Diff} = 0.00$ -> `خالص ومصفى بالكامل بالفواتير ✓`).
3. **Driver Owes (Advance Pending):** $\text{Cash} > \text{Invoice}$ -> `متبقي بعهدته (لم يأتِ بفواتيرها بعد)`.
4. **Company Owes Driver:** $\text{Cash} < \text{Invoice}$ -> `له فرق فواتير مستحق الصرف`.
5. **Multi-Row Typing:** Typing numbers in row 50+ must NOT cause scroll jumps to the top.
6. **Sticky Overlaps:** Table headers (`thead`) must NEVER obscure Row 1.
7. **Fridays / Weekends:** Handled cleanly without data corruption.

### Rule 11: Document and Explain Financial Formula Changes
Whenever a formula or balance calculation is touched, the agent must provide:
* The exact mathematical formula before and after.
* The expected result on a concrete example (e.g., Float = 50,000, Distributed = 42,000, Invoices = 39,000).
* Verification proof (console test or automated browser test output).

### Rule 12: Maintain Strict Documentation and Business Rules Integrity
* Do not change existing business workflows (such as petty cash float distribution or replenishment procedures) without explicitly identifying the proposed change and rationale first.
* Preserve senior-friendly styling: large fonts, clear color contrast, calm alerts, and explanatory labels.

---

## 4. Canonical Accounting Formulas Reference

| Metric | Level | Exact Mathematical Formula | Code Reference |
| :--- | :--- | :--- | :--- |
| **Total Distributed Today** | Daily (Tab 1) | $\sum_{p \in \text{people}} \text{cash}_{p, \text{date}} + \text{extra}_{\text{date}}.\text{amount}$ | `getDayTotals().distributed` |
| **Total Invoices Today** | Daily (Tab 1) | $\sum_{p \in \text{people}} \text{invoice}_{p, \text{date}}$ | `getDayTotals().invoices` |
| **Daily Float Remaining** | Daily (Tab 1) | $\text{dailyReceipts}[\text{date}] - \text{Total Distributed Today}$ | `getDayTotals().remaining` |
| **Person Monthly Balance** | Monthly / Ledger | $\sum_{d=1}^{\text{days}} \text{cash}_{p, d} - \sum_{d=1}^{\text{days}} \text{invoice}_{p, d}$ | `getPersonMonthTotals().diff` |
| **Person Running Balance** | Ledger (Tab 3) | $\text{RunningBal}_{d} = \text{RunningBal}_{d-1} + (\text{cash}_d - \text{invoice}_d)$ | `renderPersonSheet()` |
| **Monthly Custody Net** | Safe (Tab 6) | $\text{custodyReceived}_{\text{month}} - \text{monthDistributed}$ | `renderCustodyTab().monthNet` |
| **Cumulative Safe Cash** | Safe (Tab 6) | $\sum_{m=1}^{\text{current}} \text{custodyReceived}_m - \sum_{m=1}^{\text{current}} \text{monthDistributed}_m$ | `renderCustodyTab().cumulativeCashInHand` |

---

## 5. Verification Checklist for Agents

Before completing any task touching the codebase:
- [ ] Run `node --check app.js` to guarantee valid syntax.
- [ ] Verify that `localStorage.getItem('petty_cash_clean_v2')` format is strictly preserved.
- [ ] Verify that Row 1 of the daily table is completely visible and not covered by any header elements.
- [ ] Verify that typing in table cells does NOT trigger scroll-to-top events.
- [ ] Verify that negative numbers display with `\u200E-` on the left.
- [ ] Verify that Tab 1, Tab 2, Tab 3, Tab 4, and Tab 6 totals match each other perfectly.
- [ ] Test the live deployment or local page in a browser without any console errors.
