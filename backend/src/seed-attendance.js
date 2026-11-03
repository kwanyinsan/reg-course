const pool = require('./db');
require('./attendance-mail').installTemplate()
    .then(count => console.log('Attendance templates installed:', count))
    .catch(function failed() { console.error('Attendance template installation failed.'); process.exitCode = 1; })
    .finally(() => pool.end());
