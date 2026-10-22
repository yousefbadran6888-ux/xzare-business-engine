export const SALON_APPLICATION_ID = 0x585a534c
export const salonSchema = `
CREATE TABLE sal_customers(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,phone TEXT NOT NULL,note TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sal_services(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,category TEXT NOT NULL,duration INTEGER NOT NULL CHECK(duration BETWEEN 5 AND 480),fee INTEGER NOT NULL CHECK(fee>=0),active INTEGER NOT NULL CHECK(active IN(0,1)),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sal_staff(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,phone TEXT NOT NULL,note TEXT NOT NULL,user_id TEXT UNIQUE REFERENCES users(id),commission_bps INTEGER NOT NULL CHECK(commission_bps BETWEEN 0 AND 10000),active INTEGER NOT NULL CHECK(active IN(0,1)),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sal_plans(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,service_id TEXT NOT NULL REFERENCES sal_services(id),credits INTEGER NOT NULL CHECK(credits BETWEEN 1 AND 1000),days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 366),fee INTEGER NOT NULL CHECK(fee>=0),description TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sal_bookings(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES sal_customers(id),service_id TEXT NOT NULL REFERENCES sal_services(id),staff_id TEXT NOT NULL REFERENCES sal_staff(id),customer_json TEXT NOT NULL,service_json TEXT NOT NULL,staff_json TEXT NOT NULL,day TEXT NOT NULL,start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),duration INTEGER NOT NULL CHECK(duration>0),fee INTEGER NOT NULL CHECK(fee>=0),discount INTEGER NOT NULL CHECK(discount BETWEEN 0 AND fee),package_id TEXT REFERENCES sal_packages(id),note TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('booked','arrived','done','no-show','cancelled','void')),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE INDEX sal_booking_calendar ON sal_bookings(day,staff_id,start_minute);
CREATE INDEX sal_booking_customer ON sal_bookings(customer_id,day);
CREATE TABLE sal_invoices(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN('service','package')),source_id TEXT NOT NULL UNIQUE,number TEXT NOT NULL UNIQUE,customer_id TEXT NOT NULL REFERENCES sal_customers(id),status TEXT NOT NULL CHECK(status IN('posted','void')),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sal_invoice_snapshots(id TEXT PRIMARY KEY REFERENCES sal_invoices(id),customer_json TEXT NOT NULL,item_json TEXT NOT NULL,business_json TEXT NOT NULL,total INTEGER NOT NULL CHECK(total>=0));
CREATE TABLE sal_ledger(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES sal_invoices(id),kind TEXT NOT NULL CHECK(kind IN('charge','payment','payment-void','reverse')),amount INTEGER NOT NULL,reference_id TEXT,reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE INDEX sal_ledger_invoice ON sal_ledger(invoice_id);
CREATE TABLE sal_packages(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES sal_customers(id),plan_id TEXT NOT NULL REFERENCES sal_plans(id),service_id TEXT NOT NULL REFERENCES sal_services(id),customer_json TEXT NOT NULL,plan_json TEXT NOT NULL,start_day TEXT NOT NULL,end_day TEXT NOT NULL,credits INTEGER NOT NULL CHECK(credits>0),net INTEGER NOT NULL CHECK(net>=0),invoice_id TEXT NOT NULL UNIQUE REFERENCES sal_invoices(id),status TEXT NOT NULL CHECK(status IN('active','cancelled')),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sal_completions(id TEXT PRIMARY KEY,booking_id TEXT NOT NULL UNIQUE REFERENCES sal_bookings(id),invoice_id TEXT NOT NULL UNIQUE REFERENCES sal_invoices(id),staff_id TEXT NOT NULL REFERENCES sal_staff(id),basis INTEGER NOT NULL CHECK(basis>=0),rate_bps INTEGER NOT NULL CHECK(rate_bps BETWEEN 0 AND 10000),commission INTEGER NOT NULL CHECK(commission>=0),package_index INTEGER,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE sal_completion_voids(id TEXT PRIMARY KEY,completion_id TEXT NOT NULL UNIQUE REFERENCES sal_completions(id),reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE sal_package_uses(id TEXT PRIMARY KEY,package_id TEXT NOT NULL REFERENCES sal_packages(id),booking_id TEXT NOT NULL UNIQUE REFERENCES sal_bookings(id),credit_index INTEGER NOT NULL CHECK(credit_index>=0),basis INTEGER NOT NULL CHECK(basis>=0),at INTEGER NOT NULL);
CREATE INDEX sal_package_use ON sal_package_uses(package_id,credit_index);
CREATE TABLE sal_payments(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,invoice_id TEXT NOT NULL REFERENCES sal_invoices(id),amount INTEGER NOT NULL CHECK(amount>0),method TEXT NOT NULL,reference TEXT NOT NULL,customer_json TEXT NOT NULL,item_json TEXT NOT NULL,business_json TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE sal_payment_voids(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL UNIQUE REFERENCES sal_payments(id),reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE sal_commission_ledger(id TEXT PRIMARY KEY,staff_id TEXT NOT NULL REFERENCES sal_staff(id),kind TEXT NOT NULL CHECK(kind IN('earned','reverse','payout','payout-void')),amount INTEGER NOT NULL,reference_id TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE INDEX sal_commission_staff ON sal_commission_ledger(staff_id);
CREATE TABLE sal_payouts(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,staff_id TEXT NOT NULL REFERENCES sal_staff(id),amount INTEGER NOT NULL CHECK(amount>0),method TEXT NOT NULL,reference TEXT NOT NULL,staff_json TEXT NOT NULL,business_json TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE sal_payout_voids(id TEXT PRIMARY KEY,payout_id TEXT NOT NULL UNIQUE REFERENCES sal_payouts(id),reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE sal_events(id TEXT PRIMARY KEY,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,snapshot TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
`
export const salonImmutableTables = [
  'sal_invoice_snapshots',
  'sal_ledger',
  'sal_completions',
  'sal_completion_voids',
  'sal_package_uses',
  'sal_payments',
  'sal_payment_voids',
  'sal_commission_ledger',
  'sal_payouts',
  'sal_payout_voids',
  'sal_events',
]
