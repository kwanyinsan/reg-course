import { courseText, feeCents, formatMoney } from '../course-utils';

function SelectedCourses({ courses, text, language, busy, onRemove }) {
    const total = courses.reduce(function addFee(sum, course) { return sum + feeCents(course.fee); }, 0);
    return (
        <section className="selected-courses">
            <p>{text.selectionOnly}</p>
            {!courses.length ? <p>{text.noSelectedCourses}</p> : (
                <>
                    <ul className="selected-course-list">
                        {courses.map(function selectedRow(course) {
                            return (
                                <li key={course.id}>
                                    <div>
                                        <a href={`#courses/${course.id}`}>{courseText(course.title, language)}</a>
                                        <p className="course-code">{course.code}</p>
                                    </div>
                                    <span>{formatMoney(feeCents(course.fee), language)}</span>
                                    <button type="button" className="secondary-button" disabled={busy}
                                        onClick={function remove() { onRemove(course.id); }}>{text.remove}</button>
                                </li>
                            );
                        })}
                    </ul>
                    <p className="selection-total">{text.selectedCount}: {courses.length} — {text.total}: {formatMoney(total, language)}</p>
                    <p>{text.currentFees}</p>
                </>
            )}
            <a className="button" href="#courses">{text.continueBrowsing}</a>
        </section>
    );
}

export default SelectedCourses;
