import { Money } from '@xzare/core'
export const readMoney = (s: unknown) => {
  const r = Money.parse(s)
  if (!r.ok || r.value < 0 || r.value > 1e12)
    throw Error('أدخل مبلغًا صحيحًا حتى خانتين')
  return r.value as number
}
export const stamp = (n: number) =>
  new Date(n).toLocaleString('ar-EG', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
export const passwordValue = (f: FormData, n: string) => String(f.get(n) ?? '')
export const addDay = (d: string, n: number) =>
  new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000)
    .toISOString()
    .slice(0, 10)
export const roles: Record<string, string> = {
  admin: 'مسؤول النظام',
  manager: 'مدير الفندق',
  cashier: 'الاستقبال',
}
export const statuses: Record<string, string> = {
  reserved: 'محجوز',
  'in-house': 'داخل الفندق',
  'checked-out': 'غادر',
  cancelled: 'ملغى',
  'no-show': 'لم يحضر',
}
export const cleanLabels: Record<string, string> = {
  ready: 'جاهزة',
  dirty: 'تحتاج تنظيف',
  cleaning: 'جارٍ التجهيز',
}
export const methods: Record<string, string> = {
  cash: 'نقدي',
  card: 'بطاقة',
  transfer: 'تحويل',
}
export const ledgerLabels: Record<string, string> = {
  room: 'رسوم إقامة',
  adjustment: 'تعديل الإقامة',
  extra: 'خدمة إضافية',
  'extra-void': 'تصحيح رسم',
  receipt: 'تحصيل',
  refund: 'رد مبلغ',
  'payment-void': 'تصحيح إيصال',
  cancel: 'إلغاء رسوم الحجز',
}
export const eventLabel = (s: string) =>
  (
    ({
      'hotel.reservation.add': 'إنشاء حجز',
      'hotel.reservation.change': 'تعديل الإقامة',
      'hotel.reservation.checkin': 'دخول النزيل',
      'hotel.reservation.checkout': 'مغادرة النزيل',
      'hotel.reservation.cancel': 'إلغاء الحجز',
      'hotel.reservation.no-show': 'عدم الحضور',
      'hotel.housekeeping.set': 'تجهيز غرفة',
      'hotel.room.block': 'إيقاف غرفة',
      'hotel.room.save': 'حفظ غرفة',
      'hotel.guest.save': 'حفظ نزيل',
      'hotel.charge.add': 'رسم إضافي',
      'hotel.charge.void': 'تصحيح رسم',
      'hotel.payment.post': 'تحصيل أو رد',
      'hotel.payment.void': 'تصحيح إيصال',
      login: 'تسجيل الدخول',
      logout: 'تسجيل الخروج',
      setup: 'إنشاء الفندق',
      'user.save': 'حفظ مستخدم',
      'password.change': 'تغيير كلمة المرور',
      'settings.save': 'حفظ الإعدادات',
      'backup.create': 'إنشاء نسخة',
      'backup.restore': 'استعادة نسخة',
    }) as Record<string, string>
  )[s] ?? 'عملية مسجلة'
