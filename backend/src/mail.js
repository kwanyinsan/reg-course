const nodemailer = require('nodemailer');

function mailConfiguration() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT);
    const security = process.env.SMTP_SECURITY;
    const authentication = process.env.SMTP_AUTH;
    const address = process.env.SMTP_FROM_ADDRESS;

    if (!host || !Number.isInteger(port) || port < 1 || port > 65535 ||
        !['tls', 'starttls'].includes(security) || !['password', 'none'].includes(authentication) ||
        !address || /[\r\n]/.test(address) || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ||
        (authentication === 'password' && (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD))) {
        throw Object.assign(new Error('SMTP configuration is incomplete.'), { code: 'MAIL_CONFIG' });
    }

    return {
        host,
        port,
        secure: security === 'tls',
        requireTLS: security === 'starttls',
        ...(authentication === 'password' ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
        dnsTimeout: 5000,
        tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
        logger: false,
        debug: false,
        disableFileAccess: true,
        disableUrlAccess: true,
    };
}

async function sendMessage(message) {
    const transporter = nodemailer.createTransport(mailConfiguration());
    return transporter.sendMail({
        ...message,
        from: { name: process.env.SMTP_FROM_NAME || '', address: process.env.SMTP_FROM_ADDRESS },
    });
}

function mailFailure(error) {
    const code = ['MAIL_CONFIG', 'MAIL_TEMPLATE', 'ENOTFOUND', 'EDNS', 'ECONNECTION', 'ECONNREFUSED',
        'ETIMEDOUT', 'ETLS', 'EAUTH', 'EENVELOPE', 'EMESSAGE', 'ESOCKET', 'ECONNRESET', 'EPROTOCOL', 'EREJECTED'].includes(error.code)
        ? error.code : 'MAIL_ERROR';
    const command = ['CONN', 'AUTH', 'AUTH LOGIN', 'AUTH PLAIN', 'MAIL FROM', 'RCPT TO', 'DATA'].includes(error.command)
        ? error.command : undefined;
    const responseCode = Number.isInteger(error.responseCode) ? error.responseCode : undefined;
    const rejected = responseCode >= 400 && responseCode <= 599;
    // Socket errors can report CONN even after DATA. Treat an interrupted exchange as uncertain.
    const definite = rejected || ['MAIL_CONFIG', 'MAIL_TEMPLATE', 'EDNS', 'ENOTFOUND', 'ECONNREFUSED', 'EAUTH', 'EENVELOPE', 'EREJECTED'].includes(code);
    return { status: definite ? 'failed' : 'uncertain', code, command, responseCode };
}

module.exports = { sendMessage, mailConfiguration, mailFailure };
