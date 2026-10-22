import { useEffect, useRef, useState, type ReactNode } from "react";
import { ulid } from "@xzare/core";
import type { Accounting, Account, Journal, User } from "@xzare/engine";
import { AuthScreen, type AuthValues } from "../../pos/src/AuthScreen";
import { BrandMark } from "../../pos/src/BrandMark";
import { LicensePanel } from "../../pos/src/LicensePanel";
import { WorkspaceClock } from "../../pos/src/WorkspaceClock";
import { call } from "../../pos/src/bridge";
import { useSessionActivity } from "../../pos/src/useSessionActivity";
import { DraftEditor } from "./DraftEditor";
import {
  Modal,
  Field,
  Empty,
  amount,
  decimal,
  today,
  kinds,
  statuses,
  csv,
  download,
} from "./ui";
type State = ReturnType<Accounting["state"]>;
type Report = ReturnType<Accounting["report"]>;
type Ledger = ReturnType<Accounting["ledger"]>;
const pages = {
  overview: "نظرة عامة",
  accounts: "دليل الحسابات",
  journals: "القيود اليومية",
  ledger: "الأستاذ العام",
  trial: "ميزان المراجعة",
  statements: "القوائم المالية",
  periods: "الفترات المالية",
  users: "المستخدمون",
  audit: "سجل التدقيق",
  settings: "الإعدادات والترخيص",
};
type View = keyof typeof pages;
type Form = {
  title: string;
  body: ReactNode;
  submit: (f: FormData) => Promise<void>;
  button?: string;
};
const roles = {
  hr: "شؤون الموظفين",
  payroll: "مسؤول الرواتب",
  teacher: "غير متاح في هذا المنتج",
  trainer: "غير متاح في هذا المنتج",
  stylist: "غير متاح في هذا المنتج",
  technician: "غير مستخدم في هذا المنتج",
  doctor: "غير مستخدم في هذا المنتج",
  admin: "مسؤول النظام",
  manager: "محاسب مسؤول",
  cashier: "مُعدّ قيود",
  kitchen: "غير مستخدم في المحاسبة",
};
export function App() {
  const [configured, setConfigured] = useState<boolean | null>(null),
    [state, setState] = useState<State | null>(null),
    [view, setView] = useState<View>("overview"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [form, setForm] = useState<Form | null>(null),
    [editor, setEditor] = useState<Journal | "new" | null>(null),
    [detail, setDetail] = useState<Journal | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [from, setFrom] = useState(today().slice(0, 4) + "-01-01"),
    [to, setTo] = useState(today()),
    [report, setReport] = useState<Report | null>(null),
    [ledger, setLedger] = useState<Ledger | null>(null),
    [accountId, setAccountId] = useState("");
  const mutex = useRef(false),
    requests = useRef(new Map<string, string>()),
    generation = useRef(0),
    loadSeq = useRef(0);
  const end = () => {
    generation.current++;
    setState(null);
    setReport(null);
    setLedger(null);
    setEditor(null);
    setDetail(null);
    setForm(null);
    setView("overview");
    setSearch("");
    setError("");
    setNotice("");
    requests.current.clear();
  };
  useSessionActivity(!!state, end);
  async function load() {
    const g = generation.current,
      n = ++loadSeq.current,
      next = await call<State>("accounting.state");
    if (g === generation.current && n === loadSeq.current) setState(next);
  }
  useEffect(() => {
    void call<{ configured: boolean }>("auth.status")
      .then((v) => {
        setConfigured(v.configured);
        if (v.configured) void load().catch(() => {});
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!state) return;
    const timer = setInterval(() => {
      if (!mutex.current)
        void load().catch((e) => {
          if (/انتهت الجلسة|سجّل الدخول/.test(e.message)) end();
          else setError(e.message);
        });
    }, 15000);
    return () => clearInterval(timer);
  }, [state?.user.id]);
  useEffect(() => {
    if (!state) return;
    let disposed = false;
    setReport(null);
    setLedger(null);
    const query = ["overview", "trial", "statements"].includes(view)
      ? call<Report>("accounting.report", { from, to })
      : view === "ledger" && accountId
        ? call<Ledger>("accounting.ledger", { accountId, from, to })
        : null;
    void query
      ?.then((v) => {
        if (disposed) return;
        if ("reconciled" in v) setReport(v);
        else setLedger(v);
      })
      .catch((e) => {
        if (!disposed) {
          setError(e.message);
          if (/انتهت الجلسة|سجّل الدخول/.test(e.message)) end();
        }
      });
    return () => {
      disposed = true;
    };
  }, [state, view, from, to, accountId]);
  const invoke = (work: () => Promise<unknown>) => {
    void work().catch(() => {});
  };
  async function run(
    action: string,
    payload: Record<string, unknown> = {},
    command = action.startsWith("accounting."),
  ) {
    if (mutex.current) throw new Error("انتظر انتهاء العملية");
    mutex.current = true;
    setBusy(true);
    setError("");
    const key = JSON.stringify([action, payload]);
    try {
      if (command && !requests.current.has(key))
        requests.current.set(key, ulid());
      const value = await call<any>(
        action,
        command
          ? { ...payload, clientTxnId: requests.current.get(key) }
          : payload,
      );
      requests.current.delete(key);
      setNotice("تم حفظ العملية");
      try {
        await load();
      } catch {
        setError("تم الحفظ؛ اضغط تحديث لإعادة تحميل العرض.");
      }
      return value;
    } catch (e) {
      const message = e instanceof Error ? e.message : "تعذر إتمام العملية";
      setError(message);
      if (/انتهت الجلسة|سجّل الدخول/.test(message)) end();
      throw e;
    } finally {
      mutex.current = false;
      setBusy(false);
    }
  }
  function show(f: Form) {
    setError("");
    setForm(f);
  }
  function saveForm(
    title: string,
    body: ReactNode,
    action: string,
    payload: (f: FormData) => Record<string, unknown>,
    button?: string,
  ) {
    show({
      title,
      body,
      button,
      submit: async (f) => {
        await run(action, payload(f));
        setForm(null);
      },
    });
  }
  function navigate(v: View) {
    setView(v);
    setSearch("");
    setFilter("all");
    setError("");
    setNotice("");
  }
  const manager =
      state?.user.role === "admin" || state?.user.role === "manager",
    admin = state?.user.role === "admin";
  async function authenticate(v: AuthValues) {
    setBusy(true);
    setError("");
    try {
      if (configured)
        await call("login", { username: v.username, password: v.password });
      else await call("setup", v);
      setConfigured(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تسجيل الدخول");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  if (!state)
    return (
      <AuthScreen
        product="accounting"
        configured={configured}
        busy={busy}
        error={error}
        onAuthenticate={authenticate}
      />
    );
  function accountForm(a?: Account) {
    saveForm(
      a ? "تعديل الحساب" : "حساب جديد",
      <>
        <div className="a-form-row">
          <Field label="كود الحساب">
            <input
              name="code"
              required
              pattern="[A-Za-z0-9.\-]+"
              maxLength={30}
              defaultValue={a?.code ?? ""}
              dir="ltr"
            />
          </Field>
          <Field label="اسم الحساب">
            <input
              name="name"
              required
              maxLength={160}
              defaultValue={a?.name ?? ""}
            />
          </Field>
        </div>
        <Field label="نوع الحساب">
          <select name="kind" defaultValue={a?.kind ?? "asset"}>
            {Object.entries(kinds).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="المجموعة الرئيسية">
          <select name="parentId" defaultValue={a?.parentId ?? ""}>
            <option value="">حساب رئيسي</option>
            {state!.accounts
              .filter((x) => x.id !== a?.id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code} — {x.name} · {kinds[x.kind]}
                </option>
              ))}
          </select>
        </Field>
        <label className="a-check">
          <input
            type="checkbox"
            name="active"
            defaultChecked={a ? !!a.active : true}
          />
          الحساب نشط
        </label>
        <small>
          الأرصدة تُسجّل بقيد افتتاحي. نوع وكود ومجموعة الحساب المستخدم في قيود
          مرحّلة لا يمكن تغييرها.
        </small>
      </>,
      "accounting.account.save",
      (f) => ({
        ...(a && { id: a.id }),
        code: String(f.get("code")),
        name: String(f.get("name")),
        kind: String(f.get("kind")),
        parentId: f.get("parentId") || null,
        active: f.has("active"),
      }),
    );
  }
  function periodForm() {
    saveForm(
      "فترة مالية جديدة",
      <>
        <Field label="اسم الفترة">
          <input name="name" required maxLength={160} />
        </Field>
        <div className="a-form-row">
          <Field label="من تاريخ">
            <input
              name="from"
              type="date"
              required
              defaultValue={today().slice(0, 4) + "-01-01"}
            />
          </Field>
          <Field label="إلى تاريخ">
            <input
              name="to"
              type="date"
              required
              defaultValue={today().slice(0, 4) + "-12-31"}
            />
          </Field>
        </div>
        <small>الفترات لا تتداخل. كل قيد يحتاج تاريخًا داخل فترة مفتوحة.</small>
      </>,
      "accounting.period.save",
      (f) => ({
        name: String(f.get("name")),
        from: String(f.get("from")),
        to: String(f.get("to")),
      }),
    );
  }
  function post(j: Journal) {
    saveForm(
      "ترحيل القيد",
      <>
        <p>
          سيُرحّل قيد «{j.memo}» بمبلغ <b>{amount(j.total)} ج.م</b>.
        </p>
        <p className="muted">
          يظهر في الدفاتر والتقارير، وتُثبت بياناته بعد الترحيل. التصحيح يتم
          بقيد عكسي جديد.
        </p>
      </>,
      "accounting.journal.post",
      () => ({ id: j.id, version: j.version }),
      "تأكيد الترحيل",
    );
  }
  function reverse(j: Journal) {
    saveForm(
      "عكس القيد " + j.number,
      <>
        <p className="muted">
          ينشئ قيدًا مرحّلًا بعكس المدين والدائن؛ الأصل يظل محفوظًا. اختر
          تاريخًا في فترة مفتوحة.
        </p>
        <Field label="تاريخ العكس">
          <input name="date" type="date" required defaultValue={today()} />
        </Field>
        <Field label="سبب التصحيح">
          <textarea name="memo" required maxLength={160} />
        </Field>
      </>,
      "accounting.journal.reverse",
      (f) => ({
        id: j.id,
        date: String(f.get("date")),
        memo: String(f.get("memo")),
      }),
      "إنشاء القيد العكسي",
    );
  }
  function userForm(u?: User) {
    saveForm(
      u ? "تعديل المستخدم" : "مستخدم جديد",
      <>
        <Field label="الاسم">
          <input
            name="name"
            required
            maxLength={160}
            defaultValue={u?.name ?? ""}
          />
        </Field>
        <Field label="اسم المستخدم">
          <input
            name="username"
            required
            pattern="[A-Za-z0-9_.\-]{3,40}"
            dir="ltr"
            defaultValue={u?.username ?? ""}
          />
        </Field>
        <Field label="الصلاحية">
          <select name="role" defaultValue={u?.role ?? "cashier"}>
            <option value="cashier">مُعدّ قيود: مسودات وتقارير</option>
            <option value="manager">محاسب مسؤول: حسابات وترحيل</option>
            <option value="admin">مسؤول النظام: إقفال وإدارة</option>
          </select>
        </Field>
        <Field label={u ? "كلمة مرور جديدة (اختياري)" : "كلمة المرور"}>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required={!u}
          />
        </Field>
        <label className="a-check">
          <input
            name="active"
            type="checkbox"
            defaultChecked={u ? !!u.active : true}
          />
          مستخدم نشط
        </label>
      </>,
      "user.save",
      (f) => ({
        ...(u && { id: u.id }),
        name: String(f.get("name")),
        username: String(f.get("username")),
        role: String(f.get("role")),
        active: f.has("active"),
        ...(f.get("password") && { password: String(f.get("password")) }),
      }),
    );
  }
  async function backup() {
    setError("");
    try {
      const v = await call<{
        download?: string;
        fileName?: string;
        cancelled?: boolean;
      }>("backup.create");
      if (v?.download)
        download(
          v.fileName ?? "Xzare-Accounting.xzbak",
          new Blob([Uint8Array.from(atob(v.download), (c) => c.charCodeAt(0))]),
        );
      if (!v?.cancelled) setNotice("تم إنشاء النسخة الاحتياطية");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر النسخ الاحتياطي");
    }
  }
  function restore() {
    show({
      title: "استعادة نسخة احتياطية",
      button: "تأكيد الاستعادة",
      body: (
        <>
          <p className="muted">
            تستبدل بيانات الشركة الحالية وتُنهي الجلسات. أنشئ نسخة احتياطية
            أولًا. تُقبل نسخ المحاسبة المطابقة فقط.
          </p>
          {!window.xzare && (
            <Field label="ملف النسخة">
              <input type="file" name="file" required accept=".xzbak" />
            </Field>
          )}
          <Field label="كلمة مرور المسؤول">
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </Field>
        </>
      ),
      submit: async (f) => {
        if (mutex.current) return;
        mutex.current = true;
        setBusy(true);
        setError("");
        try {
          let restored = false;
          if (window.xzare) {
            const v = await call<{ restored?: boolean }>("backup.restore", {
              password: String(f.get("password")),
            });
            restored = !!v?.restored;
          } else {
            const file = f.get("file") as File;
            const r = await fetch("/api/restore", {
                method: "POST",
                headers: {
                  "X-Xzare-Request": "1",
                  "X-Xzare-Password": encodeURIComponent(
                    String(f.get("password")),
                  ),
                },
                body: file,
                credentials: "same-origin",
              }),
              v = await r.json();
            if (!r.ok || !v.ok) throw new Error(v.error ?? "تعذر الاسترجاع");
            restored = !!v.value?.restored;
          }
          if (restored) end();
          else setForm(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : "تعذر الاسترجاع");
        } finally {
          mutex.current = false;
          setBusy(false);
        }
      },
    });
  }
  const journalRows = state.journals.filter(
    (j) =>
      (filter === "all" || j.status === filter) &&
      (j.memo + " " + (j.number ?? ""))
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const accountRows = state.accounts.filter(
    (a) =>
      (filter === "all" || a.kind === filter) &&
      (a.code + " " + a.name).toLowerCase().includes(search.toLowerCase()),
  );
  const reportViews = ["overview", "ledger", "trial", "statements"].includes(
    view,
  );
  function exportReport() {
    if (view === "ledger" && ledger) {
      const a = state!.accounts.find((x) => x.id === accountId);
      csv("Xzare-Accounting-Ledger.csv", [
        [state!.businessName, "الأستاذ", a?.code, a?.name, from, to, "EGP"],
        ["رصيد افتتاحي", decimal(ledger.opening)],
        ["التاريخ", "رقم القيد", "البيان", "مدين", "دائن", "الرصيد", "ملاحظة"],
        ...ledger.rows.map((r) => [
          r.date,
          r.number,
          r.memo,
          decimal(r.debit),
          decimal(r.credit),
          decimal(r.balance),
          r.note,
        ]),
        ["رصيد ختامي", decimal(ledger.closing)],
      ]);
    } else if (report) {
      if (view === "statements")
        csv("Xzare-Accounting-Statements.csv", [
          [state!.businessName, from, to, "EGP"],
          ["البند", "المبلغ"],
          ["إيرادات الفترة", decimal(report.income)],
          ["مصروفات الفترة", decimal(report.expenses)],
          ["صافي الفترة", decimal(report.profit)],
          ["الأصول", decimal(report.assets)],
          ["الالتزامات", decimal(report.liabilities)],
          ["حقوق الملكية", decimal(report.equity)],
          ["صافي النتائج المتراكمة", decimal(report.accumulatedProfit)],
        ]);
      else
        csv("Xzare-Accounting-Trial.csv", [
          [state!.businessName, from, to, "EGP"],
          [
            "الكود",
            "الحساب",
            "افتتاحي",
            "حركة مدين",
            "حركة دائن",
            "رصيد مدين",
            "رصيد دائن",
          ],
          ...report.balances.map((r) => [
            r.code,
            r.name,
            decimal(r.opening),
            decimal(r.debit),
            decimal(r.credit),
            decimal(Math.max(r.closing, 0)),
            decimal(Math.max(-r.closing, 0)),
          ]),
          [
            "الإجمالي",
            "",
            "",
            decimal(report.trial.movementDebit),
            decimal(report.trial.movementCredit),
            decimal(report.trial.debit),
            decimal(report.trial.credit),
          ],
        ]);
    }
  }
  const entriesTable = (js: Journal[], compact = false) => (
    <div className="a-scroll">
      <table>
        <thead>
          <tr>
            <th>التاريخ / الرقم</th>
            <th>البيان</th>
            <th>المبلغ · ج.م</th>
            <th>الحالة</th>
            <th>الإجراء</th>
          </tr>
        </thead>
        <tbody>
          {js.map((j) => (
            <tr key={j.id}>
              <td className="a-date">
                {j.date}
                <small dir="ltr">{j.number ?? "بدون رقم حتى الترحيل"}</small>
              </td>
              <td>
                {j.memo}
                {j.reverseOf && (
                  <small>
                    قيد عكسي ·{" "}
                    {state!.journals.find((x) => x.id === j.reverseOf)
                      ?.number ?? j.reverseOf}
                  </small>
                )}
              </td>
              <td className="a-num">{amount(j.total)}</td>
              <td>
                <span className={"a-tag " + j.status}>
                  {statuses[j.status]}
                </span>
              </td>
              <td>
                <div className="a-row-actions">
                  <button
                    onClick={() => {
                      setError("");
                      setDetail(j);
                    }}
                  >
                    عرض
                  </button>
                  {!compact && j.status === "draft" && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setError("");
                          setEditor(j);
                        }}
                      >
                        تعديل
                      </button>
                      {manager && (
                        <button
                          disabled={busy}
                          className="primary"
                          onClick={() => post(j)}
                        >
                          ترحيل
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() =>
                          saveForm(
                            "إلغاء المسودة",
                            <Field label="سبب الإلغاء">
                              <input name="memo" required maxLength={160} />
                            </Field>,
                            "accounting.journal.void",
                            (f) => ({
                              id: j.id,
                              version: j.version,
                              memo: String(f.get("memo")),
                            }),
                            "إلغاء المسودة",
                          )
                        }
                      >
                        إلغاء
                      </button>
                    </>
                  )}
                  {!compact &&
                    manager &&
                    j.status === "posted" &&
                    !j.reverseOf &&
                    !state!.journals.some((x) => x.reverseOf === j.id) && (
                      <button disabled={busy} onClick={() => reverse(j)}>
                        عكس
                      </button>
                    )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!js.length && (
        <Empty>لا توجد قيود هنا. سجّل عمليات شركتك الفعلية عند جاهزيتها.</Empty>
      )}
    </div>
  );
  return (
    <div className="a-app">
      <aside className="a-sidebar">
        <div className="a-wordmark">
          <BrandMark />
          <div>
            <b>XZARE</b>
            <small>ACCOUNTING / 0.1</small>
          </div>
        </div>
        <div className="a-company">
          {state.businessName}
          <small>
            {state.user.name} · {roles[state.user.role]}
          </small>
        </div>
        <nav aria-label="أقسام المحاسبة">
          {(Object.entries(pages) as [View, string][])
            .filter(
              ([k]) => admin || !["users", "audit", "settings"].includes(k),
            )
            .map(([k, v], i) => (
              <button
                key={k}
                onClick={() => navigate(k)}
                className={k === view ? "active" : ""}
                aria-current={k === view ? "page" : undefined}
              >
                <span className="a-nav-index">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {v}
              </button>
            ))}
        </nav>
        <div className="a-sidebar-foot">
          <small>دفاتر شركتك، في مكان واحد.</small>
          <span dir="ltr">hello@xzare.com</span>
        </div>
      </aside>
      <main className="a-workspace">
        <header className="a-topbar">
          <div>
            مساحة المحاسبة <span>/ {pages[view]}</span>
          </div>
          <div className="a-top-actions">
            <WorkspaceClock english={false} />
            <button
              disabled={busy}
              onClick={() =>
                invoke(async () => {
                  await load();
                  setNotice("تم تحديث العرض");
                })
              }
            >
              تحديث
            </button>
            <button
              disabled={busy}
              onClick={() =>
                invoke(async () => {
                  await call("logout");
                  end();
                })
              }
            >
              قفل الجلسة
            </button>
          </div>
        </header>
        <div className="a-content">
          <div className="a-heading">
            <div>
              <span className="eyebrow">XZARE / ACCOUNTING</span>
              <h1>{pages[view]}</h1>
              <p>
                {view === "overview"
                  ? "أرقام من قيودك المرحّلة، ومسودات تنتظر المراجعة."
                  : view === "accounts"
                    ? "دليل حساباتك الفعلي؛ الأرصدة تُبنى من القيود."
                    : view === "journals"
                      ? "إعداد، مراجعة، ثم ترحيل. كل خطوة محفوظة."
                      : view === "statements"
                        ? "نتيجة الفترة والمركز المالي حتى نهاية التاريخ المختار."
                        : "دفاتر واضحة، ومصدر كل رقم محفوظ."}
              </p>
            </div>
            <div className="a-heading-actions">
              {(view === "journals" || view === "overview") && (
                <button
                  className="primary"
                  disabled={
                    busy ||
                    state.accounts.length < 2 ||
                    !state.periods.some((p) => p.status === "open")
                  }
                  onClick={() => {
                    setError("");
                    setEditor("new");
                  }}
                >
                  + قيد جديد
                </button>
              )}
              {view === "accounts" && manager && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => accountForm()}
                >
                  + حساب جديد
                </button>
              )}
              {view === "periods" && manager && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={periodForm}
                >
                  + فترة جديدة
                </button>
              )}
              {view === "users" && admin && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => userForm()}
                >
                  + مستخدم جديد
                </button>
              )}
            </div>
          </div>
          {error && !form && !editor && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="a-notice" role="status">
              {notice}
              <button aria-label="إخفاء الإشعار" onClick={() => setNotice("")}>
                ×
              </button>
            </div>
          )}
          {reportViews && (
            <section className="a-filter">
              <Field label="من تاريخ">
                <input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setError("");
                    setFrom(e.target.value);
                  }}
                />
              </Field>
              <Field label="إلى تاريخ">
                <input
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setError("");
                    setTo(e.target.value);
                  }}
                />
              </Field>
              {view === "ledger" && (
                <Field label="الحساب">
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                  >
                    <option value="">اختر حسابًا</option>
                    {state.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="a-report-actions">
                <span>العملة: EGP · ج.م</span>
                <button
                  disabled={
                    !(view === "ledger" ? ledger : report) ||
                    report?.reconciled === false
                  }
                  onClick={exportReport}
                >
                  تصدير CSV
                </button>
                <button
                  disabled={
                    !(view === "ledger" ? ledger : report) ||
                    report?.reconciled === false
                  }
                  onClick={() => window.print()}
                >
                  طباعة / PDF
                </button>
              </div>
            </section>
          )}
          {view === "overview" && (
            <>
              {(!state.accounts.length || !state.periods.length) && (
                <section className="a-start">
                  <div>
                    <span className="eyebrow">البداية / ٣ خطوات</span>
                    <h2>جهّز دفاتر شركتك</h2>
                    <p>
                      ابدأ بفترة مالية، أضف حساباتك، ثم سجّل أول قيد متوازن. لا
                      تُضاف عمليات تلقائيًا.
                    </p>
                  </div>
                  <div>
                    <button onClick={() => navigate("periods")}>
                      ١. الفترة المالية
                    </button>
                    <button onClick={() => navigate("accounts")}>
                      ٢. دليل الحسابات
                    </button>
                    <button
                      disabled={
                        state.accounts.length < 2 || !state.periods.length
                      }
                      onClick={() => navigate("journals")}
                    >
                      ٣. أول قيد
                    </button>
                  </div>
                </section>
              )}
              {report && (
                <>
                  <div className="a-stats">
                    {[
                      ["الأصول حتى " + to, report.assets],
                      ["إيرادات الفترة", report.income],
                      ["مصروفات الفترة", report.expenses],
                      ["صافي الفترة", report.profit],
                    ].map(([label, n]) => (
                      <div key={String(label)}>
                        <span>{label}</span>
                        <strong>{amount(Number(n))}</strong>
                        <small>جنيه مصري</small>
                      </div>
                    ))}
                  </div>
                  <div
                    className={
                      "a-reconcile " + (report.reconciled ? "a-ok" : "a-warn")
                    }
                  >
                    {report.reconciled
                      ? "✓ الدفاتر متطابقة: المدين = الدائن"
                      : "التقارير تحتاج مراجعة؛ لم تتطابق الدفاتر."}
                    <span>
                      {
                        state.journals.filter((j) => j.status === "draft")
                          .length
                      }{" "}
                      مسودة تنتظر المراجعة
                    </span>
                  </div>
                </>
              )}
              <section className="a-sheet">
                <div className="a-section-title">
                  <h2>آخر القيود</h2>
                  <button onClick={() => navigate("journals")}>
                    كل القيود ←
                  </button>
                </div>
                {entriesTable(state.journals.slice(0, 7), true)}
              </section>
              <p className="a-footnote">
                المسودات لا تدخل في الأرصدة. ملخص القيود يعرض آخر ١٠٠٠ قيد؛
                التقارير تقرأ جميع القيود المرحّلة.
              </p>
            </>
          )}
          {view === "accounts" && (
            <>
              <div className="a-filter">
                <Field label="بحث عن حساب">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="الكود أو اسم الحساب"
                  />
                </Field>
                <Field label="نوع الحساب">
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">كل الأنواع</option>
                    {Object.entries(kinds).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <span>{state.accounts.length} حساب</span>
              </div>
              <section className="a-sheet a-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>الكود</th>
                      <th>الحساب</th>
                      <th>النوع</th>
                      <th>المجموعة</th>
                      <th>الحالة</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {accountRows.map((a) => (
                      <tr key={a.id}>
                        <td className="a-date">{a.code}</td>
                        <td>
                          <b>{a.name}</b>
                          {state.accounts.some((x) => x.parentId === a.id) && (
                            <small>مجموعة · لا يُرحّل إليها مباشرة</small>
                          )}
                        </td>
                        <td>{kinds[a.kind]}</td>
                        <td>
                          {state.accounts.find((x) => x.id === a.parentId)
                            ?.name ?? "رئيسي"}
                        </td>
                        <td>{a.active ? "نشط" : "متوقف"}</td>
                        <td>
                          {manager && (
                            <button
                              disabled={busy}
                              onClick={() => accountForm(a)}
                            >
                              تعديل
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!accountRows.length && (
                  <Empty>
                    أضف حسابات شركتك الفعلية: كود واسم ونوع كل حساب.
                  </Empty>
                )}
              </section>
            </>
          )}
          {view === "journals" && (
            <>
              <div className="a-filter">
                <Field label="بحث القيود">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="البيان أو رقم القيد"
                  />
                </Field>
                <Field label="حالة القيد">
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">كل الحالات</option>
                    {Object.entries(statuses).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <section className="a-sheet">{entriesTable(journalRows)}</section>
              <p className="a-footnote">
                يعرض آخر ١٠٠٠ قيد مع أولوية المسودات. الأستاذ والتقارير يقرآن
                جميع القيود المرحّلة.
              </p>
            </>
          )}
          {view === "trial" && (
            <section className="a-sheet">
              <div className="a-section-title">
                <h2>ميزان المراجعة</h2>
                {report && (
                  <span className={report.reconciled ? "a-ok" : "a-warn"}>
                    {report.reconciled ? "متطابق" : "غير متطابق"}
                  </span>
                )}
              </div>
              {report ? (
                <div className="a-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>الحساب</th>
                        <th>افتتاحي</th>
                        <th>حركة مدين</th>
                        <th>حركة دائن</th>
                        <th>رصيد مدين</th>
                        <th>رصيد دائن</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.balances.map((r) => (
                        <tr key={r.id}>
                          <td>
                            {r.code} — {r.name}
                          </td>
                          <td className="a-num">{amount(r.opening)}</td>
                          <td className="a-num">{amount(r.debit)}</td>
                          <td className="a-num">{amount(r.credit)}</td>
                          <td className="a-num">
                            {amount(Math.max(r.closing, 0))}
                          </td>
                          <td className="a-num">
                            {amount(Math.max(-r.closing, 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th>الإجمالي</th>
                        <td />
                        <th className="a-num">
                          {amount(report.trial.movementDebit)}
                        </th>
                        <th className="a-num">
                          {amount(report.trial.movementCredit)}
                        </th>
                        <th className="a-num">{amount(report.trial.debit)}</th>
                        <th className="a-num">{amount(report.trial.credit)}</th>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <Empty>
                  {error
                    ? "راجع الفترة المختارة."
                    : "جارٍ قراءة القيود المرحّلة…"}
                </Empty>
              )}
              <p className="a-footnote">
                الافتتاحي والرصد الجاري: موجب = مدين، سالب = دائن. القيم بالجنيه
                المصري.
              </p>
            </section>
          )}
          {view === "ledger" && (
            <section className="a-sheet">
              <div className="a-section-title">
                <h2>
                  {state.accounts.find((a) => a.id === accountId)?.name ??
                    "الأستاذ العام"}
                </h2>
                {ledger && (
                  <span>
                    رصيد افتتاحي:{" "}
                    <b className="a-num">{amount(ledger.opening)}</b>
                  </span>
                )}
              </div>
              {ledger ? (
                <>
                  <div className="a-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>التاريخ</th>
                          <th>القيد / البيان</th>
                          <th>مدين</th>
                          <th>دائن</th>
                          <th>الرصيد الجاري</th>
                          <th>ملاحظة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledger.rows.map((r, i) => (
                          <tr key={r.id + "-" + i}>
                            <td className="a-date">{r.date}</td>
                            <td>
                              <button
                                className="a-ledger-link"
                                aria-label={"فتح القيد " + r.number}
                                dir="ltr"
                                onClick={() =>
                                  invoke(async () => {
                                    try {
                                      setError("");
                                      setDetail(
                                        await call<Journal>(
                                          "accounting.journal.get",
                                          { id: r.id },
                                        ),
                                      );
                                    } catch (e) {
                                      setError(
                                        e instanceof Error
                                          ? e.message
                                          : "تعذر فتح القيد",
                                      );
                                    }
                                  })
                                }
                              >
                                {r.number}
                              </button>
                              <small>{r.memo}</small>
                            </td>
                            <td className="a-num">{amount(r.debit)}</td>
                            <td className="a-num">{amount(r.credit)}</td>
                            <td className="a-num">{amount(r.balance)}</td>
                            <td>{r.note}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th colSpan={4}>رصيد ختامي</th>
                          <th className="a-num">{amount(ledger.closing)}</th>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {!ledger.rows.length && (
                    <Empty>لا توجد حركة مرحّلة لهذا الحساب في الفترة.</Empty>
                  )}
                  <p className="a-footnote">
                    الرصيد الموجب مدين، والسالب دائن. لا تدخل المسودات في كشف
                    الحساب.
                  </p>
                </>
              ) : (
                <Empty>
                  {accountId
                    ? "جارٍ قراءة كشف الحساب…"
                    : "اختر الحساب لعرض رصيده وحركاته."}
                </Empty>
              )}
            </section>
          )}
          {view === "statements" && (
            <>
              {report?.reconciled ? (
                <div className="a-statements">
                  <section className="a-sheet">
                    <div className="a-section-title">
                      <h2>قائمة الدخل</h2>
                      <span>
                        {from} ← {to}
                      </span>
                    </div>
                    {[
                      ["الإيرادات", report.income],
                      ["المصروفات", report.expenses],
                      ["صافي نتيجة الفترة", report.profit],
                    ].map(([label, n], i) => (
                      <div
                        className={
                          "a-statement-row " + (i === 2 ? "total" : "")
                        }
                        key={String(label)}
                      >
                        <span>{label}</span>
                        <b className="a-num">{amount(Number(n))}</b>
                      </div>
                    ))}
                    <p className="a-footnote">
                      صافي الفترة ناتج من حركة حسابات الإيرادات والمصروفات خلال
                      الفترة المختارة.
                    </p>
                  </section>
                  <section className="a-sheet">
                    <div className="a-section-title">
                      <h2>المركز المالي</h2>
                      <span>حتى {to}</span>
                    </div>
                    {[
                      ["الأصول", report.assets],
                      ["الالتزامات", report.liabilities],
                      ["حقوق الملكية المسجّلة", report.equity],
                      ["صافي النتائج المتراكمة", report.accumulatedProfit],
                      [
                        "الالتزامات + الملكية + النتائج",
                        report.liabilities +
                          report.equity +
                          report.accumulatedProfit,
                      ],
                    ].map(([label, n], i) => (
                      <div
                        className={
                          "a-statement-row " + (i === 4 ? "total" : "")
                        }
                        key={String(label)}
                      >
                        <span>{label}</span>
                        <b className="a-num">{amount(Number(n))}</b>
                      </div>
                    ))}
                    <p className="a-footnote">
                      الأصول = الالتزامات + حقوق الملكية + صافي النتائج
                      المتراكمة. لا تُنشأ قيود إقفال أرباح تلقائية.
                    </p>
                  </section>
                </div>
              ) : (
                <Empty>
                  {report
                    ? "تعذر مطابقة الدفاتر؛ راجع القيود قبل الاعتماد على القوائم."
                    : "جارٍ قراءة القوائم…"}
                </Empty>
              )}
            </>
          )}
          {view === "periods" && (
            <section className="a-sheet a-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الفترة</th>
                    <th>من</th>
                    <th>إلى</th>
                    <th>الحالة</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {state.periods.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <b>{p.name}</b>
                      </td>
                      <td className="a-date">{p.dateFrom}</td>
                      <td className="a-date">{p.dateTo}</td>
                      <td>
                        <span
                          className={
                            "a-tag " +
                            (p.status === "open" ? "draft" : "posted")
                          }
                        >
                          {p.status === "open" ? "مفتوحة" : "مقفلة"}
                        </span>
                      </td>
                      <td>
                        {admin && p.status === "open" && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              saveForm(
                                "إقفال الفترة",
                                <>
                                  <p>
                                    إقفال «{p.name}» يمنع إضافة أو تعديل أو عكس
                                    قيود بتاريخ داخلها.
                                  </p>
                                  <p className="muted">
                                    راجع المسودات والتقارير أولًا. الإقفال
                                    نهائي؛ يُرفض إذا بقيت مسودات أو اختلفت
                                    الدفاتر.
                                  </p>
                                </>,
                                "accounting.period.close",
                                () => ({ id: p.id }),
                                "تأكيد الإقفال",
                              )
                            }
                          >
                            إقفال الفترة
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!state.periods.length && (
                <Empty>
                  ابدأ بإضافة الفترة المالية التي تسجّل فيها عملياتك.
                </Empty>
              )}
            </section>
          )}
          {view === "users" && admin && (
            <section className="a-sheet a-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>المستخدم</th>
                    <th>الصلاحية</th>
                    <th>الحالة</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {state.users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td dir="ltr">{u.username}</td>
                      <td>{roles[u.role]}</td>
                      <td>{u.active ? "نشط" : "موقوف"}</td>
                      <td>
                        <button disabled={busy} onClick={() => userForm(u)}>
                          تعديل
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {view === "audit" && admin && (
            <section className="a-sheet a-scroll">
              <table>
                <thead>
                  <tr>
                    <th>التوقيت</th>
                    <th>المستخدم</th>
                    <th>العملية</th>
                    <th>مرجع السجل</th>
                  </tr>
                </thead>
                <tbody>
                  {state.audit.map((a) => (
                    <tr key={a.id}>
                      <td>{new Date(a.at).toLocaleString("ar-EG")}</td>
                      <td>{a.user_name ?? "النظام"}</td>
                      <td dir="ltr">{a.action}</td>
                      <td className="a-date">{a.entity_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="a-footnote">
                آخر ٣٠٠ حدث. السجل محفوظ للإعداد والترحيل والعكس والإقفال
                والإدارة.
              </p>
            </section>
          )}
          {view === "settings" && admin && (
            <div className="a-settings">
              <section className="a-sheet a-settings-block">
                <h2>الشركة والبيانات</h2>
                <p>{state.businessName}</p>
                <p className="muted">
                  {state.settings.phone || "لم يُضف هاتف الشركة"}
                  <br />
                  {state.settings.address || "لم يُضف عنوان الشركة"}
                </p>
                <div className="a-row-actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      saveForm(
                        "بيانات الشركة",
                        <>
                          <Field label="اسم الشركة">
                            <input
                              name="businessName"
                              required
                              maxLength={160}
                              defaultValue={state.businessName}
                            />
                          </Field>
                          <Field label="هاتف الشركة">
                            <input
                              name="phone"
                              maxLength={40}
                              defaultValue={state.settings.phone}
                            />
                          </Field>
                          <Field label="عنوان الشركة">
                            <input
                              name="address"
                              maxLength={250}
                              defaultValue={state.settings.address}
                            />
                          </Field>
                          <p className="muted">
                            العملة الحالية: الجنيه المصري (EGP).
                          </p>
                        </>,
                        "settings.save",
                        (f) => ({
                          businessName: String(f.get("businessName")),
                          phone: String(f.get("phone")),
                          address: String(f.get("address")),
                          currency: "EGP",
                          language: "ar",
                          receiptFooter: state.settings.receiptFooter ?? "",
                          taxBps: Number(state.settings.taxBps ?? 0),
                        }),
                      )
                    }
                  >
                    تعديل بيانات الشركة
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      show({
                        title: "تغيير كلمة المرور",
                        body: (
                          <>
                            <Field label="كلمة المرور الحالية">
                              <input
                                name="current"
                                type="password"
                                required
                                autoComplete="current-password"
                              />
                            </Field>
                            <Field label="كلمة المرور الجديدة">
                              <input
                                name="password"
                                type="password"
                                required
                                minLength={12}
                                maxLength={128}
                                autoComplete="new-password"
                              />
                            </Field>
                            <small>تُنهى الجلسات بعد تغيير كلمة المرور.</small>
                          </>
                        ),
                        submit: async (f) => {
                          await run(
                            "password.change",
                            {
                              current: String(f.get("current")),
                              password: String(f.get("password")),
                            },
                            false,
                          );
                          end();
                        },
                      })
                    }
                  >
                    تغيير كلمة المرور
                  </button>
                </div>
                <hr />
                <h3>النسخ الاحتياطي</h3>
                <p className="muted">
                  ملف مستقل لبيانات المحاسبة. احتفظ بنسخة في مكان آمن خارج
                  الجهاز.
                </p>
                <div className="a-row-actions">
                  <button disabled={busy} onClick={() => invoke(backup)}>
                    إنشاء نسخة احتياطية
                  </button>
                  <button disabled={busy} onClick={restore}>
                    استعادة نسخة
                  </button>
                </div>
              </section>
              <LicensePanel />
              <section className="a-support">
                <h3>دعم Xzare</h3>
                <a href="mailto:hello@xzare.com">hello@xzare.com</a>
                <a
                  href="https://wa.me/201501230440"
                  target="_blank"
                  rel="noreferrer"
                  dir="ltr"
                >
                  +201501230440
                </a>
                <small>
                  نسخة المحاسبة 0.1 · شركة واحدة · عملة EGP · دفاتر محلية.
                </small>
              </section>
            </div>
          )}
          <div className="a-print-footer">
            {state.businessName} · Xzare Accounting · {from} إلى {to} · EGP
          </div>
        </div>
      </main>
      {form && (
        <Modal
          title={form.title}
          onClose={() => {
            setForm(null);
            setError("");
          }}
          busy={busy}
          error={error}
          submit={form.button}
          onSubmit={(e) => {
            const f = new FormData(e.currentTarget);
            invoke(() => form.submit(f));
          }}
        >
          {form.body}
        </Modal>
      )}
      {editor && (
        <DraftEditor
          key={typeof editor === "string" ? "new" : editor.id}
          accounts={state.accounts}
          journal={typeof editor === "string" ? undefined : editor}
          busy={busy}
          error={error}
          onClose={() => {
            setEditor(null);
            setError("");
          }}
          onSave={(v) =>
            invoke(async () => {
              await run(
                "accounting.journal.save",
                v as Record<string, unknown>,
              );
              setEditor(null);
            })
          }
        />
      )}
      {detail && (
        <Modal
          title={detail.number ?? "تفاصيل المسودة"}
          onSubmit={
            manager &&
            detail.status === "posted" &&
            !detail.reverseOf &&
            !state.journals.some((j) => j.reverseOf === detail.id)
              ? () => {
                  setDetail(null);
                  reverse(detail);
                }
              : undefined
          }
          submit="عكس هذا القيد"
          busy={busy}
          error=""
          onClose={() => setDetail(null)}
        >
          <p>
            <b>{detail.memo}</b>
            <br />
            {detail.date} · {statuses[detail.status]}
          </p>
          {detail.reverseOf && (
            <small>
              عكس القيد:{" "}
              {state.journals.find((j) => j.id === detail.reverseOf)?.number ??
                detail.reverseOf}
            </small>
          )}
          <div className="a-scroll">
            <table>
              <thead>
                <tr>
                  <th>الحساب</th>
                  <th>مدين</th>
                  <th>دائن</th>
                  <th>ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l, i) => (
                  <tr key={i}>
                    <td>
                      {state.accounts.find((a) => a.id === l.accountId)?.name ??
                        l.accountId}
                    </td>
                    <td className="a-num">{amount(l.debit)}</td>
                    <td className="a-num">{amount(l.credit)}</td>
                    <td>{l.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="a-balance">
            <span>
              الإجمالي المدين <b>{amount(detail.total)}</b>
            </span>
            <span>
              الإجمالي الدائن <b>{amount(detail.total)}</b>
            </span>
          </div>
        </Modal>
      )}
    </div>
  );
}
