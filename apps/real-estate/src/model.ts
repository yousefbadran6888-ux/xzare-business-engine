import { Money } from '@xzare/core'
export const readMoney = (s: unknown) => {
  const r = Money.parse(s)
  if (!r.ok || r.value < 0 || r.value > 1e12) throw Error('أدخل مبلغًا صحيحًا حتى خانتين')
  return r.value as number
}
export const passwordValue = (f: FormData, n: string) => String(f.get(n) ?? '')
export const stamp = (n: number) =>
  new Date(n).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
export const roles: Record<string, string> = {
  admin: 'مسؤول النظام',
  manager: 'مدير المكتب',
  cashier: 'موظف التحصيل',
}
export const statuses: Record<string, string> = {
  reserved: 'محجوزة',
  contracted: 'تم التعاقد',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
}
export const categories: Record<string, string> = {
  apartment: 'شقة',
  villa: 'فيلا',
  office: 'مكتب',
  shop: 'محل',
  land: 'أرض',
  other: 'أخرى',
}
export const offers: Record<string, string> = { sale: 'بيع', lease: 'إيجار', both: 'بيع أو إيجار' }
export const availability: Record<string, string> = {
  available: 'متاحة',
  sold: 'مباعة',
  leased: 'مؤجرة',
}
export const kinds: Record<string, string> = { owner: 'مالك', client: 'عميل', broker: 'وسيط' }
export const channels: Record<string, string> = {
  deposit: 'عربون وأمانات',
  fee: 'عمولة المكتب',
  broker: 'حصة الوسيط',
}
export const movements: Record<string, string> = {
  receipt: 'تحصيل',
  refund: 'رد مبلغ',
  handover: 'تسليم للمالك',
  payout: 'صرف للوسيط',
  void: 'تصحيح عكسي',
}
export const methods: Record<string, string> = { cash: 'نقدي', card: 'بطاقة', transfer: 'تحويل' }
export const eventLabel = (s: string) =>
  (
    ({
      're.deal.add': 'حجز صفقة',
      're.contract.record': 'تسجيل عقد موقع',
      're.deal.complete': 'إتمام الصفقة',
      're.deal.cancel': 'إلغاء الصفقة',
      're.entry.post': 'حركة مالية',
      're.entry.void': 'تصحيح حركة',
      're.contact.save': 'حفظ جهة اتصال',
      're.unit.save': 'حفظ وحدة',
      're.unit.relist': 'إعادة عرض وحدة',
      'settings.save': 'حفظ الإعدادات',
      'user.save': 'حفظ مستخدم',
      setup: 'إعداد المكتب',
      login: 'دخول',
      logout: 'خروج',
      'password.change': 'تغيير كلمة المرور',
      'backup.create': 'نسخة احتياطية',
      'backup.restore': 'استعادة نسخة',
    }) as Record<string, string>
  )[s] ?? 'عملية مسجلة'
