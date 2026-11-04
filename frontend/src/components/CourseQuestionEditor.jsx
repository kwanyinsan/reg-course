import { useEffect, useRef, useState } from 'react';
import { courseText } from '../course-utils';
import { cleanDefinition, emptyOption, newFieldId, questionDraftDirty, validateQuestionDraft } from '../question-utils';
import QuestionFields from './QuestionFields';

function TranslationStatus({ label, text }) {
    return <p className="question-translations">{text.translationStatus}: {['en', 'zh-Hant', 'zh-Hans'].map(function status(language) {
        return <span key={language}>{language === 'en' ? 'EN' : language === 'zh-Hant' ? '繁' : '简'}: {label[language]?.trim() ? text.translationPresent : text.translationMissing}</span>;
    })}</p>;
}

function QuestionEditorCard({ question, index, total, editingLanguage, text, errorField, onChange, onTypeChange, onMove, onRemove, onAddOption }) {
    const field = `questions.${index}`;
    function changeLabel(value) { onChange({ ...question, label: { ...question.label, [editingLanguage]: value } }); }
    return (
        <section className="question-editor-card" aria-labelledby={`heading-${question.id}`}>
            <h3 id={`heading-${question.id}`}>{text.question} {index + 1}</h3>
            <div className="question-settings">
                <label htmlFor={`type-${question.id}`}>{text.questionType}</label>
                <select id={`type-${question.id}`} value={question.type} onChange={function changeType(event) { onTypeChange(event.target.value); }}>
                    {['text', 'single_choice', 'multiple_choice'].map(function typeOption(type) { return <option value={type} key={type}>{text[`questionType_${type}`]}</option>; })}
                </select>
                <label className="question-checkbox"><input type="checkbox" checked={question.required} onChange={function changeRequired(event) { onChange({ ...question, required: event.target.checked }); }} />{text.requiredQuestion}</label>
            </div>
            <label htmlFor={`label-${question.id}`}>{text.questionLabel} {editingLanguage === 'en' && `(${text.englishRequired})`}</label>
            <textarea id={`label-${question.id}`} rows="2" lang={editingLanguage} value={question.label[editingLanguage] || ''}
                data-field={`${field}.label.${editingLanguage}`} aria-invalid={errorField === `${field}.label.${editingLanguage}`}
                onChange={function labelChanged(event) { changeLabel(event.target.value); }} />
            <TranslationStatus label={question.label} text={text} />
            {question.type !== 'text' && <div className="question-options" data-field={`${field}.options`} tabIndex="-1">
                <h4>{text.questionOptions}</h4>
                {question.options.map(function optionEditor(option, optionIndex) {
                    const optionField = `${field}.options.${optionIndex}.label.${editingLanguage}`;
                    return <div className="question-option-editor" key={option.id}>
                        <label htmlFor={`label-${option.id}`}>{text.option} {optionIndex + 1}</label>
                        <input id={`label-${option.id}`} lang={editingLanguage} value={option.label[editingLanguage] || ''} data-field={optionField} aria-invalid={errorField === optionField}
                            onChange={function optionLabelChanged(event) { onChange({ ...question, options: question.options.map(function update(item) {
                                return item.id === option.id ? { ...item, label: { ...item.label, [editingLanguage]: event.target.value } } : item;
                            }) }); }} />
                        <TranslationStatus label={option.label} text={text} />
                        <button type="button" className="secondary-button" onClick={function removeOption() { onChange({ ...question, options: question.options.filter(function keep(item) { return item.id !== option.id; }) }); }}>{text.removeOption} {optionIndex + 1}</button>
                    </div>;
                })}
                <button type="button" className="secondary-button" onClick={onAddOption}>{text.addOption}</button>
            </div>}
            <div className="question-actions">
                <button type="button" className="secondary-button" disabled={index === 0} onClick={function up() { onMove(-1); }} aria-label={`${text.moveUp}: ${text.question} ${index + 1}`}>{text.moveUp}</button>
                <button type="button" className="secondary-button" disabled={index === total - 1} onClick={function down() { onMove(1); }} aria-label={`${text.moveDown}: ${text.question} ${index + 1}`}>{text.moveDown}</button>
                <button type="button" className="secondary-button question-remove" onClick={onRemove}>{text.removeQuestion} {index + 1}</button>
            </div>
        </section>
    );
}

function CourseFormPreview({ definition, language, text, dirty }) {
    const [answers, setAnswers] = useState({});
    return (
        <section className="course-form-preview" id="question-preview" tabIndex="-1" aria-labelledby="preview-heading">
            <h2 id="preview-heading">{text.formPreview}</h2>
            <p role="status">{dirty ? text.unsavedPreview : text.savedPreview}</p>
            <p>{text.previewExplanation}</p>
            <p>{text.previewLanguageFallback}</p>
            <section className="preview-personal"><h3>{text.fixedPersonalFields}</h3><p>{text.fixedFieldsExplanation}</p>
                <label htmlFor="preview-salutation">{text.salutation} *</label>
                <select id="preview-salutation" disabled defaultValue=""><option value="">{text.fixedField}</option><option>Mr</option><option>Ms</option><option>Miss</option></select>
                {['fullName', 'organisation', 'jobTitle', 'phone', 'email'].map(function fixedField(field) {
                    return <div key={field}><label htmlFor={`preview-personal-${field}`}>{text[field]} *</label>
                        <input id={`preview-personal-${field}`} disabled value="" placeholder={field === 'phone' ? text.eightDigitPhone : text.fixedField} />
                    </div>;
                })}
            </section>
            <section><h3>{text.courseSpecificQuestions}</h3>
                {!definition.questions.length ? <p>{text.noAdditionalQuestions}</p> : <QuestionFields questions={definition.questions} answers={answers} language={language} text={text}
                    onAnswerChange={function changeAnswer(id, value) { setAnswers(function update(previous) { return { ...previous, [id]: value }; }); }} />}
            </section>
            <button type="button" className="secondary-button" onClick={function reset() { setAnswers({}); }}>{text.resetPreview}</button>
        </section>
    );
}

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

function CourseQuestionEditor({ id, adminId, text, language, draft, onDraftChange, onSessionExpired, onNotice }) {
    const [result, setResult] = useState({ id: null, status: 'loading' });
    const [refresh, setRefresh] = useState(0);
    const [busy, setBusy] = useState(false);
    const [issue, setIssue] = useState(null);
    const savePending = useRef(false);
    const replaceOnLoad = useRef(false);
    useEffect(function loadBank() {
        let ignore = false;
        async function load() {
            try {
                const response = await fetch(`/api/admin/courses/${id}/questions`, { signal: AbortSignal.timeout(10000) });
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
        const definition = cleanDefinition(current.definition);
        const error = validateQuestionDraft(definition);
        if (error) return showIssue(error);
        savePending.current = true;
        setBusy(true);
        setIssue(null);
        try {
            const response = await fetch(`/api/admin/courses/${id}/questions`, {
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
            onNotice('questionsSaved');
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
    if (result.status === 'error') return <section><p role="alert">{text[result.message]}</p><button type="button" onClick={reload}>{text.tryAgain}</button></section>;
    const { course, editable, lock_reason: reason } = result.data;
    if (!current) return <section><p role="alert">{text.otherUnsavedQuestions}</p>
        <a href={`#admin/courses/${draft?.courseId}/questions`}>{text.returnToUnsavedQuestions}</a>
        <button type="button" onClick={function replace() { if (window.confirm(text.confirmDiscardQuestions)) onDraftChange(loadedDraft(result.data, id, adminId)); }}>{text.openThisQuestionBank}</button>
    </section>;
    return (
        <section className="course-question-workspace">
            <h2>{courseText(course.title, language)}</h2><p className="course-code">{course.code}</p>
            <p className="question-bank-state">{editable ? text.questionsEditable : text.questionsLocked} — {dirty ? text.unsavedChanges : result.data.question ? text.savedQuestionBank : text.noSavedQuestionBank}</p>
            {!editable && <p className="feedback">{text[`questionLock_${reason}`] || text.questionsLocked}{dirty && ` ${text.unsavedQuestionsRetained}`}</p>}
            {issue && <p id="question-save-error" className="feedback error" role="alert" tabIndex="-1">{text[`questionError_${issue.code}`] || text.questionError_save_failed}</p>}
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
