import { useState, useRef } from "react";
import type { EduSessionDetail, EduExamDetail, EduEvent } from "@xzare/engine";
import { Modal, Field, decimal, csv } from "./ui";
import {
  attendanceLabels,
  eventLabels,
  stamp,
  readMoney,
  clock,
} from "./model";
export function History({ events }: { events: EduEvent[] }) {
  return (
    <div className="edu-history">
      {events.length === 0 ? (
        <p>لا توجد أحداث محفوظة.</p>
      ) : (
        events.map((x) => (
          <article key={x.id}>
            <small>
              {stamp(x.at)} · {x.actorName}
            </small>
            <strong>{eventLabels[x.action] ?? "عملية مسجلة"}</strong>
            {x.reason && <p>{x.reason}</p>}
          </article>
        ))
      )}
    </div>
  );
}
export function Attendance({
  d,
  busy,
  close,
  save,
}: {
  d: EduSessionDetail;
  busy: boolean;
  close: () => void;
  save: (a: string, p: Record<string, unknown>) => Promise<unknown>;
}) {
  const [marks, setMarks] = useState(() =>
      d.roster.map((x) => ({
        enrollmentId: x.enrollmentId,
        status: x.status ?? "",
        note: x.note,
      })),
    ),
    [error, setError] = useState(""),
    mutex = useRef(false);
  const edit = (i: number, k: "status" | "note", v: string) =>
    setMarks((old) => old.map((x, n) => (i === n ? { ...x, [k]: v } : x)));
  return (
    <Modal
      title={"حضور — " + d.session.title}
      busy={busy}
      error={error}
      manual
      onClose={close}
    >
      <p>
        {d.session.groupName} · {d.session.teacherName} · {d.session.day} ·{" "}
        {clock(d.session.startMinute)}
      </p>
      <p className="edu-callout">
        حدد حالة كل طالب من القائمة الأصلية. عدم التسجيل لا يعتبر غيابًا.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (mutex.current || busy) return;
          mutex.current = true;
          try {
            await save("edu.attendance.save", {
              sessionId: d.session.id,
              version: d.session.version,
              marks,
            });
            close();
          } catch (e) {
            setError(e instanceof Error ? e.message : "تعذر حفظ الحضور");
          } finally {
            mutex.current = false;
          }
        }}
      >
        <div className="edu-table">
          <table>
            <thead>
              <tr>
                <th>الطالب</th>
                <th>الحالة</th>
                <th>ملاحظة الحضور</th>
              </tr>
            </thead>
            <tbody>
              {d.roster.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.studentName}</strong>
                    <small>{r.studentCode}</small>
                  </td>
                  <td>
                    <select
                      aria-label={"حضور " + r.studentName}
                      required
                      disabled={busy || d.session.status === "cancelled"}
                      value={marks[i]!.status}
                      onChange={(e) => edit(i, "status", e.target.value)}
                    >
                      <option value="">لم يسجل</option>
                      {Object.entries(attendanceLabels).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={"ملاحظة " + r.studentName}
                      maxLength={2000}
                      value={marks[i]!.note}
                      onChange={(e) => edit(i, "note", e.target.value)}
                      disabled={busy || d.session.status === "cancelled"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="edu-toolbar">
          <button
            className="primary"
            disabled={busy || d.session.status === "cancelled"}
          >
            حفظ كشف الحضور
          </button>
          <button
            type="button"
            onClick={() =>
              csv("Education-attendance-" + d.session.day + ".csv", [
                ["الحصة", "التاريخ", "الطالب", "الكود", "الحالة", "الملاحظة"],
                ...d.roster.map((r) => [
                  d.session.title,
                  d.session.day,
                  r.studentName,
                  r.studentCode,
                  r.status ? attendanceLabels[r.status] : "لم يسجل",
                  r.note,
                ]),
              ])
            }
          >
            تصدير الحضور CSV
          </button>
        </div>
      </form>
      <h3>سجل الحصة</h3>
      <History events={d.events} />
    </Modal>
  );
}
export function Grades({
  d,
  busy,
  manager,
  canEdit,
  close,
  save,
}: {
  d: EduExamDetail;
  busy: boolean;
  manager: boolean;
  canEdit: boolean;
  close: () => void;
  save: (a: string, p: Record<string, unknown>) => Promise<unknown>;
}) {
  const [rows, setRows] = useState(() =>
      d.roster.map((x) => ({
        enrollmentId: x.enrollmentId,
        score:
          x.score === null || x.score === undefined ? "" : decimal(x.score),
        note: x.note,
      })),
    ),
    [error, setError] = useState(""),
    mutex = useRef(false),
    editable = canEdit && (d.exam.status !== "published" || manager);
  const edit = (i: number, k: "score" | "note", v: string) =>
    setRows((old) => old.map((x, n) => (i === n ? { ...x, [k]: v } : x)));
  return (
    <Modal
      title={"درجات — " + d.exam.title}
      busy={busy}
      error={error}
      manual
      onClose={close}
    >
      <p>
        {d.exam.groupName} · {d.exam.day} · النهاية {decimal(d.exam.maxScore)} ·{" "}
        {d.exam.status === "published" ? "منشور" : "مسودة"}
      </p>
      <p className="edu-callout">
        أدخل الدرجة الفعلية من التصحيح. الدرجة الفارغة تحتاج سببًا عند النشر. لا
        يصدر البرنامج قرار نجاح أو قبول تلقائيًا.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (mutex.current || busy) return;
          const f = new FormData(e.currentTarget);
          mutex.current = true;
          try {
            await save("edu.grades.save", {
              examId: d.exam.id,
              version: d.exam.version,
              grades: rows.map((r) => ({
                ...r,
                score: r.score.trim() === "" ? null : readMoney(r.score),
              })),
              publish: d.exam.status === "published" || f.has("publish"),
              reason: String(f.get("reason") ?? ""),
            });
            close();
          } catch (e) {
            setError(e instanceof Error ? e.message : "تعذر حفظ الدرجات");
          } finally {
            mutex.current = false;
          }
        }}
      >
        <div className="edu-table">
          <table>
            <thead>
              <tr>
                <th>الطالب</th>
                <th>الدرجة</th>
                <th>ملاحظات التصحيح</th>
              </tr>
            </thead>
            <tbody>
              {d.roster.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.studentName}</strong>
                    <small>{r.studentCode}</small>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={d.exam.maxScore / 100}
                      aria-label={"درجة " + r.studentName}
                      value={rows[i]!.score}
                      onChange={(e) => edit(i, "score", e.target.value)}
                      disabled={busy || !editable}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={"ملاحظة " + r.studentName}
                      maxLength={2000}
                      value={rows[i]!.note}
                      onChange={(e) => edit(i, "note", e.target.value)}
                      disabled={busy || !editable}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && (
          <>
            <Field label="سبب الحفظ أو التصحيح">
              <textarea name="reason" required maxLength={2000} />
            </Field>
            {d.exam.status === "draft" && (
              <label className="a-check">
                <input type="checkbox" name="publish" />
                راجعت الكشف وأريد نشر الدرجات
              </label>
            )}
            <button className="primary" disabled={busy}>
              حفظ الدرجات
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() =>
            csv("Education-grades-" + d.exam.day + ".csv", [
              [
                "الاختبار",
                "المجموعة",
                "الطالب",
                "الكود",
                "الدرجة",
                "النهاية",
                "الملاحظة",
              ],
              ...d.roster.map((r) => [
                d.exam.title,
                d.exam.groupName,
                r.studentName,
                r.studentCode,
                r.score === null || r.score === undefined
                  ? ""
                  : decimal(r.score),
                decimal(d.exam.maxScore),
                r.note,
              ]),
            ])
          }
        >
          تصدير الدرجات CSV
        </button>
      </form>
      <h3>سجل الاختبار</h3>
      <History events={d.events} />
    </Modal>
  );
}
