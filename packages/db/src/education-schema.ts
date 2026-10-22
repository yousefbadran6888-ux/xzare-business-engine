export const EDUCATION_APPLICATION_ID = 0x585a4544
export const educationSchema = `
CREATE TABLE edu_students(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,phone TEXT NOT NULL,guardian TEXT NOT NULL,guardian_phone TEXT NOT NULL,birth_day TEXT,level TEXT NOT NULL,note TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE edu_teachers(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,phone TEXT NOT NULL,note TEXT NOT NULL,user_id TEXT UNIQUE REFERENCES users(id),active INTEGER NOT NULL CHECK(active IN(0,1)),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE edu_courses(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,description TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE edu_groups(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,course_id TEXT NOT NULL REFERENCES edu_courses(id),teacher_id TEXT NOT NULL REFERENCES edu_teachers(id),start_day TEXT NOT NULL,end_day TEXT NOT NULL,fee INTEGER NOT NULL CHECK(fee>=0),capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 500),note TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE edu_enrollments(id TEXT PRIMARY KEY,student_id TEXT NOT NULL REFERENCES edu_students(id),group_id TEXT NOT NULL REFERENCES edu_groups(id),student_json TEXT NOT NULL,group_json TEXT NOT NULL,fee INTEGER NOT NULL,discount INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN('active','cancelled')),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX edu_active_enrollment ON edu_enrollments(student_id,group_id) WHERE status='active';
CREATE TABLE edu_fee_ledger(id TEXT PRIMARY KEY,enrollment_id TEXT NOT NULL REFERENCES edu_enrollments(id),kind TEXT NOT NULL CHECK(kind IN('charge','payment','void','credit','cancel')),amount INTEGER NOT NULL,reference_id TEXT,reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE INDEX edu_ledger_enrollment ON edu_fee_ledger(enrollment_id);
CREATE TABLE edu_payments(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,enrollment_id TEXT NOT NULL REFERENCES edu_enrollments(id),amount INTEGER NOT NULL CHECK(amount>0),method TEXT NOT NULL,reference TEXT NOT NULL,student_json TEXT NOT NULL,group_json TEXT NOT NULL,business_json TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE edu_payment_voids(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL UNIQUE REFERENCES edu_payments(id),reason TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
CREATE TABLE edu_sessions(id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES edu_groups(id),day TEXT NOT NULL,start_minute INTEGER NOT NULL,duration INTEGER NOT NULL,title TEXT NOT NULL,note TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('scheduled','cancelled')),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE INDEX edu_session_day ON edu_sessions(day,start_minute);
CREATE TABLE edu_session_roster(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES edu_sessions(id),enrollment_id TEXT NOT NULL REFERENCES edu_enrollments(id),student_id TEXT NOT NULL REFERENCES edu_students(id),student_name TEXT NOT NULL,student_code TEXT NOT NULL,UNIQUE(session_id,enrollment_id));
CREATE TABLE edu_attendance(roster_id TEXT PRIMARY KEY REFERENCES edu_session_roster(id),status TEXT NOT NULL CHECK(status IN('present','absent','late','excused')),note TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL);
CREATE TABLE edu_exams(id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES edu_groups(id),day TEXT NOT NULL,title TEXT NOT NULL,max_score INTEGER NOT NULL CHECK(max_score>0),note TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('draft','published')),at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE edu_exam_roster(id TEXT PRIMARY KEY,exam_id TEXT NOT NULL REFERENCES edu_exams(id),enrollment_id TEXT NOT NULL REFERENCES edu_enrollments(id),student_id TEXT NOT NULL REFERENCES edu_students(id),student_name TEXT NOT NULL,student_code TEXT NOT NULL,UNIQUE(exam_id,enrollment_id));
CREATE TABLE edu_grades(roster_id TEXT PRIMARY KEY REFERENCES edu_exam_roster(id),score INTEGER,note TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL);
CREATE TABLE edu_events(id TEXT PRIMARY KEY,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,snapshot TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at INTEGER NOT NULL);
`
export const educationImmutableTables = [
  'edu_fee_ledger',
  'edu_payments',
  'edu_payment_voids',
  'edu_session_roster',
  'edu_exam_roster',
  'edu_events',
]
