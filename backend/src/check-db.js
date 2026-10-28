const pool = require('./db');

async function checkDatabase() {
    const result = await pool.query(
        `SELECT current_database() AS database_name, current_user AS role_name,
                r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication,
                d.datdba = r.oid AS owns_database
         FROM pg_roles r
         JOIN pg_database d ON d.datname = current_database()
         WHERE r.rolname = current_user`
    );
    const identity = result.rows[0];

    if (!identity || identity.database_name !== 'reg_course' ||
        identity.role_name !== 'reg_course_app' || !identity.owns_database ||
        identity.rolsuper || identity.rolcreatedb || identity.rolcreaterole ||
        identity.rolreplication) {
        throw new Error('The database identity, ownership or role privileges are incorrect.');
    }

    const tables = await pool.query(
        `SELECT tablename, tableowner
         FROM pg_tables
         WHERE schemaname = 'public'
         ORDER BY tablename`
    );

    console.log('Database:', identity.database_name);
    console.log('Application role:', identity.role_name);
    console.log('Restricted role and database ownership verified.');
    console.log('Application tables:', tables.rows);
}

checkDatabase()
    .catch(function reportCheckError(error) {
        console.error('Database check failed:', error.message);
        process.exitCode = 1;
    })
    .finally(function closePool() {
        return pool.end();
    });
