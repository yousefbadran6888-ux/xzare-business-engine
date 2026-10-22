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
  manager: 'مدير الجيم',
  cashier: 'الاستقبال والتحصيل',
  trainer: 'مدرب',
  stylist: "غير متاح في هذا المنتج",
}
export const methods: Record<string, string> = {
  cash: 'نقدي',
  card: 'بطاقة',
  transfer: 'تحويل',
}
export const ledgerLabels: Record<string, string> = {
  charge: 'رسوم الاشتراك',
  payment: 'تحصيل',
  void: 'إلغاء إيصال',
  credit: 'تخفيض معتمد',
  cancel: 'إلغاء الاشتراك',
}
export const sessionLabels: Record<string, string> = {
  scheduled: 'موعد قادم',
  done: 'تم التدريب',
  'no-show': 'لم يحضر',
  cancelled: 'ملغاة',
}
export const eventLabels: Record<string, string> = {
  'gym.member.save': 'بيانات العضو',
  'gym.membership.add': 'اشتراك جديد',
  'gym.membership.renew': 'تجديد اشتراك',
  'gym.membership.freeze': 'تجميد اشتراك',
  'gym.membership.assign': 'تكليف المدرب',
  'gym.membership.stop': 'إيقاف الاشتراك',
  'gym.membership.cancel': 'إلغاء التسجيل',
  'gym.payment.post': 'إيصال تحصيل',
  'gym.payment.void': 'إلغاء إيصال',
  'gym.credit.post': 'تخفيض معتمد',
  'gym.attendance.in': 'دخول عضو',
  'gym.attendance.out': 'خروج عضو',
  'gym.attendance.void': 'تصحيح حضور',
  'gym.session.save': 'موعد تدريب',
  'gym.session.cancel': 'إلغاء جلسة',
  'gym.session.mark': 'نتيجة التدريب',
}
