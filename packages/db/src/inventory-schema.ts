export const INVENTORY_APPLICATION_ID = 0x585a494e
export const inventorySchema = `
CREATE TABLE inventory_lots(id TEXT PRIMARY KEY,variant_id TEXT NOT NULL REFERENCES variants(id),batch TEXT NOT NULL,serial TEXT NOT NULL,expiry TEXT,UNIQUE(variant_id,batch,serial));
CREATE UNIQUE INDEX inventory_serial_unique ON inventory_lots(serial) WHERE serial!='';
CREATE TABLE inventory_balances(lot_id TEXT NOT NULL REFERENCES inventory_lots(id),warehouse_id TEXT NOT NULL REFERENCES warehouses(id),qty INTEGER NOT NULL CHECK(qty BETWEEN 0 AND 1000000000000),cost INTEGER NOT NULL CHECK(cost BETWEEN 0 AND 1000000000000),PRIMARY KEY(lot_id,warehouse_id),CHECK(qty>0 OR cost=0));
CREATE TABLE inventory_documents(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN('receipt','issue','transfer','count')),warehouse_id TEXT NOT NULL REFERENCES warehouses(id),destination_id TEXT REFERENCES warehouses(id),note TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL);
CREATE TABLE inventory_entries(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES inventory_documents(id),lot_id TEXT NOT NULL REFERENCES inventory_lots(id),warehouse_id TEXT NOT NULL REFERENCES warehouses(id),qty INTEGER NOT NULL CHECK(qty!=0),cost INTEGER NOT NULL);
CREATE TABLE inventory_count_observations(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES inventory_documents(id),lot_id TEXT NOT NULL REFERENCES inventory_lots(id),warehouse_id TEXT NOT NULL REFERENCES warehouses(id),expected_qty INTEGER NOT NULL,expected_cost INTEGER NOT NULL,actual_qty INTEGER NOT NULL,difference INTEGER NOT NULL,UNIQUE(document_id,lot_id));
CREATE INDEX inventory_entry_balance ON inventory_entries(lot_id,warehouse_id);
CREATE INDEX inventory_document_time ON inventory_documents(at);
CREATE TRIGGER inventory_lot_update BEFORE UPDATE ON inventory_lots BEGIN SELECT RAISE(ABORT,'Lot identity immutable'); END;
CREATE TRIGGER inventory_lot_delete BEFORE DELETE ON inventory_lots BEGIN SELECT RAISE(ABORT,'Lot identity immutable'); END;
`
export const inventoryImmutableTables = [
  'inventory_documents',
  'inventory_entries',
  'inventory_count_observations',
] as const
