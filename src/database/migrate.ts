import { initializeDatabase, closeDatabase } from './db';

console.log('Running database migration...');
initializeDatabase();
console.log('Migration complete.');
closeDatabase();
