CREATE TABLE public.whw_collection_weeks (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  week_key text NOT NULL CHECK (week_key ~ '^[0-9]{4}M(1[0-2]|[1-9])W[1-6]$'),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_key)
);

CREATE TRIGGER whw_collection_weeks_updated_at
BEFORE UPDATE ON public.whw_collection_weeks
FOR EACH ROW EXECUTE FUNCTION public.whw_collections_touch_updated_at();

ALTER TABLE public.whw_collection_weeks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whw_collection_weeks FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whw_collection_weeks TO authenticated;

CREATE POLICY whw_collection_weeks_select_own ON public.whw_collection_weeks
FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY whw_collection_weeks_insert_own ON public.whw_collection_weeks
FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY whw_collection_weeks_update_own ON public.whw_collection_weeks
FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY whw_collection_weeks_delete_own ON public.whw_collection_weeks
FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

ALTER TABLE public.whw_collections ADD COLUMN week_key text;

WITH categorized AS (
  SELECT
    id,
    user_id,
    format(
      '%sM%sW%s',
      extract(year FROM local_date)::integer,
      extract(month FROM local_date)::integer,
      floor(
        (
          extract(day FROM local_date)::integer - 1
          + extract(isodow FROM date_trunc('month', local_date))::integer - 1
        ) / 7.0
      )::integer + 1
    ) AS week_key
  FROM (
    SELECT id, user_id, (created_at AT TIME ZONE 'Asia/Shanghai')::date AS local_date
    FROM public.whw_collections
  ) source
), inserted_weeks AS (
  INSERT INTO public.whw_collection_weeks (user_id, week_key)
  SELECT DISTINCT user_id, week_key FROM categorized
  ON CONFLICT (user_id, week_key) DO NOTHING
)
UPDATE public.whw_collections collection
SET week_key = categorized.week_key
FROM categorized
WHERE collection.id = categorized.id;

ALTER TABLE public.whw_collections
  ADD CONSTRAINT whw_collections_owner_week_fk
  FOREIGN KEY (user_id, week_key)
  REFERENCES public.whw_collection_weeks (user_id, week_key)
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX whw_collections_owner_week_created_idx
  ON public.whw_collections (user_id, week_key, created_at DESC, id DESC);
