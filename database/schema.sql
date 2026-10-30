CREATE FUNCTION valid_text_translations(value JSONB)
RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE
AS $$
    SELECT COALESCE(
        jsonb_typeof(value) = 'object'
        AND value ? 'en'
        AND NOT EXISTS (
            SELECT 1
            FROM jsonb_each(CASE WHEN jsonb_typeof(value) = 'object' THEN value ELSE '{}'::JSONB END) AS translation
            WHERE translation.key NOT IN ('en', 'zh-Hant', 'zh-Hans')
               OR jsonb_typeof(translation.value) <> 'string'
               OR BTRIM(translation.value #>> '{}') = ''
        ),
        FALSE
    );
$$;

CREATE FUNCTION valid_offset_time(value TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
    IF value IS NULL OR value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN
        RETURN FALSE;
    END IF;
    RETURN isfinite(value::TIMESTAMPTZ);
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_parameter_value THEN
    RETURN FALSE;
END;
$$;

CREATE FUNCTION valid_sessions(value JSONB, course_mode TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    session JSONB;
    session_ids TEXT[] := '{}';
    modes TEXT[] := '{}';
    previous_end TIMESTAMPTZ;
BEGIN
    IF value IS NULL OR jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) = 0 THEN
        RETURN FALSE;
    END IF;
    FOR session IN SELECT jsonb_array_elements(value) LOOP
        IF jsonb_typeof(session) <> 'object'
           OR NOT session ?& ARRAY['id', 'starts_at', 'ends_at', 'topic', 'mode']
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(session) AS field
                      WHERE field NOT IN ('id', 'starts_at', 'ends_at', 'topic', 'mode', 'description', 'speaker'))
           OR jsonb_typeof(session->'id') <> 'string'
           OR (session->>'id') !~ '^[a-z][a-z0-9_]*$'
           OR (session->>'id') = ANY(session_ids)
           OR NOT valid_offset_time(session->>'starts_at')
           OR NOT valid_offset_time(session->>'ends_at')
           OR NOT valid_text_translations(session->'topic')
           OR (session ? 'description' AND NOT valid_text_translations(session->'description'))
           OR (session ? 'speaker' AND NOT valid_text_translations(session->'speaker'))
           OR jsonb_typeof(session->'mode') IS DISTINCT FROM 'string'
           OR (session->>'mode') NOT IN ('in_person', 'virtual') THEN
            RETURN FALSE;
        END IF;
        IF (session->>'ends_at')::TIMESTAMPTZ <= (session->>'starts_at')::TIMESTAMPTZ
           OR (previous_end IS NOT NULL AND (session->>'starts_at')::TIMESTAMPTZ < previous_end) THEN
            RETURN FALSE;
        END IF;
        previous_end := (session->>'ends_at')::TIMESTAMPTZ;
        session_ids := array_append(session_ids, session->>'id');
        modes := array_append(modes, session->>'mode');
    END LOOP;
    RETURN COALESCE(CASE course_mode
        WHEN 'in_person' THEN 'virtual' <> ALL(modes)
        WHEN 'virtual' THEN 'in_person' <> ALL(modes)
        WHEN 'hybrid' THEN 'in_person' = ANY(modes) AND 'virtual' = ANY(modes)
        ELSE FALSE
    END, FALSE);
EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN FALSE;
END;
$$;

CREATE FUNCTION valid_questions(value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    question JSONB;
    option JSONB;
    question_ids TEXT[] := '{}';
    option_ids TEXT[];
BEGIN
    IF value IS NULL OR jsonb_typeof(value) <> 'object'
       OR jsonb_typeof(value->'questions') IS DISTINCT FROM 'array'
       OR (SELECT COUNT(*) FROM jsonb_object_keys(value)) <> 1 THEN
        RETURN FALSE;
    END IF;
    FOR question IN SELECT jsonb_array_elements(value->'questions') LOOP
        IF jsonb_typeof(question) <> 'object'
           OR NOT question ?& ARRAY['id', 'label', 'type', 'required']
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(question) AS field WHERE field NOT IN ('id', 'label', 'type', 'required', 'options'))
           OR jsonb_typeof(question->'id') <> 'string'
           OR (question->>'id') !~ '^[a-z][a-z0-9_]*$'
           OR (question->>'id') = ANY(question_ids)
           OR NOT valid_text_translations(question->'label')
           OR jsonb_typeof(question->'type') IS DISTINCT FROM 'string'
           OR (question->>'type') NOT IN ('text', 'single_choice', 'multiple_choice')
           OR jsonb_typeof(question->'required') <> 'boolean' THEN
            RETURN FALSE;
        END IF;
        question_ids := array_append(question_ids, question->>'id');
        IF question->>'type' = 'text' THEN
            IF question ? 'options' THEN RETURN FALSE; END IF;
        ELSE
            IF jsonb_typeof(question->'options') IS DISTINCT FROM 'array'
               OR jsonb_array_length(question->'options') = 0 THEN
                RETURN FALSE;
            END IF;
            option_ids := '{}';
            FOR option IN SELECT jsonb_array_elements(question->'options') LOOP
                IF jsonb_typeof(option) <> 'object'
                   OR NOT option ?& ARRAY['id', 'label']
                   OR (SELECT COUNT(*) FROM jsonb_object_keys(option)) <> 2
                   OR jsonb_typeof(option->'id') <> 'string'
                   OR (option->>'id') !~ '^[a-z][a-z0-9_]*$'
                   OR (option->>'id') = ANY(option_ids)
                   OR NOT valid_text_translations(option->'label') THEN
                    RETURN FALSE;
                END IF;
                option_ids := array_append(option_ids, option->>'id');
            END LOOP;
        END IF;
    END LOOP;
    RETURN TRUE;
EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN FALSE;
END;
$$;

CREATE FUNCTION valid_certificate_template(value JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    section JSONB;
    wording TEXT;
BEGIN
    IF value IS NULL OR jsonb_typeof(value) <> 'object'
       OR NOT value ?& ARRAY['heading', 'body', 'footer']
       OR (SELECT COUNT(*) FROM jsonb_object_keys(value)) <> 3 THEN
        RETURN FALSE;
    END IF;
    FOR section IN SELECT jsonb_each.value FROM jsonb_each(value) LOOP
        IF NOT valid_text_translations(section) THEN RETURN FALSE; END IF;
        FOR wording IN SELECT jsonb_each_text.value FROM jsonb_each_text(section) LOOP
            wording := REPLACE(wording, '{{participant_name}}', '');
            wording := REPLACE(wording, '{{course_title}}', '');
            wording := REPLACE(wording, '{{course_code}}', '');
            wording := REPLACE(wording, '{{certificate_number}}', '');
            wording := REPLACE(wording, '{{issued_date}}', '');
            IF wording LIKE '%{{%' OR wording LIKE '%}}%' THEN RETURN FALSE; END IF;
        END LOOP;
    END LOOP;
    RETURN TRUE;
EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN FALSE;
END;
$$;

CREATE TABLE admin (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE CHECK (BTRIM(username) <> ''),
    password_hash TEXT NOT NULL CHECK (BTRIM(password_hash) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE course (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE CHECK (BTRIM(code) <> ''),
    title JSONB NOT NULL CHECK (valid_text_translations(title)),
    short_description JSONB NOT NULL CHECK (valid_text_translations(short_description)),
    long_description JSONB NOT NULL CHECK (valid_text_translations(long_description)),
    information JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(information) = 'object'),
    mode TEXT NOT NULL CHECK (mode IN ('in_person', 'virtual', 'hybrid')),
    sessions JSONB NOT NULL,
    fee INTEGER NOT NULL CONSTRAINT course_fee_multiple_of_ten CHECK (fee >= 0 AND MOD(fee, 10) = 0),
    registration_opens_at TIMESTAMPTZ,
    registration_closes_at TIMESTAMPTZ,
    payment_deadline TIMESTAMPTZ NOT NULL CHECK (isfinite(payment_deadline)),
    attendance_requirement_percent NUMERIC(5,2) NOT NULL CHECK (attendance_requirement_percent > 0 AND attendance_requirement_percent <= 100),
    state TEXT NOT NULL CHECK (state IN ('draft', 'published', 'archived')),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (valid_sessions(sessions, mode)),
    CHECK (registration_opens_at IS NULL OR isfinite(registration_opens_at)),
    CHECK (registration_closes_at IS NULL OR isfinite(registration_closes_at)),
    CHECK (registration_opens_at IS NULL OR registration_closes_at IS NULL OR registration_closes_at >= registration_opens_at),
    CHECK (state <> 'published' OR published_at IS NOT NULL)
);

CREATE TABLE question (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL UNIQUE REFERENCES course(id) ON DELETE RESTRICT,
    definition JSONB NOT NULL CHECK (valid_questions(definition)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE certificate (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL UNIQUE REFERENCES course(id) ON DELETE RESTRICT,
    template JSONB NOT NULL CHECK (valid_certificate_template(template)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE email (
    id SERIAL PRIMARY KEY,
    course_id INTEGER REFERENCES course(id) ON DELETE RESTRICT,
    event TEXT NOT NULL CHECK (BTRIM(event) <> ''),
    subject TEXT NOT NULL CHECK (BTRIM(subject) <> ''),
    body TEXT NOT NULL CHECK (BTRIM(body) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE NULLS NOT DISTINCT (course_id, event)
);

CREATE TABLE submission (
    id SERIAL PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE CHECK (BTRIM(reference) <> ''),
    salutation TEXT NOT NULL CHECK (salutation IN ('Mr', 'Ms', 'Miss')),
    full_name TEXT NOT NULL CHECK (BTRIM(full_name) <> ''),
    organisation TEXT NOT NULL CHECK (BTRIM(organisation) <> ''),
    job_title TEXT NOT NULL CHECK (BTRIM(job_title) <> ''),
    phone TEXT NOT NULL CHECK (phone ~ '^[0-9]{8}$'),
    email TEXT NOT NULL CHECK (BTRIM(email) = email AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
    comments TEXT,
    consent_accepted BOOLEAN NOT NULL CHECK (consent_accepted),
    total NUMERIC(10,2) NOT NULL CHECK (total >= 0 AND total <> 'NaN'::NUMERIC),
    is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
    cancelled_at TIMESTAMPTZ,
    cancelled_by INTEGER REFERENCES admin(id) ON DELETE RESTRICT,
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((NOT is_cancelled AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL)
        OR (is_cancelled AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND BTRIM(cancellation_reason) <> '' AND cancellation_reason IS NOT NULL))
);

CREATE TABLE registration (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL REFERENCES submission(id) ON DELETE RESTRICT,
    course_id INTEGER NOT NULL REFERENCES course(id) ON DELETE RESTRICT,
    fee NUMERIC(10,2) NOT NULL CHECK (fee >= 0 AND fee <> 'NaN'::NUMERIC),
    answers JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(answers) = 'object'),
    attendance JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(attendance) = 'object'),
    state TEXT NOT NULL DEFAULT 'registered' CHECK (state IN ('registered', 'cancelled')),
    cancelled_at TIMESTAMPTZ,
    cancelled_by INTEGER REFERENCES admin(id) ON DELETE RESTRICT,
    cancellation_reason TEXT,
    certificate_number TEXT UNIQUE CHECK (certificate_number IS NULL OR BTRIM(certificate_number) <> ''),
    certificate_issued_at TIMESTAMPTZ,
    certificate_data JSONB CHECK (certificate_data IS NULL OR jsonb_typeof(certificate_data) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (submission_id, course_id),
    CHECK ((state = 'registered' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL)
        OR (state = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND BTRIM(cancellation_reason) <> '' AND cancellation_reason IS NOT NULL)),
    CHECK ((certificate_number IS NULL AND certificate_issued_at IS NULL AND certificate_data IS NULL)
        OR (certificate_number IS NOT NULL AND certificate_issued_at IS NOT NULL AND certificate_data IS NOT NULL))
);

CREATE TABLE payment (
    id SERIAL PRIMARY KEY,
    submission_id INTEGER NOT NULL UNIQUE REFERENCES submission(id) ON DELETE RESTRICT,
    reference TEXT NOT NULL UNIQUE CHECK (BTRIM(reference) <> ''),
    amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0 AND amount <> 'NaN'::NUMERIC),
    due_at TIMESTAMPTZ NOT NULL CHECK (isfinite(due_at)),
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'paid', 'expired', 'cancelled')),
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((state = 'paid' AND paid_at IS NOT NULL) OR (state <> 'paid' AND paid_at IS NULL))
);

CREATE TABLE log (
    id SERIAL PRIMARY KEY,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('admin', 'participant', 'system')),
    admin_id INTEGER REFERENCES admin(id) ON DELETE RESTRICT,
    event TEXT NOT NULL CHECK (BTRIM(event) <> ''),
    course_id INTEGER REFERENCES course(id) ON DELETE RESTRICT,
    submission_id INTEGER REFERENCES submission(id) ON DELETE RESTRICT,
    registration_id INTEGER REFERENCES registration(id) ON DELETE RESTRICT,
    payment_id INTEGER REFERENCES payment(id) ON DELETE RESTRICT,
    email_id INTEGER REFERENCES email(id) ON DELETE RESTRICT,
    details JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((actor_type = 'admin' AND admin_id IS NOT NULL) OR (actor_type <> 'admin' AND admin_id IS NULL))
);

CREATE INDEX course_state_idx ON course(state);
CREATE INDEX registration_course_id_idx ON registration(course_id);
CREATE INDEX submission_email_idx ON submission(email);
CREATE INDEX log_submission_created_idx ON log(submission_id, created_at);
CREATE INDEX log_registration_created_idx ON log(registration_id, created_at);

CREATE FUNCTION protect_published_course()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    first_publication BOOLEAN;
    old_structure JSONB;
    new_structure JSONB;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.published_at IS NOT NULL THEN
            RAISE EXCEPTION 'A previously published course cannot be deleted.' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' THEN
        first_publication := NEW.state = 'published' OR NEW.published_at IS NOT NULL;
    ELSE
        first_publication := OLD.published_at IS NULL
            AND (NEW.state = 'published' OR NEW.published_at IS NOT NULL);
    END IF;
    IF first_publication AND NOT EXISTS (SELECT 1 FROM question WHERE course_id = NEW.id) THEN
        RAISE EXCEPTION 'Create the draft course question bank before publishing the course.' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL THEN
        IF NEW.sessions IS DISTINCT FROM OLD.sessions THEN
            IF NOT valid_sessions(NEW.sessions, NEW.mode) THEN
                RAISE EXCEPTION 'Session content is invalid.' USING ERRCODE = '23514';
            END IF;
            SELECT jsonb_agg((item - ARRAY['topic', 'description', 'speaker'])
                   || jsonb_build_object('has_description', item ? 'description', 'has_speaker', item ? 'speaker') ORDER BY position)
            INTO old_structure FROM jsonb_array_elements(OLD.sessions) WITH ORDINALITY AS sessions(item, position);
            SELECT jsonb_agg((item - ARRAY['topic', 'description', 'speaker'])
                   || jsonb_build_object('has_description', item ? 'description', 'has_speaker', item ? 'speaker') ORDER BY position)
            INTO new_structure FROM jsonb_array_elements(NEW.sessions) WITH ORDINALITY AS sessions(item, position);
            IF new_structure IS DISTINCT FROM old_structure
               OR EXISTS (SELECT 1 FROM registration WHERE course_id = OLD.id) THEN
                RAISE EXCEPTION 'Published session structure is fixed; wording is fixed once registrations exist.' USING ERRCODE = '23514';
            END IF;
        END IF;
        IF NEW.published_at IS DISTINCT FROM OLD.published_at
           OR NEW.mode IS DISTINCT FROM OLD.mode
           OR NEW.attendance_requirement_percent IS DISTINCT FROM OLD.attendance_requirement_percent THEN
            RAISE EXCEPTION 'Published session definitions and attendance requirements are fixed.' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF NEW.state = 'published' AND NEW.published_at IS NULL THEN
        NEW.published_at := NOW();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER course_publication_guard
BEFORE INSERT OR UPDATE OR DELETE ON course
FOR EACH ROW EXECUTE FUNCTION protect_published_course();

CREATE FUNCTION protect_published_definition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    published TIMESTAMPTZ;
    wording_only BOOLEAN := FALSE;
    old_structure JSONB;
    new_structure JSONB;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL; END IF;
    IF TG_TABLE_NAME = 'question' AND TG_OP = 'UPDATE' THEN
        IF NEW.id = OLD.id AND NEW.course_id = OLD.course_id AND NEW.created_at = OLD.created_at
           AND valid_questions(NEW.definition) THEN
            SELECT jsonb_agg(item - 'label' ORDER BY position) INTO old_structure
            FROM jsonb_array_elements(OLD.definition->'questions') WITH ORDINALITY AS questions(item, position);
            SELECT jsonb_agg(item - 'label' ORDER BY position) INTO new_structure
            FROM jsonb_array_elements(NEW.definition->'questions') WITH ORDINALITY AS questions(item, position);
            wording_only := new_structure IS NOT DISTINCT FROM old_structure;
        END IF;
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        SELECT published_at INTO published FROM course WHERE id = OLD.course_id FOR UPDATE;
        IF published IS NOT NULL AND (NOT wording_only OR EXISTS (SELECT 1 FROM registration WHERE course_id = OLD.course_id)) THEN
            RAISE EXCEPTION 'Published course questions and certificate wording are fixed.' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT published_at INTO published FROM course WHERE id = NEW.course_id FOR UPDATE;
        IF published IS NOT NULL AND (NOT wording_only OR EXISTS (SELECT 1 FROM registration WHERE course_id = NEW.course_id)) THEN
            RAISE EXCEPTION 'Published course questions and certificate wording are fixed.' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER question_publication_guard
AFTER INSERT OR UPDATE OR DELETE ON question
FOR EACH ROW EXECUTE FUNCTION protect_published_definition();

CREATE TRIGGER certificate_publication_guard
AFTER INSERT OR UPDATE OR DELETE ON certificate
FOR EACH ROW EXECUTE FUNCTION protect_published_definition();

CREATE FUNCTION validate_registration_data()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    bank JSONB;
    course_sessions JSONB;
    question JSONB;
    answer JSONB;
    answer_key TEXT;
    answer_option JSONB;
    attendance_entry RECORD;
    session JSONB;
    check_in TIMESTAMPTZ;
    check_out TIMESTAMPTZ;
    attended BOOLEAN;
BEGIN
    IF EXISTS (SELECT 1 FROM payment WHERE submission_id = NEW.submission_id AND state = 'paid') THEN
        IF TG_OP = 'INSERT' THEN
            RAISE EXCEPTION 'A paid submission cannot acquire additional registrations.' USING ERRCODE = '23514';
        ELSIF NEW.submission_id IS DISTINCT FROM OLD.submission_id THEN
            RAISE EXCEPTION 'A registration cannot be moved into a paid submission.' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF jsonb_typeof(NEW.answers) IS DISTINCT FROM 'object'
       OR jsonb_typeof(NEW.attendance) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Answers and attendance must be JSON objects.' USING ERRCODE = '23514';
    END IF;
    SELECT sessions INTO course_sessions FROM course WHERE id = NEW.course_id FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration course does not exist.' USING ERRCODE = '23503';
    END IF;
    SELECT definition INTO bank FROM question WHERE course_id = NEW.course_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration course requires a question bank.' USING ERRCODE = '23514';
    END IF;
    FOR answer_key IN SELECT jsonb_object_keys(NEW.answers) LOOP
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(bank->'questions') AS item WHERE item->>'id' = answer_key) THEN
            RAISE EXCEPTION 'Answer references an unknown course question.' USING ERRCODE = '23514';
        END IF;
    END LOOP;
    FOR question IN SELECT jsonb_array_elements(bank->'questions') LOOP
        answer := NEW.answers->(question->>'id');
        IF answer IS NULL OR answer = 'null'::JSONB THEN
            IF (question->>'required')::BOOLEAN THEN
                RAISE EXCEPTION 'A required course answer is missing.' USING ERRCODE = '23514';
            END IF;
            CONTINUE;
        END IF;
        IF question->>'type' = 'text' THEN
            IF jsonb_typeof(answer) <> 'string' OR ((question->>'required')::BOOLEAN AND BTRIM(answer #>> '{}') = '') THEN
                RAISE EXCEPTION 'Text answer is invalid.' USING ERRCODE = '23514';
            END IF;
        ELSIF question->>'type' = 'single_choice' THEN
            IF jsonb_typeof(answer) <> 'string'
               OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(question->'options') AS option WHERE option->>'id' = answer #>> '{}') THEN
                RAISE EXCEPTION 'Single-choice answer is invalid.' USING ERRCODE = '23514';
            END IF;
        ELSE
            IF jsonb_typeof(answer) <> 'array' THEN
                RAISE EXCEPTION 'Multiple-choice answer must be an array.' USING ERRCODE = '23514';
            END IF;
            IF ((question->>'required')::BOOLEAN AND jsonb_array_length(answer) = 0)
               OR jsonb_array_length(answer) <> (SELECT COUNT(DISTINCT item) FROM jsonb_array_elements(answer) AS item) THEN
                RAISE EXCEPTION 'Multiple-choice answer is empty or duplicated.' USING ERRCODE = '23514';
            END IF;
            FOR answer_option IN SELECT jsonb_array_elements(answer) LOOP
                IF jsonb_typeof(answer_option) <> 'string'
                   OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(question->'options') AS option WHERE option->>'id' = answer_option #>> '{}') THEN
                    RAISE EXCEPTION 'Multiple-choice option is invalid.' USING ERRCODE = '23514';
                END IF;
            END LOOP;
        END IF;
    END LOOP;
    FOR attendance_entry IN SELECT * FROM jsonb_each(NEW.attendance) LOOP
        SELECT item INTO session FROM jsonb_array_elements(course_sessions) AS item WHERE item->>'id' = attendance_entry.key;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Attendance references an unknown session.' USING ERRCODE = '23514';
        END IF;
        IF jsonb_typeof(attendance_entry.value) <> 'object'
           OR NOT attendance_entry.value ?& ARRAY['check_in_at', 'check_out_at', 'attended']
           OR (SELECT COUNT(*) FROM jsonb_object_keys(attendance_entry.value)) <> 3
           OR jsonb_typeof(attendance_entry.value->'attended') <> 'boolean' THEN
            RAISE EXCEPTION 'Attendance must contain check-in, check-out and attended fields.' USING ERRCODE = '23514';
        END IF;
        IF attendance_entry.value->'check_in_at' <> 'null'::JSONB AND NOT valid_offset_time(attendance_entry.value->>'check_in_at') THEN
            RAISE EXCEPTION 'Attendance check-in requires an explicit time-zone offset.' USING ERRCODE = '23514';
        END IF;
        IF attendance_entry.value->'check_out_at' <> 'null'::JSONB AND NOT valid_offset_time(attendance_entry.value->>'check_out_at') THEN
            RAISE EXCEPTION 'Attendance check-out requires an explicit time-zone offset.' USING ERRCODE = '23514';
        END IF;
        check_in := (attendance_entry.value->>'check_in_at')::TIMESTAMPTZ;
        check_out := (attendance_entry.value->>'check_out_at')::TIMESTAMPTZ;
        IF check_out IS NOT NULL AND (check_in IS NULL OR check_out < check_in) THEN
            RAISE EXCEPTION 'Attendance check-out must follow check-in.' USING ERRCODE = '23514';
        END IF;
        attended := COALESCE(check_in <= (session->>'starts_at')::TIMESTAMPTZ AND check_out >= (session->>'ends_at')::TIMESTAMPTZ, FALSE);
        IF (attendance_entry.value->>'attended')::BOOLEAN IS DISTINCT FROM attended THEN
            RAISE EXCEPTION 'Attendance result does not match the recorded times.' USING ERRCODE = '23514';
        END IF;
    END LOOP;
    IF TG_OP = 'UPDATE' THEN
        IF EXISTS (SELECT 1 FROM payment WHERE submission_id = OLD.submission_id AND state = 'paid')
           AND (NEW.fee IS DISTINCT FROM OLD.fee OR NEW.submission_id IS DISTINCT FROM OLD.submission_id OR NEW.course_id IS DISTINCT FROM OLD.course_id) THEN
            RAISE EXCEPTION 'Paid registration charges and relationships cannot be rewritten.' USING ERRCODE = '23514';
        END IF;
        IF OLD.certificate_number IS NOT NULL
           AND (NEW.certificate_number IS DISTINCT FROM OLD.certificate_number OR NEW.certificate_issued_at IS DISTINCT FROM OLD.certificate_issued_at OR NEW.certificate_data IS DISTINCT FROM OLD.certificate_data
                OR NEW.course_id IS DISTINCT FROM OLD.course_id OR NEW.submission_id IS DISTINCT FROM OLD.submission_id) THEN
            RAISE EXCEPTION 'Issued certificate information cannot be rewritten.' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER registration_data_guard
BEFORE INSERT OR UPDATE ON registration
FOR EACH ROW EXECUTE FUNCTION validate_registration_data();

CREATE FUNCTION protect_registration_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.certificate_number IS NOT NULL
       OR EXISTS (SELECT 1 FROM payment WHERE submission_id = OLD.submission_id AND state = 'paid') THEN
        RAISE EXCEPTION 'Paid or certified registrations must be cancelled rather than deleted.' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER registration_history_guard
BEFORE DELETE ON registration
FOR EACH ROW EXECUTE FUNCTION protect_registration_history();

CREATE FUNCTION protect_paid_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.state = 'paid' THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Paid payment history cannot be deleted.' USING ERRCODE = '23514';
        END IF;
        IF NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION 'Paid payment history cannot be rewritten; cancellation does not imply a refund.' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER payment_history_guard
BEFORE UPDATE OR DELETE ON payment
FOR EACH ROW EXECUTE FUNCTION protect_paid_payment();

CREATE FUNCTION protect_paid_submission_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.total IS DISTINCT FROM OLD.total
       AND EXISTS (SELECT 1 FROM payment WHERE submission_id = OLD.id AND state = 'paid') THEN
        RAISE EXCEPTION 'A paid submission total cannot be rewritten.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER submission_paid_total_guard
BEFORE UPDATE ON submission
FOR EACH ROW EXECUTE FUNCTION protect_paid_submission_total();
