import { Icon } from './Icon'
export function WorkspaceHelp({ manager }: { manager: boolean }) {
  return (
    <div className="workspace-help">
      <p className="muted">خطوات قليلة للعمل اليومي. كل حركة تحفظ بعد تأكيدك.</p>
      <ol className="help-steps">
        {manager && (
          <li>
            <Icon name="barcode" />
            <div>
              <strong>جهّز أصنافك مرة واحدة</strong>
              <p>
                أضف الاسم والسعر والباركود من «الأصناف»، ثم سجّل رصيد المخزون أو فاتورة شراء. حافظ
                على الأصفار في بداية الباركود.
              </p>
            </div>
          </li>
        )}
        <li>
          <Icon name="shifts" />
          <div>
            <strong>افتح وردية قبل البيع</strong>
            <p>استخدم زر الوردية أعلى الشاشة، وسجّل النقدية الافتتاحية الفعلية.</p>
          </div>
        </li>
        <li>
          <Icon name="pos" />
          <div>
            <strong>امسح الباركود أو ابحث</strong>
            <p>
              في نقطة البيع، ركّز حقل الباركود قبل المسح. راجع الكميات وطريقة الدفع، ثم احفظ
              الفاتورة.
            </p>
          </div>
        </li>
        <li>
          <Icon name="invoices" />
          <div>
            <strong>راجع يومك وأغلق الوردية</strong>
            <p>
              المرتجع يبدأ من الفاتورة الأصلية. عند الإغلاق، سجّل المبلغ الموجود فعلًا في الخزينة.
            </p>
          </div>
        </li>
      </ol>
      <div className="shortcut-list">
        <span>
          <kbd>F2</kbd> نقطة البيع
        </span>
        {manager && (
          <span>
            <kbd>Alt + N</kbd> إضافة صنف
          </span>
        )}
        <span>
          <kbd>Alt + H</kbd> المساعدة
        </span>
        <span>
          <kbd>Esc</kbd> إغلاق النافذة
        </span>
      </div>
      <small>
        الاختصارات لا تعمل أثناء الكتابة أو مسح الباركود. قفل البرنامج من زر القفل أعلى الشاشة.
      </small>
    </div>
  )
}
