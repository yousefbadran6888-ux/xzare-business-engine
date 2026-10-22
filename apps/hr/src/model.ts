import { Money } from "@xzare/core";
export const roles = {
  admin: "مسؤول النظام",
  manager: "مدير الموارد البشرية",
  hr: "شؤون الموظفين",
  payroll: "مسؤول الرواتب",
  teacher: "غير متاح في هذا المنتج",
  trainer: "غير متاح في هذا المنتج",
  stylist: "غير متاح في هذا المنتج",
  cashier: "غير مستخدم",
  kitchen: "غير مستخدم",
  doctor: "غير مستخدم",
  technician: "غير مستخدم",
};
export const leaveLabels = {
  pending: "بانتظار القرار",
  approved: "معتمدة",
  rejected: "مرفوضة",
  cancelled: "ملغاة",
};
export const payrollLabels = {
  submitted: "بانتظار الاعتماد",
  approved: "معتمد للصرف",
  void: "ملغى",
};
export const methods = { cash: "نقدي", bank: "تحويل بنكي", card: "بطاقة" };
export const stamp = (n: number) =>
  new Date(n).toLocaleString("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
export function readMoney(s: unknown) {
  const r = Money.parse(s);
  if (!r.ok || r.value < 0)
    throw new Error("أدخل مبلغًا صحيحًا حتى خانتين عشريتين");
  return r.value as number;
}
export const clock = (m: number | null) =>
  m === null
    ? "—"
    : String(Math.floor((m % 1440) / 60)).padStart(2, "0") +
      ":" +
      String(m % 60).padStart(2, "0") +
      (m >= 1440 ? " +1" : "");
export const minutes = (s: unknown) => {
  const x = /^(\d{2}):(\d{2})$/.exec(String(s));
  if (!x || Number(x[1]) > 23 || Number(x[2]) > 59)
    throw new Error("راجع الوقت");
  return Number(x[1]) * 60 + Number(x[2]);
};
export const dayOffset = (day: string, n: number) =>
  new Date(Date.parse(day + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
