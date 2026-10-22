import { useEffect, useRef, useState, type ReactNode } from "react";
import { ulid } from "@xzare/core";
import type {
  Product,
  User,
  Inventory,
  InventoryBalance,
  InventoryDocument,
} from "@xzare/engine";
import { AuthScreen, type AuthValues } from "../../pos/src/AuthScreen";
import { BrandMark } from "../../pos/src/BrandMark";
import { Icon } from "../../pos/src/Icon";
import { LicensePanel } from "../../pos/src/LicensePanel";
import { WorkspaceClock } from "../../pos/src/WorkspaceClock";
import { ProductBarcode } from "../../pos/src/ProductBarcode";
import { Label } from "../../pos/src/Label";
import { call } from "../../pos/src/bridge";
import { useSessionActivity } from "../../pos/src/useSessionActivity";
import {
  Modal,
  Field,
  Empty,
  amount,
  decimal,
  today,
  csv,
  download,
} from "./ui";
import { DocumentEditor } from "./DocumentEditor";
import { kinds, qty, readMoney, readQty, type State } from "./model";
const pages = {
  overview: "نظرة عامة",
  products: "الأصناف والباركود",
  warehouses: "المستودعات",
  documents: "حركات المخزون",
  count: "الجرد",
  tracking: "التشغيلات والتسلسل",
  reports: "التقارير",
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
  manager: "مدير مخازن",
  cashier: "عرض وتقارير",
  kitchen: "غير مستخدم",
};
export function App() {
  const [configured, setConfigured] = useState<boolean | null>(null),
    [state, setState] = useState<State | null>(null),
    [view, setView] = useState<View>("overview"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [form, setForm] = useState<Form | null>(null),
    [editor, setEditor] = useState<keyof typeof kinds | null>(null),
    [detail, setDetail] = useState<ReturnType<Inventory["get"]> | null>(null),
    [label, setLabel] = useState<Product | null>(null),
    [search, setSearch] = useState(""),
    [warehouse, setWarehouse] = useState(""),
    [from, setFrom] = useState(today().slice(0, 4) + "-01-01"),
    [to, setTo] = useState(today()),
    [report, setReport] = useState<ReturnType<Inventory["report"]> | null>(
      null,
    );
  const mutex = useRef(false),
    requests = useRef(new Map<string, string>()),
    generation = useRef(0),
    loadSeq = useRef(0);
  const end = () => {
    generation.current++;
    setState(null);
    setEditor(null);
    setForm(null);
    setLabel(null);
    setDetail(null);
    setReport(null);
    setView("overview");
    requests.current.clear();
    setError("");
    setNotice("");
  };
  useSessionActivity(!!state, end);
  async function load() {
    const g = generation.current,
      n = ++loadSeq.current;
    const s = await call<State>("inventory.state");
    if (g === generation.current && n === loadSeq.current) setState(s);
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
    if (!state || view !== "reports") return;
    let live = true;
    setReport(null);
    void call<ReturnType<Inventory["report"]>>("inventory.report", {
      from,
      to,
      ...(warehouse ? { warehouseId: warehouse } : {}),
    })
      .then((r) => {
        if (live) setReport(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [view, from, to, warehouse, state]);
  const invoke = (f: () => Promise<unknown>) => {
    void f().catch((e) =>
      setError(e instanceof Error ? e.message : "تعذر إتمام العملية"),
    );
  };
  async function run(
    action: string,
    payload: Record<string, unknown> = {},
    command = action.startsWith("inventory."),
  ) {
    if (mutex.current) throw new Error("انتظر انتهاء العملية");
    mutex.current = true;
    setBusy(true);
    setError("");
    setNotice("");
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
        setError("تم الحفظ؛ اضغط تحديث لقراءة الرصيد.");
      }
      return value;
    } catch (e) {
      const m = e instanceof Error ? e.message : "تعذر إتمام العملية";
      setError(m);
      if (/انتهت الجلسة|سجّل الدخول/.test(m)) end();
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
    setWarehouse("");
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
      await call(
        configured ? "login" : "setup",
        configured ? { username: v.username, password: v.password } : v,
      );
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
        product="inventory"
        configured={configured}
        busy={busy}
        error={error}
        onAuthenticate={authenticate}
      />
    );
  function productForm(p?: Product) {
    saveForm(
      p ? "تعديل الصنف" : "صنف جديد",
      <>
        <div className="a-form-row">
          <Field label="اسم الصنف">
            <input
              name="name"
              required
              maxLength={160}
              defaultValue={p?.name ?? ""}
            />
          </Field>
          <Field label="كود الصنف SKU">
            <input
              name="sku"
              required
              maxLength={64}
              defaultValue={p?.sku ?? ""}
              dir="ltr"
            />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="الوحدة">
            <input
              name="unit"
              required
              maxLength={30}
              defaultValue={p?.unit ?? ""}
            />
          </Field>
          <Field label="المجموعة">
            <input
              name="category"
              maxLength={100}
              defaultValue={p?.category ?? ""}
            />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="سعر مرجعي · ج.م">
            <input
              name="price"
              required
              inputMode="decimal"
              defaultValue={decimal(p?.price ?? 0)}
              dir="ltr"
            />
          </Field>
          <Field label="حد إعادة الطلب">
            <input
              name="reorderQty"
              required
              inputMode="decimal"
              defaultValue={qty(p?.reorder_qty ?? 0)}
              dir="ltr"
            />
          </Field>
        </div>
        <ProductBarcode product={p} open={productForm} />
        <label className="a-check">
          <input
            name="active"
            type="checkbox"
            defaultChecked={p ? !!p.active : true}
          />
          صنف نشط
        </label>
      </>,
      "product.save",
      (f) => ({
        ...(p && { id: p.id }),
        name: String(f.get("name")),
        sku: String(f.get("sku")),
        unit: String(f.get("unit")),
        category: String(f.get("category")),
        price: readMoney(f.get("price")),
        reorderQty: readQty(f.get("reorderQty")),
        barcode: String(f.get("barcode") ?? ""),
        format: String(f.get("format") ?? "CODE128"),
        active: f.has("active"),
      }),
    );
  }
  function warehouseForm(w?: { id: string; name: string }) {
    saveForm(
      w ? "تعديل المخزن" : "مخزن جديد",
      <Field label="اسم المخزن">
        <input
          name="name"
          required
          maxLength={160}
          defaultValue={w?.name ?? ""}
        />
      </Field>,
      "inventory.warehouse.save",
      (f) => ({ ...(w && { id: w.id }), name: String(f.get("name")) }),
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
            <option value="cashier">عرض المخزون: عرض وتقارير فقط</option>
            <option value="manager">مدير مخازن: إدارة المخازن والحركات</option>
            <option value="admin">
              مسؤول النظام: إدارة المستخدمين والإعدادات
            </option>
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
          v.fileName ?? "Xzare-Inventory.xzbak",
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
            أولًا. تُقبل نسخ المخازن المطابقة فقط.
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

  const warehouseName = (id: string | null) =>
    state.warehouses.find((w) => w.id === id)?.name ?? "—";
  const match = (s: string) =>
    s.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  const balances = state.balances.filter(
    (b) =>
      (!warehouse || b.warehouseId === warehouse) &&
      match([b.name, b.sku, b.batch, b.serial].join(" ")),
  );
  const products = state.products.filter((p) =>
    match([p.name, p.sku, p.barcode].join(" ")),
  );
  const documents = state.documents.filter(
    (d) =>
      (!warehouse ||
        d.warehouseId === warehouse ||
        d.destinationId === warehouse) &&
      match(d.number + " " + d.note),
  );
  const low = state.products.filter((p) => p.active && p.qty <= p.reorder_qty);
  const expiring = state.balances.filter(
    (b) =>
      b.qty > 0 &&
      b.expiry &&
      b.expiry <=
        new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  );
  const balanceTable = (xs: InventoryBalance[]) => (
    <section className="a-sheet a-scroll">
      <table>
        <thead>
          <tr>
            <th>الصنف / الكود</th>
            <th>المخزن</th>
            <th>التشغيلة / التسلسل</th>
            <th>الصلاحية</th>
            <th>الرصيد</th>
            <th>القيمة · ج.م</th>
          </tr>
        </thead>
        <tbody>
          {xs.map((b) => (
            <tr key={b.lotId + b.warehouseId}>
              <td>
                <b>{b.name}</b>
                <small dir="ltr">{b.sku}</small>
              </td>
              <td>{warehouseName(b.warehouseId)}</td>
              <td className="i-batch">
                {b.batch || "—"}
                <small>{b.serial || ""}</small>
              </td>
              <td>
                {b.expiry ? (
                  <span className={b.expiry < today() ? "i-warn" : ""}>
                    {b.expiry}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="a-num">
                {qty(b.qty)} {b.unit}
              </td>
              <td className="a-num">{amount(b.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!xs.length && (
        <Empty>لا توجد أرصدة مطابقة. أضف صنفًا ثم سجّل مستند استلام.</Empty>
      )}
    </section>
  );
  const documentTable = (xs: InventoryDocument[]) => (
    <section className="a-sheet a-scroll">
      <table>
        <thead>
          <tr>
            <th>رقم المستند / التوقيت</th>
            <th>الحركة</th>
            <th>المخزن</th>
            <th>الوجهة</th>
            <th>المرجع</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {xs.map((d) => (
            <tr key={d.id}>
              <td>
                <b dir="ltr">{d.number}</b>
                <small>{new Date(d.at).toLocaleString("ar-EG")}</small>
              </td>
              <td>
                <span className="a-tag posted">{kinds[d.kind]}</span>
              </td>
              <td>{warehouseName(d.warehouseId)}</td>
              <td>{warehouseName(d.destinationId)}</td>
              <td>{d.note}</td>
              <td>
                <button
                  disabled={busy}
                  onClick={() =>
                    invoke(async () => {
                      try {
                        setDetail(
                          await call("inventory.document.get", { id: d.id }),
                        );
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : "تعذر قراءة المستند",
                        );
                      }
                    })
                  }
                >
                  عرض
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!xs.length && (
        <Empty>ستظهر هنا مستنداتك المعتمدة. ابدأ بتسجيل الاستلام الفعلي.</Empty>
      )}
    </section>
  );
  function exportBalances() {
    csv("Xzare-Inventory-Balances.csv", [
      [state!.settings.businessName, "EGP", today()],
      [
        "الصنف",
        "SKU",
        "المخزن",
        "التشغيلة",
        "التسلسل",
        "الصلاحية",
        "الكمية",
        "الوحدة",
        "القيمة",
      ],
      ...balances.map((b) => [
        b.name,
        b.sku,
        warehouseName(b.warehouseId),
        b.batch,
        b.serial,
        b.expiry,
        qty(b.qty),
        b.unit,
        decimal(b.cost),
      ]),
    ]);
  }
  return (
    <div className={"a-app i-app" + (label ? " i-print-label" : "")}>
      <aside className="a-sidebar">
        <div className="a-wordmark">
          <BrandMark />
          <div>
            <b>XZARE</b>
            <small>INVENTORY</small>
          </div>
        </div>
        <div className="a-company">
          {state.settings.businessName}
          <small>مساحة إدارة مخازنك</small>
        </div>
        <nav aria-label="أقسام البرنامج">
          {Object.entries(pages)
            .filter(
              ([v]) => admin || !["users", "audit", "settings"].includes(v),
            )
            .map(([v, title]) => (
              <button
                key={v}
                className={view === v ? "active" : ""}
                onClick={() => navigate(v as View)}
              >
                <Icon
                  name={
                    v === "overview"
                      ? "dashboard"
                      : v === "products"
                        ? "barcode"
                        : v === "reports"
                          ? "reports"
                          : v === "settings"
                            ? "settings"
                            : "products"
                  }
                />
                {title}
              </button>
            ))}
        </nav>
        <div className="a-sidebar-foot">
          <small>
            {roles[state.user.role]} · {state.user.name}
          </small>
          <span>XZARE INVENTORY · 0.1.0</span>
        </div>
      </aside>
      <main className="a-workspace">
        <header className="a-topbar">
          <div>
            <b>{state.user.name}</b>
            <span> · {roles[state.user.role]}</span>
          </div>
          <div className="a-top-actions">
            <WorkspaceClock english={false} />
            <button
              disabled={busy}
              onClick={() =>
                invoke(async () => {
                  try {
                    await load();
                    setNotice("تم تحديث الرصيد");
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "تعذر التحديث");
                  }
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
              خروج
            </button>
          </div>
        </header>
        <div className="a-content">
          <div className="a-heading">
            <div>
              <span className="eyebrow">XZARE / WAREHOUSE OPERATIONS</span>
              <h1>{pages[view]}</h1>
              <p>
                {view === "overview"
                  ? "كل صنف في مكانه. حركة موثقة ورصيد من عملياتك الفعلية."
                  : view === "count"
                    ? "عدّ المخزون الفعلي، ثم اعتمد الفرق مع توثيق السبب."
                    : view === "tracking"
                      ? "تتبّع التشغيلات والأرقام التسلسلية والصلاحية في كل مخزن."
                      : "بياناتك محفوظة محليًا، والصلاحيات تنظم كل عملية."}
              </p>
            </div>
            <div className="a-heading-actions">
              {manager && view === "products" && (
                <button className="primary" onClick={() => productForm()}>
                  + صنف جديد
                </button>
              )}
              {manager && view === "warehouses" && (
                <button className="primary" onClick={() => warehouseForm()}>
                  + مخزن جديد
                </button>
              )}
              {manager && view === "users" && (
                <button className="primary" onClick={() => userForm()}>
                  + مستخدم جديد
                </button>
              )}
              {manager && view === "count" && (
                <button className="primary" onClick={() => setEditor("count")}>
                  بدء الجرد
                </button>
              )}
              {["tracking", "count", "reports"].includes(view) && (
                <button onClick={exportBalances}>تصدير الأرصدة CSV</button>
              )}
            </div>
          </div>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <div className="a-notice" role="status">
              {notice}
              <button onClick={() => setNotice("")} aria-label="إغلاق الإشعار">
                ×
              </button>
            </div>
          )}
          {["overview", "documents"].includes(view) && manager && (
            <div className="i-route">
              {Object.entries(kinds).map(([k, n]) => (
                <button
                  key={k}
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setEditor(k as keyof typeof kinds);
                  }}
                >
                  <b>{n}</b>
                  <span>
                    {k === "receipt"
                      ? "إضافة مخزون بتكلفته"
                      : k === "issue"
                        ? "تسليم من المخزن"
                        : k === "transfer"
                          ? "نقل بين المستودعات"
                          : "مراجعة الكمية الفعلية"}
                  </span>
                </button>
              ))}
            </div>
          )}
          {["products", "documents", "tracking", "count", "reports"].includes(
            view,
          ) && (
            <div className="a-filter">
              <Field label="بحث">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="اسم، كود، تشغيلة أو تسلسل"
                />
              </Field>
              {view !== "products" && (
                <Field label="المخزن">
                  <select
                    value={warehouse}
                    onChange={(e) => setWarehouse(e.target.value)}
                  >
                    <option value="">كل المخازن</option>
                    {state.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {view === "reports" && (
                <>
                  <Field label="من">
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </Field>
                  <Field label="إلى">
                    <input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </Field>
                  <button
                    onClick={() => {
                      if (report)
                        csv("Xzare-Inventory-Movements.csv", [
                          [
                            "المستند",
                            "الحركة",
                            "الصنف",
                            "المخزن",
                            "الكمية",
                            "القيمة",
                            "التشغيلة",
                            "التسلسل",
                            "المرجع",
                          ],
                          ...report.rows
                            .filter((r) =>
                              match(
                                r.name +
                                  " " +
                                  r.sku +
                                  " " +
                                  r.batch +
                                  " " +
                                  r.serial,
                              ),
                            )
                            .map((r) => [
                              r.number,
                              kinds[r.kind as keyof typeof kinds],
                              r.name,
                              r.warehouse,
                              qty(r.qty),
                              decimal(r.cost),
                              r.batch,
                              r.serial,
                              r.note,
                            ]),
                        ]);
                    }}
                    disabled={!report}
                  >
                    تصدير الحركات
                  </button>
                </>
              )}
              <button onClick={() => window.print()}>طباعة / PDF</button>
            </div>
          )}
          {view === "overview" && (
            <>
              {!state.products.length && (
                <div className="a-start">
                  <div>
                    <h2>ابدأ بمخزونك الفعلي</h2>
                    <p>
                      أضف الأصناف بباركودها، جهّز مخازنك، ثم سجّل أول استلام. كل
                      الأرصدة تبدأ من صفر.
                    </p>
                  </div>
                  {manager && (
                    <div>
                      <button onClick={() => productForm()}>
                        إضافة أول صنف
                      </button>
                      <button onClick={() => warehouseForm()}>
                        إضافة مخزن
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div className="a-stats">
                <div>
                  <span>أصناف مسجلة</span>
                  <strong>{state.products.length}</strong>
                </div>
                <div>
                  <span>المستودعات</span>
                  <strong>{state.warehouses.length}</strong>
                </div>
                <div>
                  <span>قيمة المخزون · ج.م</span>
                  <strong>
                    {amount(state.balances.reduce((n, b) => n + b.cost, 0))}
                  </strong>
                </div>
                <div>
                  <span>عند حد إعادة الطلب</span>
                  <strong>{low.length}</strong>
                </div>
              </div>
              <div className="a-reconcile">
                <b className={state.reconciled ? "a-ok" : "a-warn"}>
                  {state.reconciled
                    ? "✓ أرصدة المخازن تطابق سجل الحركة"
                    : "يلزم مراجعة اختلاف الأرصدة"}
                </b>
                <span>
                  {expiring.length} رصيد يقترب من انتهاء الصلاحية أو انتهت
                  صلاحيته
                </span>
              </div>
              <div className="a-section-title">
                <h2>آخر الحركات</h2>
                <button onClick={() => navigate("documents")}>
                  عرض سجل الحركة
                </button>
              </div>
              {documentTable(state.documents.slice(0, 6))}
              {expiring.length > 0 && (
                <>
                  <div className="a-section-title">
                    <h2>مراجعة الصلاحية</h2>
                  </div>
                  {balanceTable(expiring)}
                </>
              )}
            </>
          )}
          {view === "products" && (
            <section className="a-sheet a-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الصنف / SKU</th>
                    <th>الباركود</th>
                    <th>المجموعة</th>
                    <th>الرصيد في كل المخازن</th>
                    <th>القيمة · ج.م</th>
                    <th>الحالة</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <b>{p.name}</b>
                        <small dir="ltr">{p.sku}</small>
                      </td>
                      <td dir="ltr">{p.barcode || "لم يُسجل"}</td>
                      <td>{p.category || "—"}</td>
                      <td className="a-num">
                        {qty(p.qty)} {p.unit}
                        {p.active && p.qty <= p.reorder_qty && (
                          <small className="a-warn">يحتاج إعادة طلب</small>
                        )}
                      </td>
                      <td className="a-num">{amount(p.cost)}</td>
                      <td>{p.active ? "نشط" : "موقوف"}</td>
                      <td>
                        <div className="a-row-actions">
                          {manager && (
                            <button onClick={() => productForm(p)}>
                              تعديل
                            </button>
                          )}
                          {p.barcode && (
                            <button onClick={() => setLabel(p)}>
                              ملصق الباركود
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!products.length && (
                <Empty>
                  سجّل الأصناف بالاسم والكود والباركود، ثم أضف مخزونها من
                  الاستلام.
                </Empty>
              )}
            </section>
          )}
          {view === "warehouses" && (
            <section className="a-sheet a-scroll">
              <table>
                <thead>
                  <tr>
                    <th>المخزن</th>
                    <th>أصناف لها رصيد</th>
                    <th>قيمة المخزون · ج.م</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {state.warehouses.map((w) => {
                    const bs = state.balances.filter(
                      (b) => b.warehouseId === w.id && b.qty > 0,
                    );
                    return (
                      <tr key={w.id}>
                        <td>
                          <b>{w.name}</b>
                        </td>
                        <td>{new Set(bs.map((b) => b.variantId)).size}</td>
                        <td className="a-num">
                          {amount(bs.reduce((n, b) => n + b.cost, 0))}
                        </td>
                        <td>
                          {manager && (
                            <button onClick={() => warehouseForm(w)}>
                              تعديل الاسم
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}
          {view === "documents" && (
            <>
              {documentTable(documents)}
              <p className="a-footnote">
                آخر ١٠٠٠ مستند. التقرير يشمل كل الحركات ضمن الفترة المحددة.
              </p>
            </>
          )}
          {["tracking", "count"].includes(view) && balanceTable(balances)}
          {view === "reports" && (
            <>
              <div className="a-section-title">
                <h2>الأرصدة الحالية</h2>
                <span>كما في {today()}</span>
              </div>
              {balanceTable(balances)}
              <div className="a-section-title">
                <h2>حركة المخزون خلال الفترة</h2>
                <span>
                  {from} — {to}
                </span>
              </div>
              <section className="a-sheet a-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>المستند / الحركة</th>
                      <th>الصنف</th>
                      <th>المخزن</th>
                      <th>الكمية</th>
                      <th>القيمة · ج.م</th>
                      <th>التشغيلة / التسلسل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report?.rows
                      .filter((r) =>
                        match(
                          r.name + " " + r.sku + " " + r.batch + " " + r.serial,
                        ),
                      )
                      .map((r, i) => (
                        <tr key={i}>
                          <td>
                            <b dir="ltr">{r.number}</b>
                            <small>
                              {kinds[r.kind as keyof typeof kinds]} ·{" "}
                              {new Date(r.at).toLocaleDateString("ar-EG")}
                            </small>
                          </td>
                          <td>{r.name}</td>
                          <td>{r.warehouse}</td>
                          <td className="a-num">{qty(r.qty)}</td>
                          <td className="a-num">{amount(r.cost)}</td>
                          <td className="i-batch">
                            {r.batch || "—"} / {r.serial || "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!report?.rows.length && (
                  <Empty>
                    {report
                      ? "لا توجد حركات خلال هذه الفترة."
                      : "جارٍ قراءة سجل المخزون…"}
                  </Empty>
                )}
              </section>
            </>
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
                <p>{state.settings.businessName}</p>
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
                              defaultValue={state.settings.businessName}
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
                  ملف مستقل لبيانات المخازن. احتفظ بنسخة في مكان آمن خارج
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
                  نسخة المخازن 0.1 · شركة واحدة · عملة EGP · مخازن محلية.
                </small>
              </section>
            </div>
          )}

          <div className="a-print-footer">
            {state.settings.businessName} · Xzare Inventory · {today()} · EGP
          </div>
        </div>
      </main>
      {form && (
        <Modal
          title={form.title}
          busy={busy}
          error={error}
          submit={form.button}
          onClose={() => {
            setForm(null);
            setError("");
          }}
          onSubmit={(e) =>
            invoke(() => form.submit(new FormData(e.currentTarget)))
          }
        >
          {form.body}
        </Modal>
      )}
      {editor && (
        <DocumentEditor
          key={editor}
          kind={editor}
          state={state}
          busy={busy}
          error={error}
          onClose={() => {
            setEditor(null);
            setError("");
          }}
          onSave={async (p) => {
            await run("inventory.document.post", p);
            setEditor(null);
          }}
        />
      )}
      {detail && (
        <Modal
          title={"المستند " + detail.document.number}
          busy={false}
          error=""
          onClose={() => setDetail(null)}
        >
          <p>
            {kinds[detail.document.kind]} · {detail.document.note}
          </p>
          <section className="a-sheet a-scroll">
            <table>
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th>المخزن</th>
                  <th>الكمية</th>
                  <th>القيمة</th>
                  <th>التشغيلة / التسلسل</th>
                </tr>
              </thead>
              <tbody>
                {detail.entries.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td>{r.warehouse}</td>
                    <td>{qty(r.qty)}</td>
                    <td>{amount(r.cost)}</td>
                    <td>
                      {r.batch || "—"} / {r.serial || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {detail.observations.length > 0 && (
            <section className="a-sheet a-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الصنف المعدود</th>
                    <th>الرصيد المتوقع</th>
                    <th>الكمية الفعلية</th>
                    <th>الفرق</th>
                    <th>التشغيلة / التسلسل</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.observations.map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td>{qty(r.expectedQty)}</td>
                      <td>{qty(r.actualQty)}</td>
                      <td>{qty(r.difference)}</td>
                      <td>
                        {r.batch || "—"} / {r.serial || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <p className="muted">
            كل تغيير موثق بحركة جديدة. أصل المستند يظل محفوظًا.
          </p>
        </Modal>
      )}
      {label && (
        <Modal
          title="ملصق الباركود"
          busy={false}
          error=""
          onClose={() => setLabel(null)}
        >
          <Label product={label} />
          <button type="button" onClick={() => window.print()}>
            طباعة الملصق
          </button>
        </Modal>
      )}
    </div>
  );
}
