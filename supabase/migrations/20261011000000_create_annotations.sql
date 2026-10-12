CREATE TABLE IF NOT EXISTS public.annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid REFERENCES public.files(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners can manage their annotations"
ON public.annotations FOR ALL TO authenticated
USING ((select auth.uid()) = owner_id)
WITH CHECK ((select auth.uid()) = owner_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.annotations TO authenticated;
