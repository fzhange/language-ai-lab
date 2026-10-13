CREATE TABLE public.whw_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  content_text text NOT NULL CHECK (content_text ~ '[^[:space:]]'),
  content_doc jsonb NOT NULL CHECK (jsonb_typeof(content_doc) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX whw_collections_owner_created_idx
  ON public.whw_collections (user_id, created_at DESC, id DESC);

CREATE FUNCTION public.whw_collections_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER whw_collections_updated_at
BEFORE UPDATE ON public.whw_collections
FOR EACH ROW EXECUTE FUNCTION public.whw_collections_touch_updated_at();

ALTER TABLE public.whw_collections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whw_collections FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whw_collections TO authenticated;

CREATE POLICY whw_collections_select_own ON public.whw_collections
FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY whw_collections_insert_own ON public.whw_collections
FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY whw_collections_update_own ON public.whw_collections
FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY whw_collections_delete_own ON public.whw_collections
FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
