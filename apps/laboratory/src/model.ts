import { Money } from "@xzare/core";
import type { Laboratory, LabOrderDetail } from "@xzare/engine";
export type State = ReturnType<Laboratory["state"]>;
export type Detail = LabOrderDetail;
export const roles = {
  hr: "شؤون الموظفين",
  payroll: "مسؤول الرواتب",
  teacher: "غير متاح في هذا المنتج",
  trainer: "غير متاح في هذا المنتج",
  stylist: "غير متاح في هذا المنتج",
  admin: "مسؤول النظام",
  manager: "مراجع النتائج ومدير المعمل",
  cashier: "الاستقبال والتحصيل",
  technician: "فني المعمل",
  doctor: "غير مستخدم",
  kitchen: "غير مستخدم",
};
export const statuses = {
  testing: "قيد العمل",
  released: "معتمد",
  cancelled: "ملغي",
};
export const sampleStatuses = {
  pending: "بانتظار السحب",
  collected: "تم السحب",
  received: "مستلمة",
  rejected: "مرفوضة",
};
export const methods = { cash: "نقدي", bank: "تحويل بنكي", card: "بطاقة" };
export const flags = {
  low: "أقل من المجال",
  high: "أعلى من المجال",
  normal: "داخل المجال",
  unclassified: "—",
};
export const stamp = (n: number) =>
  new Date(n).toLocaleString("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
export const localInput = (n: number) => {
  const d = new Date(n);
  return (
    [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("-") +
    "T" +
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0")
  );
};
export function readMoney(s: unknown) {
  const r = Money.parse(s);
  if (!r.ok || r.value < 0)
    throw new Error("أدخل مبلغًا صحيحًا حتى خانتين عشريتين");
  return r.value as number;
}
