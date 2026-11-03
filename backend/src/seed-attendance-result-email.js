const pool = require('./db');
require('./attendance-result-mail').installTemplate()
    .then(count => console.log('Attendance result templates installed:', count))
    .catch(function failed() { console.error('Attendance result template installation failed.'); process.exitCode = 1; })
    .finally(() => pool.end());
