import { Component, type ReactNode } from 'react'
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? (
      <main className="auth">
        <section className="panel">
          <h1>تعذر عرض هذه الشاشة</h1>
          <p>أعد تحميل الواجهة. العمليات المحفوظة موجودة في قاعدة البيانات.</p>
          <button className="primary" onClick={() => location.reload()}>
            إعادة تحميل
          </button>
          <p>hello@xzare.com · +201501230440</p>
        </section>
      </main>
    ) : (
      this.props.children
    )
  }
}
