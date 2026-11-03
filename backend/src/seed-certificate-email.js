const pool = require('./db');
require('./certificate-mail').installTemplate()
    .then(count => console.log('Certificate email templates installed:', count))
    .catch(function failed() { console.error('Certificate email template installation failed.'); process.exitCode = 1; })
    .finally(() => pool.end());
