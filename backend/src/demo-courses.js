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

const speaker = text('Mira Demo (fictional demo speaker)', '米拉・示範（虛構講者）', '米拉·示范（虚构讲者）');
const openDates = {
    registration_opens_at: '2026-10-01T09:00:00+08:00',
    registration_closes_at: '2026-11-30T18:00:00+08:00',
    payment_deadline: '2026-12-01T18:00:00+08:00',
};
const richInformation = {
    venue: text('Demo classroom A and an online classroom', '示範課室 A 及網上課室', '示范课室 A 及网上课室'),
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
        code: 'DEMO-CR-001',
        title: text('IP Basics (Demo)'),
        short_description: text('A short introduction to intellectual property.'),
        long_description: text('Explore the basic idea of intellectual property using fictional examples.'),
        mode: 'in_person', fee: '0.00', attendance_requirement_percent: '100.00', state: 'published',
        payment_deadline: '2026-12-04T18:00:00+08:00',
        sessions: [session('session_1', '2026-12-05', '10:00', '11:00', 'in_person', text('Getting started'))],
    },
    {
        code: 'DEMO-CR-002',
        title: text('Trademark Basics (Demo)', '商標入門（示範）', '商标入门（示范）'),
        short_description: text('Explore names, signs and the basic purpose of trademarks.', '認識名稱、標誌及商標的基本用途。', '认识名称、标志及商标的基本用途。'),
        long_description: text('Use fictional business names to discuss how trademarks help distinguish products and services. This demonstration course introduces vocabulary and simple examples; it does not provide legal advice.', '透過虛構商業名稱，討論商標如何區分產品及服務。本示範課程介紹基本用語及例子，並不提供法律意見。', '通过虚构商业名称，讨论商标如何区分产品及服务。本示范课程介绍基本用语及例子，并不提供法律意见。'),
        information: { venue: text('Online classroom', '網上課室', '网上课室'), teaching_language: text('English', '英語', '英语') },
        mode: 'virtual', fee: '149.50', attendance_requirement_percent: '100.00', state: 'published', ...openDates,
        sessions: [session('session_1', '2026-12-06', '19:00', '21:00', 'virtual', text('Names and signs', '名稱與標誌', '名称与标志'), {
            description: text('Discuss fictional examples of names and product signs.', '討論虛構名稱與產品標誌的例子。', '讨论虚构名称与产品标志的例子。'), speaker,
        })],
    },
    {
        code: 'DEMO-CR-003',
        title: text('From Idea to Prototype (Demo)', '從構思到原型（示範）', '从构思到原型（示范）'),
        short_description: text('Four sessions on recording ideas and developing a fictional prototype.', '透過四節課堂，學習記錄構思及開發虛構原型。', '通过四节课堂，学习记录构思及开发虚构原型。'),
        long_description: text('Follow a fictional team as it develops an idea into a prototype. Start with observation and notes, then organise decisions and discuss how a team can retain a clear project record.\n\nThe four sessions combine online discussions and classroom exercises. All exercises use synthetic examples and make no claims about accreditation or professional qualification.', '跟隨虛構團隊，把構思發展成原型。先從觀察及筆記開始，再整理決策，討論如何保留清晰的項目紀錄。\n\n四節課堂結合網上討論與課室練習。所有練習均採用虛構例子，不涉及認可資格或專業認證。', '跟随虚构团队，把构思发展成原型。先从观察及笔记开始，再整理决策，讨论如何保留清晰的项目记录。\n\n四节课堂结合网上讨论与课室练习。所有练习均采用虚构例子，不涉及认可资格或专业认证。'),
        information: richInformation,
        mode: 'hybrid', fee: '350.25', attendance_requirement_percent: '50.00', state: 'published', ...openDates,
        sessions: [
            session('session_1', '2026-12-08', '19:00', '21:00', 'virtual', text('Understanding an idea', '認識構思', '认识构思'), { description: text('Discuss what the fictional team wants to achieve.', '討論虛構團隊希望達成的目標。', '讨论虚构团队希望达成的目标。'), speaker }),
            session('session_2', '2026-12-10', '19:00', '21:00', 'in_person', text('Recording decisions', '記錄決策', '记录决策'), { description: text('Practise keeping useful project notes.', '練習記錄實用的項目筆記。', '练习记录实用的项目笔记。') }),
            session('session_3', '2026-12-12', '19:00', '21:00', 'virtual', text('Reviewing a prototype', '檢視原型', '检视原型'), { speaker }),
            session('session_4', '2026-12-15', '19:00', '21:00', 'in_person', text('Sharing the project record', '分享項目紀錄', '分享项目记录')),
        ],
    },
    {
        code: 'DEMO-CR-004',
        title: text('Creative Works and Copyright (Demo)', '創作與版權（示範）', '创作与版权（示范）'),
        short_description: text('Explore creative works through two practical discussions.', '透過兩節實務討論認識創作。', '通过两节实务讨论认识创作。'),
        long_description: text('Discuss fictional drawings, photographs and written work. Explore why a team should keep clear records of how creative material was produced and used.', '討論虛構繪畫、照片及文字作品，認識團隊為何應清楚記錄創作素材的製作及使用方式。', '讨论虚构绘画、照片及文字作品，认识团队为何应清楚记录创作素材的制作及使用方式。'),
        information: { audience: text('People working with creative material', '處理創作素材的人士', '处理创作素材的人士'), prerequisites: null, teaching_language: '' },
        mode: 'in_person', fee: '80.00', attendance_requirement_percent: '50.00', state: 'published',
        registration_closes_at: openDates.registration_closes_at, payment_deadline: openDates.payment_deadline,
        sessions: [
            session('session_1', '2026-12-13', '14:00', '16:00', 'in_person', text('Understanding creative material', '認識創作素材', '认识创作素材'), { description: text('Compare different kinds of fictional creative work.', '比較不同類型的虛構創作。', '比较不同类型的虚构创作。') }),
            session('session_2', '2026-12-20', '14:00', '16:00', 'in_person', text('Keeping a usage record', '保留使用紀錄', '保留使用记录')),
        ],
    },
    {
        code: 'DEMO-CR-005',
        title: text('Digital Content Rights (Demo)', '數碼內容權利（示範）', '数码内容权利（示范）'),
        short_description: text('An introductory discussion about fictional digital content.', '有關虛構數碼內容的入門討論。', '有关虚构数码内容的入门讨论。'),
        long_description: text('Use a fictional website project to discuss organising content permissions and records. This is a free demonstration course with a future registration opening date.', '以虛構網站項目討論如何整理內容授權及紀錄。這是免費示範課程，報名將於指定日期開始。', '以虚构网站项目讨论如何整理内容授权及记录。这是免费示范课程，报名将于指定日期开始。'),
        information: { teaching_language: text('English', '英語', '英语') },
        mode: 'virtual', fee: '0.00', attendance_requirement_percent: '100.00', state: 'published',
        registration_opens_at: '2026-11-10T09:00:00+08:00', registration_closes_at: '2026-12-10T18:00:00+08:00', payment_deadline: '2026-12-11T18:00:00+08:00',
        sessions: [session('session_1', '2026-12-19', '11:00', '12:00', 'virtual', text('Organising content permissions', '整理內容授權', '整理内容授权'), { description: text('Review an example content record.', '檢視內容紀錄例子。', '检视内容记录例子。'), speaker })],
    },
    {
        code: 'DEMO-CR-006', title: text('Licensing Introduction (Demo)'),
        short_description: text('An introductory demonstration course whose registration has closed.'),
        long_description: text('Discuss a fictional licensing example and the information a team may wish to record. This past demonstration course remains visible for testing the closed-registration display.'),
        mode: 'in_person', fee: '50.10', attendance_requirement_percent: '100.00', state: 'published',
        registration_opens_at: '2026-10-01T09:00:00+08:00', registration_closes_at: '2026-10-15T18:00:00+08:00', payment_deadline: '2026-10-16T18:00:00+08:00',
        sessions: [session('session_1', '2026-10-20', '10:00', '12:00', 'in_person', text('A licensing example'), { description: text('Discuss the fictional example as a group.'), speaker: text('Mira Demo (fictional demo speaker)') })],
    },
    {
        code: 'DEMO-CR-007', title: text('Organising IP Records (Demo)', '整理知識產權紀錄（示範）'),
        short_description: text('Build a simple record of fictional project information.', '為虛構項目資訊建立簡單紀錄。'),
        long_description: text('Practise grouping project notes into a clear record. This demonstration deliberately provides English and Traditional Chinese content, allowing the Simplified Chinese interface to demonstrate English fallback.', '練習把項目筆記整理成清晰紀錄。本示範刻意提供英文及繁體中文內容，以展示簡體中文介面的英文後備內容。'),
        information: { audience: null, prerequisites: '', venue: {}, learning_outcomes: [] },
        mode: 'virtual', fee: '99.99', attendance_requirement_percent: '50.00', state: 'published', ...openDates,
        sessions: [
            session('session_1', '2026-12-07', '19:00', '20:00', 'virtual', text('Gathering notes', '收集筆記')),
            session('session_2', '2026-12-14', '19:00', '20:00', 'virtual', text('Organising the record', '整理紀錄')),
        ],
    },
    {
        code: 'DEMO-CR-008',
        title: text('Practical IP Record-Keeping for Small Teams: From Initial Ideas to Organised Project Files (Demo)', '小型團隊知識產權紀錄實務：從初步構思到有序項目檔案（示範）', '小型团队知识产权记录实务：从初步构思到有序项目档案（示范）'),
        short_description: text('A detailed fictional case study covering the journey from early notes to a structured project file, with classroom and online sessions.', '透過詳細虛構案例，從初期筆記整理至有序項目檔案，結合課室及網上課堂。', '通过详细虚构案例，从初期笔记整理至有序项目档案，结合课室及网上课堂。'),
        long_description: text('Small teams often collect ideas across notebooks, messages and shared files. This fictional case study follows a team that wants a more consistent way to organise that information. Participants compare several example records and discuss what makes them understandable to another team member.\n\nThe first session uses a classroom exercise to organise the team’s early notes. The second session takes place online and reviews a more developed project file. Examples include decisions, revisions, references and simple notes about creative material. The aim is to practise a clear recording process rather than assess any real person or business.\n\nAll names, projects and settings are invented for this prototype. The course does not claim official accreditation, professional status or legal advice. Its extended text also provides a practical check that descriptions remain readable on narrow screens and across the three interface languages.', '小型團隊經常把構思分散記錄在筆記本、訊息及共用檔案。本虛構案例介紹一個希望有系統整理資訊的團隊。學員會比較多份示範紀錄，討論如何讓其他成員容易理解。\n\n第一節以課室練習整理團隊的早期筆記。第二節於網上進行，檢視較完整的項目檔案。例子包括決策、修訂、參考資料及創作素材筆記，重點是練習清晰的記錄流程，而非評估真實人士或企業。\n\n所有名稱、項目及設定均為本原型而虛構。課程不聲稱具官方認可、專業資格或提供法律意見。較長文字亦用於檢查窄屏幕及三語介面的閱讀效果。', '小型团队经常把构思分散记录在笔记本、消息及共享文件。本虚构案例介绍一个希望有系统整理信息的团队。学员会比较多份示范记录，讨论如何让其他成员容易理解。\n\n第一节以课室练习整理团队的早期笔记。第二节于网上进行，检视较完整的项目文件。例子包括决策、修订、参考资料及创作素材笔记，重点是练习清晰的记录流程，而非评估真实人士或企业。\n\n所有名称、项目及设置均为本原型而虚构。课程不声称具官方认可、专业资格或提供法律意见。较长文字亦用于检查窄屏幕及三语界面的阅读效果。'),
        information: { ...richInformation, extra_demo_field: { deliberately_not_displayed: true } },
        mode: 'hybrid', fee: '275.50', attendance_requirement_percent: '100.00', state: 'published', ...openDates,
        sessions: [
            session('session_1', '2026-12-09', '14:00', '16:00', 'in_person', text('Organising the early project record', '整理早期項目紀錄', '整理早期项目记录'), { description: text('Work through the fictional team’s notes and identify useful groupings. Compare alternative ways to describe a decision, record a revision and retain a reference. The session uses only invented materials, so participants can discuss the examples without sharing private project information.', '整理虛構團隊的筆記，找出實用的分類方式。比較如何描述決策、記錄修訂及保留參考資料。課堂只使用虛構素材，無需分享私人項目資訊。', '整理虚构团队的笔记，找出实用的分类方式。比较如何描述决策、记录修订及保留参考资料。课堂只使用虚构素材，无需分享私人项目信息。'), speaker }),
            session('session_2', '2026-12-16', '19:00', '21:00', 'virtual', text('Reviewing and sharing the file', '檢視及分享檔案', '检视及分享文件')),
        ],
    },
    {
        code: 'DEMO-CR-009', title: text('IP Strategy Workshop (Demo)', '知識產權策略工作坊（示範）', '知识产权策略工作坊（示范）'),
        short_description: text('An unpublished demonstration workshop.', '尚未發佈的示範工作坊。', '尚未发布的示范工作坊。'),
        long_description: text('This draft remains editable for later course-form work. It must not appear on public pages.', '此草稿保留作日後課程表格工作之用，不應在公開頁面顯示。', '此草稿保留作日后课程表格工作之用，不应在公开页面显示。'),
        mode: 'virtual', fee: '75.00', attendance_requirement_percent: '100.00', state: 'draft',
        registration_opens_at: '2026-11-01T09:00:00+08:00', registration_closes_at: '2026-12-10T18:00:00+08:00', payment_deadline: '2026-12-11T18:00:00+08:00',
        sessions: [session('session_1', '2026-12-22', '18:00', '19:00', 'virtual', text('Exploring a strategy', '探討策略', '探讨策略'))],
    },
    {
        code: 'DEMO-CR-010', title: text('Innovation Basics (Demo)', '創新入門（示範）', '创新入门（示范）'),
        short_description: text('An archived demonstration course.', '已封存的示範課程。', '已封存的示范课程。'),
        long_description: text('This synthetic past course tests archived-course visibility and publication protections.', '此虛構過往課程用於測試封存課程的可見性及發佈保護。', '此虚构过往课程用于测试封存课程的可见性及发布保护。'),
        information: { audience: text('Demonstration learners', '示範學員', '示范学员') },
        mode: 'hybrid', fee: '120.00', attendance_requirement_percent: '50.00', state: 'archived',
        registration_opens_at: '2026-08-01T09:00:00+08:00', registration_closes_at: '2026-09-01T18:00:00+08:00', payment_deadline: '2026-09-02T18:00:00+08:00',
        sessions: [
            session('session_1', '2026-09-10', '14:00', '16:00', 'in_person', text('Starting with an idea', '由構思開始', '由构思开始'), { description: text('Discuss a fictional innovation example.', '討論虛構創新例子。', '讨论虚构创新例子。') }),
            session('session_2', '2026-09-17', '14:00', '16:00', 'virtual', text('Reviewing the idea', '檢視構思', '检视构思'), { speaker }),
        ],
    },
];

module.exports = courses;
