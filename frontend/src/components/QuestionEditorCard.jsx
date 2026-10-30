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

export default QuestionEditorCard;
