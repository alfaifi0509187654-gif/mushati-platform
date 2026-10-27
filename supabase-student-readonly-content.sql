-- محتوى الطالب العام: قراءة فقط، بدون كشف بيانات الطلاب أو مفاتيح الإجابات
CREATE OR REPLACE FUNCTION public.mx_s_public_content(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_student_id text;
  v_class_key text;
BEGIN
  SELECT s.owner, s.student_id, s.class_key
    INTO v_owner, v_student_id, v_class_key
  FROM public.mx_sessions x
  JOIN public.mx_students s
    ON s.owner = x.owner AND s.student_id = x.student_id
  WHERE x.token = p_token
    AND x.expires_at > now()
    AND s.active = true
  LIMIT 1;

  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('error','session');
  END IF;

  RETURN jsonb_build_object(
    'student', jsonb_build_object('student_id',v_student_id,'class_key',v_class_key),
    'curriculum', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'lesson_key', l.lesson_key,
        'title', l.title,
        'content', l.content,
        'source_pages', l.source_pages
      ) ORDER BY l.lesson_key)
      FROM public.mx_reference_lessons l
      JOIN public.mx_references r ON r.id = l.reference_id
      WHERE r.owner_id = v_owner AND l.status = 'approved'
    ), '[]'::jsonb),
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', q.id,
        'lesson_id', q.lesson_id,
        'question_text', q.question_text,
        'options', q.options,
        'explanation', q.explanation,
        'source_pages', q.source_pages
      ) ORDER BY q.created_at)
      FROM public.mx_reference_questions q
      JOIN public.mx_references r ON r.id = q.reference_id
      WHERE r.owner_id = v_owner AND q.status = 'approved'
    ), '[]'::jsonb),
    'exams', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id,
        'class_key', e.class_key,
        'title', e.title,
        'starts_at', e.starts_at,
        'ends_at', e.ends_at,
        'duration_min', e.duration_min,
        'active', e.active
      ) ORDER BY e.starts_at NULLS LAST, e.created_at DESC)
      FROM public.mx_exams e
      WHERE e.owner = v_owner AND e.active = true
    ), '[]'::jsonb),
    'assignments', '[]'::jsonb,
    'read_only', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mx_s_public_content(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mx_s_public_content(uuid) TO anon, authenticated;
