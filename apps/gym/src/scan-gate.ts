export type ScanTicket = { epoch: number; code: string }
export class ScanGate {
  private epoch = 0
  private code = ''
  change(code: string) {
    this.epoch++
    this.code = code.trim()
  }
  begin(): ScanTicket {
    return { epoch: ++this.epoch, code: this.code }
  }
  accept(ticket: ScanTicket) {
    return (
      ticket.epoch === this.epoch && ticket.code === this.code && !!ticket.code
    )
  }
  clear() {
    this.change('')
  }
}
