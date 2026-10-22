import { Money } from "@xzare/core";
import type { Clinic } from "@xzare/engine";
export type State = ReturnType<Clinic["state"]>;
export type VisitDetail = {
  visit: {
    id: string;
    appointmentId: string;
    version: number;
    openedAt: number;
    finalizedAt: number | null;
    complaint: string;
    assessment: string;
    plan: string;
  };
  appointment: import("@xzare/engine").ClinicAppointment;
  patient: import("@xzare/engine").ClinicPatient;
  doctor: import("@xzare/engine").ClinicDoctor;
  addenda: {
    id: string;
    at: number;
    note: string;
    reason: string;
    userName: string;
  }[];
};
export type InvoiceDetail = {
  invoice: import("@xzare/engine").ClinicInvoice;
  lines: {
    id: string;
    name: string;
    qty: number;
    price: number;
    total: number;
  }[];
  payments: {
    id: string;
    at: number;
    amount: number;
    method: string;
    reference: string;
  }[];
  refund?: {
    at: number;
    amount: number;
    note: string;
    method: string;
    reference: string;
  };
};
export type PatientHistory = {
  patient: import("@xzare/engine").ClinicPatient;
  appointments: import("@xzare/engine").ClinicAppointment[];
  invoices: import("@xzare/engine").ClinicInvoice[];
};
export const statuses = {
  scheduled: "محجوز",
  checked_in: "وصل المريض",
  in_visit: "في الزيارة",
  completed: "مكتمل",
  cancelled: "ملغي",
  no_show: "لم يحضر",
};
export const roles = {
  hr: "شؤون الموظفين",
  payroll: "مسؤول الرواتب",
  teacher: "غير متاح في هذا المنتج",
  trainer: "غير متاح في هذا المنتج",
  stylist: "غير متاح في هذا المنتج",
  admin: "مسؤول النظام",
  manager: "مدير العيادة",
  cashier: "الاستقبال والتحصيل",
  technician: "غير مستخدم في هذا المنتج",
  doctor: "طبيب",
  kitchen: "غير مستخدم",
};
export const methods = { cash: "نقدي", bank: "تحويل بنكي", card: "بطاقة" };
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
export const stamp = (n: number) =>
  new Date(n).toLocaleString("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
export const clock = (n: number) =>
  new Date(n).toLocaleTimeString("ar-EG", {
    hour: "2-digit",
    minute: "2-digit",
  });
export function readMoney(s: unknown) {
  const r = Money.parse(s);
  if (!r.ok || r.value < 0)
    throw new Error("أدخل مبلغًا صحيحًا حتى خانتين عشريتين");
  return r.value as number;
}
