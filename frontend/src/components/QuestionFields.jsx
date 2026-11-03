import { courseText } from '../course-utils';

function QuestionFields({ questions, answers, onAnswerChange, language, text, namespace = 'preview', maxLength }) {
    return questions.map(function questionField(question, index) {
        const label = courseText(question.label, language) || `${text.question} ${index + 1} (${text.labelNotEntered})`;
        const required = question.required ? ` * (${text.requiredLabel})` : '';
        const value = Object.hasOwn(answers, question.id) ? answers[question.id] : undefined;
        if (question.type === 'text') return <div className="preview-question application-field" key={question.id}>
            <label htmlFor={`${namespace}-${question.id}`}>{label}{required}</label>
            <input id={`${namespace}-${question.id}`} type="text" value={typeof value === 'string' ? value : ''} maxLength={maxLength} aria-required={question.required}
                onChange={function answerChanged(event) { onAnswerChange(question.id, event.target.value); }} />
        </div>;
        return <fieldset className="preview-question" key={question.id}>
            <legend>{label}{required}</legend>
            {!question.options.length && <p>{text.previewNoOptions}</p>}
            {question.options.map(function choice(option, optionIndex) {
                const multiple = question.type === 'multiple_choice';
                const checked = multiple ? Array.isArray(value) && value.includes(option.id) : value === option.id;
                return <label className="question-checkbox" key={option.id}>
                    <input type={multiple ? 'checkbox' : 'radio'} name={`${namespace}-${question.id}`} value={option.id} checked={checked}
                        onChange={function answerChanged(event) {
                            onAnswerChange(question.id, multiple ? event.target.checked ? [...(Array.isArray(value) ? value : []), option.id]
                                : value.filter(function keep(id) { return id !== option.id; }) : option.id);
                        }} />
                    <span>{courseText(option.label, language) || `${text.option} ${optionIndex + 1} (${text.labelNotEntered})`}</span>
                </label>;
            })}
        </fieldset>;
    });
}

export default QuestionFields;
