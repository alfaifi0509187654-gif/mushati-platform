-- منصة المشاطي — المرحلة الأولى للحضور عن بُعد
-- جلسة يدوية تبدأ فورًا، مدتها 40 دقيقة، وهامش التأخير/الخروج المبكر 5 دقائق.

CREATE TABLE IF NOT EXISTS public.mx_remote_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  class_key text NOT NULL,
  title text NOT NULL DEFAULT 'تحضير عن بُعد',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  grace_min integer NOT NULL DEFAULT 5 CHECK (grace_min BETWEEN 0 AND 30),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public.mx_remote_attendance (
  session_id uuid NOT NULL REFERENCES public.mx_remote_sessions(id) ON DELETE CASCADE,
  owner uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id text NOT NULL,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  logout_at timestamptz,
  status text NOT NULL DEFAULT 'present'
    CHECK (status IN ('present','late','early_leave','late_early')),
  PRIMARY KEY (session_id, student_id)
);

ALTER TABLE public.mx_remote_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mx_remote_attendance ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.mx_t_remote_session_create(
  p_class_key text, p_title text, p_starts_at timestamptz, p_ends_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error','auth'); END IF;
  IF p_class_key IS NULL OR p_class_key = '' OR p_ends_at <= p_starts_at THEN
    RETURN jsonb_build_object('error','invalid_time');
  END IF;
  INSERT INTO public.mx_remote_sessions
    (owner,class_key,title,starts_at,ends_at,grace_min)
  VALUES
    (auth.uid(),p_class_key,COALESCE(NULLIF(p_title,''),'تحضير عن بُعد'),p_starts_at,p_ends_at,5)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id',v_id,'class_key',p_class_key,
    'starts_at',p_starts_at,'ends_at',p_ends_at,'grace_min',5,'active',true);
END; $$;

CREATE OR REPLACE FUNCTION public.mx_s_remote_sessions(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; v_class text;
BEGIN
  SELECT s.owner,s.class_key INTO v_owner,v_class
  FROM public.mx_sessions x
  JOIN public.mx_students s ON s.owner=x.owner AND s.student_id=x.student_id
  WHERE x.token=p_token AND x.expires_at>now() AND s.active=true LIMIT 1;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('error','session'); END IF;
  RETURN jsonb_build_object('items',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,
      'class_key',r.class_key,'starts_at',r.starts_at,'ends_at',r.ends_at,
      'active',r.active) ORDER BY r.starts_at DESC)
    FROM public.mx_remote_sessions r
    WHERE r.owner=v_owner AND r.class_key=v_class AND r.active=true
      AND r.ends_at >= now()-interval '1 day'
      AND r.starts_at <= now()+interval '1 day'
  ),'[]'::jsonb));
END; $$;

CREATE OR REPLACE FUNCTION public.mx_s_remote_heartbeat(
  p_token uuid, p_session_id uuid, p_event text DEFAULT 'heartbeat'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; v_student text; v_class text;
  v_start timestamptz; v_end timestamptz; v_now timestamptz:=now(); v_seen timestamptz;
BEGIN
  SELECT s.owner,s.student_id,s.class_key INTO v_owner,v_student,v_class
  FROM public.mx_sessions x
  JOIN public.mx_students s ON s.owner=x.owner AND s.student_id=x.student_id
  WHERE x.token=p_token AND x.expires_at>now() AND s.active=true LIMIT 1;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('error','session'); END IF;
  SELECT starts_at,ends_at INTO v_start,v_end
  FROM public.mx_remote_sessions
  WHERE id=p_session_id AND owner=v_owner AND class_key=v_class AND active=true LIMIT 1;
  IF v_start IS NULL THEN RETURN jsonb_build_object('error','remote_session'); END IF;
  v_seen:=LEAST(v_now,v_end);
  INSERT INTO public.mx_remote_attendance
    (session_id,owner,student_id,first_seen_at,last_seen_at,logout_at,status)
  VALUES
    (p_session_id,v_owner,v_student,v_seen,v_seen,
     CASE WHEN p_event='logout' THEN v_seen ELSE NULL END,
     CASE WHEN v_seen>v_start+interval '5 minutes' THEN 'late' ELSE 'present' END)
  ON CONFLICT(session_id,student_id) DO UPDATE SET
    last_seen_at=CASE WHEN p_event='logout'
      THEN public.mx_remote_attendance.last_seen_at
      ELSE GREATEST(public.mx_remote_attendance.last_seen_at,EXCLUDED.last_seen_at) END,
    logout_at=CASE WHEN p_event='logout' THEN EXCLUDED.logout_at
      ELSE public.mx_remote_attendance.logout_at END,
    status=CASE WHEN public.mx_remote_attendance.first_seen_at>v_start+interval '5 minutes'
      THEN 'late' ELSE 'present' END;
  RETURN jsonb_build_object('ok',true,'server_at',v_now,
    'session_id',p_session_id,'student_id',v_student);
END; $$;

CREATE OR REPLACE FUNCTION public.mx_t_remote_report(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; v_class text; v_start timestamptz; v_end timestamptz; v_grace integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error','auth'); END IF;
  SELECT owner,class_key,starts_at,ends_at,grace_min
    INTO v_owner,v_class,v_start,v_end,v_grace
  FROM public.mx_remote_sessions
  WHERE id=p_session_id AND owner=auth.uid() LIMIT 1;
  IF v_owner IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
  RETURN jsonb_build_object(
    'session',jsonb_build_object('id',p_session_id,'class_key',v_class,
      'starts_at',v_start,'ends_at',v_end,'grace_min',v_grace),
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'student_id',s.student_id,'name',s.name,'username',s.username,
      'first_seen_at',a.first_seen_at,'last_seen_at',a.last_seen_at,
      'logout_at',a.logout_at,
      'status',CASE
        WHEN a.first_seen_at IS NULL THEN 'absent'
        WHEN a.first_seen_at>v_start+make_interval(mins=>v_grace)
          AND COALESCE(a.logout_at,a.last_seen_at)<v_end-make_interval(mins=>v_grace)
          THEN 'late_early'
        WHEN a.first_seen_at>v_start+make_interval(mins=>v_grace) THEN 'late'
        WHEN COALESCE(a.logout_at,a.last_seen_at)<v_end-make_interval(mins=>v_grace)
          THEN 'early_leave'
        ELSE 'present' END
    ) ORDER BY s.name)
    FROM public.mx_students s
    LEFT JOIN public.mx_remote_attendance a
      ON a.owner=s.owner AND a.session_id=p_session_id AND a.student_id=s.student_id
    WHERE s.owner=v_owner AND s.class_key=v_class AND s.active=true),'[]'::jsonb)
  );
END; $$;

REVOKE ALL ON FUNCTION public.mx_t_remote_session_create(text,text,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mx_s_remote_sessions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mx_s_remote_heartbeat(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mx_t_remote_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mx_t_remote_session_create(text,text,timestamptz,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mx_s_remote_sessions(uuid) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mx_s_remote_heartbeat(uuid,uuid,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mx_t_remote_report(uuid) TO authenticated;
