import { Money, Quantity, basisPoints, lineTotal } from "@xzare/core";
export const roles = {
  admin: "مسؤول النظام",
  manager: "مدير المبيعات",
  cashier: "مندوب مبيعات",
  hr: "غير مستخدم",
  payroll: "غير مستخدم",
  teacher: "غير متاح في هذا المنتج",
  trainer: "غير متاح في هذا المنتج",
  stylist: "غير متاح في هذا المنتج",
  kitchen: "غير مستخدم",
  doctor: "غير مستخدم",
  technician: "غير مستخدم",
};
export const stages = {
  new: "جديدة",
  qualified: "مؤهلة",
  proposal: "عرض مقدم",
  negotiation: "تفاوض",
  won: "فائزة",
  lost: "خاسرة",
};
export const leadStatuses = {
  new: "جديد",
  qualified: "مؤهل",
  disqualified: "غير مؤهل",
  converted: "محول لعميل",
};
export const quoteStatuses = {
  issued: "صادر",
  accepted: "مقبول",
  rejected: "مرفوض",
  withdrawn: "مسحوب",
};
export const taskKinds = {
  call: "اتصال",
  meeting: "اجتماع",
  email: "بريد",
  other: "متابعة",
};
export const stamp = (n: number) =>
  new Date(n).toLocaleString("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
export const clock = (n: number) =>
  String(Math.floor(n / 60)).padStart(2, "0") +
  ":" +
  String(n % 60).padStart(2, "0");
export const minutes = (s: unknown) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59)
    throw new Error("راجع الوقت");
  return Number(m[1]) * 60 + Number(m[2]);
};
export const readMoney = (s: unknown) => {
  const r = Money.parse(s);
  if (!r.ok || r.value < 0 || r.value > 1e12)
    throw new Error("أدخل مبلغًا صحيحًا حتى خانتين عشريتين");
  return r.value as number;
};
export const readQty = (s: unknown) => {
  const r = Quantity.parse(s);
  if (!r.ok || r.value <= 0 || r.value > 1e9)
    throw new Error("أدخل كمية أكبر من صفر حتى ثلاث خانات عشرية");
  return r.value as number;
};
export const quantity = (n: number) =>
  Quantity.toCompactString(Quantity.fromMilliUnits(n));
export function quotationTotal(
  lines: { qty: number; price: number }[],
  discount: number,
  taxBps: number,
) {
  const safe = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0 || n > 1e12)
      throw new Error("راجع مبالغ العرض");
    return n;
  };
  if (!Number.isInteger(taxBps) || taxBps < 0 || taxBps > 10000)
    throw new Error("راجع نسبة الضريبة");
  const values = lines.map((x) => {
      if (!Number.isSafeInteger(x.qty) || x.qty <= 0 || x.qty > 1e9)
        throw new Error("راجع الكمية");
      safe(x.price);
      return safe(
        lineTotal(
          Money.fromPiastres(x.price),
          Quantity.fromMilliUnits(x.qty),
        ) as number,
      );
    }),
    subtotal = values.reduce((n, x) => safe(n + x), 0);
  safe(discount);
  if (discount > subtotal) throw new Error("الخصم أكبر من الإجمالي");
  const tax = Money.applyRate(
    Money.fromPiastres(subtotal - discount),
    basisPoints(taxBps),
  ) as number;
  return { values, subtotal, tax, total: safe(subtotal - discount + tax) };
}
