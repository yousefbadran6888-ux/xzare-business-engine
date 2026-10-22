import { ulid } from "@xzare/core";
import type { XzareDatabase } from "@xzare/db";
import { Identity } from "./identity.js";
import { fingerprint } from "./commerce.js";
import type { User, Audit } from "./types.js";
export type Period = {
  id: string;
  name: string;
  dateFrom: string;
  dateTo: string;
  status: "open" | "closed";
};
import {
  accountingSchemas,
  type Account,
  type Journal,
  type JournalLine,
} from "./accounting-validation.js";
const jq =
  "SELECT id,number,date,memo,status,version,period_id AS periodId,user_id AS userId,total,reverse_of AS reverseOf,draft FROM accounting_journals";
const aq =
  "SELECT id,code,name,kind,parent_id AS parentId,active FROM accounting_accounts";
function safe(n: number) {
  if (!Number.isSafeInteger(n))
    throw new Error("المبلغ الإجمالي تجاوز الحد الآمن؛ استخدم فترة أصغر");
  return n;
}
const add = (xs: number[]) => safe(xs.reduce((a, b) => safe(a + b), 0));
export class Accounting {
  constructor(
    readonly db: XzareDatabase,
    readonly identity: Identity,
  ) {}
  accounts() {
    return this.db.prepare(aq + " ORDER BY code").all() as Account[];
  }
  get(id: string): Journal {
    const j = this.db.prepare(jq + " WHERE id=?").get(id) as
      (Omit<Journal, "lines"> & { draft: string }) | undefined;
    if (!j) throw new Error("القيد غير موجود");
    const { draft, ...rest } = j;
    return {
      ...rest,
      lines:
        j.status === "posted"
          ? (this.db
              .prepare(
                "SELECT account_id AS accountId,debit,credit,note FROM accounting_entries WHERE journal_id=? ORDER BY rowid",
              )
              .all(id) as JournalLine[])
          : JSON.parse(draft),
    };
  }
  state(user: User) {
    return {
      user,
      settings: Object.fromEntries(
        (
          this.db
            .prepare(
              "SELECT key,value FROM settings WHERE key IN ('businessName','phone','address','currency','language','receiptFooter','taxBps')",
            )
            .all() as { key: string; value: string }[]
        ).map((r) => [r.key, r.value]),
      ),
      businessName: (
        this.db
          .prepare("SELECT value FROM settings WHERE key='businessName'")
          .get() as {
          value: string;
        }
      ).value,
      accounts: this.accounts(),
      periods: this.db
        .prepare(
          "SELECT id,name,date_from AS dateFrom,date_to AS dateTo,status FROM accounting_periods ORDER BY date_from DESC",
        )
        .all() as Period[],
      journals: (
        this.db
          .prepare(
            jq +
              " ORDER BY CASE WHEN status='draft' THEN 0 ELSE 1 END,date DESC,id DESC LIMIT 1000",
          )
          .all() as { id: string }[]
      ).map((j) => this.get(j.id)),
      users:
        user.role === "admin"
          ? (this.db
              .prepare(
                "SELECT id,username,name,role,active FROM users ORDER BY name",
              )
              .all() as User[])
          : [],
      audit:
        user.role === "admin"
          ? (this.db
              .prepare(
                "SELECT a.*,u.name user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT 300",
              )
              .all() as Audit[])
          : [],
    };
  }
  private openPeriod(date: string) {
    const p = this.db
      .prepare(
        "SELECT id,status FROM accounting_periods WHERE date_from<=? AND date_to>=?",
      )
      .get(date, date) as { id: string; status: string } | undefined;
    if (!p || p.status !== "open")
      throw new Error("التاريخ يحتاج فترة مالية مفتوحة");
    return p.id;
  }
  private validateLines(lines: JournalLine[]) {
    const dr = add(lines.map((l) => l.debit)),
      cr = add(lines.map((l) => l.credit));
    if (!dr || dr !== cr || dr > 1e12)
      throw new Error("القيد غير متوازن أو أكبر من الحد");
    for (const line of lines) {
      let a = this.db.prepare(aq + " WHERE id=?").get(line.accountId) as
        Account | undefined;
      if (
        !a ||
        !a.active ||
        this.db
          .prepare(
            "SELECT id FROM accounting_accounts WHERE parent_id=? LIMIT 1",
          )
          .get(a.id)
      )
        throw new Error("اختر حسابًا نهائيًا نشطًا");
      while (a?.parentId) {
        a = this.db.prepare(aq + " WHERE id=?").get(a.parentId) as Account;
        if (!a.active) throw new Error("مجموعة الحساب متوقفة");
      }
    }
    return dr;
  }
  private save(d: any, u: User) {
    const total = this.validateLines(d.lines),
      periodId = this.openPeriod(d.date),
      id = d.id ?? ulid();
    if (d.id) {
      const j = this.get(id);
      if (j.status !== "draft" || j.version !== d.version)
        throw new Error("القيد تغير؛ حدّث العرض");
      this.openPeriod(j.date);
      this.db
        .prepare(
          "UPDATE accounting_journals SET date=?,memo=?,draft=?,total=?,period_id=?,version=version+1 WHERE id=?",
        )
        .run(d.date, d.memo, JSON.stringify(d.lines), total, periodId, id);
    } else
      this.db
        .prepare(
          "INSERT INTO accounting_journals(id,date,memo,status,version,period_id,user_id,draft,total,reverse_of) VALUES(?,?,?,'draft',0,?,?,?,?,?)",
        )
        .run(
          id,
          d.date,
          d.memo,
          periodId,
          u.id,
          JSON.stringify(d.lines),
          total,
          d.reverseOf ?? null,
        );
    this.identity.audit(u.id, "accounting.journal.save", id);
    return this.get(id);
  }
  private post(d: any, u: User) {
    const j = this.get(d.id);
    if (j.status !== "draft" || j.version !== d.version)
      throw new Error("القيد تغير أو تم ترحيله");
    this.openPeriod(j.date);
    this.validateLines(j.lines);
    for (const l of j.lines)
      this.db
        .prepare("INSERT INTO accounting_entries VALUES(?,?,?,?,?,?)")
        .run(ulid(), j.id, l.accountId, l.debit, l.credit, l.note);
    this.db
      .prepare(
        "INSERT INTO sequences VALUES('accounting',1) ON CONFLICT(kind) DO UPDATE SET value=value+1",
      )
      .run();
    const n = (
      this.db
        .prepare("SELECT value FROM sequences WHERE kind='accounting'")
        .get() as {
        value: number;
      }
    ).value;
    this.db
      .prepare(
        "UPDATE accounting_journals SET number=?,status='posted',posted_at=?,version=version+1 WHERE id=?",
      )
      .run("J-" + String(n).padStart(6, "0"), Date.now(), j.id);
    this.identity.audit(u.id, "accounting.journal.post", j.id);
    return this.get(j.id);
  }
  report(from: string, to: string) {
    if (from > to) throw new Error("راجع فترة التقرير");
    const rows = this.db
      .prepare(
        `SELECT a.id,a.code,a.name,a.kind,
COALESCE(sum(CASE WHEN j.date<? THEN e.debit-e.credit ELSE 0 END),0) opening,
COALESCE(sum(CASE WHEN j.date BETWEEN ? AND ? THEN e.debit ELSE 0 END),0) debit,
COALESCE(sum(CASE WHEN j.date BETWEEN ? AND ? THEN e.credit ELSE 0 END),0) credit
FROM accounting_accounts a LEFT JOIN accounting_entries e ON e.account_id=a.id LEFT JOIN accounting_journals j ON j.id=e.journal_id AND j.status='posted' AND j.date<=? GROUP BY a.id ORDER BY a.code`,
      )
      .all(from, from, to, from, to, to) as {
      id: string;
      code: string;
      name: string;
      kind: string;
      opening: number;
      debit: number;
      credit: number;
    }[];
    const balances = rows.map((r) => ({
      ...r,
      opening: safe(r.opening),
      debit: safe(r.debit),
      credit: safe(r.credit),
      closing: safe(r.opening + r.debit - r.credit),
    }));
    const ending = (kind: string) =>
        add(balances.filter((r) => r.kind === kind).map((r) => r.closing)),
      movement = (kind: string) =>
        add(
          balances
            .filter((r) => r.kind === kind)
            .map((r) => r.debit - r.credit),
        );
    const assets = ending("asset"),
      liabilities = -ending("liability"),
      equity = -ending("equity"),
      income = -movement("income"),
      expenses = movement("expense"),
      profit = safe(income - expenses),
      accumulatedProfit = safe(-ending("income") - ending("expense"));
    const trial = {
      debit: add(balances.map((r) => Math.max(0, r.closing))),
      credit: add(balances.map((r) => Math.max(0, -r.closing))),
      movementDebit: add(balances.map((r) => r.debit)),
      movementCredit: add(balances.map((r) => r.credit)),
    };
    const bad = this.db
      .prepare(
        "SELECT j.id FROM accounting_journals j LEFT JOIN accounting_entries e ON e.journal_id=j.id WHERE j.status='posted' GROUP BY j.id HAVING COALESCE(sum(e.debit),0)!=j.total OR COALESCE(sum(e.credit),0)!=j.total LIMIT 1",
      )
      .get();
    const reconciled =
      !bad &&
      trial.debit === trial.credit &&
      trial.movementDebit === trial.movementCredit &&
      assets === safe(liabilities + equity + accumulatedProfit);
    return {
      from,
      to,
      balances,
      trial,
      assets,
      liabilities,
      equity,
      income,
      expenses,
      profit,
      accumulatedProfit,
      reconciled,
    };
  }
  ledger(accountId: string, from: string, to: string) {
    if (from > to || !this.db.prepare(aq + " WHERE id=?").get(accountId))
      throw new Error("راجع الحساب وفترة التقرير");
    const opening = safe(
      (
        this.db
          .prepare(
            "SELECT COALESCE(sum(e.debit-e.credit),0) balance FROM accounting_entries e JOIN accounting_journals j ON j.id=e.journal_id WHERE e.account_id=? AND j.status='posted' AND j.date<?",
          )
          .get(accountId, from) as { balance: number }
      ).balance,
    );
    const rows = this.db
      .prepare(
        "SELECT j.id,j.number,j.date,j.memo,e.debit,e.credit,e.note FROM accounting_entries e JOIN accounting_journals j ON j.id=e.journal_id WHERE e.account_id=? AND j.status='posted' AND j.date BETWEEN ? AND ? ORDER BY j.date,j.number,e.rowid LIMIT 50001",
      )
      .all(accountId, from, to) as {
      id: string;
      number: string;
      date: string;
      memo: string;
      note: string;
      debit: number;
      credit: number;
    }[];
    if (rows.length > 50000) throw new Error("استخدم فترة أصغر لعرض الأستاذ");
    let balance = opening;
    return {
      opening,
      rows: rows.map((r) => ({
        ...r,
        balance: (balance = safe(balance + r.debit - r.credit)),
      })),
      closing: balance,
    };
  }
  call(action: string, payload: unknown, user: User) {
    const schema = accountingSchemas[action as keyof typeof accountingSchemas];
    if (!schema) throw new Error("العملية غير متاحة");
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new Error("راجع البيانات والتاريخ والمبالغ");
    const d = parsed.data as any;
    const required =
      action === "accounting.period.close"
        ? "admin"
        : [
              "accounting.account.save",
              "accounting.period.save",
              "accounting.journal.post",
              "accounting.journal.reverse",
            ].includes(action)
          ? "manager"
          : "cashier";
    if (
      {
        admin: 3,
        manager: 2,
        cashier: 1,
        kitchen: 0,
        technician: 0,
        doctor: 0,
        hr: 0,
        payroll: 0,
        teacher: 0,
        trainer: 0,
        stylist: 0,
      }[user.role] < { admin: 3, manager: 2, cashier: 1 }[required]
    )
      throw new Error("ليس لديك صلاحية");
    return this.db.transaction(() => {
      let old: any;
      if (d.clientTxnId) {
        old = this.db
          .prepare("SELECT * FROM commands WHERE client_txn_id=?")
          .get(d.clientTxnId);
        if (old) {
          if (
            old.user_id !== user.id ||
            old.action !== action ||
            old.request_hash !== fingerprint(d)
          )
            throw new Error("معرّف العملية مستخدم لطلب آخر");
          return JSON.parse(old.result);
        }
      }
      let result: any;
      switch (action) {
        case "accounting.state":
          return this.state(user);
        case "accounting.journal.get":
          return this.get(d.id);
        case "accounting.report":
          return this.report(d.from, d.to);
        case "accounting.ledger":
          return this.ledger(d.accountId, d.from, d.to);
        case "accounting.account.save": {
          const id = d.id ?? ulid(),
            current = d.id
              ? (this.db.prepare(aq + " WHERE id=?").get(id) as Account)
              : undefined;
          if (d.id && !current) throw new Error("الحساب غير موجود");
          let parent = d.parentId,
            seen = new Set([id]);
          while (parent) {
            if (seen.has(parent)) throw new Error("دليل الحسابات يحتوي دورة");
            seen.add(parent);
            const a = this.db
              .prepare(aq + " WHERE id=?")
              .get(parent) as Account;
            if (!a || a.kind !== d.kind)
              throw new Error("المجموعة يجب أن تكون من نفس نوع الحساب");
            parent = a.parentId;
          }
          if (
            d.parentId &&
            this.db
              .prepare(
                "SELECT id FROM accounting_entries WHERE account_id=? LIMIT 1",
              )
              .get(d.parentId)
          )
            throw new Error("لا تحول حسابًا له قيود إلى مجموعة");
          if (
            current &&
            (current.kind !== d.kind ||
              current.code !== d.code ||
              current.parentId !== d.parentId) &&
            this.db
              .prepare(
                "SELECT id FROM accounting_entries WHERE account_id=? LIMIT 1",
              )
              .get(id)
          )
            throw new Error("نوع وكود ومجموعة الحساب المستخدم ثابتة");
          if (
            current &&
            current.kind !== d.kind &&
            this.db
              .prepare(
                "SELECT id FROM accounting_accounts WHERE parent_id=? LIMIT 1",
              )
              .get(id)
          )
            throw new Error("المجموعة لها حسابات فرعية");
          this.db
            .prepare(
              "INSERT INTO accounting_accounts VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,kind=excluded.kind,parent_id=excluded.parent_id,active=excluded.active",
            )
            .run(id, d.code, d.name, d.kind, d.parentId, Number(d.active));
          result = { id };
          break;
        }
        case "accounting.period.save":
          if (
            d.from > d.to ||
            this.db
              .prepare(
                "SELECT id FROM accounting_periods WHERE date_from<=? AND date_to>=? LIMIT 1",
              )
              .get(d.to, d.from)
          )
            throw new Error("الفترة متداخلة أو غير صالحة");
          result = { id: ulid() };
          this.db
            .prepare(
              "INSERT INTO accounting_periods(id,name,date_from,date_to) VALUES(?,?,?,?)",
            )
            .run(result.id, d.name, d.from, d.to);
          break;
        case "accounting.journal.save":
          result = this.save(d, user);
          break;
        case "accounting.journal.post":
          result = this.post(d, user);
          break;
        case "accounting.journal.void": {
          const j = this.get(d.id);
          this.openPeriod(j.date);
          if (j.status !== "draft" || j.version !== d.version)
            throw new Error("القيد تغير");
          this.db
            .prepare(
              "UPDATE accounting_journals SET status='void',version=version+1 WHERE id=?",
            )
            .run(j.id);
          result = this.get(j.id);
          break;
        }
        case "accounting.journal.reverse": {
          const j = this.get(d.id);
          if (
            j.status !== "posted" ||
            j.reverseOf ||
            this.db
              .prepare("SELECT id FROM accounting_journals WHERE reverse_of=?")
              .get(j.id)
          )
            throw new Error("القيد غير قابل للعكس أو سبق عكسه");
          const reverse = this.save(
            {
              date: d.date,
              memo: d.memo,
              reverseOf: j.id,
              lines: j.lines.map((l) => ({
                ...l,
                debit: l.credit,
                credit: l.debit,
              })),
            },
            user,
          );
          result = this.post(reverse, user);
          break;
        }
        case "accounting.period.close": {
          const p = this.db
            .prepare("SELECT * FROM accounting_periods WHERE id=?")
            .get(d.id) as any;
          if (
            !p ||
            p.status !== "open" ||
            this.db
              .prepare(
                "SELECT id FROM accounting_journals WHERE period_id=? AND status='draft' LIMIT 1",
              )
              .get(d.id)
          )
            throw new Error("حل المسودات أولًا أو راجع الفترة");
          if (!this.report(p.date_from, p.date_to).reconciled)
            throw new Error("الدفتر لا يتطابق؛ لا يمكن الإقفال");
          this.db
            .prepare(
              "UPDATE accounting_periods SET status='closed',closed_at=? WHERE id=?",
            )
            .run(Date.now(), d.id);
          result = { closed: true };
          break;
        }
        default:
          throw new Error("العملية غير متاحة");
      }
      this.identity.audit(user.id, action, d.id ?? result.id ?? "ledger");
      if (d.clientTxnId)
        this.db
          .prepare("INSERT INTO commands VALUES(?,?,?,?,?)")
          .run(
            d.clientTxnId,
            action,
            user.id,
            fingerprint(d),
            JSON.stringify(result),
          );
      return result;
    })();
  }
}
