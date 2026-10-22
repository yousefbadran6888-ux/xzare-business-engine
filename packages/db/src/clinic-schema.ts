export const CLINIC_APPLICATION_ID = 0x585a434c
export const clinicImmutableTables = [
  'clinic_appointment_events',
  'clinic_visit_final',
  'clinic_addenda',
  'clinic_invoices',
  'clinic_invoice_lines',
  'clinic_payments',
  'clinic_voids',
]
export const clinicSchema = `
CREATE TABLE clinic_patients(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,name TEXT NOT NULL,phone TEXT NOT NULL,birth_date TEXT,sex TEXT NOT NULL CHECK(sex IN('male','female','unknown')),address TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE clinic_doctors(id TEXT PRIMARY KEY,name TEXT NOT NULL,specialty TEXT NOT NULL,user_id TEXT UNIQUE REFERENCES users(id),active INTEGER NOT NULL CHECK(active IN(0,1)),version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE clinic_services(id TEXT PRIMARY KEY,name TEXT NOT NULL,price INTEGER NOT NULL CHECK(price BETWEEN 0 AND 1000000000000),active INTEGER NOT NULL CHECK(active IN(0,1)),version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE clinic_appointments(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,patient_id TEXT NOT NULL REFERENCES clinic_patients(id),doctor_id TEXT NOT NULL REFERENCES clinic_doctors(id),start INTEGER NOT NULL,duration INTEGER NOT NULL CHECK(duration BETWEEN 5 AND 480),reason TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('scheduled','checked_in','in_visit','completed','cancelled','no_show')),version INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
CREATE INDEX clinic_appointments_time ON clinic_appointments(doctor_id,start);
CREATE INDEX clinic_appointments_patient ON clinic_appointments(patient_id,start);
CREATE TABLE clinic_appointment_events(id TEXT PRIMARY KEY,appointment_id TEXT NOT NULL REFERENCES clinic_appointments(id),user_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL,status TEXT NOT NULL,note TEXT NOT NULL,start INTEGER NOT NULL,duration INTEGER NOT NULL);
CREATE TABLE clinic_visits(id TEXT PRIMARY KEY,appointment_id TEXT NOT NULL UNIQUE REFERENCES clinic_appointments(id),user_id TEXT NOT NULL REFERENCES users(id),opened_at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0,complaint TEXT NOT NULL DEFAULT '',assessment TEXT NOT NULL DEFAULT '',plan TEXT NOT NULL DEFAULT '');
CREATE TABLE clinic_visit_final(visit_id TEXT PRIMARY KEY REFERENCES clinic_visits(id),user_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL,patient_snapshot TEXT NOT NULL,doctor_snapshot TEXT NOT NULL,complaint TEXT NOT NULL,assessment TEXT NOT NULL,plan TEXT NOT NULL);
CREATE TABLE clinic_addenda(id TEXT PRIMARY KEY,visit_id TEXT NOT NULL REFERENCES clinic_visit_final(visit_id),user_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL,reason TEXT NOT NULL,note TEXT NOT NULL);
CREATE TABLE clinic_invoices(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,appointment_id TEXT NOT NULL UNIQUE REFERENCES clinic_appointments(id),patient_snapshot TEXT NOT NULL,doctor_snapshot TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL,subtotal INTEGER NOT NULL CHECK(subtotal BETWEEN 0 AND 1000000000000),discount INTEGER NOT NULL CHECK(discount BETWEEN 0 AND subtotal),tax_bps INTEGER NOT NULL CHECK(tax_bps BETWEEN 0 AND 10000),tax INTEGER NOT NULL CHECK(tax>=0),total INTEGER NOT NULL CHECK(total BETWEEN 0 AND 1000000000000));
CREATE TABLE clinic_invoice_lines(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES clinic_invoices(id),service_id TEXT NOT NULL REFERENCES clinic_services(id),name TEXT NOT NULL,qty INTEGER NOT NULL CHECK(qty BETWEEN 1 AND 100),price INTEGER NOT NULL CHECK(price BETWEEN 0 AND 1000000000000),total INTEGER NOT NULL CHECK(total BETWEEN 0 AND 1000000000000));
CREATE TABLE clinic_payments(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES clinic_invoices(id),user_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL,amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000000000000),method TEXT NOT NULL CHECK(method IN('cash','bank','card')),reference TEXT NOT NULL);
CREATE TABLE clinic_voids(invoice_id TEXT PRIMARY KEY REFERENCES clinic_invoices(id),user_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL,note TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount BETWEEN 0 AND 1000000000000),method TEXT NOT NULL CHECK(method IN('cash','bank','card')),reference TEXT NOT NULL);
`
