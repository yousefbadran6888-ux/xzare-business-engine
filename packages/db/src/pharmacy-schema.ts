export const PHARMACY_APPLICATION_ID = 0x585a5048
export const pharmacySchema = `
CREATE TABLE pharmacy_medicines(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,ingredient TEXT NOT NULL,strength TEXT NOT NULL,form TEXT NOT NULL,unit TEXT NOT NULL,manufacturer TEXT NOT NULL,price INTEGER NOT NULL CHECK(price BETWEEN 0 AND 1000000000000),reorder_qty INTEGER NOT NULL,barcode TEXT,format TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),version INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX pharmacy_barcode ON pharmacy_medicines(barcode) WHERE barcode IS NOT NULL;
CREATE TABLE pharmacy_alternatives(medicine_id TEXT NOT NULL REFERENCES pharmacy_medicines(id),alternative_id TEXT NOT NULL REFERENCES pharmacy_medicines(id),PRIMARY KEY(medicine_id,alternative_id),CHECK(medicine_id!=alternative_id));
CREATE TABLE pharmacy_suppliers(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL,address TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE pharmacy_lots(id TEXT PRIMARY KEY,medicine_id TEXT NOT NULL REFERENCES pharmacy_medicines(id),batch TEXT NOT NULL,expiry TEXT NOT NULL,UNIQUE(medicine_id,batch));
CREATE TABLE pharmacy_lot_status(lot_id TEXT PRIMARY KEY REFERENCES pharmacy_lots(id),status TEXT NOT NULL CHECK(status IN('available','quarantine','recalled')),version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE pharmacy_documents(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN('receipt','sale','return','dispose','status')),supplier_snapshot TEXT,note TEXT NOT NULL,reference TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL);
CREATE TABLE pharmacy_entries(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES pharmacy_documents(id),lot_id TEXT NOT NULL REFERENCES pharmacy_lots(id),bucket TEXT NOT NULL CHECK(bucket IN('available','quarantine')),qty INTEGER NOT NULL CHECK(qty!=0),cost INTEGER NOT NULL,snapshot TEXT NOT NULL);
CREATE TABLE pharmacy_balances(lot_id TEXT NOT NULL REFERENCES pharmacy_lots(id),bucket TEXT NOT NULL CHECK(bucket IN('available','quarantine')),qty INTEGER NOT NULL CHECK(qty BETWEEN 0 AND 1000000000),cost INTEGER NOT NULL CHECK(cost BETWEEN 0 AND 1000000000000),PRIMARY KEY(lot_id,bucket),CHECK(qty>0 OR cost=0));
CREATE TABLE pharmacy_status_events(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES pharmacy_documents(id),lot_id TEXT NOT NULL REFERENCES pharmacy_lots(id),status TEXT NOT NULL,version INTEGER NOT NULL);
CREATE TABLE pharmacy_sales(id TEXT PRIMARY KEY REFERENCES pharmacy_documents(id),customer TEXT NOT NULL,subtotal INTEGER NOT NULL,discount INTEGER NOT NULL,tax_bps INTEGER NOT NULL,tax INTEGER NOT NULL,total INTEGER NOT NULL);
CREATE TABLE pharmacy_sale_lines(id TEXT PRIMARY KEY,sale_id TEXT NOT NULL REFERENCES pharmacy_sales(id),medicine_id TEXT NOT NULL REFERENCES pharmacy_medicines(id),snapshot TEXT NOT NULL,qty INTEGER NOT NULL,price INTEGER NOT NULL,value INTEGER NOT NULL);
CREATE TABLE pharmacy_allocations(id TEXT PRIMARY KEY,line_id TEXT NOT NULL REFERENCES pharmacy_sale_lines(id),lot_id TEXT NOT NULL REFERENCES pharmacy_lots(id),qty INTEGER NOT NULL,cost INTEGER NOT NULL,value INTEGER NOT NULL);
CREATE TABLE pharmacy_returns(id TEXT PRIMARY KEY REFERENCES pharmacy_documents(id),sale_id TEXT NOT NULL REFERENCES pharmacy_sales(id),credit INTEGER NOT NULL,refunded INTEGER NOT NULL);
CREATE TABLE pharmacy_return_lines(id TEXT PRIMARY KEY,return_id TEXT NOT NULL REFERENCES pharmacy_returns(id),allocation_id TEXT NOT NULL REFERENCES pharmacy_allocations(id),qty INTEGER NOT NULL,cost INTEGER NOT NULL,value INTEGER NOT NULL,UNIQUE(return_id,allocation_id));
CREATE TABLE pharmacy_payments(id TEXT PRIMARY KEY,sale_id TEXT NOT NULL REFERENCES pharmacy_sales(id),return_id TEXT REFERENCES pharmacy_returns(id),amount INTEGER NOT NULL CHECK(amount!=0),method TEXT NOT NULL CHECK(method IN('cash','card','bank')),reference TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL,CHECK((return_id IS NULL AND amount>0) OR (return_id IS NOT NULL AND amount<0)));
CREATE INDEX pharmacy_fefo ON pharmacy_lots(medicine_id,expiry);
CREATE INDEX pharmacy_entry_lot ON pharmacy_entries(lot_id,bucket);
CREATE INDEX pharmacy_payment_sale ON pharmacy_payments(sale_id);
`
export const pharmacyImmutableTables = [
  'pharmacy_lots',
  'pharmacy_documents',
  'pharmacy_entries',
  'pharmacy_status_events',
  'pharmacy_sales',
  'pharmacy_sale_lines',
  'pharmacy_allocations',
  'pharmacy_returns',
  'pharmacy_return_lines',
  'pharmacy_payments',
] as const
