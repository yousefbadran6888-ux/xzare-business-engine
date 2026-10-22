import { Money } from "@xzare/core";
export const roles = {
  hr: "شؤون الموظفين",
  payroll: "مسؤول الرواتب",
  teacher: "غير متاح في هذا المنتج",
  trainer: "غير متاح في هذا المنتج",
  stylist: "غير متاح في هذا المنتج",
  admin: "مسؤول النظام",
  manager: "مدير الصيدلية",
  cashier: "موظف الكاونتر",
  kitchen: "غير مستخدم",
  doctor: "غير مستخدم",
  technician: "غير مستخدم",
};
export const methods = { cash: "نقدي", bank: "تحويل بنكي", card: "بطاقة" };
export const statusLabels = {
  available: "متاح",
  quarantine: "معزول",
  recalled: "مسحوب",
};
export const documentKinds = {
  receipt: "استلام",
  sale: "صرف",
  return: "مرتجع",
  dispose: "هالك",
  status: "حالة تشغيلة",
};
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
