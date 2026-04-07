import { v4 as uuid } from 'uuid';
import { initializeDatabase, getDb, closeDatabase } from './db';

console.log('Seeding database...');
initializeDatabase();

const db = getDb();

// Seed sample residents
const residents = [
  { id: uuid(), name: 'Ahmad Razak', unit_number: 'A-10-01', phone_number: '60123456789' },
  { id: uuid(), name: 'Sarah Tan', unit_number: 'B-12-03', phone_number: '60198765432' },
  { id: uuid(), name: 'Raj Kumar', unit_number: 'C-05-08', phone_number: '60171234567' },
];

const insert = db.prepare(
  'INSERT OR IGNORE INTO residents (id, name, unit_number, phone_number) VALUES (?, ?, ?, ?)'
);

for (const r of residents) {
  insert.run(r.id, r.name, r.unit_number, r.phone_number);
  console.log(`  Resident: ${r.name} (${r.unit_number}) — ${r.phone_number}`);
}

console.log('Seed complete.');
closeDatabase();
