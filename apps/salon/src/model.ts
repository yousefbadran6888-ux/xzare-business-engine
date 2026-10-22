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
export const clock = (m: number) =>
  String(Math.floor(m / 60)).padStart(2, '0') +
  ':' +
  String(m % 60).padStart(2, '0')
export const minutes = (s: string) => {
  if (!/^\d{2}:\d{2}$/.test(s)) throw Error('وقت غير صالح')
  const [h, m] = s.split(':').map(Number)
  if (h! > 23 || m! > 59) throw Error('وقت غير صالح')
  return h! * 60 + m!
}
export const passwordValue = (f: FormData, name: string) =>
  String(f.get(name) ?? '')
export const addDay = (d: string, n: number) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isSafeInteger(n)) return ''
  const start = Date.parse(d + 'T12:00:00Z')
  if (
    !Number.isFinite(start) ||
    new Date(start).toISOString().slice(0, 10) !== d
  )
    return ''
  const end = new Date(start + n * 86400000)
  return Number.isFinite(end.getTime()) ? end.toISOString().slice(0, 10) : ''
}
export const roles = {
  admin: 'مسؤول النظام',
  manager: 'مدير الصالون',
  cashier: 'الاستقبال والتحصيل',
  stylist: 'موظف الخدمات',
}
export const bookingLabels = {
  booked: 'محجوز',
  arrived: 'وصل العميل',
  done: 'تمت الخدمة',
  'no-show': 'لم يحضر',
  cancelled: 'ملغى',
  void: 'نتيجة مصححة',
}
export const methods: Record<string, string> = {
  cash: 'نقدي',
  card: 'بطاقة',
  transfer: 'تحويل',
}
export const ledgerLabels: Record<string, string> = {
  charge: 'رسوم',
  payment: 'تحصيل',
  'payment-void': 'إلغاء إيصال',
  reverse: 'عكس الرسوم',
  earned: 'عمولة خدمة',
  payout: 'صرف عمولة',
  'payout-void': 'تصحيح صرف',
}

export const eventLabel = (action: string) =>
  (
    ({
      'sal.customer.save': 'حفظ بيانات العميل',
      'sal.service.save': 'حفظ الخدمة',
      'sal.staff.save': 'حفظ الموظف',
      'sal.plan.save': 'حفظ تعريف الباقة',
      'sal.booking.add': 'حجز موعد',
      'sal.booking.move': 'نقل الموعد',
      'sal.booking.arrive': 'وصول العميل',
      'sal.booking.complete': 'إتمام الخدمة',
      'sal.booking.cancel': 'إلغاء الموعد',
      'sal.booking.no-show': 'تسجيل عدم الحضور',
      'sal.booking.void': 'تصحيح نتيجة الخدمة',
      'sal.package.sell': 'بيع باقة',
      'sal.package.cancel': 'إلغاء باقة',
      'sal.payment.post': 'تحصيل فاتورة',
      'sal.payment.void': 'إلغاء إيصال',
      'sal.commission.pay': 'صرف عمولة',
      'sal.commission.void': 'تصحيح صرف عمولة',
      login: 'تسجيل الدخول',
      logout: 'تسجيل الخروج',
      setup: 'إنشاء الصالون',
      'user.save': 'حفظ المستخدم',
      'password.change': 'تغيير كلمة المرور',
      'settings.save': 'حفظ الإعدادات',
      'backup.create': 'إنشاء نسخة احتياطية',
      'backup.restore': 'استعادة نسخة احتياطية',
    }) as Record<string, string>
  )[action] ?? 'عملية مسجلة'
