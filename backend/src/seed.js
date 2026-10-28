const bcrypt = require('bcryptjs');
const pool = require('./db');

async function insertAdmin(client, username, password) {
    if (typeof username !== 'string' || !username.trim() || username.length > 50) {
        throw new Error('SEED_STAFF_USERNAME must contain 1 to 50 characters.');
    }
    if (typeof password !== 'string' || password.length < 8 ||
        Buffer.byteLength(password, 'utf8') > 72) {
        throw new Error('SEED_STAFF_PASSWORD must contain at least 8 characters and fit within 72 UTF-8 bytes.');
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await client.query(
        `INSERT INTO admin (username, password_hash)
         VALUES ($1, $2)
         ON CONFLICT (username) DO NOTHING
         RETURNING id`,
        [username.trim(), hash]
    );

    return result.rowCount;
}

async function seed() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const count = await insertAdmin(
            client, process.env.SEED_STAFF_USERNAME, process.env.SEED_STAFF_PASSWORD
        );
        await client.query('COMMIT');
        console.log('Administrator accounts inserted:', count);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    seed()
        .catch(function reportSeedError(error) {
            console.error('Seed failed:', error.message);
            process.exitCode = 1;
        })
        .finally(function closePool() {
            return pool.end();
        });
}

module.exports = insertAdmin;
