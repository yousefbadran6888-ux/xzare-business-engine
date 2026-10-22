import { useState } from 'react'
import { Money } from '@xzare/core'
import type { Account, Journal, JournalLine } from '@xzare/engine'
import { Modal, Field, amount, decimal, today } from './ui'
type Line = { accountId: string; debit: string; credit: string; note: string }
const blank = (): Line => ({ accountId: '', debit: '', credit: '', note: '' })
export function DraftEditor({
  accounts,
  journal,
  busy,
  error,
  onClose,
  onSave,
}: {
  accounts: Account[]
  journal?: Journal
  busy: boolean
  error: string
  onClose: () => void
  onSave: (value: unknown) => void
}) {
  const [date, setDate] = useState(journal?.date ?? today()),
    [memo, setMemo] = useState(journal?.memo ?? ''),
    [lines, setLines] = useState<Line[]>(
      journal?.lines.map((l) => ({
        ...l,
        debit: l.debit ? decimal(l.debit) : '',
        credit: l.credit ? decimal(l.credit) : '',
      })) ?? [blank(), blank()],
    )
  const selectable = accounts.filter(
    (a) =>
      a.active &&
      !accounts.some((b) => b.parentId === a.id) &&
      (() => {
        let p = a.parentId
        while (p) {
          const parent = accounts.find((b) => b.id === p)
          if (!parent?.active) return false
          p = parent.parentId
        }
        return true
      })(),
  )
  const parsed: JournalLine[] = lines.map((l) => {
      const d = Money.parse(l.debit || '0'),
        c = Money.parse(l.credit || '0')
      return {
        accountId: l.accountId,
        debit: d.ok ? d.value : -1,
        credit: c.ok ? c.value : -1,
        note: l.note,
      }
    }),
    dr = parsed.reduce((s, l) => s + Math.max(l.debit, 0), 0),
    cr = parsed.reduce((s, l) => s + Math.max(l.credit, 0), 0),
    valid =
      parsed.every(
        (l) =>
          selectable.some((a) => a.id === l.accountId) &&
          ((l.debit > 0 && l.credit === 0) || (l.credit > 0 && l.debit === 0)) &&
          l.debit <= 1e12 &&
          l.credit <= 1e12,
      ) &&
      dr === cr &&
      dr > 0 &&
      dr <= 1e12
  const update = (i: number, k: keyof Line, v: string) =>
    setLines((prev) => prev.map((l, n) => (n === i ? { ...l, [k]: v } : l)))
  return (
    <Modal
      title={journal ? 'تعديل المسودة' : 'قيد جديد'}
      busy={busy}
      error={error}
      onClose={onClose}
      disabled={!valid}
      submit="حفظ المسودة"
      onSubmit={() =>
        onSave({
          ...(journal ? { id: journal.id, version: journal.version } : {}),
          date,
          memo,
          lines: parsed,
        })
      }
    >
      <p className="muted">
        سجّل المبلغ في مدين أو دائن لكل سطر. الحفظ لا يؤثر على التقارير حتى ترحيل القيد.
      </p>
      <div className="a-form-row">
        <Field label="تاريخ القيد">
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="البيان">
          <input required maxLength={1000} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>
      </div>
      <div className="a-scroll">
        <table className="a-lines">
          <thead>
            <tr>
              <th>الحساب</th>
              <th>مدين · ج.م</th>
              <th>دائن · ج.م</th>
              <th>ملاحظة</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <select
                    aria-label={'الحساب السطر ' + (i + 1)}
                    required
                    value={l.accountId}
                    onChange={(e) => update(i, 'accountId', e.target.value)}
                  >
                    <option value="">اختر الحساب</option>
                    {selectable.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={'مدين السطر ' + (i + 1)}
                    dir="ltr"
                    inputMode="decimal"
                    value={l.debit}
                    maxLength={20}
                    onChange={(e) => update(i, 'debit', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    aria-label={'دائن السطر ' + (i + 1)}
                    dir="ltr"
                    inputMode="decimal"
                    value={l.credit}
                    maxLength={20}
                    onChange={(e) => update(i, 'credit', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    aria-label={'ملاحظة السطر ' + (i + 1)}
                    maxLength={300}
                    value={l.note}
                    onChange={(e) => update(i, 'note', e.target.value)}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    aria-label={'حذف السطر ' + (i + 1)}
                    disabled={lines.length <= 2 || busy}
                    onClick={() => setLines(lines.filter((_, n) => n !== i))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        disabled={lines.length >= 200 || busy}
        onClick={() => setLines([...lines, blank()])}
      >
        + إضافة سطر
      </button>
      <div className="a-balance" aria-live="polite">
        <span>
          مدين <b>{amount(dr)}</b>
        </span>
        <span>
          دائن <b>{amount(cr)}</b>
        </span>
        <strong className={valid ? 'a-ok' : 'a-warn'}>
          {valid ? 'القيد متوازن' : 'الفرق: ' + amount(Math.abs(dr - cr))}
        </strong>
      </div>
      {!valid && <small>اختر الحسابات، وأدخل مبالغ موجبة متساوية على الجانبين.</small>}
    </Modal>
  )
}
