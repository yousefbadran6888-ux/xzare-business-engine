export type Role =
  | 'admin'
  | 'manager'
  | 'cashier'
  | 'kitchen'
  | 'doctor'
  | 'technician'
  | 'hr'
  | 'payroll'
  | 'teacher'
  | 'trainer'
  | 'stylist'
export interface User {
  id: string
  username: string
  name: string
  role: Role
  active: number
}
export interface Product {
  id: string
  product_id: string
  name: string
  variant_name: string
  sku: string
  unit: string
  price: number
  reorder_qty: number
  qty: number
  cost: number
  category: string
  active: number
  barcode: string | null
  format: string | null
}
export interface Party {
  id: string
  kind: 'customer' | 'supplier'
  name: string
  phone: string
  address: string
  active: number
  balance: number
}
export interface Invoice {
  id: string
  number: string
  kind: 'sale' | 'purchase'
  user_id: string
  party_id: string | null
  at: number
  subtotal: number
  discount: number
  tax: number
  total: number
  cost: number
  paid: number
  returned: number
  refunded: number
  balance: number
  note: string
  party_name: string | null
  change: number
}
export interface InvoiceLine {
  id: string
  invoice_id: string
  variant_id: string
  name: string
  unit: string
  qty: number
  price: number
  total: number
  cost: number
  returned_qty: number
}
export interface Shift {
  id: string
  user_id: string
  opened_at: number
  opening: number
  closed_at: number | null
  actual: number | null
  expected: number
}
export interface CashMovement {
  id: string
  amount: number
  kind: string
  note: string
  at: number
}
export interface Hold {
  id: string
  title: string
  payload: string
  at: number
}
export interface Audit {
  id: string
  action: string
  entity_id: string
  at: number
  user_name: string | null
}
export interface StockMovement {
  note: string
  id: string
  name: string
  qty: number
  cost: number
  kind: string
  at: number
}
export interface AppState {
  user: User
  settings: Record<string, string>
  products: Product[]
  parties: Party[]
  invoices: Invoice[]
  shift: Shift | null
  shifts: Shift[]
  cash: CashMovement[]
  holds: Hold[]
  users: User[]
  audit: Audit[]
  movements: StockMovement[]
}
