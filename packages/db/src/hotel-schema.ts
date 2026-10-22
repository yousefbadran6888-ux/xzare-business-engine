export const HOTEL_APPLICATION_ID = 0x585a4854
export const hotelSchema = `
CREATE TABLE hotel_rooms(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,category TEXT NOT NULL,floor TEXT NOT NULL,capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 20),rate INTEGER NOT NULL CHECK(rate>=0),active INTEGER NOT NULL CHECK(active IN(0,1)),blocked INTEGER NOT NULL DEFAULT 0 CHECK(blocked IN(0,1)),cleanliness TEXT NOT NULL DEFAULT 'ready' CHECK(cleanliness IN('ready','dirty','cleaning')),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE hotel_guests(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,phone TEXT NOT NULL,document TEXT NOT NULL,note TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE hotel_reservations(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,guest_id TEXT NOT NULL REFERENCES hotel_guests(id),room_id TEXT NOT NULL REFERENCES hotel_rooms(id),guest_json TEXT NOT NULL,room_json TEXT NOT NULL,business_json TEXT NOT NULL,arrival TEXT NOT NULL,departure TEXT NOT NULL,adults INTEGER NOT NULL CHECK(adults>0),rate INTEGER NOT NULL CHECK(rate>=0),discount INTEGER NOT NULL CHECK(discount>=0),note TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('reserved','in-house','checked-out','cancelled','no-show')),checkin_at INTEGER,checkout_at INTEGER,at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE INDEX hotel_reservation_room ON hotel_reservations(room_id,arrival,departure,status);
CREATE TABLE hotel_charges(id TEXT PRIMARY KEY,reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id),title TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE hotel_charge_voids(id TEXT PRIMARY KEY,charge_id TEXT NOT NULL UNIQUE REFERENCES hotel_charges(id),reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE hotel_payments(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id),kind TEXT NOT NULL CHECK(kind IN('receipt','refund')),amount INTEGER NOT NULL CHECK(amount>0),method TEXT NOT NULL,reference TEXT NOT NULL,reason TEXT NOT NULL,guest_json TEXT NOT NULL,room_json TEXT NOT NULL,business_json TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE hotel_payment_voids(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL UNIQUE REFERENCES hotel_payments(id),reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE hotel_ledger(id TEXT PRIMARY KEY,reservation_id TEXT NOT NULL REFERENCES hotel_reservations(id),kind TEXT NOT NULL CHECK(kind IN('room','adjustment','extra','extra-void','receipt','refund','payment-void','cancel')),amount INTEGER NOT NULL,reference_id TEXT,reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE INDEX hotel_ledger_reservation ON hotel_ledger(reservation_id);
CREATE TABLE hotel_events(id TEXT PRIMARY KEY,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,snapshot TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE hotel_commands(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,at INTEGER NOT NULL);
`
export const hotelImmutableTables = [
  'hotel_charges',
  'hotel_charge_voids',
  'hotel_payments',
  'hotel_payment_voids',
  'hotel_ledger',
  'hotel_events',
  'hotel_commands',
]
