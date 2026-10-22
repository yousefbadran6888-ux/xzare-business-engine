export const APPLICATION_ID = 0x585a5053
export const SCHEMA_VERSION = 1
export const schema = `
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','manager','cashier')), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), failures INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE TABLE auth_attempts(key TEXT PRIMARY KEY, failures INTEGER NOT NULL, locked_until INTEGER NOT NULL);
CREATE TABLE audit_log(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), action TEXT NOT NULL, entity_id TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE commands(client_txn_id TEXT PRIMARY KEY, action TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), request_hash TEXT NOT NULL, result TEXT NOT NULL);
CREATE TABLE sequences(kind TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE warehouses(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE parties(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN('customer','supplier')), name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)));
CREATE TABLE products(id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)));
CREATE TABLE variants(id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), name TEXT NOT NULL DEFAULT '', sku TEXT UNIQUE NOT NULL, unit TEXT NOT NULL, price INTEGER NOT NULL CHECK(price BETWEEN 0 AND 9007199254740991), reorder_qty INTEGER NOT NULL DEFAULT 0 CHECK(reorder_qty>=0));
CREATE TABLE barcodes(code TEXT PRIMARY KEY, format TEXT NOT NULL CHECK(format IN('EAN8','EAN13','UPCA','GTIN14','CODE128')), variant_id TEXT NOT NULL REFERENCES variants(id));
CREATE TABLE stock_levels(variant_id TEXT NOT NULL REFERENCES variants(id), warehouse_id TEXT NOT NULL REFERENCES warehouses(id), qty INTEGER NOT NULL DEFAULT 0 CHECK(qty BETWEEN 0 AND 9007199254740991), cost INTEGER NOT NULL DEFAULT 0 CHECK(cost BETWEEN 0 AND 9007199254740991), PRIMARY KEY(variant_id,warehouse_id), CHECK(qty>0 OR cost=0));
CREATE TABLE shifts(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), opened_at INTEGER NOT NULL, opening INTEGER NOT NULL CHECK(opening>=0), closed_at INTEGER, actual INTEGER CHECK(actual>=0), expected INTEGER CHECK(expected>=0));
CREATE UNIQUE INDEX shifts_one_open ON shifts(user_id) WHERE closed_at IS NULL;
CREATE TABLE invoices(id TEXT PRIMARY KEY, number TEXT UNIQUE NOT NULL, kind TEXT NOT NULL CHECK(kind IN('sale','purchase')), user_id TEXT NOT NULL REFERENCES users(id), party_id TEXT REFERENCES parties(id), shift_id TEXT NOT NULL REFERENCES shifts(id), at INTEGER NOT NULL, subtotal INTEGER NOT NULL CHECK(subtotal>=0), discount INTEGER NOT NULL CHECK(discount>=0), tax INTEGER NOT NULL CHECK(tax>=0), total INTEGER NOT NULL CHECK(total>=0), client_txn_id TEXT UNIQUE NOT NULL, request_hash TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', cash_received INTEGER NOT NULL DEFAULT 0, change INTEGER NOT NULL DEFAULT 0);
CREATE TABLE invoice_lines(id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), variant_id TEXT NOT NULL REFERENCES variants(id), name TEXT NOT NULL, unit TEXT NOT NULL, qty INTEGER NOT NULL CHECK(qty>0), price INTEGER NOT NULL CHECK(price>=0), total INTEGER NOT NULL CHECK(total>=0), cost INTEGER NOT NULL CHECK(cost>=0));
CREATE TABLE payments(id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), shift_id TEXT NOT NULL REFERENCES shifts(id), method TEXT NOT NULL CHECK(method IN('cash','card','transfer')), amount INTEGER NOT NULL CHECK(amount>0), at INTEGER NOT NULL, client_txn_id TEXT UNIQUE NOT NULL);
CREATE TABLE returns(id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), user_id TEXT NOT NULL REFERENCES users(id), shift_id TEXT NOT NULL REFERENCES shifts(id), at INTEGER NOT NULL, total INTEGER NOT NULL CHECK(total>=0), refunded INTEGER NOT NULL CHECK(refunded>=0), method TEXT NOT NULL CHECK(method IN('cash','card','transfer')), client_txn_id TEXT UNIQUE NOT NULL, request_hash TEXT NOT NULL, note TEXT NOT NULL);
CREATE TABLE return_lines(id TEXT PRIMARY KEY, return_id TEXT NOT NULL REFERENCES returns(id), invoice_line_id TEXT NOT NULL REFERENCES invoice_lines(id), qty INTEGER NOT NULL CHECK(qty>0), total INTEGER NOT NULL CHECK(total>=0), cost INTEGER NOT NULL CHECK(cost>=0));
CREATE TABLE stock_movements(id TEXT PRIMARY KEY, variant_id TEXT NOT NULL REFERENCES variants(id), warehouse_id TEXT NOT NULL REFERENCES warehouses(id), user_id TEXT NOT NULL REFERENCES users(id), qty INTEGER NOT NULL CHECK(qty!=0), cost INTEGER NOT NULL, kind TEXT NOT NULL, document_id TEXT NOT NULL, at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '');
CREATE INDEX stock_movement_variant ON stock_movements(variant_id,warehouse_id,at);
CREATE TABLE party_ledger(id TEXT PRIMARY KEY, party_id TEXT NOT NULL REFERENCES parties(id), amount INTEGER NOT NULL CHECK(amount!=0), kind TEXT NOT NULL, document_id TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX party_entries ON party_ledger(party_id,at);
CREATE TABLE cash_movements(id TEXT PRIMARY KEY, shift_id TEXT NOT NULL REFERENCES shifts(id), user_id TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL CHECK(amount!=0), kind TEXT NOT NULL, note TEXT NOT NULL, document_id TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE expenses(id TEXT PRIMARY KEY, shift_id TEXT NOT NULL REFERENCES shifts(id), user_id TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL CHECK(amount>0), category TEXT NOT NULL, note TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE holds(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, payload TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX invoices_time ON invoices(kind,at);
CREATE INDEX lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX returns_invoice ON returns(invoice_id);
CREATE INDEX payments_invoice ON payments(invoice_id);
CREATE INDEX variants_product ON variants(product_id);
CREATE INDEX barcodes_variant ON barcodes(variant_id);
`

export const immutableTables = [
  'audit_log',
  'commands',
  'stock_movements',
  'party_ledger',
  'cash_movements',
  'invoice_lines',
  'payments',
  'returns',
  'return_lines',
  'invoices',
  'expenses',
] as const
