export const GYM_APPLICATION_ID = 0x585a4759
export const gymSchema = `
CREATE TABLE gym_members(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,phone TEXT NOT NULL,note TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE gym_trainers(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,phone TEXT NOT NULL,note TEXT NOT NULL,user_id TEXT UNIQUE REFERENCES users(id),active INTEGER NOT NULL CHECK(active IN(0,1)),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE gym_plans(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 366),fee INTEGER NOT NULL CHECK(fee>=0),visits INTEGER CHECK(visits>0),freeze_days INTEGER NOT NULL CHECK(freeze_days BETWEEN 0 AND 90),description TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE gym_memberships(id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES gym_members(id),plan_id TEXT NOT NULL REFERENCES gym_plans(id),trainer_id TEXT REFERENCES gym_trainers(id),member_json TEXT NOT NULL,plan_json TEXT NOT NULL,start_day TEXT NOT NULL,end_day TEXT NOT NULL,fee INTEGER NOT NULL,discount INTEGER NOT NULL,visits INTEGER,freeze_days INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN('active','cancelled','stopped')),previous_id TEXT REFERENCES gym_memberships(id),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE INDEX gym_membership_member ON gym_memberships(member_id,start_day,end_day);
CREATE TABLE gym_ledger(id TEXT PRIMARY KEY,membership_id TEXT NOT NULL REFERENCES gym_memberships(id),kind TEXT NOT NULL CHECK(kind IN('charge','payment','void','credit','cancel')),amount INTEGER NOT NULL,reference_id TEXT,reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE INDEX gym_ledger_membership ON gym_ledger(membership_id);
CREATE TABLE gym_payments(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,membership_id TEXT NOT NULL REFERENCES gym_memberships(id),amount INTEGER NOT NULL CHECK(amount>0),method TEXT NOT NULL,reference TEXT NOT NULL,member_json TEXT NOT NULL,plan_json TEXT NOT NULL,business_json TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE gym_payment_voids(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL UNIQUE REFERENCES gym_payments(id),reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE gym_freezes(id TEXT PRIMARY KEY,membership_id TEXT NOT NULL REFERENCES gym_memberships(id),from_day TEXT NOT NULL,to_day TEXT NOT NULL,days INTEGER NOT NULL CHECK(days>0),original_end TEXT NOT NULL,new_end TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE gym_checkins(id TEXT PRIMARY KEY,membership_id TEXT NOT NULL REFERENCES gym_memberships(id),member_id TEXT NOT NULL REFERENCES gym_members(id),member_name TEXT NOT NULL,member_code TEXT NOT NULL,day TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE INDEX gym_checkin_day ON gym_checkins(day,member_id);
CREATE TABLE gym_checkouts(id TEXT PRIMARY KEY,checkin_id TEXT NOT NULL UNIQUE REFERENCES gym_checkins(id),actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE gym_checkin_voids(id TEXT PRIMARY KEY,checkin_id TEXT NOT NULL UNIQUE REFERENCES gym_checkins(id),reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE gym_sessions(id TEXT PRIMARY KEY,membership_id TEXT NOT NULL REFERENCES gym_memberships(id),trainer_id TEXT NOT NULL REFERENCES gym_trainers(id),trainer_name TEXT NOT NULL,member_name TEXT NOT NULL,member_code TEXT NOT NULL,day TEXT NOT NULL,start_minute INTEGER NOT NULL,duration INTEGER NOT NULL,title TEXT NOT NULL,note TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('scheduled','done','no-show','cancelled')),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE INDEX gym_session_day ON gym_sessions(day,start_minute);
CREATE TABLE gym_events(id TEXT PRIMARY KEY,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,snapshot TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
`
export const gymImmutableTables = [
  'gym_ledger',
  'gym_payments',
  'gym_payment_voids',
  'gym_freezes',
  'gym_checkins',
  'gym_checkouts',
  'gym_checkin_voids',
  'gym_events',
]
