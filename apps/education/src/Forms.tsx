import { useState, type ReactNode } from "react";
import type {
  EduState,
  EduStudent,
  EduTeacher,
  EduCourse,
  EduGroup,
} from "@xzare/engine";
import { Field, amount, decimal, today } from "./ui";
import { readMoney, minutes } from "./model";
export type EduForm = {
  title: string;
  body: ReactNode;
  action: string;
  payload: (f: FormData) => Record<string, unknown>;
  submit?: string;
};
export const text = (f: FormData, k: string) => String(f.get(k) ?? "");
const input = (
  label: string,
  name: string,
  value = "",
  required = false,
  type = "text",
) => (
  <Field label={label}>
    <input
      name={name}
      defaultValue={value}
      required={required}
      type={type}
      maxLength={160}
    />
  </Field>
);
const memo = (label: string, name: string, value = "") => (
  <Field label={label}>
    <textarea name={name} defaultValue={value} maxLength={2000} />
  </Field>
);
const active = (v = true) => (
  <label className="a-check">
    <input name="active" type="checkbox" defaultChecked={v} />
    نشط
  </label>
);
export function studentForm(x?: EduStudent): EduForm {
  return {
    title: x ? "تعديل الطالب" : "تسجيل طالب",
    action: "edu.student.save",
    body: (
      <>
        <div className="edu-two">
          {input("كود الطالب", "code", x?.code, true)}
          {input("اسم الطالب", "name", x?.name, true)}
          {input("هاتف الطالب", "phone", x?.phone)}
          {input("المستوى الدراسي", "level", x?.level)}
          {input("اسم ولي الأمر", "guardian", x?.guardian)}
          {input("هاتف ولي الأمر", "guardianPhone", x?.guardianPhone)}
          {input(
            "تاريخ الميلاد، اختياري",
            "birthDay",
            x?.birthDay ?? "",
            false,
            "date",
          )}
        </div>
        {memo("ملاحظات خاصة بالاستقبال", "note", x?.note)}
        {active(x ? !!x.active : true)}
      </>
    ),
    payload: (f) => ({
      ...(x && { id: x.id, version: x.version }),
      code: text(f, "code"),
      name: text(f, "name"),
      phone: text(f, "phone"),
      guardian: text(f, "guardian"),
      guardianPhone: text(f, "guardianPhone"),
      birthDay: text(f, "birthDay") || null,
      level: text(f, "level"),
      note: text(f, "note"),
      active: f.has("active"),
    }),
  };
}
export function teacherForm(s: EduState, x?: EduTeacher): EduForm {
  return {
    title: x ? "تعديل المدرس" : "إضافة مدرس",
    action: "edu.teacher.save",
    body: (
      <>
        <div className="edu-two">
          {input("كود المدرس", "code", x?.code, true)}
          {input("اسم المدرس", "name", x?.name, true)}
          {input("هاتف المدرس", "phone", x?.phone)}
        </div>
        <Field label="حساب دخول المدرس">
          <select name="userId" defaultValue={x?.userId ?? ""}>
            <option value="">بدون حساب دخول</option>
            {s.teacherAccounts.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.active ? "" : " — معطل؛ اختر بديلًا"}
              </option>
            ))}
          </select>
        </Field>
        <p>
          أنشئ حسابًا بدور مدرس من المستخدمين، ثم اربطه هنا. الربط يحدد
          المجموعات التي يراها.
        </p>
        {memo("ملاحظات إدارية", "note", x?.note)}
        {active(x ? !!x.active : true)}
      </>
    ),
    payload: (f) => ({
      ...(x && { id: x.id, version: x.version }),
      code: text(f, "code"),
      name: text(f, "name"),
      phone: text(f, "phone"),
      note: text(f, "note"),
      userId: text(f, "userId") || null,
      active: f.has("active"),
    }),
  };
}
export function courseForm(x?: EduCourse): EduForm {
  return {
    title: x ? "تعديل الدورة" : "دورة جديدة",
    action: "edu.course.save",
    body: (
      <>
        {input("كود الدورة", "code", x?.code, true)}
        {input("اسم الدورة أو المادة", "name", x?.name, true)}
        {memo("وصف الدورة", "description", x?.description)}
        {active(x ? !!x.active : true)}
      </>
    ),
    payload: (f) => ({
      ...(x && { id: x.id, version: x.version }),
      code: text(f, "code"),
      name: text(f, "name"),
      description: text(f, "description"),
      active: f.has("active"),
    }),
  };
}
export function groupForm(s: EduState, x?: EduGroup): EduForm {
  return {
    title: x ? "تعديل المجموعة" : "مجموعة جديدة",
    action: "edu.group.save",
    body: (
      <>
        <div className="edu-two">
          {input("كود المجموعة", "code", x?.code, true)}
          {input("اسم المجموعة", "name", x?.name, true)}
          <Field label="الدورة">
            <select name="courseId" required defaultValue={x?.courseId ?? ""}>
              <option value="">اختر دورة</option>
              {s.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? "" : " — متوقفة"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="المدرس">
            <select name="teacherId" required defaultValue={x?.teacherId ?? ""}>
              <option value="">اختر مدرسًا</option>
              {s.teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.active ? "" : " — متوقف"}
                </option>
              ))}
            </select>
          </Field>
          {input(
            "بداية المجموعة",
            "startDay",
            x?.startDay ?? today(),
            true,
            "date",
          )}
          {input(
            "نهاية المجموعة",
            "endDay",
            x?.endDay ?? today(),
            true,
            "date",
          )}
          <Field label="رسوم الاشتراك، ج.م">
            <input
              name="fee"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={x ? decimal(x.fee ?? 0) : ""}
            />
          </Field>
          <Field label="عدد الأماكن">
            <input
              name="capacity"
              type="number"
              min="1"
              max="500"
              step="1"
              required
              defaultValue={x?.capacity ?? ""}
            />
          </Field>
        </div>
        <p>
          الرسوم الجديدة تخص التسجيلات القادمة؛ رسوم الاشتراكات السابقة محفوظة
          وقت التسجيل.
        </p>
        {memo("ملاحظات المجموعة الإدارية", "note", x?.note)}
        {active(x ? !!x.active : true)}
      </>
    ),
    payload: (f) => ({
      ...(x && { id: x.id, version: x.version }),
      code: text(f, "code"),
      name: text(f, "name"),
      courseId: text(f, "courseId"),
      teacherId: text(f, "teacherId"),
      startDay: text(f, "startDay"),
      endDay: text(f, "endDay"),
      fee: readMoney(text(f, "fee")),
      capacity: Number(text(f, "capacity")),
      note: text(f, "note"),
      active: f.has("active"),
    }),
  };
}
function EnrollmentFields({
  s,
  studentId,
  groupId,
}: {
  s: EduState;
  studentId: string;
  groupId: string;
}) {
  const [g, setG] = useState(groupId),
    [discount, setDiscount] = useState("0"),
    group = s.groups.find((x) => x.id === g);
  let due = null;
  try {
    due = (group?.fee ?? 0) - readMoney(discount);
  } catch {}
  return (
    <>
      <Field label="الطالب">
        <select name="studentId" defaultValue={studentId} required>
          <option value="">اختر طالبًا نشطًا</option>
          {s.students
            .filter((x) => x.active)
            .map((x) => (
              <option value={x.id} key={x.id}>
                {x.name} · {x.code}
              </option>
            ))}
        </select>
      </Field>
      <Field label="المجموعة">
        <select
          name="groupId"
          value={g}
          required
          onChange={(e) => setG(e.target.value)}
        >
          <option value="">اختر مجموعة</option>
          {s.groups
            .filter((x) => x.active)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.count}/{x.capacity}
              </option>
            ))}
        </select>
      </Field>
      {group && (
        <p className="edu-callout">
          رسوم المجموعة {amount(group.fee ?? 0)} ج.م · متاح{" "}
          {group.capacity - group.count} مكان
        </p>
      )}
      <Field label="خصم التسجيل، ج.م">
        <input
          name="discount"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          type="number"
          min="0"
          step="0.01"
          required
        />
      </Field>
      {group && (
        <strong>
          المستحق عند التسجيل{" "}
          {due !== null && due >= 0 ? amount(due) : "راجع الخصم"} ج.م
        </strong>
      )}
      <label className="a-check">
        <input type="checkbox" required />
        راجعت الطالب والمجموعة والرسوم
      </label>
    </>
  );
}
export function enrollmentForm(
  s: EduState,
  studentId = "",
  groupId = "",
): EduForm {
  return {
    title: "تسجيل طالب في مجموعة",
    action: "edu.enrollment.add",
    body: <EnrollmentFields s={s} studentId={studentId} groupId={groupId} />,
    submit: "تأكيد التسجيل",
    payload: (f) => {
      const sid = text(f, "studentId"),
        gid = text(f, "groupId"),
        student = s.students.find((x) => x.id === sid),
        group = s.groups.find((x) => x.id === gid);
      if (!student || !group) throw new Error("اختر طالبًا ومجموعة");
      return {
        studentId: sid,
        studentVersion: student.version,
        groupId: gid,
        groupVersion: group.version,
        discount: readMoney(text(f, "discount")),
      };
    },
  };
}
export function academicForm(
  s: EduState,
  kind: "session" | "exam",
  groupId = "",
): EduForm {
  return {
    title: kind === "session" ? "حصة جديدة" : "اختبار جديد",
    action: kind === "session" ? "edu.session.save" : "edu.exam.add",
    body: (
      <>
        <Field label="المجموعة">
          <select name="groupId" defaultValue={groupId} required>
            <option value="">اختر مجموعة نشطة</option>
            {s.groups
              .filter((x) => x.active)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {x.teacherName}
                </option>
              ))}
          </select>
        </Field>
        {input(
          kind === "session" ? "عنوان الحصة" : "اسم الاختبار",
          "title",
          "",
          true,
        )}
        {input("التاريخ", "day", today(), true, "date")}
        {kind === "session" ? (
          <div className="edu-two">
            {input("بداية الحصة", "startMinute", "09:00", true, "time")}
            <Field label="المدة بالدقائق">
              <input
                name="duration"
                type="number"
                min="1"
                max="720"
                step="1"
                defaultValue="60"
                required
              />
            </Field>
          </div>
        ) : (
          <Field label="الدرجة النهائية">
            <input
              name="maxScore"
              type="number"
              min="0.01"
              step="0.01"
              max="10000"
              required
            />
          </Field>
        )}
        {memo("ملاحظات الدرس أو الاختبار", "note")}
        <p className="edu-callout">
          قائمة الطلاب تثبت عند الإنشاء من الاشتراكات النشطة؛ أي تسجيل لاحق لن
          يغيرها تلقائيًا.
        </p>
      </>
    ),
    payload: (f) => ({
      groupId: text(f, "groupId"),
      title: text(f, "title"),
      day: text(f, "day"),
      note: text(f, "note"),
      ...(kind === "session"
        ? {
            startMinute: minutes(text(f, "startMinute")),
            duration: Number(text(f, "duration")),
          }
        : { maxScore: readMoney(text(f, "maxScore")) }),
    }),
  };
}
