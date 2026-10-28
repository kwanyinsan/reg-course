const path = require('node:path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

for (const name of ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
    if (!process.env[name]) {
        throw new Error(`${name} must be set in backend/.env or the process environment.`);
    }
}

if (process.env.PGDATABASE !== 'reg_course' || process.env.PGUSER !== 'reg_course_app') {
    throw new Error('Use the dedicated reg_course database and reg_course_app role.');
}

const port = Number(process.env.PGPORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PGPORT must be a valid TCP port.');
}

const pool = new Pool({ connectionTimeoutMillis: 5000 });

pool.on('error', function reportPoolError(error) {
    console.error('PostgreSQL pool error:', error.message);
});

module.exports = pool;
