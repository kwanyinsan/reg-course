import { useEffect, useRef, useState } from 'react';
import { courseText } from '../course-utils';
import { cleanDefinition, emptyOption, newFieldId, questionDraftDirty, validateQuestionDraft } from '../question-utils';
import QuestionEditorCard from './QuestionEditorCard';
import CourseFormPreview from './CourseFormPreview';

function loadedDraft(data, courseId, adminId) {
    return { courseId, adminId, originalDefinition: data.question?.definition ?? null,
        definition: structuredClone(data.question?.definition ?? { questions: [] }), editingLanguage: 'en' };
}

function SaveActions({ text, busy, disabled, onSave, onDiscard }) {
    return <div className="question-actions">
        <button type="button" disabled={disabled || busy} onClick={onSave}>{busy ? text.savingQuestions : text.saveQuestions}</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={onDiscard}>{text.discardQuestions}</button>
    </div>;
}

function CourseQuestionEditor({ id, adminId, text, language, draft, onDraftChange, onSessionExpired }) {
    const [result, setResult] = useState({ id: null, status: 'loading' });
    const [refresh, setRefresh] = useState(0);
    const [busy, setBusy] = useState(false);
    const [issue, setIssue] = useState(null);
    const [message, setMessage] = useState('');
    const savePending = useRef(false);
    const replaceOnLoad = useRef(false);
    useEffect(function loadBank() {
        let ignore = false;
        async function load() {
            try {
                const response = await fetch(`/api/staff/courses/${id}/questions`, { signal: AbortSignal.timeout(10000) });
                const data = await response.json();
                if (ignore) return;
                if (response.status === 401) return onSessionExpired();
                if (!response.ok || !data.course) return setResult({ id, status: 'error', message: response.status === 404 ? 'courseUnavailable' : 'questionLoadError' });
                const replace = replaceOnLoad.current;
                onDraftChange(function keepLocalEdits(current) {
                    if (!replace && current?.adminId === adminId && questionDraftDirty(current)) return current;
                    return loadedDraft(data, id, adminId);
                });
                replaceOnLoad.current = false;
                setResult({ id, status: 'ready', data });
            } catch {
                if (!ignore) setResult({ id, status: 'error', message: 'questionLoadError' });
            }
        }
        load();
        return function ignoreOldResponse() { ignore = true; };
    }, [id, adminId, refresh, onDraftChange, onSessionExpired]);

    const current = draft?.courseId === id && draft.adminId === adminId ? draft : null;
    const dirty = questionDraftDirty(current);
    function editDefinition(definition) {
        setIssue(null);
        setMessage('');
        onDraftChange(function edit(previous) { return { ...previous, definition }; });
    }
    function showIssue(error) {
        setIssue(error);
        if (error.field) {
            const labelLanguage = error.field.split('.').at(-1);
            if (['en', 'zh-Hant', 'zh-Hans'].includes(labelLanguage)) {
                onDraftChange(function focusLanguage(previous) { return { ...previous, editingLanguage: labelLanguage }; });
            }
        }
        requestAnimationFrame(function focusError() {
            const target = error.field ? document.querySelector(`[data-field="${error.field}"]`) : null;
            (target || document.getElementById('question-save-error'))?.focus();
        });
    }
    async function save() {
        if (savePending.current || !current || !result.data.editable) return;
        setMessage('');
        const definition = cleanDefinition(current.definition);
        const error = validateQuestionDraft(definition);
        if (error) return showIssue(error);
        savePending.current = true;
        setBusy(true);
        setIssue(null);
        try {
            const response = await fetch(`/api/staff/courses/${id}/questions`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'reg-course' },
                body: JSON.stringify({ definition, original_definition: current.originalDefinition }), signal: AbortSignal.timeout(10000),
            });
            const data = await response.json().catch(function invalidJson() { return null; });
            if (response.status === 401) return onSessionExpired();
            if (!response.ok || !data?.question) {
                if (data?.code === 'form_locked') setResult(function lock(previous) {
                    return { ...previous, data: { ...previous.data, editable: false, lock_reason: data.lock_reason } };
                });
                showIssue({ code: response.status === 413 ? 'definition_too_large' : data?.code || 'save_failed', field: data?.field });
                return;
            }
            onDraftChange(function saved(previous) {
                if (previous?.courseId !== id || previous.adminId !== adminId) return previous;
                return { ...loadedDraft(data, id, adminId), editingLanguage: previous.editingLanguage };
            });
            setResult({ id, status: 'ready', data });
            setMessage('questionsSaved');
        } catch {
            setIssue({ code: 'save_unconfirmed' });
        } finally {
            savePending.current = false;
            setBusy(false);
        }
    }
    function reload() {
        if (busy || (dirty && !window.confirm(text.confirmDiscardQuestions))) return;
        replaceOnLoad.current = true;
        setIssue(null);
        setMessage('');
        setResult({ id, status: 'loading' });
        setRefresh(function increment(previous) { return previous + 1; });
    }
    function jump(event, target) {
        event.preventDefault();
        const section = document.getElementById(target);
        section?.focus();
        section?.scrollIntoView({ block: 'start' });
    }
    if (result.id !== id || result.status === 'loading') return <p role="status">{text.loadingQuestions}</p>;
    if (result.status === 'error') return <section><p role="alert">{text[result.message]}</p><button type="button" onClick={reload}>{text.tryAgain}</button><p><a href={`#staff/courses/${id}`}>{text.backToCourse}</a></p></section>;
    const { course, editable, lock_reason: reason } = result.data;
    if (!current) return <section><p role="alert">{text.otherUnsavedQuestions}</p>
        <a href={`#staff/courses/${draft?.courseId}/questions`}>{text.returnToUnsavedQuestions}</a>
        <button type="button" onClick={function replace() { if (window.confirm(text.confirmDiscardQuestions)) onDraftChange(loadedDraft(result.data, id, adminId)); }}>{text.openThisQuestionBank}</button>
    </section>;
    return (
        <section className="course-question-workspace">
            <a href={`#staff/courses/${id}`}>{text.backToCourse}</a>
            <h2>{courseText(course.title, language)}</h2><p className="course-code">{course.code}</p>
            <p className="question-bank-state">{editable ? text.questionsEditable : text.questionsLocked} — {dirty ? text.unsavedChanges : result.data.question ? text.savedQuestionBank : text.noSavedQuestionBank}</p>
            {!editable && <p className="feedback">{text[`questionLock_${reason}`] || text.questionsLocked}{dirty && ` ${text.unsavedQuestionsRetained}`}</p>}
            {issue && <p id="question-save-error" className="feedback error" role="alert" tabIndex="-1">{text[`questionError_${issue.code}`] || text.questionError_save_failed}</p>}
            {message && <p className="feedback" role="status">{text[message]}</p>}
            {busy && <p role="status">{text.savingQuestions}</p>}
            {editable && <SaveActions text={text} busy={busy} disabled={!dirty && Boolean(result.data.question)} onSave={save} onDiscard={reload} />}
            {!editable && dirty && <button type="button" className="secondary-button" onClick={reload}>{text.discardQuestions}</button>}
            <div className={editable ? 'question-editor-layout' : 'question-locked-layout'}>
                {editable && <section id="question-editor" tabIndex="-1" aria-labelledby="editor-heading">
                    <h2 id="editor-heading">{text.questionEditor}</h2>
                    <a className="question-jump" href="#question-preview" onClick={function preview(event) { jump(event, 'question-preview'); }}>{text.jumpToPreview}</a>
                    <label className="question-label-language" htmlFor="question-label-language">{text.editLabelLanguage}
                        <select id="question-label-language" value={current.editingLanguage} onChange={function choose(event) { onDraftChange({ ...current, editingLanguage: event.target.value }); }}>
                            <option value="en">{text.languageEnglish}</option><option value="zh-Hant">{text.languageTraditional}</option><option value="zh-Hans">{text.languageSimplified}</option>
                        </select>
                    </label>
                    <p>{text.labelLanguageExplanation}</p>
                    <fieldset className="question-edit-fields" disabled={busy}>
                        <legend className="visually-hidden">{text.courseSpecificQuestions}</legend>
                        {!current.definition.questions.length && <p>{text.noAdditionalQuestions}</p>}
                        {current.definition.questions.map(function card(question, index) {
                            function replaceQuestion(next) { editDefinition({ questions: current.definition.questions.map(function update(item) { return item.id === question.id ? next : item; }) }); }
                            return <QuestionEditorCard key={question.id} question={question} index={index} total={current.definition.questions.length}
                                editingLanguage={current.editingLanguage} text={text} errorField={issue?.field} onChange={replaceQuestion}
                                onTypeChange={function changeType(type) {
                                    const next = { id: newFieldId('q'), label: question.label, type, required: question.required };
                                    if (type !== 'text') next.options = question.options || [emptyOption()];
                                    replaceQuestion(next);
                                    requestAnimationFrame(function focusType() { document.getElementById(`type-${next.id}`)?.focus(); });
                                }}
                                onAddOption={function addOption() { replaceQuestion({ ...question, options: [...question.options, emptyOption()] }); }}
                                onRemove={function remove() { editDefinition({ questions: current.definition.questions.filter(function keep(item) { return item.id !== question.id; }) }); }}
                                onMove={function move(direction) {
                                    const questions = [...current.definition.questions];
                                    [questions[index], questions[index + direction]] = [questions[index + direction], questions[index]];
                                    editDefinition({ questions });
                                }} />;
                        })}
                        <button type="button" className="secondary-button" onClick={function addQuestion() {
                            const question = { id: newFieldId('q'), label: { en: '' }, type: 'text', required: false };
                            editDefinition({ questions: [...current.definition.questions, question] });
                            requestAnimationFrame(function focusLabel() { document.getElementById(`label-${question.id}`)?.focus(); });
                        }}>{text.addQuestion}</button>
                    </fieldset>
                    <SaveActions text={text} busy={busy} disabled={!dirty && Boolean(result.data.question)} onSave={save} onDiscard={reload} />
                </section>}
                <div><CourseFormPreview definition={current.definition} language={language} text={text} dirty={dirty || !result.data.question} />
                    {editable && <a className="question-jump" href="#question-editor" onClick={function editor(event) { jump(event, 'question-editor'); }}>{text.backToEditor}</a>}
                </div>
            </div>
        </section>
    );
}

export default CourseQuestionEditor;
