export const ACCOUNTING_APPLICATION_ID = 0x585a4143
export const accountingSchema = `
CREATE TABLE accounting_accounts(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('asset','liability','equity','income','expense')),parent_id TEXT REFERENCES accounting_accounts(id),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)));
CREATE TABLE accounting_periods(id TEXT PRIMARY KEY,name TEXT NOT NULL,date_from TEXT NOT NULL,date_to TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','closed')),closed_at INTEGER);
CREATE TABLE accounting_journals(id TEXT PRIMARY KEY,number TEXT UNIQUE,date TEXT NOT NULL,memo TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('draft','posted','void')),version INTEGER NOT NULL,period_id TEXT NOT NULL REFERENCES accounting_periods(id),user_id TEXT NOT NULL REFERENCES users(id),draft TEXT NOT NULL,total INTEGER NOT NULL CHECK(total>0),posted_at INTEGER,reverse_of TEXT UNIQUE REFERENCES accounting_journals(id));
CREATE TABLE accounting_entries(id TEXT PRIMARY KEY,journal_id TEXT NOT NULL REFERENCES accounting_journals(id),account_id TEXT NOT NULL REFERENCES accounting_accounts(id),debit INTEGER NOT NULL CHECK(debit>=0),credit INTEGER NOT NULL CHECK(credit>=0),note TEXT NOT NULL,CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)));
CREATE INDEX accounting_entry_account ON accounting_entries(account_id,journal_id);
CREATE INDEX accounting_journal_date ON accounting_journals(date,status);
CREATE TRIGGER accounting_entry_insert BEFORE INSERT ON accounting_entries WHEN (SELECT status FROM accounting_journals WHERE id=NEW.journal_id)!='draft' BEGIN SELECT RAISE(ABORT,'Posted ledger immutable'); END;
CREATE TRIGGER accounting_journal_post BEFORE UPDATE OF status ON accounting_journals WHEN NEW.status='posted' BEGIN SELECT CASE WHEN (SELECT COALESCE(sum(debit),0) FROM accounting_entries WHERE journal_id=NEW.id)!=NEW.total OR (SELECT COALESCE(sum(credit),0) FROM accounting_entries WHERE journal_id=NEW.id)!=NEW.total THEN RAISE(ABORT,'Unbalanced journal') END; END;
CREATE TRIGGER accounting_journal_update BEFORE UPDATE ON accounting_journals WHEN OLD.status!='draft' BEGIN SELECT RAISE(ABORT,'Posted journal immutable'); END;
CREATE TRIGGER accounting_journal_delete BEFORE DELETE ON accounting_journals WHEN OLD.status!='draft' BEGIN SELECT RAISE(ABORT,'Posted journal immutable'); END;
CREATE TRIGGER accounting_period_update BEFORE UPDATE ON accounting_periods WHEN OLD.status='closed' BEGIN SELECT RAISE(ABORT,'Closed period immutable'); END;
CREATE TRIGGER accounting_period_delete BEFORE DELETE ON accounting_periods BEGIN SELECT RAISE(ABORT,'Period immutable'); END;
`
export const accountingImmutableTables = ['accounting_entries'] as const
