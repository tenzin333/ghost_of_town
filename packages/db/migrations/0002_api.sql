-- Read API for the browser, called through PostgREST (/rest/v1/rpc/<name> on Supabase).
-- All functions are SECURITY INVOKER: they run as the caller (anon), so RLS still hides unpublished rows.
-- JSON shapes match @wwh/schema (MapIndex, Place); packages/db/test checks them against data/places.json.

-- Stack order used everywhere: newest first; "until X" layers just below X; undated layers at the bottom.
CREATE FUNCTION public.layer_sort_key(year_start integer, year_end integer) RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN coalesce(year_start::numeric, year_end - 0.5);
--> statement-breakpoint

-- Everything the map needs to render instantly: every place with its layer years and wow scores.
CREATE FUNCTION public.map_index() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'lat', st_y(p.location::geometry),
    'lng', st_x(p.location::geometry),
    'geoPrecision', p.geo_precision,
    'layers', ls.layers
  ) ORDER BY p.id), '[]'::jsonb)
  FROM places p
  CROSS JOIN LATERAL (
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('yearStart', l.year_start, 'yearEnd', l.year_end, 'wow', l.wow))
                     ORDER BY layer_sort_key(l.year_start, l.year_end) DESC NULLS LAST, length(l.id), l.id) AS layers
    FROM layers l WHERE l.place_id = p.id
  ) ls
  WHERE ls.layers IS NOT NULL;
$$;
--> statement-breakpoint

-- One place with its full layer stack, sources and media. NULL if missing or unpublished.
CREATE FUNCTION public.place_detail(place_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions
AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'lat', st_y(p.location::geometry),
    'lng', st_x(p.location::geometry),
    'geoPrecision', p.geo_precision,
    'layers', ls.layers
  )
  FROM places p
  CROSS JOIN LATERAL (
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', l.id,
      'yearStart', l.year_start,
      'yearEnd', l.year_end,
      'datePrecision', l.date_precision,
      'type', l.type,
      'title', l.title,
      'hook', l.hook,
      'story', l.story,
      'media', (SELECT jsonb_build_object('src', m.src, 'width', m.width, 'height', m.height, 'credit', m.credit,
                                          'licence', m.licence, 'licenceUrl', m.licence_url, 'sourceUrl', m.source_url)
                FROM media m WHERE m.layer_id = l.id),
      'sources', (SELECT coalesce(jsonb_agg(jsonb_build_object('label', s.label, 'url', s.url) ORDER BY x.position), '[]'::jsonb)
                  FROM layer_sources x JOIN sources s ON s.id = x.source_id WHERE x.layer_id = l.id),
      'confidence', l.confidence,
      'wow', l.wow
    )) ORDER BY layer_sort_key(l.year_start, l.year_end) DESC NULLS LAST, length(l.id), l.id) AS layers
    FROM layers l WHERE l.place_id = p.id
  ) ls
  WHERE p.id = place_detail.place_id AND ls.layers IS NOT NULL;
$$;
--> statement-breakpoint

-- Places within radius_m of a point, nearest first. With era_from/era_to, only places with a layer overlapping
-- that span (same rule as layerInEra in apps/web/lib/data.ts).
CREATE FUNCTION public.places_near(
  lat double precision,
  lng double precision,
  radius_m double precision DEFAULT 1000,
  era_from integer DEFAULT NULL,
  era_to integer DEFAULT NULL,
  max_results integer DEFAULT 20
) RETURNS TABLE (id text, name text, metres double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, extensions
AS $$
  SELECT p.id, p.name, st_distance(p.location, here.g) AS metres
  FROM places p,
       LATERAL (SELECT st_setsrid(st_makepoint(places_near.lng, places_near.lat), 4326)::geography AS g) here
  WHERE st_dwithin(p.location, here.g, least(radius_m, 50000))
    AND EXISTS (
      SELECT 1 FROM layers l
      WHERE l.place_id = p.id
        AND (era_from IS NULL OR (
          coalesce(l.year_start, l.year_end) <= era_to AND coalesce(l.year_end, l.year_start) >= era_from
        ))
    )
  ORDER BY metres
  LIMIT least(max_results, 100);
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO anon, authenticated;--> statement-breakpoint
GRANT SELECT ON public.places, public.layers, public.sources, public.layer_sources, public.media TO anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.map_index(), public.place_detail(text),
  public.places_near(double precision, double precision, double precision, integer, integer, integer),
  public.layer_sort_key(integer, integer) TO anon, authenticated;--> statement-breakpoint
-- Let PostgREST pick up the new functions without a restart.
NOTIFY pgrst, 'reload schema';
