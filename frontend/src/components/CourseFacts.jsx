import { feeCents, formatCourseDate, formatMoney } from '../course-utils';

function CourseFacts({ course, text, language, includeFee = true }) {
    const firstDate = formatCourseDate(course.starts_at, language);
    const lastDate = formatCourseDate(course.ends_at, language);
    return <dl className="course-facts">
        <div><dt>{text.courseDates}</dt><dd>{firstDate}{firstDate !== lastDate && ` – ${lastDate}`}</dd></div>
        <div><dt>{text.sessions}</dt><dd>{course.session_count}</dd></div>
        <div><dt>{text.courseMode}</dt><dd>{text[course.mode]}</dd></div>
        {includeFee && <div><dt>{text.fee}</dt><dd>{formatMoney(feeCents(course.fee), language)}{course.fee === 0 && ` (${text.free})`}</dd></div>}
    </dl>;
}

export default CourseFacts;
