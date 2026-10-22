import { Money } from "@xzare/core";
export const readMoney = (s: unknown) => {
  const r = Money.parse(s);
  if (!r.ok || r.value < 0 || r.value > 1e12)
    throw new Error("أدخل قيمة صحيحة حتى خانتين");
  return r.value as number;
};
export const stamp = (n: number) =>
  new Date(n).toLocaleString("ar-EG", {
    dateStyle: "short",
    timeStyle: "short",
  });
export const clock = (m: number) =>
  String(Math.floor(m / 60)).padStart(2, "0") +
  ":" +
  String(m % 60).padStart(2, "0");
export const minutes = (s: string) => {
  if (!/^\d{2}:\d{2}$/.test(s)) throw new Error("وقت غير صالح");
  const [h, m] = s.split(":").map(Number);
  if (h! > 23 || m! > 59) throw new Error("وقت غير صالح");
  return h! * 60 + m!;
};
export const roles: Record<string, string> = {
  admin: "مسؤول النظام",
  manager: "مدير المركز",
  cashier: "الاستقبال والتحصيل",
  teacher: "مدرس",
  trainer: "غير متاح في هذا المنتج",
  stylist: "غير متاح في هذا المنتج",
};
export const attendanceLabels: Record<string, string> = {
  present: "حاضر",
  absent: "غائب",
  late: "متأخر",
  excused: "بعذر",
};
export const ledgerLabels: Record<string, string> = {
  charge: "رسوم التسجيل",
  payment: "تحصيل",
  void: "إلغاء إيصال",
  credit: "تخفيض معتمد",
  cancel: "إلغاء الاشتراك",
};
export const methods: Record<string, string> = {
  cash: "نقدي",
  card: "بطاقة",
  transfer: "تحويل",
};
export const eventLabels: Record<string, string> = {
  "edu.student.save": "بيانات الطالب",
  "edu.enrollment.add": "تسجيل في المجموعة",
  "edu.enrollment.cancel": "إلغاء اشتراك",
  "edu.payment.post": "إيصال تحصيل",
  "edu.payment.void": "إلغاء إيصال",
  "edu.credit.post": "تخفيض الرسوم",
  "edu.session.save": "تسجيل حصة",
  "edu.session.cancel": "إلغاء حصة",
  "edu.attendance.save": "تسجيل أو تصحيح حضور",
  "edu.exam.add": "إنشاء اختبار",
  "edu.grades.save": "تسجيل أو تصحيح درجات",
};
