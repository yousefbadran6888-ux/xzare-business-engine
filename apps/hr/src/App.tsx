import { useEffect, useRef, useState, type ReactNode } from "react";
import { ulid } from "@xzare/core";
import type {
  HrState,
  HrEmployee,
  HrShift,
  HrRoster,
  HrAttendance,
  HrLeave,
  HrEvaluation,
  HrPeriod,
  HrPayrollDetail,
  User,
} from "@xzare/engine";
import { call } from "../../pos/src/bridge";
import { useSessionActivity } from "../../pos/src/useSessionActivity";
import { LicensePanel } from "../../pos/src/LicensePanel";
import { WorkspaceClock } from "../../pos/src/WorkspaceClock";
import { AuthScreen, type AuthValues } from "./AuthScreen";
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
import {
  readMoney,
  clock,
  minutes,
  dayOffset,
  stamp,
  roles,
  leaveLabels,
  payrollLabels,
} from "./model";
import { PayrollEditor, PayrollDetail } from "./Payroll";
import { commitThenRefresh } from "./commit-refresh";
import { exclusive } from "./exclusive";
const pages = {
  overview: "يوم العمل",
  employees: "الموظفون",
  roster: "الورديات والحضور",
  leave: "الإجازات",
  evaluations: "التقييمات",
  payroll: "الرواتب",
  teacher: "غير متاح في هذا المنتج",
  trainer: "غير متاح في هذا المنتج",
  stylist: "غير متاح في هذا المنتج",
  reports: "تقارير الحضور",
  users: "المستخدمون",
  audit: "سجل التدقيق",
  settings: "الإعدادات والترخيص",
};
type View = keyof typeof pages;
type Form = {
  title: string;
  body: ReactNode;
  action: string;
  payload: (f: FormData) => Record<string, unknown>;
  submit?: string;
};
const text = (f: FormData, k: string) => String(f.get(k) ?? "");
const number = (f: FormData, k: string) => Number(f.get(k));
export function App() {
  const [configured, setConfigured] = useState<boolean | null>(null),
    [s, setState] = useState<HrState | null>(null),
    [view, setView] = useState<View>("overview"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState(""),
    [form, setForm] = useState<Form | null>(null),
    [detail, setDetail] = useState<HrPayrollDetail | null>(null),
    [compose, setCompose] = useState(false),
    [day, setDay] = useState(today()),
    [from, setFrom] = useState(today().slice(0, 7) + "-01"),
    [to, setTo] = useState(today()),
    [period, setPeriod] = useState<HrPeriod | null>(null),
    [shiftModal, setShiftModal] = useState(false),
    [leaveYear, setLeaveYear] = useState(Number(today().slice(0, 4))),
    [balances, setBalances] = useState<HrState["leaveBalances"]>([]);
  const mutex = useRef(false),
    generation = useRef(0),
    loadSeq = useRef(0),
    requests = useRef(new Map<string, string>());
  const end = () => {
    generation.current++;
    setState(null);
    setForm(null);
    setDetail(null);
    setCompose(false);
    setPeriod(null);
    setView("overview");
    setQuery("");
    setError("");
    setNotice("");
    requests.current.clear();
  };
  const authError = (m: string) => {
    if (/انتهت الجلسة|سجّل الدخول/.test(m)) {
      end();
      setError(m);
    }
  };
  useSessionActivity(!!s, end);
  async function load() {
    const g = generation.current,
      n = ++loadSeq.current,
      v = await call<HrState>("hr.state");
    if (g === generation.current && n === loadSeq.current) setState(v);
  }
  useEffect(() => {
    void call<{ configured: boolean }>("auth.status")
      .then((r) => {
        setConfigured(r.configured);
        if (r.configured) void load().catch(() => {});
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!s) return;
    const id = setInterval(() => {
      if (!mutex.current)
        void load().catch((e) => {
          setError(e.message);
          authError(e.message);
        });
    }, 15000);
    return () => clearInterval(id);
  }, [s?.user.id]);
  useEffect(() => {
    if (
      !s ||
      !["roster", "reports", "leave"].includes(view) ||
      !["admin", "manager", "hr"].includes(s.user.role)
    )
      return;
    let live = true;
    setPeriod(null);
    void call<HrPeriod>(
      "hr.period",
      view === "roster" ? { from: day, to: dayOffset(day, 6) } : { from, to },
    )
      .then((v) => {
        if (live) setPeriod(v);
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          authError(e.message);
        }
      });
    return () => {
      live = false;
    };
  }, [view, day, from, to, s]);
  useEffect(() => {
    if (!s || view !== "leave") return;
    let live = true;
    setBalances([]);
    void call<HrState["leaveBalances"]>("hr.leave.balances", {
      year: leaveYear,
    })
      .then((v) => {
        if (live) setBalances(v);
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          authError(e.message);
        }
      });
    return () => {
      live = false;
    };
  }, [view, leaveYear, s]);
  const invoke = (f: () => Promise<unknown>) => {
    void f().catch((e) => {
      const m = e instanceof Error ? e.message : "تعذر إتمام العملية";
      setError(m);
      authError(m);
    });
  };
  async function run(a: string, p: Record<string, unknown> = {}) {
    if (mutex.current) throw new Error("انتظر انتهاء العملية");
    const g = generation.current,
      key = JSON.stringify([a, p]),
      command = a.startsWith("hr.");
    mutex.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (command && !requests.current.has(key))
        requests.current.set(key, ulid());
      const r = await call<{ id: string }>(
        a,
        command ? { ...p, clientTxnId: requests.current.get(key) } : p,
      );
      if (g !== generation.current)
        throw new Error("انتهت الجلسة؛ سجّل الدخول مرة أخرى");
      requests.current.delete(key);
      setNotice("تم حفظ العملية");
      try {
        await load();
      } catch (e) {
        const m = e instanceof Error ? e.message : "";
        authError(m);
        setError("تم الحفظ؛ حدّث العرض لقراءة البيانات الجديدة");
      }
      return r;
    } catch (e) {
      const m = e instanceof Error ? e.message : "تعذر الحفظ";
      setError(m);
      authError(m);
      throw e;
    } finally {
      mutex.current = false;
      setBusy(false);
    }
  }
  const saveForm = (
    title: string,
    body: ReactNode,
    action: string,
    payload: Form["payload"],
    submit?: string,
  ) => {
    setError("");
    setForm({ title, body, action, payload, submit });
  };
  const openPayroll = async (id: string) => {
    const g = generation.current,
      v = await call<HrPayrollDetail>("hr.payroll.get", { id });
    if (g === generation.current) {
      setDetail(v);
      setError("");
    }
  };
  async function authenticate(v: AuthValues) {
    if (mutex.current) return;
    mutex.current = true;
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
      setError(e instanceof Error ? e.message : "تعذر الدخول");
      throw e;
    } finally {
      mutex.current = false;
      setBusy(false);
    }
  }
  if (!s)
    return (
      <AuthScreen
        configured={configured}
        busy={busy}
        error={error}
        onAuthenticate={authenticate}
      />
    );
  const operations = ["admin", "manager", "hr"].includes(s.user.role),
    finance = ["admin", "manager", "payroll"].includes(s.user.role),
    admin = s.user.role === "admin",
    name = (id: string) => s.employees.find((x) => x.id === id)?.name ?? "موظف",
    chosen = s.employees.filter((e) =>
      (e.name + " " + e.code + " " + e.department + " " + e.job).includes(
        query,
      ),
    ),
    week = Array.from({ length: 7 }, (_, i) => dayOffset(day, i));
  const employeeOptions = (selected?: string) => (
    <Field label="الموظف">
      <select name="employeeId" required defaultValue={selected ?? ""}>
        <option value="">اختر موظفًا</option>
        {s.employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} · {e.code}
          </option>
        ))}
      </select>
    </Field>
  );
  function employeeEditor(e?: HrEmployee) {
    saveForm(
      e ? "تعديل ملف الموظف" : "إضافة موظف",
      <>
        <div className="a-form-row">
          <Field label="كود الموظف">
            <input
              name="code"
              required
              maxLength={160}
              defaultValue={e?.code}
            />
          </Field>
          <Field label="اسم الموظف">
            <input
              name="name"
              required
              maxLength={160}
              defaultValue={e?.name}
            />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="القسم">
            <input
              name="department"
              maxLength={160}
              defaultValue={e?.department}
            />
          </Field>
          <Field label="الوظيفة">
            <input name="job" maxLength={160} defaultValue={e?.job} />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="الهاتف">
            <input
              name="phone"
              dir="ltr"
              maxLength={40}
              defaultValue={e?.phone}
            />
          </Field>
          <Field label="البريد الإلكتروني">
            <input
              name="email"
              type="email"
              maxLength={200}
              defaultValue={e?.email}
            />
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="تاريخ التعيين">
            <input
              name="hired"
              type="date"
              required
              defaultValue={e?.hired ?? s!.today}
            />
          </Field>
          <Field label="آخر يوم عمل، اختياري">
            <input name="ended" type="date" defaultValue={e?.ended} />
          </Field>
        </div>
        <Field label="ملاحظات شؤون الموظفين">
          <textarea name="note" maxLength={1500} defaultValue={e?.note} />
        </Field>
        <label className="a-check">
          <input
            name="active"
            type="checkbox"
            defaultChecked={e ? !!e.active : true}
          />
          ملف نشط
        </label>
      </>,
      "hr.employee.save",
      (f) => ({
        ...(e ? { id: e.id, version: e.version } : {}),
        code: text(f, "code"),
        name: text(f, "name"),
        department: text(f, "department"),
        job: text(f, "job"),
        phone: text(f, "phone"),
        email: text(f, "email"),
        hired: text(f, "hired"),
        ended: text(f, "ended"),
        active: f.get("active") === "on",
        note: text(f, "note"),
      }),
    );
  }
  function salaryEditor(e: HrEmployee) {
    const v = s!.salaries.find((x) => x.employeeId === e.id);
    saveForm(
      "أساس الراتب — " + e.name,
      <>
        <p>مبلغ شهري متفق عليه. لا يُحوّل الحضور إلى خصومات تلقائيًا.</p>
        <Field label="أساس الراتب الشهري، ج.م">
          <input
            name="base"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={v ? decimal(v.base) : ""}
          />
        </Field>
        <Field label="سبب التسجيل أو التعديل">
          <textarea name="reason" required maxLength={1500} />
        </Field>
      </>,
      "hr.salary.save",
      (f) => ({
        employeeId: e.id,
        version: v?.version ?? 0,
        base: readMoney(f.get("base")),
        reason: text(f, "reason"),
      }),
    );
  }
  function shiftEditor(x?: HrShift) {
    setShiftModal(false);
    saveForm(
      x ? "تعديل الوردية" : "وردية جديدة",
      <>
        <Field label="اسم الوردية">
          <input name="name" required maxLength={160} defaultValue={x?.name} />
        </Field>
        <div className="a-form-row">
          <Field label="بداية الوردية">
            <input
              name="start"
              type="time"
              required
              defaultValue={x ? clock(x.start) : ""}
            />
          </Field>
          <Field label="نهاية الوردية">
            <input
              name="end"
              type="time"
              required
              defaultValue={x ? clock(x.end).slice(0, 5) : ""}
            />
          </Field>
        </div>
        <p className="muted">
          النهاية قبل البداية تعني وردية تمتد لليوم التالي.
        </p>
        <div className="a-form-row">
          <Field label="دقائق الراحة">
            <input
              name="breakMinutes"
              type="number"
              min="0"
              max="1439"
              required
              defaultValue={x?.breakMinutes ?? 0}
            />
          </Field>
          <Field label="دقائق سماح التأخير">
            <input
              name="graceMinutes"
              type="number"
              min="0"
              max="120"
              required
              defaultValue={x?.graceMinutes ?? 0}
            />
          </Field>
        </div>
        <label className="a-check">
          <input
            type="checkbox"
            name="active"
            defaultChecked={x ? !!x.active : true}
          />
          متاحة للجدولة
        </label>
      </>,
      "hr.shift.save",
      (f) => ({
        ...(x ? { id: x.id, version: x.version } : {}),
        name: text(f, "name"),
        start: minutes(f.get("start")),
        end: minutes(f.get("end")),
        breakMinutes: number(f, "breakMinutes"),
        graceMinutes: number(f, "graceMinutes"),
        active: f.get("active") === "on",
      }),
    );
  }
  function rosterEditor(e: HrEmployee, date: string, r?: HrRoster) {
    saveForm(
      "جدول " + e.name + " · " + date,
      <>
        <Field label="الوردية أو الراحة">
          <select name="shiftId" defaultValue={r?.shiftId ?? ""}>
            <option value="">يوم راحة</option>
            {s!.shifts
              .filter((x) => x.active)
              .map((x) => (
                <option value={x.id} key={x.id}>
                  {x.name} {clock(x.start)} → {clock(x.end)}
                </option>
              ))}
          </select>
        </Field>
        <Field label="سبب التسجيل أو التعديل">
          <textarea name="reason" required maxLength={1500} />
        </Field>
        <p className="muted">
          اليوم غير المجدول لا يُحسب راحة تلقائيًا. تعديل قالب الوردية لا يغير
          الأيام المسجلة.
        </p>
      </>,
      "hr.roster.save",
      (f) => ({
        employeeId: e.id,
        day: date,
        ...(r ? { version: r.version } : {}),
        shiftId: text(f, "shiftId") || null,
        off: !text(f, "shiftId"),
        reason: text(f, "reason"),
      }),
    );
  }
  function attendanceEditor(e: HrEmployee, r: HrRoster, a?: HrAttendance) {
    saveForm(
      "حضور " + e.name + " · " + r.day,
      <>
        <Field label="الحالة">
          <select name="status" defaultValue={a?.status ?? "present"}>
            <option value="present">حاضر</option>
            <option value="absent">غائب</option>
          </select>
        </Field>
        <p>
          الوردية: {r.shiftName} {clock(r.start)} → {clock(r.end)}
        </p>
        <div className="a-form-row">
          <Field label="وقت الدخول">
            <input
              name="in"
              type="time"
              defaultValue={clock(a?.inMinute ?? r.start).slice(0, 5)}
            />
          </Field>
          <Field label="يوم الدخول">
            <select
              name="inDay"
              defaultValue={String(Math.floor((a?.inMinute ?? r.start) / 1440))}
            >
              <option value="0">تاريخ الوردية</option>
              <option value="1">اليوم التالي</option>
            </select>
          </Field>
        </div>
        <div className="a-form-row">
          <Field label="وقت الخروج">
            <input
              name="out"
              type="time"
              defaultValue={clock(a?.outMinute ?? r.end).slice(0, 5)}
            />
          </Field>
          <Field label="يوم الخروج">
            <select
              name="outDay"
              defaultValue={String(Math.floor((a?.outMinute ?? r.end) / 1440))}
            >
              <option value="0">تاريخ الوردية</option>
              <option value="1">اليوم التالي</option>
            </select>
          </Field>
        </div>
        <Field label="دقائق الراحة الفعلية">
          <input
            name="breakMinutes"
            type="number"
            min="0"
            max="1439"
            required
            defaultValue={a?.breakMinutes ?? r.breakMinutes}
          />
        </Field>
        <Field label="مصدر التسجيل أو سبب التصحيح">
          <textarea name="reason" required maxLength={1500} />
        </Field>
        <p className="muted">
          في حالة الغياب تُسجل الأوقات والراحة فارغة تلقائيًا. الإدخال يدوي؛ لا
          يوجد ربط بصمة مفعّل.
        </p>
      </>,
      "hr.attendance.save",
      (f) => {
        const present = text(f, "status") === "present";
        return {
          employeeId: e.id,
          day: r.day,
          ...(a ? { version: a.version } : {}),
          status: text(f, "status"),
          inMinute: present
            ? minutes(f.get("in")) + 1440 * number(f, "inDay")
            : null,
          outMinute: present
            ? minutes(f.get("out")) + 1440 * number(f, "outDay")
            : null,
          breakMinutes: present ? number(f, "breakMinutes") : 0,
          reason: text(f, "reason"),
        };
      },
    );
  }
  function creditEditor() {
    saveForm(
      "تعديل رصيد إجازة مدفوعة",
      <>
        {employeeOptions()}
        <div className="a-form-row">
          <Field label="السنة">
            <input
              name="year"
              type="number"
              min="2000"
              max="2100"
              required
              defaultValue={s!.today.slice(0, 4)}
            />
          </Field>
          <Field label="عدد الأيام المضافة أو المخصومة">
            <input name="days" type="number" min="-366" max="366" required />
          </Field>
        </div>
        <Field label="سبب تعديل الرصيد">
          <textarea name="reason" required maxLength={1500} />
        </Field>
        <p className="muted">
          لا توجد أرصدة قانونية افتراضية. أدخل الرصيد المعتمد في سياسة شركتك.
        </p>
      </>,
      "hr.leave.credit",
      (f) => ({
        employeeId: text(f, "employeeId"),
        year: number(f, "year"),
        days: number(f, "days"),
        reason: text(f, "reason"),
      }),
    );
  }
  function leaveEditor() {
    saveForm(
      "طلب إجازة",
      <>
        {employeeOptions()}
        <div className="a-form-row">
          <Field label="من">
            <input name="from" type="date" required defaultValue={s!.today} />
          </Field>
          <Field label="إلى">
            <input name="to" type="date" required defaultValue={s!.today} />
          </Field>
        </div>
        <Field label="نوع الإجازة">
          <select name="kind">
            <option value="paid">مدفوعة من الرصيد</option>
            <option value="unpaid">غير مدفوعة</option>
          </select>
        </Field>
        <Field label="سبب الطلب">
          <textarea name="reason" required maxLength={1500} />
        </Field>
        <p className="muted">
          حدد وردية أو راحة لكل يوم في الفترة أولًا. تُحسب أيام العمل فقط، وبحد
          أقصى 93 يومًا داخل سنة واحدة.
        </p>
      </>,
      "hr.leave.request",
      (f) => ({
        employeeId: text(f, "employeeId"),
        from: text(f, "from"),
        to: text(f, "to"),
        kind: text(f, "kind"),
        reason: text(f, "reason"),
      }),
    );
  }
  function decide(l: HrLeave, status: string) {
    saveForm(
      (status === "approved"
        ? "اعتماد"
        : status === "rejected"
          ? "رفض"
          : "إلغاء") +
        " إجازة " +
        name(l.employeeId),
      <>
        <p>
          {l.from} → {l.to} · {l.days} يوم عمل
        </p>
        <Field label="سبب القرار">
          <textarea name="reason" required maxLength={1500} />
        </Field>
      </>,
      "hr.leave.decide",
      (f) => ({
        id: l.id,
        version: l.version,
        status,
        reason: text(f, "reason"),
      }),
    );
  }
  function evaluationEditor(v?: HrEvaluation) {
    saveForm(
      v ? "تعديل تقييم" : "تقييم موظف",
      <>
        {v ? <p>{name(v.employeeId)}</p> : employeeOptions()}
        <Field label="فترة التقييم">
          <input
            name="period"
            required
            maxLength={160}
            defaultValue={v?.period}
          />
        </Field>
        <div className="a-form-row">
          {(["quality", "reliability", "teamwork"] as const).map((k) => (
            <Field
              key={k}
              label={
                {
                  quality: "جودة العمل",
                  reliability: "الالتزام",
                  teamwork: "التعاون",
                }[k]
              }
            >
              <select name={k} defaultValue={String(v?.[k] ?? 3)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} / 5
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>
        <Field label="الأهداف والخطوة القادمة">
          <textarea name="goals" maxLength={1500} defaultValue={v?.goals} />
        </Field>
        <Field label="ملاحظات التقييم">
          <textarea name="note" maxLength={1500} defaultValue={v?.note} />
        </Field>
      </>,
      "hr.evaluation.save",
      (f) => ({
        ...(v ? { id: v.id, version: v.version } : {}),
        employeeId: v?.employeeId ?? text(f, "employeeId"),
        period: text(f, "period"),
        quality: number(f, "quality"),
        reliability: number(f, "reliability"),
        teamwork: number(f, "teamwork"),
        goals: text(f, "goals"),
        note: text(f, "note"),
      }),
    );
  }
  function userEditor(u?: User) {
    saveForm(
      u ? "تعديل المستخدم" : "مستخدم جديد",
      <>
        <Field label="الاسم">
          <input name="name" required maxLength={160} defaultValue={u?.name} />
        </Field>
        <Field label="اسم المستخدم">
          <input
            name="username"
            required
            pattern="[A-Za-z0-9_.\-]{3,40}"
            dir="ltr"
            defaultValue={u?.username}
          />
        </Field>
        <Field label="الصلاحية">
          <select name="role" defaultValue={u?.role ?? "hr"}>
            {(["admin", "manager", "hr", "payroll"] as const).map((r) => (
              <option key={r} value={r}>
                {roles[r]}
              </option>
            ))}
          </select>
        </Field>
        <p>
          شؤون الموظفين: حضور وإجازات وتقييم، دون أجور. مسؤول الرواتب: أجور
          وصرف، دون تقييم أو ملاحظات شخصية. المدير يرى الجانبين.
        </p>
        <Field
          label={
            u ? "كلمة مرور جديدة، اتركها فارغة للإبقاء عليها" : "كلمة المرور"
          }
        >
          <input
            name="password"
            type="password"
            required={!u}
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
          />
        </Field>
        <label className="a-check">
          <input
            name="active"
            type="checkbox"
            defaultChecked={u ? !!u.active : true}
          />
          حساب نشط
        </label>
      </>,
      "user.save",
      (f) => ({
        ...(u ? { id: u.id } : {}),
        name: text(f, "name"),
        username: text(f, "username"),
        role: text(f, "role"),
        active: f.get("active") === "on",
        ...(text(f, "password") ? { password: text(f, "password") } : {}),
      }),
    );
  }
  const allowedViews = (Object.keys(pages) as View[]).filter(
    (v) =>
      (!["employees", "roster", "leave", "evaluations", "reports"].includes(
        v,
      ) ||
        operations) &&
      (v !== "payroll" || finance) &&
      (!["users", "audit", "settings"].includes(v) || admin),
  );
  return (
    <div className="hr-app">
      <header className="hr-header">
        <a
          className="hr-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("overview");
          }}
        >
          <img src="./icon.svg" alt="" />
          <span>
            XZARE <b>HR</b>
            <small>مساحة فريقك</small>
          </span>
        </a>
        <div className="hr-business">
          <strong>{s.settings.businessName}</strong>
          <span>
            {s.user.name} · {roles[s.user.role]}
          </span>
        </div>
        <WorkspaceClock english={false} />
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
      </header>
      <nav className="hr-nav" aria-label="مساحات العمل">
        {allowedViews.map((v) => (
          <button
            key={v}
            aria-current={v === view ? "page" : undefined}
            onClick={() => {
              setView(v);
              setQuery("");
              setError("");
            }}
          >
            {pages[v]}
            {v === "leave" && s.leaves.some((l) => l.status === "pending") && (
              <i />
            )}
          </button>
        ))}
      </nav>
      <main className="hr-main">
        <div className="hr-page-title">
          <div>
            <span className="eyebrow">XZARE / PEOPLE & WORK</span>
            <h1>{pages[view]}</h1>
          </div>
          <div className="hr-toolbar">
            <button disabled={busy} onClick={() => invoke(load)}>
              تحديث
            </button>
            <button
              disabled={busy}
              onClick={() =>
                saveForm(
                  "تغيير كلمة المرور",
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
                        minLength={12}
                        maxLength={128}
                        required
                        autoComplete="new-password"
                      />
                    </Field>
                  </>,
                  "password.change",
                  (f) => ({
                    current: text(f, "current"),
                    password: text(f, "password"),
                  }),
                )
              }
            >
              كلمة المرور
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="alert success">
            {notice}
          </p>
        )}
        {!s.reconciled && (
          <p role="alert" className="alert error">
            أرصدة الرواتب لا تطابق سجل الصرف؛ راجع النسخ الاحتياطية.
          </p>
        )}
        {view === "overview" && (
          <>
            <section className="hr-day-hero">
              <div>
                <span>اليوم · {s.today}</span>
                <h2>ابدأ بجدول فريقك.</h2>
                <p>وردية واضحة، حضور موثّق، وقرار إجازة في مكانه.</p>
                {operations && (
                  <button
                    className="primary"
                    onClick={() => {
                      setDay(s.today);
                      setView("roster");
                    }}
                  >
                    فتح جدول اليوم
                  </button>
                )}
                {finance && (
                  <button onClick={() => setView("payroll")}>
                    متابعة الرواتب
                  </button>
                )}
              </div>
              <div className="hr-day-summary">
                <strong>{s.employees.filter((e) => e.active).length}</strong>
                <span>موظف نشط</span>
                <div>
                  <b>
                    {s.roster.filter((r) => r.day === s.today && !r.off).length}
                  </b>{" "}
                  وردية اليوم{" "}
                  <b>
                    {
                      s.attendance.filter(
                        (a) => a.day === s.today && a.status === "present",
                      ).length
                    }
                  </b>{" "}
                  حضور مسجل
                </div>
              </div>
            </section>
            <div className="hr-overview-grid">
              <section className="hr-panel">
                <h2>خطوتك القادمة</h2>
                {!s.employees.length ? (
                  <Empty>
                    أضف أول موظف ببياناته الفعلية لبدء الجدولة.
                    {operations && (
                      <button
                        className="primary"
                        onClick={() => employeeEditor()}
                      >
                        إضافة موظف
                      </button>
                    )}
                  </Empty>
                ) : operations ? (
                  <>
                    <p>
                      الإجازات قيد القرار:{" "}
                      {s.leaves.filter((x) => x.status === "pending").length}
                    </p>
                    <p>
                      أيام اليوم دون حضور:{" "}
                      {
                        s.roster.filter(
                          (r) =>
                            r.day === s.today &&
                            !r.off &&
                            !s.attendance.some(
                              (a) =>
                                a.employeeId === r.employeeId &&
                                a.day === r.day,
                            ) &&
                            !s.leaves.some(
                              (l) =>
                                l.employeeId === r.employeeId &&
                                l.status === "approved" &&
                                l.from <= r.day &&
                                l.to >= r.day,
                            ),
                        ).length
                      }
                    </p>
                    <button onClick={() => setView("leave")}>
                      مراجعة الإجازات
                    </button>
                  </>
                ) : (
                  <p>
                    راجع أساس الرواتب ثم أرسل المسير إلى مستخدم آخر للاعتماد.
                  </p>
                )}
              </section>
              <section className="hr-panel">
                <h2>مسار الراتب</h2>
                <div className="hr-steps">
                  <span>إعداد المبالغ</span>
                  <span>اعتماد مستخدم آخر</span>
                  <span>تسجيل الصرف</span>
                </div>
                <p>
                  الحضور مرجع للمراجعة. مبالغ الإضافي والاستقطاعات تدخلها الشركة
                  صراحة.
                </p>
                {finance && (
                  <p>
                    مسيرات بانتظار الاعتماد:{" "}
                    {s.payrolls.filter((r) => r.status === "submitted").length}
                  </p>
                )}
              </section>
            </div>
          </>
        )}
        {view === "employees" && (
          <>
            <div className="hr-toolbar">
              <input
                aria-label="بحث الموظفين"
                placeholder="بحث بالاسم أو الكود أو القسم"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className="primary"
                disabled={busy}
                onClick={() => employeeEditor()}
              >
                إضافة موظف
              </button>
            </div>
            {!chosen.length ? (
              <Empty>لا يوجد موظفون مطابقون. أضف موظفًا أو غيّر البحث.</Empty>
            ) : (
              <div className="hr-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>الموظف</th>
                      <th>القسم والوظيفة</th>
                      <th>التواصل</th>
                      <th>مدة العمل</th>
                      {finance && <th>أساس الراتب</th>}
                      <th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chosen.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <strong>{e.name}</strong>
                          <small>
                            {e.code} · {e.active ? "نشط" : "متوقف"}
                          </small>
                        </td>
                        <td>
                          {e.department || "—"}
                          <small>{e.job}</small>
                        </td>
                        <td dir="ltr">
                          {e.phone || "—"}
                          <small>{e.email}</small>
                        </td>
                        <td>
                          {e.hired}
                          <small>{e.ended ? "حتى " + e.ended : "مستمر"}</small>
                        </td>
                        {finance && (
                          <td>
                            {s.salaries.find((x) => x.employeeId === e.id)
                              ? amount(
                                  s.salaries.find((x) => x.employeeId === e.id)!
                                    .base,
                                ) + " ج.م"
                              : "غير مسجل"}
                          </td>
                        )}
                        <td>
                          <button
                            disabled={busy}
                            onClick={() => employeeEditor(e)}
                          >
                            تعديل
                          </button>
                          {finance && (
                            <button
                              disabled={busy}
                              onClick={() => salaryEditor(e)}
                            >
                              أساس الراتب
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {view === "roster" && (
          <>
            <div className="hr-toolbar">
              <Field label="بداية الأسبوع المعروض">
                <input
                  type="date"
                  required
                  value={day}
                  onChange={(e) => {
                    if (e.target.value) setDay(e.target.value);
                  }}
                />
              </Field>
              <button onClick={() => setDay(dayOffset(day, -7))}>
                الأسبوع السابق
              </button>
              <button onClick={() => setDay(dayOffset(day, 7))}>
                الأسبوع التالي
              </button>
              <button onClick={() => setShiftModal(true)}>
                قوالب الورديات
              </button>
              <button className="primary" onClick={() => shiftEditor()}>
                وردية جديدة
              </button>
            </div>
            <p className="muted">
              اضغط «جدولة» لتعيين وردية أو راحة. اضغط «حضور» لتسجيل الأوقات؛ +1
              يعني اليوم التالي.
            </p>
            {!s.employees.length ? (
              <Empty>أضف موظفًا أولًا من صفحة الموظفين.</Empty>
            ) : !period ? (
              <p role="status">جارٍ قراءة الجدول…</p>
            ) : (
              <div className="hr-table-wrap">
                <table className="hr-roster">
                  <thead>
                    <tr>
                      <th>الموظف</th>
                      {week.map((d) => (
                        <th key={d}>
                          {new Date(d + "T12:00:00").toLocaleDateString(
                            "ar-EG",
                            {
                              weekday: "short",
                            },
                          )}
                          <small>{d.slice(5)}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.employees.map((e) => (
                      <tr key={e.id}>
                        <th>
                          {e.name}
                          <small>{e.department || e.code}</small>
                        </th>
                        {week.map((date) => {
                          const r = period.roster.find(
                              (x) => x.employeeId === e.id && x.day === date,
                            ),
                            a = period.attendance.find(
                              (x) => x.employeeId === e.id && x.day === date,
                            ),
                            l = period.leaves.find(
                              (x) =>
                                x.employeeId === e.id &&
                                x.status === "approved" &&
                                x.from <= date &&
                                x.to >= date,
                            );
                          return (
                            <td
                              key={date}
                              className={date === s.today ? "today" : ""}
                            >
                              <div
                                className={r?.off ? "hr-cell off" : "hr-cell"}
                              >
                                <strong>
                                  {l
                                    ? "إجازة معتمدة"
                                    : (r?.shiftName ?? "غير مجدول")}
                                </strong>
                                {r && !r.off && (
                                  <small dir="ltr">
                                    {clock(r.start)} – {clock(r.end)}
                                  </small>
                                )}
                                {a && (
                                  <span
                                    className={
                                      "hr-pill " +
                                      (a.status === "present" ? "ok" : "warn")
                                    }
                                  >
                                    {a.status === "present"
                                      ? "حاضر · " + a.worked + " د"
                                      : "غائب"}
                                  </span>
                                )}
                                <div>
                                  <button
                                    disabled={busy || !!a || !!l}
                                    onClick={() => rosterEditor(e, date, r)}
                                    aria-label={"جدولة " + e.name + " " + date}
                                  >
                                    جدولة
                                  </button>
                                  {r && !r.off && date <= s.today && !l && (
                                    <button
                                      disabled={busy}
                                      onClick={() => attendanceEditor(e, r, a)}
                                      aria-label={"حضور " + e.name + " " + date}
                                    >
                                      {a ? "تصحيح" : "حضور"}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {view === "leave" && (
          <>
            <div className="hr-toolbar">
              <button className="primary" disabled={busy} onClick={leaveEditor}>
                طلب إجازة
              </button>
              <button disabled={busy} onClick={creditEditor}>
                تعديل رصيد
              </button>
            </div>
            <section className="hr-panel">
              <h2>أرصدة الإجازات</h2>
              <Field label="سنة الرصيد">
                <input
                  type="number"
                  min="2000"
                  max="2100"
                  value={leaveYear}
                  onChange={(e) => setLeaveYear(Number(e.target.value))}
                />
              </Field>
              <div className="hr-balance-grid">
                {balances.map((b) => (
                  <div key={b.employeeId}>
                    <strong>{name(b.employeeId)}</strong>
                    <b>{b.available} يوم متاح</b>
                    <small>
                      رصيد ممنوح {b.granted} · مستخدم {b.used}
                    </small>
                  </div>
                ))}
              </div>
            </section>
            <div className="hr-toolbar">
              <h2>طلبات الفترة المختارة</h2>
              <Field label="بداية فترة الإجازات">
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field label="نهاية فترة الإجازات">
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
            </div>
            {!period ? (
              <p role="status">جارٍ قراءة الإجازات…</p>
            ) : !period.leaves.length ? (
              <Empty>
                لا توجد طلبات إجازة في هذه الفترة. الطلب يحتسب أيام العمل
                المجدولة فقط.
              </Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>الموظف</th>
                    <th>الفترة</th>
                    <th>أيام العمل</th>
                    <th>الحالة</th>
                    <th>السبب</th>
                    <th>القرار</th>
                  </tr>
                </thead>
                <tbody>
                  {period!.leaves.map((l) => (
                    <tr key={l.id}>
                      <td>{name(l.employeeId)}</td>
                      <td>
                        {l.from}
                        <small>{l.to}</small>
                      </td>
                      <td>
                        {l.days} · {l.kind === "paid" ? "مدفوعة" : "غير مدفوعة"}
                      </td>
                      <td>{leaveLabels[l.status]}</td>
                      <td>{l.reason}</td>
                      <td>
                        {l.status === "pending" && (
                          <>
                            <button
                              disabled={busy}
                              onClick={() => decide(l, "approved")}
                            >
                              اعتماد
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => decide(l, "rejected")}
                            >
                              رفض
                            </button>
                          </>
                        )}
                        {["pending", "approved"].includes(l.status) && (
                          <button
                            disabled={busy}
                            onClick={() => decide(l, "cancelled")}
                          >
                            إلغاء
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
        {view === "evaluations" && (
          <>
            <div className="hr-toolbar">
              <button
                className="primary"
                disabled={busy}
                onClick={() => evaluationEditor()}
              >
                تقييم جديد
              </button>
            </div>
            {!s.evaluations.length ? (
              <Empty>
                لا توجد تقييمات. سجل تقييمًا من 1 إلى 5 مع أهداف الموظف للفترة
                القادمة.
              </Empty>
            ) : (
              <div className="hr-evaluations">
                {s.evaluations.map((v) => (
                  <article key={v.id} className="hr-panel">
                    <header>
                      <div>
                        <h2>{name(v.employeeId)}</h2>
                        <span>{v.period}</span>
                      </div>
                      <button
                        disabled={busy}
                        onClick={() => evaluationEditor(v)}
                      >
                        تعديل
                      </button>
                    </header>
                    <div className="hr-ratings">
                      <span>
                        جودة <b>{v.quality}/5</b>
                      </span>
                      <span>
                        التزام <b>{v.reliability}/5</b>
                      </span>
                      <span>
                        تعاون <b>{v.teamwork}/5</b>
                      </span>
                    </div>
                    <p>{v.goals || "لم تُدخل أهداف"}</p>
                    <p>{v.note}</p>
                    <small>
                      {v.reviewerName} · {stamp(v.at)}
                    </small>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
        {view === "payroll" && (
          <>
            <div className="hr-toolbar">
              <button
                className="primary"
                disabled={busy}
                onClick={() => setCompose(true)}
              >
                إعداد مسير
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  saveForm(
                    "تسجيل أساس الراتب",
                    <>
                      {employeeOptions()}
                      <Field label="الأساس الشهري، ج.م">
                        <input
                          name="base"
                          type="number"
                          min="0"
                          step="0.01"
                          required
                        />
                      </Field>
                      <Field label="سبب التعديل">
                        <textarea name="reason" required maxLength={1500} />
                      </Field>
                    </>,
                    "hr.salary.save",
                    (f) => {
                      const id = text(f, "employeeId");
                      return {
                        employeeId: id,
                        version:
                          s.salaries.find((x) => x.employeeId === id)
                            ?.version ?? 0,
                        base: readMoney(f.get("base")),
                        reason: text(f, "reason"),
                      };
                    },
                  )
                }
              >
                أساس راتب موظف
              </button>
            </div>
            <div className="hr-callout">
              مسير واحد غير ملغى لكل شهر. المبالغ المدخلة لا تُعد حسابًا
              تلقائيًا للضرائب أو التأمينات، والصرف يسجل مبلغًا نُفذ بالفعل.
            </div>
            {!s.payrolls.length ? (
              <Empty>
                ابدأ بتسجيل أساس رواتب الموظفين، ثم أعد أول مسير للمراجعة.
              </Empty>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>المسير والشهر</th>
                    <th>الحالة</th>
                    <th>الصافي</th>
                    <th>مصروف</th>
                    <th>متبقي</th>
                    <th>إعداد / اعتماد</th>
                    <th>فتح</th>
                  </tr>
                </thead>
                <tbody>
                  {s.payrolls.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.number}
                        <small>{r.month}</small>
                      </td>
                      <td>{payrollLabels[r.status]}</td>
                      <td>{amount(r.total)}</td>
                      <td>{amount(r.paid)}</td>
                      <td>{amount(r.balance)}</td>
                      <td>
                        {r.creatorName}
                        <small>{r.approverName || "بانتظار الاعتماد"}</small>
                      </td>
                      <td>
                        <button
                          disabled={busy}
                          onClick={() => invoke(() => openPayroll(r.id))}
                        >
                          تفاصيل المسير
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
        {view === "reports" && (
          <>
            <div className="hr-toolbar">
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
                disabled={!period}
                onClick={() =>
                  period &&
                  csv("HR-attendance.csv", [
                    [
                      "الكود",
                      "الموظف",
                      "التاريخ",
                      "الحالة",
                      "الدخول بالدقائق",
                      "الخروج بالدقائق",
                      "العمل بالدقائق",
                      "التأخير بالدقائق",
                      "الإضافي بالدقائق",
                    ],
                    ...period.attendance.map((a) => [
                      s.employees.find((e) => e.id === a.employeeId)?.code,
                      name(a.employeeId),
                      a.day,
                      a.status,
                      a.inMinute ?? "",
                      a.outMinute ?? "",
                      a.worked,
                      a.late,
                      a.overtime,
                    ]),
                  ])
                }
              >
                تصدير الحضور CSV
              </button>
              <button onClick={() => window.print()}>طباعة التقرير</button>
            </div>
            {period && (
              <div className="print-area">
                <h2>تقرير حضور {s.settings.businessName}</h2>
                <p>
                  {from} → {to}
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>الموظف</th>
                      <th>وردية عمل</th>
                      <th>حضور</th>
                      <th>غياب مسجل</th>
                      <th>دقائق عمل</th>
                      <th>دقائق تأخير</th>
                      <th>دقائق إضافية</th>
                      <th>إجازة عمل معتمدة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.employees.map((e) => {
                      const a = period.attendance.filter(
                        (x) => x.employeeId === e.id,
                      );
                      return (
                        <tr key={e.id}>
                          <td>{e.name}</td>
                          <td>
                            {
                              period.roster.filter(
                                (x) => x.employeeId === e.id && !x.off,
                              ).length
                            }
                          </td>
                          <td>
                            {a.filter((x) => x.status === "present").length}
                          </td>
                          <td>
                            {a.filter((x) => x.status === "absent").length}
                          </td>
                          <td>{a.reduce((n, x) => n + x.worked, 0)}</td>
                          <td>{a.reduce((n, x) => n + x.late, 0)}</td>
                          <td>{a.reduce((n, x) => n + x.overtime, 0)}</td>
                          <td>
                            {
                              period.leaves
                                .filter(
                                  (x) =>
                                    x.employeeId === e.id &&
                                    x.status === "approved",
                                )
                                .flatMap((x) => x.dates)
                                .filter((d) => d >= from && d <= to).length
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <h3>السجل اليومي</h3>
                <table>
                  <thead>
                    <tr>
                      <th>الموظف</th>
                      <th>اليوم</th>
                      <th>الحالة</th>
                      <th>دخول</th>
                      <th>خروج</th>
                      <th>عمل، د</th>
                    </tr>
                  </thead>
                  <tbody>
                    {period.attendance.map((a) => (
                      <tr key={a.id}>
                        <td>{name(a.employeeId)}</td>
                        <td>{a.day}</td>
                        <td>{a.status === "present" ? "حاضر" : "غائب"}</td>
                        <td>{clock(a.inMinute)}</td>
                        <td>{clock(a.outMinute)}</td>
                        <td>{a.worked}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {view === "users" && (
          <>
            <div className="hr-toolbar">
              <button
                className="primary"
                disabled={busy}
                onClick={() => userEditor()}
              >
                مستخدم جديد
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>المستخدم</th>
                  <th>الصلاحية</th>
                  <th>الحالة</th>
                  <th>تعديل</th>
                </tr>
              </thead>
              <tbody>
                {s.users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.name}
                      <small>{u.username}</small>
                    </td>
                    <td>{roles[u.role]}</td>
                    <td>{u.active ? "نشط" : "متوقف"}</td>
                    <td>
                      <button disabled={busy} onClick={() => userEditor(u)}>
                        تعديل
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {view === "audit" && (
          <>
            <p className="muted">
              آخر 300 عملية. تصحيحات الحضور والجدولة تحفظ سببها ونسخة بياناتها
              في سجل مستقل داخل قاعدة البيانات.
            </p>
            <table>
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>المستخدم</th>
                  <th>العملية</th>
                  <th>السجل</th>
                </tr>
              </thead>
              <tbody>
                {s.audit.map((a, i) => (
                  <tr key={i}>
                    <td>{stamp(a.at)}</td>
                    <td>{a.user_name}</td>
                    <td dir="ltr">{a.action}</td>
                    <td dir="ltr">{a.entity_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {view === "settings" && (
          <div className="hr-settings-grid">
            <section className="hr-panel">
              <h2>بيانات الشركة</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  invoke(() =>
                    run("settings.save", {
                      businessName: text(f, "businessName"),
                      phone: text(f, "phone"),
                      address: text(f, "address"),
                      currency: "EGP",
                      language: "ar",
                      receiptFooter: text(f, "receiptFooter"),
                      taxBps: 0,
                    }),
                  );
                }}
              >
                <Field label="اسم الشركة">
                  <input
                    name="businessName"
                    required
                    maxLength={160}
                    defaultValue={s.settings.businessName}
                  />
                </Field>
                <Field label="هاتف الشركة">
                  <input
                    name="phone"
                    maxLength={40}
                    dir="ltr"
                    defaultValue={s.settings.phone}
                  />
                </Field>
                <Field label="العنوان">
                  <input
                    name="address"
                    maxLength={250}
                    defaultValue={s.settings.address}
                  />
                </Field>
                <Field label="نهاية المستند">
                  <input
                    name="receiptFooter"
                    maxLength={250}
                    defaultValue={s.settings.receiptFooter}
                  />
                </Field>
                <button className="primary" disabled={busy}>
                  حفظ بيانات الشركة
                </button>
              </form>
            </section>
            <section className="hr-panel">
              <LicensePanel />
            </section>
            <section className="hr-panel">
              <h2>النسخ الاحتياطي</h2>
              <p>
                قاعدة البيانات والنسخ غير مشفرة. احتفظ بالنسخة في مكان موثوق؛
                مفتاح الجهاز وحده محمي بتشفير Windows.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  invoke(async () => {
                    const r = await call<{
                      download?: string;
                      fileName?: string;
                      cancelled?: boolean;
                    }>("backup.create");
                    if (r.download)
                      download(
                        r.fileName ?? "HR.xzbak",
                        new Blob([
                          Uint8Array.from(atob(r.download), (c) =>
                            c.charCodeAt(0),
                          ),
                        ]),
                      );
                    if (!r.cancelled) setNotice("تم إنشاء النسخة الاحتياطية");
                  })
                }
              >
                إنشاء نسخة
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  saveForm(
                    "استعادة نسخة HR",
                    <>
                      <p>
                        تستبدل سجلات العمل وتنتهي الجلسات. تُحفظ نسخة قبل
                        الاستعادة ويبقى ترخيص الجهاز محفوظًا.
                      </p>
                      {!window.xzare && (
                        <Field label="ملف النسخة">
                          <input
                            name="file"
                            type="file"
                            accept=".xzbak"
                            required
                          />
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
                      <label className="a-check">
                        <input type="checkbox" required />
                        أؤكد استعادة هذه النسخة
                      </label>
                    </>,
                    "backup.restore",
                    (f) => ({
                      password: text(f, "password"),
                      file: f.get("file"),
                    }),
                    "استعادة النسخة",
                  )
                }
              >
                استعادة نسخة
              </button>
            </section>
            <section className="hr-panel">
              <h2>دعم Xzare</h2>
              <p dir="ltr">hello@xzare.com</p>
              <p dir="ltr">+201501230440</p>
            </section>
          </div>
        )}
      </main>
      <footer className="hr-footer">
        <span>XZARE SOFTWARE SOLUTIONS · HR / 0.1</span>
        <span dir="ltr">hello@xzare.com · +201501230440</span>
      </footer>
      {form && (
        <Modal
          title={form.title}
          busy={busy}
          error={error}
          submit={form.submit}
          onClose={() => setForm(null)}
          onSubmit={async (e) => {
            if (mutex.current) return;
            const f = new FormData(e.currentTarget),
              current = form;
            try {
              const p = current.payload(f);
              if (current.action === "backup.restore") {
                await exclusive(mutex, setBusy, async () => {
                  if (window.xzare) {
                    const r = await call<{
                      restored?: boolean;
                      cancelled?: boolean;
                    }>("backup.restore", { password: p.password });
                    if (r.restored) end();
                    else if (r.cancelled) setForm(null);
                  } else {
                    const file = p.file;
                    if (
                      !(file instanceof File) ||
                      !file.size ||
                      file.size > 128 * 1024 * 1024
                    )
                      throw new Error("اختر نسخة صحيحة حتى 128 ميجابايت");
                    const r = await fetch("/api/restore", {
                      method: "POST",
                      headers: {
                        "X-Xzare-Request": "1",
                        "X-Xzare-Password": encodeURIComponent(
                          String(p.password),
                        ),
                      },
                      credentials: "same-origin",
                      body: file,
                    });
                    const v = await r.json();
                    if (!r.ok || !v.ok)
                      throw new Error(v.error ?? "تعذر الاستعادة");
                    end();
                  }
                });
              } else {
                await run(current.action, p);
                setForm(null);
                if (current.action === "password.change") end();
              }
            } catch (e) {
              const m = e instanceof Error ? e.message : "تعذر الحفظ";
              setError(m);
              authError(m);
            }
          }}
        >
          {form.body}
        </Modal>
      )}
      {compose && (
        <PayrollEditor
          s={s}
          busy={busy}
          save={run}
          onClose={() => setCompose(false)}
        />
      )}
      {detail && (
        <PayrollDetail
          key={detail.run.id}
          d={detail}
          busy={busy}
          userId={s.user.id}
          businessName={s.settings.businessName ?? ""}
          onClose={() => setDetail(null)}
          mutate={(a, p) =>
            commitThenRefresh(
              () => run(a, p),
              () => openPayroll(detail.run.id),
              (e) => {
                setDetail(null);
                authError(e instanceof Error ? e.message : "");
                setError("تم حفظ العملية؛ أعد فتح المسير لقراءة الرصيد الجديد");
              },
            )
          }
        />
      )}
      {shiftModal && (
        <Modal
          title="قوالب الورديات"
          busy={busy}
          error=""
          manual
          onClose={() => setShiftModal(false)}
        >
          {!s.shifts.length ? (
            <Empty>أضف وردية جديدة بوقت البداية والنهاية.</Empty>
          ) : (
            s.shifts.map((x) => (
              <div className="hr-shift-row" key={x.id}>
                <strong>{x.name}</strong>
                <span>
                  {clock(x.start)} → {clock(x.end)} · راحة {x.breakMinutes} د ·
                  سماح {x.graceMinutes} د
                </span>
                <button disabled={busy} onClick={() => shiftEditor(x)}>
                  تعديل
                </button>
              </div>
            ))
          )}
        </Modal>
      )}
    </div>
  );
}
