const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const fontkit = require('fontkit');
const { validateTemplate, sections } = require('./certificate-template');

const fontPath = path.join(__dirname, '../assets/fonts/NotoSansCJKhk-Regular.otf');
const previewValues = { participant_name: 'Preview Participant', certificate_number: 'PREVIEW-ONLY', issued_date: '1 January 2030' };
const regions = {
    heading: { y: 83, height: 90, size: 26 },
    body: { y: 199, height: 225, size: 18 },
    footer: { y: 450, height: 72, size: 11 },
};
let fontData;
let font;

function fail(code, field) {
    throw Object.assign(new Error('Certificate could not be rendered.'), { code, field, status: 422 });
}

function resolveCertificate(template, course, values) {
    const issue = validateTemplate(template);
    if (issue) throw Object.assign(new Error('Invalid certificate wording.'), { ...issue, status: 400 });
    const replacements = { ...values, course_title: course.title.en, course_code: course.code };
    for (const key of ['participant_name', 'certificate_number', 'issued_date', 'course_title', 'course_code']) {
        if (typeof replacements[key] !== 'string' || !replacements[key].trim() || replacements[key].length > 4000 ||
            /[\u0000-\u001f\u007f]/.test(replacements[key])) fail('invalid_values');
    }
    return Object.fromEntries(sections.map(function resolve(section) {
        // Substitute once: inserted participant values never become template instructions.
        return [section, template[section].en.replace(/{{([^{}]+)}}/g, function value(match, key) {
            return replacements[key];
        }).replace(/\r\n?/g, '\n').replace(/\t/g, '    ')];
    }));
}

function prepareDocument(template, course, values) {
    const resolved = resolveCertificate(template, course, values);
    if (!fontData) { fontData = fs.readFileSync(fontPath); font = fontkit.create(fontData); }
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, compress: true,
        info: { Title: 'Certificate preview', Author: 'Course registration' } });
    try {
        doc.font(fontData);
        for (const section of sections) {
            for (const character of resolved[section]) {
                if (character !== '\n' && !font.hasGlyphForCodePoint(character.codePointAt(0))) fail('unsupported_character', section);
            }
            const region = regions[section];
            doc.fontSize(region.size);
            const height = doc.heightOfString(resolved[section], { width: doc.page.width - 144, align: 'center', lineGap: 4 });
            if (height > region.height) fail('content_overflow', section);
        }
        return { doc, resolved };
    } catch (error) { doc.destroy(); throw error; }
}

function checkLayout(template, course, values = previewValues) {
    const { doc } = prepareDocument(template, course, values);
    doc.destroy();
}

async function renderCertificate(template, course, values = previewValues, preview = true) {
    const { doc, resolved } = prepareDocument(template, course, values);
    return new Promise(function generate(resolve, reject) {
        const chunks = [];
        doc.on('data', function collect(chunk) { chunks.push(chunk); });
        doc.on('error', reject);
        doc.on('end', function complete() { resolve(Buffer.concat(chunks)); });
        doc.info.Title = preview ? 'Certificate preview - not issued' : 'Certificate';
        doc.strokeColor('#1a2655').lineWidth(0.8).rect(43, 43, doc.page.width - 86, doc.page.height - 86).stroke();
        doc.strokeColor('#287d79').lineWidth(2).moveTo(doc.page.width / 2 - 50, 178).lineTo(doc.page.width / 2 + 50, 178).stroke();
        if (preview) doc.fontSize(10).fillColor('#1a2655').text('Preview - not issued', 72, 22, { width: doc.page.width - 144, align: 'center' });
        for (const section of sections) {
            const region = regions[section];
            doc.fontSize(region.size).fillColor(section === 'heading' ? '#1a2655' : '#222222');
            doc.text(resolved[section], 72, region.y, { width: doc.page.width - 144, align: 'center', lineGap: 4 });
        }
        doc.end();
    });
}

module.exports = { previewValues, resolveCertificate, checkLayout, renderCertificate };
