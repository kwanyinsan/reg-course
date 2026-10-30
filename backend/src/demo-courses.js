// Synthetic development fixtures; neutral display wording does not imply official course offerings.
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

module.exports = courses;
