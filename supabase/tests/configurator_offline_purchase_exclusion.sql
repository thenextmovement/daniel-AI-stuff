-- Read-only contract. The production predicate excludes the entire order,
-- regardless of how many signs/delivery lines it contains or prior lead matches.
with fixtures(name, line_items, expected_offline_eligible) as (
  values
    ('legacy null', null::jsonb, true),
    ('legacy empty', '[]'::jsonb, true),
    ('ordinary offer', '[{"properties":[{"name":"offer_id","value":"offer"}]}]'::jsonb, true),
    ('unrelated property', '[{"properties":[{"name":"Text","value":"_Entwurf"}]}]'::jsonb, true),
    ('one configurator sign', '[{"properties":[{"name":"_Entwurf","value":"checkout"}]}]'::jsonb, false),
    ('delivery plus multiple signs', '[{"properties":[]},{"properties":[{"name":"_Entwurf","value":"checkout"}]},{"properties":[{"name":"_Entwurf","value":"checkout"}]}]'::jsonb, false),
    ('incomplete configurator marker', '[{"properties":[{"name":"_Entwurf","value":""}]}]'::jsonb, false)
), evaluated as (
  select *, not coalesce(
    line_items @> '[{"properties":[{"name":"_Entwurf"}]}]'::jsonb,
    false
  ) as actual_offline_eligible
  from fixtures
)
select count(*) as checks,
       count(*) filter (where actual_offline_eligible = expected_offline_eligible) as passed,
       coalesce(jsonb_agg(name) filter (where actual_offline_eligible <> expected_offline_eligible), '[]'::jsonb) as failures
from evaluated;
