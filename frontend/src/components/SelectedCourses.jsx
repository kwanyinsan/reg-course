import CourseFacts from './CourseFacts';
import { courseText, feeCents, formatMoney } from '../course-utils';

function SelectedCourses({ courses, text, language, busy, onRemove, onStart }) {
    const total = courses.reduce(function addFee(sum, course) { return sum + feeCents(course.fee); }, 0);
    return (
        <section className="selected-courses">
            <p>{text.applicationSelection}</p>
            {!courses.length ? <p>{text.noSelectedCourses}</p> : (
                <>
                    <div className="selection-toolbar">
                        <span>{text.selectedCount}: {courses.length}</span>
                        <span>{text.total}: {formatMoney(total, language)}</span>
                        <button type="button" className="selection-apply" disabled={busy} onClick={onStart}>{text.beginApplication}</button>
                    </div>
                    <ul className="selected-course-list">
                        {courses.map(function selectedRow(course) {
                            return <li key={course.id}><article className="selected-course-row">
                                <div className="selected-course-info">
                                    <h2><a href={`#courses/${course.id}`}>{courseText(course.title, language)}</a></h2>
                                    <p className="course-code">{course.code}</p>
                                    <p>{courseText(course.short_description, language)}</p>
                                    <CourseFacts course={course} text={text} language={language} includeFee={false} />
                                    <p className={`course-availability ${course.availability}`}>{text[course.availability]}</p>
                                </div>
                                <div className="selected-course-actions">
                                    <p className="selected-course-fee"><span>{text.fee}</span><strong>{formatMoney(feeCents(course.fee), language)}</strong>{course.fee === 0 && <span>{text.free}</span>}</p>
                                    <a className="button secondary-button" href={`#courses/${course.id}`}>{text.details}</a>
                                    <button type="button" className="secondary-button" disabled={busy} onClick={function remove() { onRemove(course.id); }}>{text.remove}</button>
                                </div>
                            </article></li>;
                        })}
                    </ul>
                    <p>{text.currentFees}</p>
                </>
            )}
        </section>
    );
}

export default SelectedCourses;
