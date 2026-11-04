const bcrypt = require('bcryptjs');
const pool = require('./db');
const writeLog = require('./log');

// EDIT STARTER DATA HERE. The insertion functions begin below the data section.
// Run: npm run seed. All nine application tables receive starter data.
// Existing rows are preserved. Seeding never sends emails or creates login sessions.

// Administrator credentials stay in ignored backend/.env, never in this file.
const administrator = {
    username: process.env.SEED_STAFF_USERNAME,
    password: process.env.SEED_STAFF_PASSWORD,
};

// Default question bank and English certificate wording for newly inserted courses.
// A course can supply its own questions/certificate object to override these defaults.
const questions = { questions: [{
    id: 'demo_learning_goal',
    label: {
        en: 'What would you like to learn?',
        'zh-Hant': '你希望學習甚麼？',
        'zh-Hans': '你希望学习什么？',
    },
    type: 'text', required: false,
}] };

const certificate = {
    "heading": {
        "en": "Certificate"
    },
    "body": {
        "en": "{{participant_name}}\n\n{{course_title}}\nCourse code: {{course_code}}"
    },
    "footer": {
        "en": "Certificate number: {{certificate_number}}\nIssued date: {{issued_date}}"
    }
};

// Courses: text(English, Traditional Chinese, Simplified Chinese).
// session(ID, date, start, end, attendance mode, topic, optional information).
// All dates/times below are fixed starter values in Hong Kong time.
const speaker = text('Mira', '米拉', '米拉');
const openDates = {
    registration_opens_at: '2026-10-01T09:00:00+08:00',
    registration_closes_at: '2026-11-30T18:00:00+08:00',
    payment_deadline: '2026-12-01T18:00:00+08:00',
};
const richInformation = {
    venue: text('Classroom A and an online classroom', '課室 A 及網上課室', '课室 A 及网上课室'),
    audience: text('Small teams exploring intellectual property', '認識知識產權的小型團隊', '认识知识产权的小型团队'),
    prerequisites: text('No previous study required', '無需相關學習經驗', '无需相关学习经验'),
    teaching_language: text('English with Chinese discussion', '英語授課，輔以中文討論', '英语授课，辅以中文讨论'),
    learning_outcomes: [
        text('Recognise information worth recording', '識別值得記錄的資訊', '识别值得记录的信息'),
        text('Organise a simple project record', '整理簡單的項目紀錄', '整理简单的项目记录'),
    ],
};

const courses = [
    {
        code: 'CR-001',
        title: text('IP Basics'),
        short_description: text('A short introduction to intellectual property.'),
        long_description: text('Explore the basic idea of intellectual property using practical examples.'),
        mode: 'in_person', fee: 0, attendance_requirement_percent: '100.00', state: 'published',
        payment_deadline: '2026-12-04T18:00:00+08:00',
        sessions: [session('session_1', '2026-12-05', '10:00', '11:00', 'in_person', text('Getting started'))],
    },
    {
        code: 'CR-002',
        title: text('Trademark Basics', '商標入門', '商标入门'),
        short_description: text('Explore names, signs and the basic purpose of trademarks.', '認識名稱、標誌及商標的基本用途。', '认识名称、标志及商标的基本用途。'),
        long_description: text('Use business names to discuss how trademarks help distinguish products and services. The course introduces vocabulary and practical examples; it does not provide legal advice.', '透過商業名稱，討論商標如何區分產品及服務。本課程介紹基本用語及實用例子，並不提供法律意見。', '通过商业名称，讨论商标如何区分产品及服务。本课程介绍基本用语及实用例子，并不提供法律意见。'),
        information: { venue: text('Online classroom', '網上課室', '网上课室'), teaching_language: text('English', '英語', '英语') },
        mode: 'virtual', fee: 140, attendance_requirement_percent: '100.00', state: 'published', ...openDates,
        sessions: [session('session_1', '2026-12-06', '19:00', '21:00', 'virtual', text('Names and signs', '名稱與標誌', '名称与标志'), {
            description: text('Discuss examples of names and product signs.', '討論名稱與產品標誌的例子。', '讨论名称与产品标志的例子。'), speaker,
        })],
    },
    {
        code: 'CR-003',
        title: text('From Idea to Prototype', '從構思到原型', '从构思到原型'),
        short_description: text('Four sessions on recording ideas and developing a prototype.', '透過四節課堂，學習記錄構思及開發原型。', '通过四节课堂，学习记录构思及开发原型。'),
        long_description: text('Follow a team as it develops an idea into a prototype. Start with observation and notes, then organise decisions and discuss how a team can retain a clear project record.', '跟隨團隊，把構思發展成原型。先從觀察及筆記開始，再整理決策，討論如何保留清晰的項目紀錄。', '跟随团队，把构思发展成原型。先从观察及笔记开始，再整理决策，讨论如何保留清晰的项目记录。'),
        information: richInformation,
        mode: 'hybrid', fee: 350, attendance_requirement_percent: '50.00', state: 'published', ...openDates,
        sessions: [
            session('session_1', '2026-12-08', '19:00', '21:00', 'virtual', text('Understanding an idea', '認識構思', '认识构思'), { description: text('Discuss what the team wants to achieve.', '討論團隊希望達成的目標。', '讨论团队希望达成的目标。'), speaker }),
            session('session_2', '2026-12-10', '19:00', '21:00', 'in_person', text('Recording decisions', '記錄決策', '记录决策'), { description: text('Practise keeping useful project notes.', '練習記錄實用的項目筆記。', '练习记录实用的项目笔记。') }),
            session('session_3', '2026-12-12', '19:00', '21:00', 'virtual', text('Reviewing a prototype', '檢視原型', '检视原型'), { speaker }),
            session('session_4', '2026-12-15', '19:00', '21:00', 'in_person', text('Sharing the project record', '分享項目紀錄', '分享项目记录')),
        ],
    },
    {
        code: 'CR-004',
        title: text('Creative Works and Copyright', '創作與版權', '创作与版权'),
        short_description: text('Explore creative works through two practical discussions.', '透過兩節實務討論認識創作。', '通过两节实务讨论认识创作。'),
        long_description: text('Discuss drawings, photographs and written work. Explore why a team should keep clear records of how creative material was produced and used.', '討論繪畫、照片及文字作品，認識團隊為何應清楚記錄創作素材的製作及使用方式。', '讨论绘画、照片及文字作品，认识团队为何应清楚记录创作素材的制作及使用方式。'),
        information: { audience: text('People working with creative material', '處理創作素材的人士', '处理创作素材的人士'), prerequisites: null, teaching_language: '' },
        mode: 'in_person', fee: 80, attendance_requirement_percent: '50.00', state: 'published',
        registration_closes_at: openDates.registration_closes_at, payment_deadline: openDates.payment_deadline,
        sessions: [
            session('session_1', '2026-12-13', '14:00', '16:00', 'in_person', text('Understanding creative material', '認識創作素材', '认识创作素材'), { description: text('Compare different kinds of creative work.', '比較不同類型的創作。', '比较不同类型的创作。') }),
            session('session_2', '2026-12-20', '14:00', '16:00', 'in_person', text('Keeping a usage record', '保留使用紀錄', '保留使用记录')),
        ],
    },
    {
        code: 'CR-005',
        title: text('Digital Content Rights', '數碼內容權利', '数码内容权利'),
        short_description: text('An introductory discussion about digital content.', '有關數碼內容的入門討論。', '有关数码内容的入门讨论。'),
        long_description: text('Use a website project to discuss organising content permissions and records. The course introduces a practical approach to keeping permission records.', '以網站項目討論如何整理內容授權及紀錄，介紹保留授權紀錄的實用方法。', '以网站项目讨论如何整理内容授权及记录，介绍保留授权记录的实用方法。'),
        information: { teaching_language: text('English', '英語', '英语') },
        mode: 'virtual', fee: 0, attendance_requirement_percent: '100.00', state: 'published',
        registration_opens_at: '2026-11-10T09:00:00+08:00', registration_closes_at: '2026-12-10T18:00:00+08:00', payment_deadline: '2026-12-11T18:00:00+08:00',
        sessions: [session('session_1', '2026-12-19', '11:00', '12:00', 'virtual', text('Organising content permissions', '整理內容授權', '整理内容授权'), { description: text('Review an example content record.', '檢視內容紀錄例子。', '检视内容记录例子。'), speaker })],
    },
    {
        code: 'CR-006', title: text('Licensing Introduction'),
        short_description: text('An introductory course on licensing and useful project records.'),
        long_description: text('Discuss a licensing example and the information a team may wish to record.'),
        mode: 'in_person', fee: 50, attendance_requirement_percent: '100.00', state: 'published',
        registration_opens_at: '2026-10-01T09:00:00+08:00', registration_closes_at: '2026-10-15T18:00:00+08:00', payment_deadline: '2026-10-16T18:00:00+08:00',
        sessions: [session('session_1', '2026-10-20', '10:00', '12:00', 'in_person', text('A licensing example'), { description: text('Discuss the example as a group.'), speaker: text('Mira') })],
    },
    {
        code: 'CR-007', title: text('Organising IP Records', '整理知識產權紀錄'),
        short_description: text('Build a simple record of project information.', '為項目資訊建立簡單紀錄。'),
        long_description: text('Practise grouping project notes into a clear record, including decisions, references and revisions.', '練習把項目筆記整理成清晰紀錄，包括決策、參考資料及修訂。'),
        information: { audience: null, prerequisites: '', venue: {}, learning_outcomes: [] },
        mode: 'virtual', fee: 90, attendance_requirement_percent: '50.00', state: 'published', ...openDates,
        sessions: [
            session('session_1', '2026-12-07', '19:00', '20:00', 'virtual', text('Gathering notes', '收集筆記')),
            session('session_2', '2026-12-14', '19:00', '20:00', 'virtual', text('Organising the record', '整理紀錄')),
        ],
    },
    {
        code: 'CR-008',
        title: text('Practical IP Record-Keeping for Small Teams: From Initial Ideas to Organised Project Files', '小型團隊知識產權紀錄實務：從初步構思到有序項目檔案', '小型团队知识产权记录实务：从初步构思到有序项目档案'),
        short_description: text('A detailed case study covering the journey from early notes to a structured project file, with classroom and online sessions.', '透過詳細案例，從初期筆記整理至有序項目檔案，結合課室及網上課堂。', '通过详细案例，从初期笔记整理至有序项目档案，结合课室及网上课堂。'),
        long_description: text('Small teams often collect ideas across notebooks, messages and shared files. This case study follows a team that wants a more consistent way to organise that information. Participants compare several example records and discuss what makes them understandable to another team member.', '小型團隊經常把構思分散記錄在筆記本、訊息及共用檔案。本課程透過案例介紹有系統整理資訊的方法。學員會比較多份紀錄，討論如何讓其他成員容易理解。', '小型团队经常把构思分散记录在笔记本、消息及共享文件。本课程通过案例介绍有系统整理信息的方法。学员会比较多份记录，讨论如何让其他成员容易理解。'),
        information: { ...richInformation, extra_demo_field: { deliberately_not_displayed: true } },
        mode: 'hybrid', fee: 270, attendance_requirement_percent: '100.00', state: 'published', ...openDates,
        sessions: [
            session('session_1', '2026-12-09', '14:00', '16:00', 'in_person', text('Organising the early project record', '整理早期項目紀錄', '整理早期项目记录'), { description: text('Work through the team’s notes and identify useful groupings. Compare alternative ways to describe a decision, record a revision and retain a reference. Discuss the examples without sharing private project information.', '整理團隊的筆記，找出實用的分類方式。比較如何描述決策、記錄修訂及保留參考資料。討論例子時無需分享私人項目資訊。', '整理团队的笔记，找出实用的分类方式。比较如何描述决策、记录修订及保留参考资料。讨论例子时无需分享私人项目信息。'), speaker }),
            session('session_2', '2026-12-16', '19:00', '21:00', 'virtual', text('Reviewing and sharing the file', '檢視及分享檔案', '检视及分享文件')),
        ],
    },
    {
        code: 'CR-009', title: text('IP Strategy Workshop', '知識產權策略工作坊', '知识产权策略工作坊'),
        short_description: text('Explore how intellectual property considerations can support project planning.', '探討如何在項目規劃中考慮知識產權。', '探讨如何在项目规划中考虑知识产权。'),
        long_description: text('Review a project idea, identify relevant intellectual property considerations and outline a simple strategy for organising further work.', '檢視項目構思，識別相關的知識產權因素，並為後續工作訂立簡單策略。', '检视项目构思，识别相关的知识产权因素，并为后续工作订立简单策略。'),
        mode: 'virtual', fee: 70, attendance_requirement_percent: '100.00', state: 'draft',
        registration_opens_at: '2026-11-01T09:00:00+08:00', registration_closes_at: '2026-12-10T18:00:00+08:00', payment_deadline: '2026-12-11T18:00:00+08:00',
        sessions: [session('session_1', '2026-12-22', '18:00', '19:00', 'virtual', text('Exploring a strategy', '探討策略', '探讨策略'))],
    },
    {
        code: 'CR-010', title: text('Innovation Basics', '創新入門', '创新入门'),
        short_description: text('An introduction to developing and reviewing ideas.', '認識發展及檢視構思的基本方法。', '认识发展及检视构思的基本方法。'),
        long_description: text('Explore how ideas develop through observation, discussion and review. The two sessions combine classroom activities with an online discussion.', '探討如何透過觀察、討論及檢視發展構思。兩節課堂結合課室活動與網上討論。', '探讨如何通过观察、讨论及检视发展构思。两节课堂结合课室活动与网上讨论。'),
        information: { audience: text('People exploring innovation', '認識創新的人士', '认识创新的人士') },
        mode: 'hybrid', fee: 120, attendance_requirement_percent: '50.00', state: 'archived',
        registration_opens_at: '2026-08-01T09:00:00+08:00', registration_closes_at: '2026-09-01T18:00:00+08:00', payment_deadline: '2026-09-02T18:00:00+08:00',
        sessions: [
            session('session_1', '2026-09-10', '14:00', '16:00', 'in_person', text('Starting with an idea', '由構思開始', '由构思开始'), { description: text('Discuss an innovation example.', '討論創新例子。', '讨论创新例子。') }),
            session('session_2', '2026-09-17', '14:00', '16:00', 'virtual', text('Reviewing the idea', '檢視構思', '检视构思'), { speaker }),
        ],
    },
];

// Shared English email templates. Keep the {{placeholders}} used by the renderers.
// These values are inserted into the email table; no messages are sent here.
const emailTemplates = [
    {
        event: 'application.acknowledgement',
        subject: 'Application acknowledgement — {{application_reference}}',
        body: `Dear {{participant_name}},

Your course application has been recorded.

Application reference: {{application_reference}}

Selected courses

{{courses}}

Total course fees: {{combined_total}}

All session dates and times are shown in Hong Kong time (UTC+8).

{{payment_note}}

{{payment_action}}

Please keep this email and your application reference for your records.

This message acknowledges your application. It does not confirm payment, attendance eligibility or course completion.`,
    },
    {
        event: 'attendance.scanner',
        subject: 'Attendance scanner — {{course_code}} — {{session_title}}',
        body: `Dear {{participant_name}},

Attendance taking is open for:

{{course_title}}
{{session_title}}
{{session_time}} — Hong Kong time

{{scanner_action}}

Check that your name is correct, then select Start scanner and allow camera access. Scan the QR code displayed by your teacher.

When your attendance is recorded, the scanner will show a confirmation and the recorded time.

Attendance closes at {{closing_time}}.

This link is personal. Do not forward it. If you cannot access the scanner or confirm your attendance, speak to the course administrator.`,
    },
    {
        event: 'attendance.result',
        subject: '{{message_heading}} — {{course_code}} — {{session_title}}',
        body: `Dear {{participant_name}},

{{introduction}}

Course: {{course_title}}
Course code: {{course_code}}
Session: {{session_title}}
Session time: {{session_time}} — Hong Kong time

Result: {{result}}
{{recorded_time}}

This message reports your attendance record for this session only.

If you believe this record is missing or incorrect, please contact the course administrator.`,
    },
    {
        event: 'certificate.issued',
        subject: 'Thank you for attending — {{course_code}}',
        body: `Dear {{participant_name}},

Thank you for attending {{course_title}}.

Your certificate is attached to this email.

Course code: {{course_code}}
Certificate number: {{certificate_number}}
Issue date: {{issued_date}}

Please keep the attached PDF for your records.`,
    }
];

// Applications and their course registrations, answers, attendance and payment state.
// Use reserved addresses for starter participants. Fees/totals/deadlines come from courses.
// Cancelled records use the seeded administrator as their cancellation actor.
const applications = [
    {
        "reference": "APP-202610-001",
        "salutation": "Mr",
        "full_name": "Alex Chan",
        "organisation": "Learning Group",
        "job_title": "Project officer",
        "phone": "00001001",
        "email": "alex.chan@example.invalid",
        "comments": "Please provide step-free access.",
        "consent_accepted": true,
        "created_at": "2026-10-27T10:00:00+08:00",
        "is_cancelled": false,
        "cancelled_at": null,
        "cancellation_reason": null,
        "registrations": [
            {
                "course_code": "CR-001",
                "answers": {
                    "demo_learning_goal": "Understand how to organise project records."
                },
                "attendance": {},
                "state": "registered",
                "cancelled_at": null,
                "cancellation_reason": null
            },
            {
                "course_code": "CR-002",
                "answers": {
                    "demo_learning_goal": "Understand how to organise project records."
                },
                "attendance": {},
                "state": "registered",
                "cancelled_at": null,
                "cancellation_reason": null
            },
            {
                "course_code": "CR-003",
                "answers": {
                    "demo_learning_goal": "Understand how to organise project records."
                },
                "attendance": {},
                "state": "registered",
                "cancelled_at": null,
                "cancellation_reason": null
            }
        ],
        "payment": {
            "reference": "PAY-202610-001",
            "state": "pending",
            "paid_at": null
        }
    },
    {
        "reference": "APP-202610-002",
        "salutation": "Ms",
        "full_name": "Jamie Lee",
        "organisation": "Learning Group",
        "job_title": "Project officer",
        "phone": "00001002",
        "email": "jamie.lee@example.invalid",
        "comments": null,
        "consent_accepted": true,
        "created_at": "2026-10-27T11:00:00+08:00",
        "is_cancelled": false,
        "cancelled_at": null,
        "cancellation_reason": null,
        "registrations": [
            {
                "course_code": "CR-004",
                "answers": {},
                "attendance": {},
                "state": "registered",
                "cancelled_at": null,
                "cancellation_reason": null
            },
            {
                "course_code": "CR-007",
                "answers": {},
                "attendance": {},
                "state": "registered",
                "cancelled_at": null,
                "cancellation_reason": null
            }
        ],
        "payment": {
            "reference": "PAY-202610-002",
            "state": "paid",
            "paid_at": "2026-10-28T10:00:00+08:00"
        }
    },
    {
        "reference": "APP-202610-003",
        "salutation": "Miss",
        "full_name": "Taylor Wong",
        "organisation": "Learning Group",
        "job_title": "Project officer",
        "phone": "00001003",
        "email": "taylor.wong@example.invalid",
        "comments": null,
        "consent_accepted": true,
        "created_at": "2026-10-10T10:00:00+08:00",
        "is_cancelled": false,
        "cancelled_at": null,
        "cancellation_reason": null,
        "registrations": [
            {
                "course_code": "CR-006",
                "answers": {},
                "attendance": {
                    "session_1": {
                        "recorded_at": "2026-10-20T09:55:00+08:00",
                        "attended": true
                    }
                },
                "state": "registered",
                "cancelled_at": null,
                "cancellation_reason": null
            }
        ],
        "payment": {
            "reference": "PAY-202610-003",
            "state": "paid",
            "paid_at": "2026-10-11T10:00:00+08:00"
        }
    },
    {
        "reference": "APP-202610-004",
        "salutation": "Mr",
        "full_name": "Casey Lam",
        "organisation": "Learning Group",
        "job_title": "Project officer",
        "phone": "00001004",
        "email": "casey.lam@example.invalid",
        "comments": null,
        "consent_accepted": true,
        "created_at": "2026-10-11T11:00:00+08:00",
        "is_cancelled": false,
        "cancelled_at": null,
        "cancellation_reason": null,
        "registrations": [
            {
                "course_code": "CR-006",
                "answers": {},
                "attendance": {},
                "state": "registered",
                "cancelled_at": null,
                "cancellation_reason": null
            }
        ],
        "payment": {
            "reference": "PAY-202610-004",
            "state": "expired",
            "paid_at": null
        }
    },
    {
        "reference": "APP-202610-005",
        "salutation": "Ms",
        "full_name": "Morgan Ho",
        "organisation": "Learning Group",
        "job_title": "Project officer",
        "phone": "00001005",
        "email": "morgan.ho@example.invalid",
        "comments": null,
        "consent_accepted": true,
        "created_at": "2026-10-27T12:00:00+08:00",
        "is_cancelled": true,
        "cancelled_at": "2026-10-28T15:00:00+08:00",
        "cancellation_reason": "Application withdrawn.",
        "registrations": [
            {
                "course_code": "CR-002",
                "answers": {},
                "attendance": {},
                "state": "cancelled",
                "cancelled_at": "2026-10-28T15:00:00+08:00",
                "cancellation_reason": "Application withdrawn."
            }
        ],
        "payment": {
            "reference": "PAY-202610-005",
            "state": "cancelled",
            "paid_at": null
        }
    },
    {
        "reference": "APP-202610-006",
        "salutation": "Mr",
        "full_name": "Riley Lau",
        "organisation": "Learning Group",
        "job_title": "Project officer",
        "phone": "00001006",
        "email": "riley.lau@example.invalid",
        "comments": null,
        "consent_accepted": true,
        "created_at": "2026-10-27T13:00:00+08:00",
        "is_cancelled": true,
        "cancelled_at": "2026-10-28T15:00:00+08:00",
        "cancellation_reason": "Application withdrawn.",
        "registrations": [
            {
                "course_code": "CR-004",
                "answers": {},
                "attendance": {},
                "state": "cancelled",
                "cancelled_at": "2026-10-28T15:00:00+08:00",
                "cancellation_reason": "Application withdrawn."
            }
        ],
        "payment": {
            "reference": "PAY-202610-006",
            "state": "paid",
            "paid_at": "2026-10-28T10:00:00+08:00"
        }
    }
];

// One truthful setup action per inserted application; no invented delivery/issuance events.
const seedLog = {
    actorType: 'system',
    event: 'development.registrations_seeded',
    details: { synthetic: true },
};

// END OF EDITABLE DATA. Normally no changes are needed below this line.

function text(en, traditional, simplified) {
    const result = { en };
    if (traditional) result['zh-Hant'] = traditional;
    if (simplified) result['zh-Hans'] = simplified;
    return result;
}

function session(id, date, start, end, mode, topic, optional = {}) {
    return {
        id,
        starts_at: `${date}T${start}:00+08:00`,
        ends_at: `${date}T${end}:00+08:00`,
        topic,
        mode,
        ...optional,
    };
}

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

async function insertEmailTemplates(client) {
    let inserted = 0;
    for (const template of emailTemplates) {
        const result = await client.query(
            `INSERT INTO email(course_id,event,subject,body) VALUES(NULL,$1,$2,$3)
             ON CONFLICT(course_id,event) DO NOTHING RETURNING id`,
            [template.event, template.subject, template.body]);
        inserted += result.rowCount;
    }
    return inserted;
}

async function insertCourses(client) {
    if (!courses.length) throw new Error('Declare at least one course in the starter data.');
    const validation = await client.query('SELECT valid_sessions($1::jsonb, $2) AS valid',
        [JSON.stringify(courses[0].sessions), courses[0].mode]);
    if (!validation.rows[0].valid) {
        throw new Error('The starter session data does not match the installed database schema.');
    }
    const result = { inserted: 0, skipped: 0 };
    for (const course of courses) {
        const existing = await client.query('SELECT id FROM course WHERE code = $1 OR code = $2 FOR UPDATE',
            [course.code, `DEMO-${course.code}`]);
        if (existing.rowCount > 1) throw new Error(`Both legacy and current codes exist for ${course.code}.`);
        if (existing.rowCount) {
            result.skipped += 1;
            continue;
        }
        const inserted = await client.query(
            `INSERT INTO course
             (code, title, short_description, long_description, information, mode, sessions,
              fee, registration_opens_at, registration_closes_at, payment_deadline,
              attendance_requirement_percent, state)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft')
             ON CONFLICT (code) DO NOTHING RETURNING id`,
            [course.code, course.title, course.short_description, course.long_description,
                course.information ?? {}, course.mode, JSON.stringify(course.sessions), course.fee,
                course.registration_opens_at ?? null, course.registration_closes_at ?? null,
                course.payment_deadline, course.attendance_requirement_percent]
        );
        if (!inserted.rowCount) {
            result.skipped += 1;
            continue;
        }
        const id = inserted.rows[0].id;
        await client.query('INSERT INTO question (course_id, definition) VALUES ($1, $2)', [id, course.questions ?? questions]);
        await client.query('INSERT INTO certificate (course_id, template) VALUES ($1, $2)', [id, course.certificate ?? certificate]);
        if (course.state !== 'draft') {
            await client.query('UPDATE course SET state = $1 WHERE id = $2', ['published', id]);
            if (course.state === 'archived') {
                await client.query('UPDATE course SET state = $1 WHERE id = $2', ['archived', id]);
            }
        }
        result.inserted += 1;
    }
    return result;
}

async function insertRegistrations(client, adminId) {
    let inserted = 0;
    let skipped = 0;
    for (const application of applications) {
        const existing = await client.query('SELECT id FROM submission WHERE reference=$1', [application.reference]);
        if (existing.rowCount) { skipped++; continue; }
        const codes = application.registrations.map(registration => registration.course_code);
        const result = await client.query('SELECT id,code,fee,payment_deadline FROM course WHERE code=ANY($1::text[]) ORDER BY id', [codes]);
        if (result.rowCount !== codes.length) throw new Error('A seeded application references a missing or repeated course.');
        const total = result.rows.reduce((sum, course) => sum + course.fee, 0);
        const deadline = new Date(Math.min(...result.rows.map(course => course.payment_deadline.getTime())));
        const submission = await client.query(
            `INSERT INTO submission(reference,salutation,full_name,organisation,job_title,phone,email,comments,
                consent_accepted,total,is_cancelled,cancelled_at,cancelled_by,cancellation_reason,created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
            [application.reference,application.salutation,application.full_name,application.organisation,application.job_title,
                application.phone,application.email,application.comments,application.consent_accepted,total,application.is_cancelled,
                application.cancelled_at,application.is_cancelled ? adminId : null,application.cancellation_reason,application.created_at]);
        const submissionId = submission.rows[0].id;
        for (const registration of application.registrations) {
            const course = result.rows.find(course => course.code === registration.course_code);
            await client.query(
                `INSERT INTO registration(submission_id,course_id,fee,answers,attendance,state,cancelled_at,cancelled_by,cancellation_reason,created_at)
                 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [submissionId,course.id,course.fee,registration.answers,registration.attendance,registration.state,
                    registration.cancelled_at,registration.state === 'cancelled' ? adminId : null,registration.cancellation_reason,application.created_at]);
        }
        if (total > 0) {
            await client.query(
                `INSERT INTO payment(submission_id,reference,amount,due_at,state,paid_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
                [submissionId,application.payment.reference,total,deadline,application.payment.state,application.payment.paid_at,application.created_at]);
        }
        await writeLog(client, { ...seedLog, submissionId, details: { ...seedLog.details, registrations: result.rowCount } });
        inserted++;
    }
    return { inserted, skipped };
}

async function seed({ username = administrator.username, password = administrator.password, database = pool } = {}) {
    const client = await database.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('reg-course initial data seed'))");
        const admin = await insertAdmin(client, username, password);
        const adminId = (await client.query('SELECT id FROM admin WHERE username=$1', [username.trim()])).rows[0].id;
        const templates = await insertEmailTemplates(client);
        const courses = await insertCourses(client);
        const registrations = await insertRegistrations(client, adminId);
        await client.query('COMMIT');
        return { admin, templates, courses, registrations };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

async function run() {
    if (process.argv.length > 2) throw new Error('Use npm run seed without additional arguments.');
    const result = await seed();
    console.log('Administrator accounts inserted:', result.admin);
    console.log('Email templates inserted:', result.templates);
    console.log('Courses inserted/skipped:', result.courses.inserted, result.courses.skipped);
    console.log('Applications inserted/skipped:', result.registrations.inserted, result.registrations.skipped);
}

if (require.main === module) {
    run().catch(function reportSeedError(error) {
        console.error('Seed failed:', error.message);
        process.exitCode = 1;
    }).finally(function closePool() { return pool.end(); });
}

module.exports = { seed, seedData: { courses, questions, certificate, emailTemplates, applications }, insertAdmin, insertCourses, insertRegistrations };
