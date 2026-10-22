export const LABORATORY_APPLICATION_ID = 0x585a4c42
export const laboratoryImmutableTables = [
  'lab_orders',
  'lab_order_tests',
  'lab_sample_events',
  'lab_reports',
  'lab_payments',
  'lab_refunds',
]
export const laboratorySchema = `
CREATE TABLE lab_patients(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,name TEXT NOT NULL,phone TEXT NOT NULL,birth_date TEXT,sex TEXT NOT NULL CHECK(sex IN('male','female','unknown')),address TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE lab_tests(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE COLLATE NOCASE,name TEXT NOT NULL,specimen TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('number','text')),unit TEXT NOT NULL,reference TEXT NOT NULL,min REAL,max REAL,price INTEGER NOT NULL CHECK(price BETWEEN 0 AND 1000000000000),active INTEGER NOT NULL CHECK(active IN(0,1)),version INTEGER NOT NULL DEFAULT 0,CHECK(min IS NULL OR max IS NULL OR min<=max));
CREATE TABLE lab_orders(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,patient_id TEXT NOT NULL REFERENCES lab_patients(id),patient_snapshot TEXT NOT NULL,referrer TEXT NOT NULL,due_at INTEGER NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL,subtotal INTEGER NOT NULL CHECK(subtotal BETWEEN 0 AND 1000000000000),discount INTEGER NOT NULL CHECK(discount BETWEEN 0 AND subtotal),tax_bps INTEGER NOT NULL CHECK(tax_bps BETWEEN 0 AND 10000),tax INTEGER NOT NULL CHECK(tax>=0),total INTEGER NOT NULL CHECK(total BETWEEN 0 AND 1000000000000));
CREATE TABLE lab_order_work(order_id TEXT PRIMARY KEY REFERENCES lab_orders(id),status TEXT NOT NULL CHECK(status IN('testing','released','cancelled')),version INTEGER NOT NULL DEFAULT 0,amendment_reason TEXT NOT NULL DEFAULT '',draft_changed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE lab_order_tests(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES lab_orders(id),test_id TEXT NOT NULL REFERENCES lab_tests(id),definition TEXT NOT NULL,price INTEGER NOT NULL CHECK(price BETWEEN 0 AND 1000000000000),UNIQUE(order_id,test_id));
CREATE TABLE lab_results(order_test_id TEXT PRIMARY KEY REFERENCES lab_order_tests(id),value TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',author_id TEXT REFERENCES users(id));
CREATE TABLE lab_samples(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,order_id TEXT NOT NULL REFERENCES lab_orders(id),specimen TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('pending','collected','received','rejected')),version INTEGER NOT NULL DEFAULT 0,replaces_id TEXT UNIQUE REFERENCES lab_samples(id),created_at INTEGER NOT NULL);
CREATE INDEX lab_samples_order ON lab_samples(order_id);
CREATE TRIGGER lab_samples_identity BEFORE UPDATE OF id,number,order_id,specimen,replaces_id,created_at ON lab_samples BEGIN SELECT RAISE(ABORT,'Immutable sample identity'); END;
CREATE TRIGGER lab_samples_delete BEFORE DELETE ON lab_samples BEGIN SELECT RAISE(ABORT,'Immutable sample identity'); END;
CREATE TABLE lab_sample_events(id TEXT PRIMARY KEY,sample_id TEXT NOT NULL REFERENCES lab_samples(id),user_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL,status TEXT NOT NULL,note TEXT NOT NULL);
CREATE TABLE lab_reports(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES lab_orders(id),revision INTEGER NOT NULL CHECK(revision>=1),user_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL,reason TEXT NOT NULL,snapshot TEXT NOT NULL,UNIQUE(order_id,revision));
CREATE TABLE lab_payments(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES lab_orders(id),user_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL,amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000000000000),method TEXT NOT NULL CHECK(method IN('cash','bank','card')),reference TEXT NOT NULL);
CREATE TABLE lab_refunds(order_id TEXT PRIMARY KEY REFERENCES lab_orders(id),user_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL,note TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 1000000000000),method TEXT NOT NULL CHECK(method IN('cash','bank','card')),reference TEXT NOT NULL);
`
