import { useState } from 'react';
import QuestionFields from './QuestionFields';

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

export default CourseFormPreview;
