import { courseText } from '../course-utils';
import CourseFacts from './CourseFacts';

function CourseList({ courses, text, language, filters, onFilter, selectedIds, busy, onToggle, onRefresh }) {
    const search = filters.search.trim().toLocaleLowerCase();
    const matches = courses.filter(function matchesFilters(course) {
        const searchable = [course.code, ...Object.values(course.title), ...Object.values(course.short_description)].join(' ').toLocaleLowerCase();
        return (!search || searchable.includes(search)) &&
            (!filters.mode || course.mode === filters.mode) &&
            (!filters.availability || course.availability === filters.availability);
    });

    return (
        <div className="course-list-layout">
            <section className="course-filters" aria-labelledby="filter-title">
                <h2 id="filter-title">{text.filterCourses}</h2>
                <label htmlFor="course-search">{text.searchCourses}</label>
                <input id="course-search" type="search" value={filters.search}
                    onChange={function searchChanged(event) { onFilter({ ...filters, search: event.target.value }); }} />
                <label htmlFor="course-mode">{text.courseMode}</label>
                <select id="course-mode" value={filters.mode}
                    onChange={function modeChanged(event) { onFilter({ ...filters, mode: event.target.value }); }}>
                    <option value="">{text.allModes}</option>
                    {['in_person', 'virtual', 'hybrid'].map(function modeOption(mode) {
                        return <option key={mode} value={mode}>{text[mode]}</option>;
                    })}
                </select>
                <label htmlFor="course-availability">{text.availability}</label>
                <select id="course-availability" value={filters.availability}
                    onChange={function availabilityChanged(event) { onFilter({ ...filters, availability: event.target.value }); }}>
                    <option value="">{text.allAvailability}</option>
                    {['open', 'upcoming', 'closed'].map(function availabilityOption(value) {
                        return <option key={value} value={value}>{text[value]}</option>;
                    })}
                </select>
                <div className="course-filter-actions"><button type="button" className="secondary-button"
                    onClick={function clearFilters() { onFilter({ search: '', mode: '', availability: '' }); }}>
                    {text.clearFilters}
                </button>
                <button type="button" className="secondary-button" onClick={onRefresh}>{text.refreshCourses}</button></div>
            </section>
            <section className="course-results" aria-label={text.courses}>
                <p role="status">{text.results}: {matches.length}</p>
                {!courses.length ? <p>{text.noCourses}</p> : !matches.length ? <p>{text.noMatchingCourses}</p> : (
                    <div className="course-grid">
                        {matches.map(function courseCard(course) {
                            const selected = selectedIds.includes(course.id);
                            return (
                                <article key={course.id} className="course-card">
                                    <h2><a href={`#courses/${course.id}`}>{courseText(course.title, language)}</a></h2>
                                    <p className="course-code">{course.code}</p>
                                    <p>{courseText(course.short_description, language)}</p>
                                    <CourseFacts course={course} text={text} language={language} />
                                    <p className={`course-availability ${course.availability}`}>{text[course.availability]}</p>
                                    <div className="course-actions">
                                        <a className="button secondary-button" href={`#courses/${course.id}`}>{text.details}</a>
                                        <button type="button" disabled={busy || (!selected && course.availability !== 'open')}
                                            aria-pressed={selected}
                                            onClick={function toggle() { onToggle(course); }}>
                                            {selected ? text.remove : text.selectCourse}
                                        </button>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
}

export default CourseList;
