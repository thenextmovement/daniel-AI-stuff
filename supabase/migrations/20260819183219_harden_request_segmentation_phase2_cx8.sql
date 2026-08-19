-- NEONTRIP request segmentation Phase 2.
--
-- This migration introduces a versioned eight-class customer-experience (CX8)
-- taxonomy in shadow mode. The existing 18 rows in segment_definitions, their
-- policy rules, classifications, gold labels, and master-request values are not
-- rewritten or reinterpreted. Reused NT codes acquire CX8 meaning only when the
-- exact taxonomy version is present on the job, classification, gold case, and
-- authoritative master state.
--
-- PII-free pre-change/rollback snapshot:
-- supabase/security-backups/request-segmentation-phase2-prechange-20260819.sql

begin;

do $phase2_preconditions$
declare
  v_active_policy text;
  v_definition_count integer;
begin
  select version into v_active_policy
  from public.segment_policy_versions
  where active
  order by created_at desc
  limit 1;

  if v_active_policy is distinct from 'nt_policy_v1_20260520_shadow' then
    raise exception using
      errcode = '55000',
      message = 'phase2_unexpected_active_segment_policy',
      detail = format('expected=nt_policy_v1_20260520_shadow actual=%s', coalesce(v_active_policy, '<none>'));
  end if;

  select count(*) into v_definition_count
  from public.segment_definitions
  where segment ~ '^NT-(1[0-8]|[1-9])$';

  if v_definition_count <> 18 then
    raise exception using
      errcode = '55000',
      message = 'phase2_legacy_taxonomy_precondition_failed',
      detail = format('expected_legacy_definitions=18 actual=%s', v_definition_count);
  end if;
end;
$phase2_preconditions$;

create table public.segment_taxonomy_versions (
  version text primary key,
  lifecycle_status text not null,
  decision_unit text not null,
  default_outcome text not null default 'needs_review',
  source_version text null references public.segment_taxonomy_versions(version),
  historical_semantics jsonb not null default '{}'::jsonb,
  created_by text not null,
  notes text null,
  created_at timestamptz not null default now(),
  constraint segment_taxonomy_versions_lifecycle_status_check
    check (lifecycle_status in ('legacy', 'shadow', 'approved', 'retired')),
  constraint segment_taxonomy_versions_decision_unit_check
    check (decision_unit = 'requesting_or_contracting_entity'),
  constraint segment_taxonomy_versions_default_outcome_check
    check (default_outcome = 'needs_review')
);

comment on table public.segment_taxonomy_versions is
  'Immutable semantic versions for NEONTRIP request segmentation. A reused NT code has meaning only together with this version.';

create table public.segment_taxonomy_definitions (
  taxonomy_version text not null references public.segment_taxonomy_versions(version) on delete restrict,
  segment text not null,
  label text not null,
  default_s_kategorie text not null,
  description text not null,
  inclusion_criteria text[] not null default '{}',
  required_evidence text[] not null default '{}',
  required_evidence_code text null,
  exclusion_criteria text[] not null default '{}',
  tie_breaker text not null,
  priority integer not null,
  review_threshold numeric not null,
  legacy_source_segments text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (taxonomy_version, segment),
  constraint segment_taxonomy_definitions_segment_check
    check (segment ~ '^NT-(1[0-8]|[1-9])$'),
  constraint segment_taxonomy_definitions_s_kategorie_check
    check (default_s_kategorie in ('S1', 'S2', 'S3', 'S4')),
  constraint segment_taxonomy_definitions_priority_check
    check (priority between 0 and 1000),
  constraint segment_taxonomy_definitions_review_threshold_check
    check (review_threshold between 0 and 1),
  constraint segment_taxonomy_definitions_required_evidence_code_check
    check (required_evidence_code is null or required_evidence_code ~ '^[a-z][a-z0-9_]*$')
);

comment on table public.segment_taxonomy_definitions is
  'Version-scoped primary CX class semantics. Exclusions and deterministic priority resolve only multiple positively evidenced candidates; they never create a fallback.';

create index segment_taxonomy_definitions_active_idx
  on public.segment_taxonomy_definitions (taxonomy_version, priority desc, segment)
  where active;

create unique index segment_taxonomy_definitions_evidence_code_uidx
  on public.segment_taxonomy_definitions (taxonomy_version, required_evidence_code)
  where required_evidence_code is not null;

create table public.segment_context_definitions (
  taxonomy_version text not null references public.segment_taxonomy_versions(version) on delete restrict,
  context_tag text not null,
  label text not null,
  description text not null,
  legacy_source_segments text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (taxonomy_version, context_tag),
  constraint segment_context_definitions_tag_check
    check (context_tag ~ '^[a-z][a-z0-9_]*$')
);

comment on table public.segment_context_definitions is
  'Optional non-authoritative vertical overlays. Context tags never replace the single primary CX8 segment.';

create table public.segment_quality_gate_versions (
  version text primary key,
  taxonomy_version text not null references public.segment_taxonomy_versions(version) on delete restrict,
  classifier_version text not null,
  prompt_version text not null,
  active boolean not null default false,
  min_unique_gold_total integer not null,
  min_gold_per_segment integer not null,
  min_precision_per_predicted_class numeric not null,
  min_recall_per_actual_class numeric not null,
  min_accepted_coverage numeric not null,
  critical_segments text[] not null default '{}',
  min_critical_precision numeric not null,
  required_mapping_integrity numeric not null,
  max_provenance_violations integer not null default 0,
  manual_activation_required boolean not null default true,
  created_by text not null,
  notes text null,
  created_at timestamptz not null default now(),
  constraint segment_quality_gate_versions_gold_total_check
    check (min_unique_gold_total > 0),
  constraint segment_quality_gate_versions_gold_per_segment_check
    check (min_gold_per_segment > 0),
  constraint segment_quality_gate_versions_precision_check
    check (min_precision_per_predicted_class between 0 and 1),
  constraint segment_quality_gate_versions_recall_check
    check (min_recall_per_actual_class between 0 and 1),
  constraint segment_quality_gate_versions_coverage_check
    check (min_accepted_coverage between 0 and 1),
  constraint segment_quality_gate_versions_critical_precision_check
    check (min_critical_precision between 0 and 1),
  constraint segment_quality_gate_versions_mapping_integrity_check
    check (required_mapping_integrity between 0 and 1),
  constraint segment_quality_gate_versions_provenance_check
    check (max_provenance_violations >= 0)
);

create unique index segment_quality_gate_versions_one_active_idx
  on public.segment_quality_gate_versions (active)
  where active;

comment on table public.segment_quality_gate_versions is
  'Versioned operational acceptance thresholds, deliberately separate from taxonomy semantics. Passing this gate never substitutes for explicit manual activation.';

insert into public.segment_taxonomy_versions (
  version, lifecycle_status, decision_unit, default_outcome, source_version,
  historical_semantics, created_by, notes
) values (
  'nt_taxonomy_v1_20260520_legacy18',
  'legacy',
  'requesting_or_contracting_entity',
  'needs_review',
  null,
  jsonb_build_object(
    'warning', 'Historical NT-8/NT-9 include deterministic fallback assignments and are not CX8 gold.',
    'nt8_fallback_reason', 'personal_no_company',
    'nt9_fallback_reason', 'business_fallback'
  ),
  'codex-phase2',
  'Read-only semantic wrapper around the existing 18 live definitions; existing rows remain untouched.'
), (
  'nt_taxonomy_v2_20260819_cx8',
  'shadow',
  'requesting_or_contracting_entity',
  'needs_review',
  'nt_taxonomy_v1_20260520_legacy18',
  jsonb_build_object(
    'single_primary_segment', true,
    'fallback_segment', null,
    'freemail_is_segment_evidence', false,
    'priority_applies_only_after_positive_evidence', true,
    'ambiguous_or_conflicting_outcome', 'needs_review'
  ),
  'codex-phase2',
  'CX8 shadow taxonomy; no automatic commercial or communication action.'
);

-- Copying the legacy definitions creates versioned display metadata only. It
-- does not update the source table or attach v1 meaning to any historical row.
insert into public.segment_taxonomy_definitions (
  taxonomy_version, segment, label, default_s_kategorie, description,
  inclusion_criteria, required_evidence, exclusion_criteria, tie_breaker,
  priority, review_threshold, legacy_source_segments, active
)
select
  'nt_taxonomy_v1_20260520_legacy18',
  sd.segment,
  sd.label,
  sd.default_s_kategorie,
  sd.description,
  sd.positive_signals,
  '{}'::text[],
  sd.negative_signals,
  'Legacy definition only; never use to classify under CX8.',
  0,
  sd.review_threshold,
  array[sd.segment],
  sd.active
from public.segment_definitions sd;

insert into public.segment_taxonomy_definitions (
  taxonomy_version, segment, label, default_s_kategorie, description,
  inclusion_criteria, required_evidence, exclusion_criteria, tie_breaker,
  priority, review_threshold, legacy_source_segments
) values
  (
    'nt_taxonomy_v2_20260819_cx8', 'NT-10', 'Institution/öffentliche Hand', 'S4',
    'Behörde, öffentliche oder gemeinnützige Institution mit formalem organisatorischem Beschaffungsweg.',
    array['Anfragende oder vertragsschließende Einheit ist eine Behörde, Kommune, Schule, Hochschule, öffentliche Einrichtung oder institutioneller Verein/Träger.'],
    array['Expliziter Einrichtungsname oder verifizierbare offizielle Organisationsidentität.', 'Belastbarer Hinweis auf institutionellen bzw. formalen Beschaffungsweg.'],
    array['Rein private Anfrage anlässlich einer Feier oder eines Geschenks.', 'Ein Agent, Planer oder Produktionspartner kauft im eigenen Namen für die Institution.'],
    'Institution/Public gewinnt bei positivem Beleg vor Größe oder Branche; handelt ein Vermittler im eigenen Namen, gilt dessen Rolle.',
    100, 0.85, array['NT-10']
  ),
  (
    'nt_taxonomy_v2_20260819_cx8', 'NT-1', 'Laden-/Messebau-Produktionspartner', 'S2',
    'Professioneller Ausführungs- oder Produktionspartner für Ladenbau, Messebau, Beschilderung oder räumliche Markeninszenierung.',
    array['Die anfragende Firma produziert oder montiert physische Kundenprojekte wiederkehrend.', 'Beschaffung erfolgt als Bestandteil einer professionellen Laden-, Messe- oder Ausbauleistung.'],
    array['Verifizierbare Leistungsbeschreibung als ausführender Laden-/Messebauer oder Produktionsbetrieb.', 'Hinweis, dass für ein Kundenprojekt und nicht nur für den eigenen Stand oder Laden gekauft wird.'],
    array['Endkunde bestellt lediglich für den eigenen Messestand oder das eigene Ladenlokal.', 'Reine Konzept-, Agentur- oder Vermittlungsleistung ohne Ausführungsrolle.'],
    'Gegen NT-4 gewinnt NT-1 nur bei positiv belegter physischer Ausführungs-/Produktionsrolle; gegen NT-3 gewinnt NT-1 bei dauerhafter Ladenbau- oder Standbaukompetenz.',
    90, 0.82, array['NT-1']
  ),
  (
    'nt_taxonomy_v2_20260819_cx8', 'NT-4', 'Agentur/Planer/Wiederverkäufer', 'S2',
    'Intermediär, der für Kunden konzipiert, plant, einkauft, vermittelt oder weiterverkauft.',
    array['Anfragende Einheit kauft erkennbar für ein Kundenmandat oder zum Weiterverkauf.', 'Agentur-, Architektur-, Planungs- oder Händlerrolle ist positiv belegt.'],
    array['Verifizierbare Intermediärrolle.', 'Konkreter Kundenprojekt- oder Wiederverkaufshinweis.'],
    array['Bestellung ausschließlich für den eigenen Betrieb.', 'Physische Laden-/Messebau-Ausführung ist die belegte Kernrolle.'],
    'Gegen NT-1 gewinnt NT-4 bei Beratung/Planung/Vermittlung ohne belegte physische Ausführung; Kundensektor bleibt nur Kontexttag.',
    80, 0.82, array['NT-4', 'NT-11']
  ),
  (
    'nt_taxonomy_v2_20260819_cx8', 'NT-3', 'Event-/Medienproduktion', 'S1',
    'Professionelle Event-, Messe-, Film-, TV-, Streaming- oder Medienproduktion mit projekt- und termingebundenem Einsatz.',
    array['Anfragende Einheit verantwortet professionell eine zeitgebundene Veranstaltung oder Medienproduktion.', 'Produkt wird für Produktion, Set, Bühne, Festival, Kongress oder Event eingesetzt.'],
    array['Verifizierbare professionelle Produktionsrolle.', 'Konkreter zeit- oder projektgebundener Event-/Medienkontext.'],
    array['Privates Event oder Hobby-/Gaming-Setup.', 'Dauerhafte Ladenbau- oder Messebau-Produktionspartnerschaft.'],
    'Gegen NT-1 gewinnt NT-3 bei belegter Event-/Medienproduktion ohne dauerhafte Laden-/Standbau-Ausführungsrolle.',
    70, 0.80, array['NT-3', 'NT-7']
  ),
  (
    'nt_taxonomy_v2_20260819_cx8', 'NT-5', 'Franchise/Filialorganisation', 'S2',
    'Franchise, Kette oder Organisation mit mehreren Standorten und wiederholbarem Rollout-Potenzial.',
    array['Mehrere Standorte, Filialen, Franchise-Nehmer oder standardisierter Rollout sind positiv belegt.'],
    array['Verifizierbare Mehrstandort- oder Franchise-Struktur.', 'Hinweis auf zentrale Beschaffung, Standardisierung oder Rollout.'],
    array['Ein einzelner unabhängiger Standort ohne belegte Mehrstandortstruktur.', 'Intermediär kauft für eine fremde Kette im eigenen Namen.'],
    'NT-5 gewinnt vor NT-6 oder NT-9, sobald die Mehrstandort-/Franchise- und Rollout-Struktur positiv belegt ist.',
    60, 0.85, array['NT-5']
  ),
  (
    'nt_taxonomy_v2_20260819_cx8', 'NT-6', 'Enterprise/Konzern', 'S2',
    'Großunternehmen oder Konzern mit mehrstufiger Organisation bzw. professioneller Beschaffung.',
    array['Große, mehrstufige Unternehmensorganisation oder Corporate Procurement ist positiv belegt.'],
    array['Verifizierbare Konzern-/Enterprise-Identität.', 'Belastbarer Hinweis auf Größe, mehrere Abteilungen oder professionellen Beschaffungsprozess.'],
    array['Bloße Rechtsform GmbH/AG ohne Größenbeleg.', 'Positiv belegte Franchise-/Filial-Rolloutstruktur.', 'Intermediär kauft im eigenen Namen für den Konzern.'],
    'NT-5 gewinnt bei belegtem Franchise-/Rollout-Modell; NT-4 oder NT-1 gewinnt, wenn die anfragende Einheit als Intermediär bzw. Produktionspartner kontrahiert.',
    50, 0.85, array['NT-6']
  ),
  (
    'nt_taxonomy_v2_20260819_cx8', 'NT-8', 'Privatkunde', 'S3',
    'Natürliche Person kauft ausdrücklich für einen privaten, nicht-gewerblichen Zweck.',
    array['Privater Verwendungszweck oder private Auftraggeberrolle ist ausdrücklich und widerspruchsfrei belegt.'],
    array['Explizite Selbstaussage oder eindeutiger privater Anlass und Einsatzort.'],
    array['Freemail-Adresse als alleiniger Hinweis.', 'Fehlender Firmenname oder fehlende Website als alleiniger Hinweis.', 'Belastbares Geschäfts-, Institutions- oder Intermediärsignal.'],
    'NT-8 darf niemals aus Freemail oder fehlender Firmenidentität folgen; bei Zweifel bleibt die Entscheidung needs_review.',
    40, 0.85, array['NT-8']
  ),
  (
    'nt_taxonomy_v2_20260819_cx8', 'NT-9', 'Direktbetrieb/KMU', 'S3',
    'Direkter kleiner oder mittlerer Geschäftskunde kauft für den eigenen Betrieb, ohne spezifischere CX8-Rolle.',
    array['Geschäftliche Identität und Beschaffung für den eigenen Betrieb sind positiv belegt.', 'Keine höher priorisierte Produktions-, Intermediär-, Multi-Site-, Enterprise- oder Institutionsrolle ist positiv belegt.'],
    array['Expliziter Firmen-/Betriebsbezug.', 'Belastbarer Hinweis auf direkten Eigenbedarf des Betriebs.'],
    array['Unspezifischer Business-Fallback.', 'Freemail plus gestalterisch schwache Anfrage ohne positiven Betriebsbeleg.', 'Positiv belegte höher priorisierte CX8-Rolle.'],
    'NT-9 ist die niedrigste positiv belegte B2B-Klasse, aber niemals ein Fallback; fehlende oder widersprüchliche Evidenz ergibt needs_review.',
    30, 0.82, array['NT-2', 'NT-9', 'NT-12', 'NT-13', 'NT-14', 'NT-15', 'NT-16', 'NT-17', 'NT-18']
  );

update public.segment_taxonomy_definitions
set required_evidence_code = case segment
  when 'NT-10' then 'verified_public_or_institutional_entity'
  when 'NT-1' then 'verified_physical_project_supplier'
  when 'NT-4' then 'verified_client_project_intermediary'
  when 'NT-3' then 'verified_event_or_media_operator'
  when 'NT-5' then 'verified_multisite_or_franchise'
  when 'NT-6' then 'verified_enterprise'
  when 'NT-8' then 'explicit_private_use'
  when 'NT-9' then 'verified_direct_business'
end
where taxonomy_version = 'nt_taxonomy_v2_20260819_cx8';

alter table public.segment_taxonomy_definitions
  add constraint segment_taxonomy_definitions_cx8_evidence_code_required_check
  check (
    taxonomy_version <> 'nt_taxonomy_v2_20260819_cx8'
    or nullif(btrim(required_evidence_code), '') is not null
  );

insert into public.segment_context_definitions (
  taxonomy_version, context_tag, label, description, legacy_source_segments
) values
  ('nt_taxonomy_v2_20260819_cx8', 'gastronomy_hospitality', 'Gastronomie/Hospitality', 'Restaurant, Bar, Café, Hotel oder Hospitality-Kontext.', array['NT-2']),
  ('nt_taxonomy_v2_20260819_cx8', 'film_tv', 'Film/TV', 'Film-, TV-, Streaming-, Set- oder Studiokontext.', array['NT-7']),
  ('nt_taxonomy_v2_20260819_cx8', 'architecture_interior', 'Architektur/Interior', 'Architektur-, Innenarchitektur- oder Raumplanungskontext.', array['NT-11']),
  ('nt_taxonomy_v2_20260819_cx8', 'creator_influencer', 'Creator/Influencer', 'Creator-, Influencer-, Streaming- oder Personenmarkenkontext.', array['NT-12']),
  ('nt_taxonomy_v2_20260819_cx8', 'healthcare', 'Healthcare', 'Praxis-, Klinik-, Dental-, Therapie- oder Medical-Kontext.', array['NT-13']),
  ('nt_taxonomy_v2_20260819_cx8', 'real_estate', 'Immobilien', 'Immobilien-, Makler-, Projektentwicklungs- oder Objektvermarktungskontext.', array['NT-14']),
  ('nt_taxonomy_v2_20260819_cx8', 'fitness_wellness', 'Fitness/Wellness', 'Fitnessstudio-, Sportstudio-, Yoga-, Pilates- oder Wellness-Kontext.', array['NT-15']),
  ('nt_taxonomy_v2_20260819_cx8', 'recruiting_employer_branding', 'Recruiting/Employer Branding', 'HR-, Recruiting-, Karriere- oder Employer-Branding-Kontext.', array['NT-16']),
  ('nt_taxonomy_v2_20260819_cx8', 'startup_tech', 'Startup/Tech', 'Startup-, Scale-up-, SaaS- oder Tech-Kontext.', array['NT-17']),
  ('nt_taxonomy_v2_20260819_cx8', 'luxury_premium_retail', 'Luxury/Premium Retail', 'Premium-, Luxury-, Fashion-, Schmuck-, Beauty- oder Boutique-Kontext.', array['NT-18']);

insert into public.segment_quality_gate_versions (
  version, taxonomy_version, classifier_version, prompt_version, active,
  min_unique_gold_total, min_gold_per_segment,
  min_precision_per_predicted_class, min_recall_per_actual_class,
  min_accepted_coverage, critical_segments, min_critical_precision,
  required_mapping_integrity, max_provenance_violations,
  manual_activation_required, created_by, notes
) values (
  'nt_quality_gate_v2_20260819_cx8',
  'nt_taxonomy_v2_20260819_cx8',
  'segment_classifier_v3_20260819_cx8',
  'segment_prompt_v4_20260819_cx8',
  true,
  300,
  25,
  0.90,
  0.85,
  0.80,
  array['NT-8', 'NT-10'],
  0.95,
  1.0,
  0,
  true,
  'codex-phase2',
  'CX8 shadow gate. Manual activation remains mandatory after every technical metric passes.'
);

alter table public.segment_policy_versions
  add column taxonomy_version text null references public.segment_taxonomy_versions(version),
  add column classifier_version text null,
  add column prompt_version text null,
  add column quality_gate_version text null references public.segment_quality_gate_versions(version),
  add constraint segment_policy_versions_contract_completeness_check
    check (
      (taxonomy_version is null and classifier_version is null and prompt_version is null and quality_gate_version is null)
      or (
        taxonomy_version is not null
        and nullif(btrim(classifier_version), '') is not null
        and nullif(btrim(prompt_version), '') is not null
        and quality_gate_version is not null
      )
    );

alter table public.segment_policy_rules
  add column taxonomy_version text null;

alter table public.segment_policy_rules
  add constraint segment_policy_rules_taxonomy_definition_fkey
  foreign key (taxonomy_version, segment)
  references public.segment_taxonomy_definitions(taxonomy_version, segment)
  on delete restrict;

alter table public.request_segmentation_jobs
  add column taxonomy_version text null references public.segment_taxonomy_versions(version),
  add column classifier_version text null,
  add column prompt_version text null,
  add constraint request_segmentation_jobs_contract_completeness_check
    check (
      num_nonnulls(taxonomy_version, classifier_version, prompt_version) = 0
      or (
        taxonomy_version is not null
        and nullif(btrim(classifier_version), '') is not null
        and nullif(btrim(prompt_version), '') is not null
      )
    );

alter table public.request_segment_classifications
  add column taxonomy_version text null references public.segment_taxonomy_versions(version),
  add column context_tags text[] not null default '{}',
  add column organization_scale text null,
  add column evidence_provenance_valid boolean not null default false,
  add column mapping_integrity boolean not null default false,
  add constraint request_segment_classifications_organization_scale_check
    check (organization_scale is null or organization_scale in ('solo', 'micro', 'small', 'medium', 'large', 'enterprise')),
  add constraint request_segment_classifications_versioned_contract_check
    check (
      taxonomy_version is null
      or (
        nullif(btrim(classifier_version), '') is not null
        and nullif(btrim(prompt_version), '') is not null
      )
    );

alter table public.master_requests
  add column segment_taxonomy_version text null references public.segment_taxonomy_versions(version),
  add column segment_context_tags text[] not null default '{}',
  add column segment_organization_scale text null,
  add constraint master_requests_segment_organization_scale_check
    check (segment_organization_scale is null or segment_organization_scale in ('solo', 'micro', 'small', 'medium', 'large', 'enterprise'));

alter table public.request_segmentation_activation_approvals
  add column policy_version text null references public.segment_policy_versions(version),
  add column taxonomy_version text null references public.segment_taxonomy_versions(version),
  add column quality_gate_version text null references public.segment_quality_gate_versions(version),
  add constraint request_segmentation_activation_approvals_contract_check
    check (num_nonnulls(policy_version, taxonomy_version, quality_gate_version) in (0, 3));

-- Allow safe re-evaluation of the same immutable input under a new semantic
-- contract while preserving legacy uniqueness for all pre-Phase-2 rows.
alter table public.request_segmentation_jobs
  drop constraint request_segmentation_jobs_request_id_input_hash_key;

create unique index request_segmentation_jobs_legacy_input_uidx
  on public.request_segmentation_jobs (request_id, input_hash)
  where taxonomy_version is null;

create unique index request_segmentation_jobs_versioned_input_uidx
  on public.request_segmentation_jobs (
    request_id, input_hash, taxonomy_version, classifier_version, prompt_version
  )
  where taxonomy_version is not null
    and classifier_version is not null
    and prompt_version is not null;

create index request_segmentation_jobs_versioned_pickup_idx
  on public.request_segmentation_jobs (
    taxonomy_version, classifier_version, prompt_version,
    status, next_attempt_at, priority desc, created_at
  )
  where taxonomy_version is not null;

alter table public.request_segment_classifications
  drop constraint request_segment_classificatio_request_id_input_hash_classif_key;

create unique index request_segment_classifications_legacy_input_uidx
  on public.request_segment_classifications (request_id, input_hash, classifier_version)
  where taxonomy_version is null;

create unique index request_segment_classifications_versioned_input_uidx
  on public.request_segment_classifications (
    request_id, input_hash, taxonomy_version, classifier_version, prompt_version
  )
  where taxonomy_version is not null;

create index request_segment_classifications_taxonomy_eval_idx
  on public.request_segment_classifications (
    taxonomy_version, classifier_version, prompt_version, request_id, input_hash, created_at desc
  )
  where taxonomy_version is not null;

create function public.neontrip_segmentation_text_array_is_canonical(
  p_values text[],
  p_max_items integer,
  p_max_length integer
)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select
    p_values is not null
    and p_max_items >= 0
    and p_max_length > 0
    and cardinality(p_values) <= p_max_items
    and not exists (
      select 1
      from unnest(p_values) value(item)
      where item is null
         or item <> btrim(item)
         or item = ''
         or length(item) > p_max_length
    )
    and cardinality(p_values) = (
      select count(distinct item)::integer
      from unnest(p_values) value(item)
    );
$function$;

comment on function public.neontrip_segmentation_text_array_is_canonical(text[], integer, integer) is
  'Immutable CHECK helper: bounded, trimmed, nonempty, unique text arrays only.';

revoke all on function public.neontrip_segmentation_text_array_is_canonical(text[], integer, integer)
  from public, anon, authenticated;
grant execute on function public.neontrip_segmentation_text_array_is_canonical(text[], integer, integer)
  to service_role;

create table public.request_segmentation_gold_adjudications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.master_requests(id) on delete restrict,
  input_hash text not null,
  taxonomy_version text not null references public.segment_taxonomy_versions(version) on delete restrict,
  labeling_version text not null,
  labeled_segment text not null,
  labeled_s_kategorie text not null,
  context_tags text[] not null default '{}',
  organization_scale text null,
  adjudicated_by text not null,
  adjudication_reason text not null,
  evidence_urls text[] not null default '{}',
  source text not null default 'explicit_human_adjudication',
  created_at timestamptz not null default now(),
  unique (request_id, input_hash, taxonomy_version),
  constraint request_segmentation_gold_adjudications_definition_fkey
    foreign key (taxonomy_version, labeled_segment)
    references public.segment_taxonomy_definitions(taxonomy_version, segment)
    on delete restrict,
  constraint request_segmentation_gold_adjudications_s_kategorie_check
    check (labeled_s_kategorie in ('S1', 'S2', 'S3', 'S4')),
  constraint request_segmentation_gold_adjudications_scale_check
    check (organization_scale is null or organization_scale in ('solo', 'micro', 'small', 'medium', 'large', 'enterprise')),
  constraint request_segmentation_gold_adjudications_actor_check
    check (length(btrim(adjudicated_by)) between 3 and 320),
  constraint request_segmentation_gold_adjudications_reason_check
    check (length(btrim(adjudication_reason)) between 20 and 4000),
  constraint request_segmentation_gold_adjudications_context_tags_check
    check (public.neontrip_segmentation_text_array_is_canonical(context_tags, 10, 80)),
  constraint request_segmentation_gold_adjudications_evidence_urls_check
    check (public.neontrip_segmentation_text_array_is_canonical(evidence_urls, 12, 2048)),
  constraint request_segmentation_gold_adjudications_source_check
    check (source = 'explicit_human_adjudication')
);

create index request_segmentation_gold_adjudications_eval_idx
  on public.request_segmentation_gold_adjudications (
    taxonomy_version, labeled_segment, request_id, input_hash
  );

-- Stage CX8 inactive. A separate, deliberately held rollout artifact outside
-- supabase/migrations flips v1 -> v2 only after the app and n8n-v3 consumers
-- are deployed and every retryable legacy job is drained/resolved. This
-- prevents the active Phase-1 workflow from claiming a CX8 job with its old
-- schema and avoids silently stranding a legacy retry.
insert into public.segment_policy_versions (
  version, active, mode, created_by, notes,
  taxonomy_version, classifier_version, prompt_version, quality_gate_version
) values (
  'nt_policy_v2_20260819_cx8_shadow',
  false,
  'shadow',
  'codex-phase2',
  'CX8 DB-first cutover. Shadow only; every automation rule remains disabled.',
  'nt_taxonomy_v2_20260819_cx8',
  'segment_classifier_v3_20260819_cx8',
  'segment_prompt_v4_20260819_cx8',
  'nt_quality_gate_v2_20260819_cx8'
);

insert into public.segment_policy_rules (
  policy_version, segment, s_kategorie, min_confidence, price_factor,
  max_followups, first_call_after_minutes, call_sequence, email_sequence,
  sales_priority, needs_human_review, automation_enabled, taxonomy_version
) values
  ('nt_policy_v2_20260819_cx8_shadow', 'NT-10', 'S4', 0.85, null, 0, null, '[]', '[]', 50, false, false, 'nt_taxonomy_v2_20260819_cx8'),
  ('nt_policy_v2_20260819_cx8_shadow', 'NT-1',  'S2', 0.82, null, 0, null, '[]', '[]', 50, false, false, 'nt_taxonomy_v2_20260819_cx8'),
  ('nt_policy_v2_20260819_cx8_shadow', 'NT-4',  'S2', 0.82, null, 0, null, '[]', '[]', 50, false, false, 'nt_taxonomy_v2_20260819_cx8'),
  ('nt_policy_v2_20260819_cx8_shadow', 'NT-3',  'S1', 0.80, null, 0, null, '[]', '[]', 50, false, false, 'nt_taxonomy_v2_20260819_cx8'),
  ('nt_policy_v2_20260819_cx8_shadow', 'NT-5',  'S2', 0.85, null, 0, null, '[]', '[]', 50, false, false, 'nt_taxonomy_v2_20260819_cx8'),
  ('nt_policy_v2_20260819_cx8_shadow', 'NT-6',  'S2', 0.85, null, 0, null, '[]', '[]', 50, false, false, 'nt_taxonomy_v2_20260819_cx8'),
  ('nt_policy_v2_20260819_cx8_shadow', 'NT-8',  'S3', 0.85, null, 0, null, '[]', '[]', 50, false, false, 'nt_taxonomy_v2_20260819_cx8'),
  ('nt_policy_v2_20260819_cx8_shadow', 'NT-9',  'S3', 0.82, null, 0, null, '[]', '[]', 50, false, false, 'nt_taxonomy_v2_20260819_cx8');

-- New objects default to service-role-only. Existing Phase-1 table grants are
-- deliberately not broadened or globally rewritten in this migration.
alter table public.segment_taxonomy_versions enable row level security;
alter table public.segment_taxonomy_definitions enable row level security;
alter table public.segment_context_definitions enable row level security;
alter table public.segment_quality_gate_versions enable row level security;
alter table public.request_segmentation_gold_adjudications enable row level security;

create policy segment_taxonomy_versions_service_role_select
  on public.segment_taxonomy_versions for select to service_role using (true);
create policy segment_taxonomy_definitions_service_role_select
  on public.segment_taxonomy_definitions for select to service_role using (true);
create policy segment_context_definitions_service_role_select
  on public.segment_context_definitions for select to service_role using (true);
create policy segment_quality_gate_versions_service_role_select
  on public.segment_quality_gate_versions for select to service_role using (true);
create policy request_segmentation_gold_adjudications_service_role_select
  on public.request_segmentation_gold_adjudications for select to service_role using (true);

revoke all on table public.segment_taxonomy_versions from public, anon, authenticated;
revoke all on table public.segment_taxonomy_definitions from public, anon, authenticated;
revoke all on table public.segment_context_definitions from public, anon, authenticated;
revoke all on table public.segment_quality_gate_versions from public, anon, authenticated;
revoke all on table public.request_segmentation_gold_adjudications from public, anon, authenticated;

-- A legacy ALTER DEFAULT PRIVILEGES grant may already give service_role DML on
-- newly created public tables. Remove it explicitly before restoring only the
-- read privilege needed by API callers; SECURITY DEFINER RPCs mutate as owner.
revoke all on table public.segment_taxonomy_versions from service_role;
revoke all on table public.segment_taxonomy_definitions from service_role;
revoke all on table public.segment_context_definitions from service_role;
revoke all on table public.segment_quality_gate_versions from service_role;
revoke all on table public.request_segmentation_gold_adjudications from service_role;

grant select on table public.segment_taxonomy_versions to service_role;
grant select on table public.segment_taxonomy_definitions to service_role;
grant select on table public.segment_context_definitions to service_role;
grant select on table public.segment_quality_gate_versions to service_role;
grant select on table public.request_segmentation_gold_adjudications to service_role;

create or replace function public.neontrip_enqueue_request_segmentation(
  p_request_id uuid,
  p_source text default 'manual'::text,
  p_priority integer default 100
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hash text;
  v_job_id uuid;
  v_public_id text;
  v_policy public.segment_policy_versions%rowtype;
begin
  select public.neontrip_compute_request_segment_input_hash(p_request_id)
  into v_hash;

  if v_hash is null then
    raise exception 'request_not_found: %', p_request_id;
  end if;

  select * into v_policy
  from public.segment_policy_versions
  where active
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'no_active_segment_policy';
  end if;

  select request_id into v_public_id
  from public.master_requests
  where id = p_request_id;

  if v_policy.taxonomy_version is null then
    -- Exact legacy lane retained only while the Phase-1 policy is active.
    insert into public.request_segmentation_jobs (
      request_id, request_public_id, input_hash, source, priority, status,
      next_attempt_at, metadata, taxonomy_version, classifier_version, prompt_version
    ) values (
      p_request_id,
      v_public_id,
      v_hash,
      coalesce(nullif(p_source, ''), 'manual'),
      greatest(0, least(1000, coalesce(p_priority, 100))),
      'pending',
      now(),
      jsonb_build_object(
        'enqueued_by', p_source,
        'enqueued_at', now(),
        'policy_version', v_policy.version,
        'contract_lane', 'legacy_unversioned'
      ),
      null,
      null,
      null
    )
    on conflict (request_id, input_hash)
      where taxonomy_version is null
    do update set
      updated_at = now(),
      source = excluded.source,
      priority = greatest(public.request_segmentation_jobs.priority, excluded.priority),
      next_attempt_at = case
        when public.request_segmentation_jobs.status in ('failed', 'cancelled') then now()
        else public.request_segmentation_jobs.next_attempt_at
      end,
      status = case
        when public.request_segmentation_jobs.status in ('failed', 'cancelled') then 'pending'
        else public.request_segmentation_jobs.status
      end,
      metadata = public.request_segmentation_jobs.metadata || excluded.metadata
    returning id into v_job_id;
  else
    if v_policy.classifier_version is null
       or v_policy.prompt_version is null
       or v_policy.quality_gate_version is null then
      raise exception 'active_segment_policy_contract_incomplete: %', v_policy.version;
    end if;

    insert into public.request_segmentation_jobs (
      request_id, request_public_id, input_hash, source, priority, status,
      next_attempt_at, metadata, taxonomy_version, classifier_version, prompt_version
    ) values (
      p_request_id,
      v_public_id,
      v_hash,
      coalesce(nullif(p_source, ''), 'manual'),
      greatest(0, least(1000, coalesce(p_priority, 100))),
      'pending',
      now(),
      jsonb_build_object(
        'enqueued_by', p_source,
        'enqueued_at', now(),
        'policy_version', v_policy.version,
        'taxonomy_version', v_policy.taxonomy_version,
        'classifier_version', v_policy.classifier_version,
        'prompt_version', v_policy.prompt_version,
        'quality_gate_version', v_policy.quality_gate_version,
        'contract_lane', 'versioned',
        'evaluation_only', false,
        'master_projection_authorized', true
      ),
      v_policy.taxonomy_version,
      v_policy.classifier_version,
      v_policy.prompt_version
    )
    on conflict (
      request_id, input_hash, taxonomy_version, classifier_version, prompt_version
    )
      where taxonomy_version is not null
        and classifier_version is not null
        and prompt_version is not null
    do update set
      updated_at = now(),
      source = excluded.source,
      priority = greatest(public.request_segmentation_jobs.priority, excluded.priority),
      next_attempt_at = case
        when public.request_segmentation_jobs.status in ('failed', 'cancelled') then now()
        else public.request_segmentation_jobs.next_attempt_at
      end,
      status = case
        when public.request_segmentation_jobs.status in ('failed', 'cancelled') then 'pending'
        else public.request_segmentation_jobs.status
      end,
      metadata = public.request_segmentation_jobs.metadata || excluded.metadata
        || case
          -- A normal enqueue may never silently promote an evaluation-only job
          -- sharing the same versioned key, including while it is processing or
          -- after it completed. Promotion requires a future explicit contract.
          when lower(coalesce(
            public.request_segmentation_jobs.metadata->>'evaluation_only',
            'false'
          )) = 'true' then jsonb_build_object(
            'evaluation_only', true,
            'master_projection_authorized', false
          )
          else jsonb_build_object(
            'evaluation_only', false,
            'master_projection_authorized', true
          )
        end
    returning id into v_job_id;
  end if;

  -- Preserve Phase-1 ingress behavior. Only neutral, non-manual pending rows may
  -- have the historical NT-8/NT-9 fallback projection removed on explicit
  -- enqueue; accepted/manual history is never remapped.
  update public.master_requests
  set
    segment = case when segment in ('NT-8', 'NT-9') then null else segment end,
    s_kategorie = case when segment in ('NT-8', 'NT-9') then null else s_kategorie end,
    segment_status = 'pending',
    segment_confidence = case when segment in ('NT-8', 'NT-9') then null else segment_confidence end,
    segment_source = 'segmentation_queue',
    segment_classified_at = case when segment in ('NT-8', 'NT-9') then null else segment_classified_at end,
    segment_policy_version = case when segment in ('NT-8', 'NT-9') then null else segment_policy_version end,
    segment_taxonomy_version = case when segment in ('NT-8', 'NT-9') then null else segment_taxonomy_version end,
    segment_context_tags = case when segment in ('NT-8', 'NT-9') then '{}'::text[] else segment_context_tags end,
    segment_organization_scale = case when segment in ('NT-8', 'NT-9') then null else segment_organization_scale end,
    commercial_playbook = case when segment in ('NT-8', 'NT-9') then '{}'::jsonb else commercial_playbook end,
    updated_at = now()
  where id = p_request_id
    and coalesce(segment_source, '') !~ '^manual_'
    and coalesce(segment_status, 'pending') in ('pending', 'legacy', 'error');

  return v_job_id;
end;
$function$;

comment on function public.neontrip_enqueue_request_segmentation(uuid, text, integer) is
  'Queues against the exact active semantic contract. Legacy jobs remain unversioned only while the legacy policy is active; CX8 jobs carry taxonomy/classifier/prompt versions.';

revoke all on function public.neontrip_enqueue_request_segmentation(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.neontrip_enqueue_request_segmentation(uuid, text, integer)
  to service_role;

create or replace function public.neontrip_stage_request_segmentation_historical_backfill(
  p_limit integer default 25,
  p_hold_until timestamptz default now() + interval '7 days',
  p_priority integer default 40
)
returns table(
  request_id uuid,
  public_request_id text,
  job_id uuid,
  input_hash text,
  source text,
  status text,
  next_attempt_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(p_limit, 0) < 1 then
    raise exception 'limit_must_be_positive';
  end if;

  if p_limit > 100 then
    raise exception 'limit_above_100_requires_smaller_controlled_batches';
  end if;

  if p_hold_until is null or p_hold_until <= now() then
    raise exception 'hold_until_must_be_in_the_future';
  end if;

  return query
  with active_policy as (
    select p.*
    from public.segment_policy_versions p
    where p.active
    order by p.created_at desc
    limit 1
  ), candidates as (
    select
      c.request_id,
      c.public_request_id,
      c.created_at,
      c.legacy_segment as legacy_segment_display_only,
      c.backfill_priority,
      c.input_hash,
      ap.version as policy_version,
      ap.taxonomy_version,
      ap.classifier_version,
      ap.prompt_version,
      ap.quality_gate_version
    from public.request_segmentation_historical_backfill_candidates c
    cross join active_policy ap
  ), picked as (
    select c.*
    from candidates c
    where c.input_hash is not null
      and not exists (
        select 1
        from public.request_segmentation_jobs j
        where j.request_id = c.request_id
          and j.input_hash = c.input_hash
          and (
            (c.taxonomy_version is null and j.taxonomy_version is null)
            or (
              c.taxonomy_version is not null
              and j.taxonomy_version = c.taxonomy_version
              and j.classifier_version = c.classifier_version
              and j.prompt_version = c.prompt_version
            )
          )
      )
      and not exists (
        select 1
        from public.request_segment_classifications cls
        where cls.request_id = c.request_id
          and cls.input_hash = c.input_hash
          and (
            (c.taxonomy_version is null and cls.taxonomy_version is null)
            or (
              c.taxonomy_version is not null
              and cls.taxonomy_version = c.taxonomy_version
              and cls.classifier_version = c.classifier_version
              and cls.prompt_version = c.prompt_version
            )
          )
      )
    order by c.created_at desc, c.request_id
    limit p_limit
  ), inserted as (
    insert into public.request_segmentation_jobs (
      request_id, request_public_id, input_hash, source, priority, status,
      next_attempt_at, metadata, taxonomy_version, classifier_version, prompt_version
    )
    select
      p.request_id,
      p.public_request_id,
      p.input_hash,
      'historical_shadow_backfill',
      greatest(0, least(1000, coalesce(p_priority, p.backfill_priority))),
      'pending',
      p_hold_until,
      jsonb_build_object(
        'staged_by', 'neontrip_stage_request_segmentation_historical_backfill',
        'staged_at', now(),
        'hold_until', p_hold_until,
        'reason', 'controlled historical shadow evaluation',
        'legacy_segment_display_only', p.legacy_segment_display_only,
        'backfill_priority', p.backfill_priority,
        'historical_segment_is_not_cx8_truth', true,
        'policy_version', p.policy_version,
        'taxonomy_version', p.taxonomy_version,
        'classifier_version', p.classifier_version,
        'prompt_version', p.prompt_version,
        'quality_gate_version', p.quality_gate_version,
        'evaluation_only', true,
        'master_projection_authorized', false
      ),
      p.taxonomy_version,
      p.classifier_version,
      p.prompt_version
    from picked p
    on conflict do nothing
    returning
      public.request_segmentation_jobs.request_id,
      public.request_segmentation_jobs.request_public_id,
      public.request_segmentation_jobs.id,
      public.request_segmentation_jobs.input_hash,
      public.request_segmentation_jobs.source,
      public.request_segmentation_jobs.status,
      public.request_segmentation_jobs.next_attempt_at
  )
  select
    i.request_id,
    i.request_public_id,
    i.id,
    i.input_hash,
    i.source,
    i.status,
    i.next_attempt_at
  from inserted i;
end;
$function$;

comment on function public.neontrip_stage_request_segmentation_historical_backfill(integer, timestamptz, integer) is
  'Stages only the exact active semantic contract. Historical segments are display metadata, never CX8 truth; all staged jobs are evaluation-only and cannot project.';

revoke all on function public.neontrip_stage_request_segmentation_historical_backfill(integer, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.neontrip_stage_request_segmentation_historical_backfill(integer, timestamptz, integer)
  to service_role;

create or replace function public.neontrip_release_request_segmentation_historical_backfill(
  p_limit integer default 25
)
returns table(
  request_id uuid,
  public_request_id text,
  job_id uuid,
  status text,
  next_attempt_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(p_limit, 0) < 1 then
    raise exception 'limit_must_be_positive';
  end if;

  if p_limit > 25 then
    raise exception 'release_limit_above_25_requires_smaller_batches';
  end if;

  return query
  with active_policy as (
    select p.*
    from public.segment_policy_versions p
    where p.active
    order by p.created_at desc
    limit 1
  ), picked as (
    select j.id
    from public.request_segmentation_jobs j
    cross join active_policy ap
    where j.source = 'historical_shadow_backfill'
      and j.status = 'pending'
      and j.next_attempt_at > now()
      and (
        (
          ap.taxonomy_version is null
          and j.taxonomy_version is null
          and j.classifier_version is null
          and j.prompt_version is null
        )
        or (
          ap.taxonomy_version is not null
          and j.taxonomy_version = ap.taxonomy_version
          and j.classifier_version = ap.classifier_version
          and j.prompt_version = ap.prompt_version
        )
      )
    order by j.priority desc, j.created_at asc
    limit p_limit
    for update of j skip locked
  )
  update public.request_segmentation_jobs j
  set
    next_attempt_at = now(),
    updated_at = now(),
    metadata = j.metadata || jsonb_build_object(
      'released_by', 'neontrip_release_request_segmentation_historical_backfill',
      'released_at', now()
    )
  from picked
  where j.id = picked.id
  returning j.request_id, j.request_public_id, j.id, j.status, j.next_attempt_at;
end;
$function$;

comment on function public.neontrip_release_request_segmentation_historical_backfill(integer) is
  'Releases only historical evaluation jobs whose complete semantic contract matches the active policy; cross-lane jobs remain held.';

revoke all on function public.neontrip_release_request_segmentation_historical_backfill(integer)
  from public, anon, authenticated;
grant execute on function public.neontrip_release_request_segmentation_historical_backfill(integer)
  to service_role;

drop function public.neontrip_claim_request_segmentation_jobs(integer, text, integer);

create function public.neontrip_claim_request_segmentation_jobs(
  p_limit integer default 5,
  p_lock_owner text default 'n8n-request-segmenter'::text,
  p_stale_minutes integer default 15,
  p_taxonomy_version text default null,
  p_classifier_version text default null,
  p_prompt_version text default null
)
returns setof public.request_segmentation_jobs
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if num_nonnulls(p_taxonomy_version, p_classifier_version, p_prompt_version) not in (0, 3) then
    raise exception 'segmentation_claim_contract_filter_all_or_none';
  end if;

  return query
  with active_policy as (
    select p.*
    from public.segment_policy_versions p
    where p.active
    order by p.created_at desc
    limit 1
  ),
  picked as (
    select j.id
    from public.request_segmentation_jobs j
    cross join active_policy p
    where (
        (
          p_taxonomy_version is null
          and p.taxonomy_version is null
          and j.taxonomy_version is null
        )
        or (
          p_taxonomy_version is not null
          and p.taxonomy_version = p_taxonomy_version
          and p.classifier_version = p_classifier_version
          and p.prompt_version = p_prompt_version
          and j.taxonomy_version = p_taxonomy_version
          and j.classifier_version = p_classifier_version
          and j.prompt_version = p_prompt_version
        )
      )
      and (
        j.status = 'pending'
        or (
          j.status = 'processing'
          and j.locked_at < now() - make_interval(mins => greatest(1, coalesce(p_stale_minutes, 15)))
        )
        or (j.status = 'failed' and j.attempts < j.max_attempts)
      )
      and j.next_attempt_at <= now()
    order by j.priority desc, j.created_at asc
    limit greatest(1, least(coalesce(p_limit, 5), 25))
    for update of j skip locked
  )
  update public.request_segmentation_jobs j
  set
    status = 'processing',
    lock_owner = coalesce(nullif(p_lock_owner, ''), 'n8n-request-segmenter'),
    locked_at = now(),
    attempts = attempts + 1,
    updated_at = now()
  from picked
  where j.id = picked.id
  returning j.*;
end;
$function$;

comment on function public.neontrip_claim_request_segmentation_jobs(integer, text, integer, text, text, text) is
  'With all contract filters NULL, claims only legacy jobs while an unversioned policy is active. With all three filters set, claims only the exact active taxonomy/classifier/prompt; partial filters fail.';

revoke all on function public.neontrip_claim_request_segmentation_jobs(integer, text, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.neontrip_claim_request_segmentation_jobs(integer, text, integer, text, text, text)
  to service_role;

drop function public.neontrip_claim_request_segmentation_jobs_by_source(text, integer, text, integer);

create function public.neontrip_claim_request_segmentation_jobs_by_source(
  p_source text,
  p_limit integer default 5,
  p_lock_owner text default 'n8n-request-segmenter'::text,
  p_stale_minutes integer default 15,
  p_taxonomy_version text default null,
  p_classifier_version text default null,
  p_prompt_version text default null
)
returns setof public.request_segmentation_jobs
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if nullif(p_source, '') is null then
    raise exception 'source_filter_required';
  end if;

  if num_nonnulls(p_taxonomy_version, p_classifier_version, p_prompt_version) not in (0, 3) then
    raise exception 'segmentation_claim_contract_filter_all_or_none';
  end if;

  return query
  with active_policy as (
    select p.*
    from public.segment_policy_versions p
    where p.active
    order by p.created_at desc
    limit 1
  ),
  picked as (
    select j.id
    from public.request_segmentation_jobs j
    cross join active_policy p
    where j.source = p_source
      and (
        (
          p_taxonomy_version is null
          and p.taxonomy_version is null
          and j.taxonomy_version is null
        )
        or (
          p_taxonomy_version is not null
          and p.taxonomy_version = p_taxonomy_version
          and p.classifier_version = p_classifier_version
          and p.prompt_version = p_prompt_version
          and j.taxonomy_version = p_taxonomy_version
          and j.classifier_version = p_classifier_version
          and j.prompt_version = p_prompt_version
        )
      )
      and (
        j.status = 'pending'
        or (
          j.status = 'processing'
          and j.locked_at < now() - make_interval(mins => greatest(1, coalesce(p_stale_minutes, 15)))
        )
        or (j.status = 'failed' and j.attempts < j.max_attempts)
      )
      and j.next_attempt_at <= now()
    order by j.priority desc, j.created_at asc
    limit greatest(1, least(coalesce(p_limit, 5), 25))
    for update of j skip locked
  )
  update public.request_segmentation_jobs j
  set
    status = 'processing',
    lock_owner = coalesce(nullif(p_lock_owner, ''), 'n8n-request-segmenter'),
    locked_at = now(),
    attempts = attempts + 1,
    updated_at = now()
  from picked
  where j.id = picked.id
  returning j.*;
end;
$function$;

comment on function public.neontrip_claim_request_segmentation_jobs_by_source(text, integer, text, integer, text, text, text) is
  'Source-filtered claim with the same exact active taxonomy/classifier/prompt contract gate.';

revoke all on function public.neontrip_claim_request_segmentation_jobs_by_source(text, integer, text, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.neontrip_claim_request_segmentation_jobs_by_source(text, integer, text, integer, text, text, text)
  to service_role;

-- The legacy cache writer trusted every evidence item once one website-domain
-- match existed. Keep that behavior for the unversioned lane, but make CX8
-- cache material strictly derivative of the same source/code/use binding that
-- Record validated. This prevents a later request from treating an unrelated
-- model-provided evidence item as verified database evidence.
create or replace function public.neontrip_upsert_segment_research_cache_from_classification(
  p_request_id uuid,
  p_effective_status text,
  p_policy_mode text,
  p_evidence_grade text,
  p_evidence_json jsonb,
  p_firmographic_json jsonb,
  p_classifier_json jsonb,
  p_model text,
  p_classifier_version text
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company_name text;
  v_customer_company text;
  v_website text;
  v_website_domain text;
  v_email_domain text;
  v_email_facts jsonb;
  v_website_facts jsonb;
  v_has_matching_evidence_url boolean;
  v_verified_company_identity boolean;
  v_email_matches_website boolean;
  v_summary jsonb;
  v_written boolean := false;
  v_taxonomy_version text := nullif(btrim(coalesce(p_classifier_json->>'taxonomy_version', '')), '');
  v_prompt_version text := nullif(btrim(coalesce(p_classifier_json->>'prompt_version', '')), '');
  v_classifier_version_json text := nullif(btrim(coalesce(p_classifier_json->>'classifier_version', '')), '');
  v_effective_segment text := nullif(btrim(coalesce(p_classifier_json->>'effective_segment', '')), '');
  v_provenance jsonb := coalesce(p_classifier_json->'evidence_provenance', '{}'::jsonb);
  v_verified_sources jsonb := '[]'::jsonb;
  v_required_evidence_code text;
  v_required_role_use text;
  v_cache_evidence_json jsonb := '[]'::jsonb;
  v_cache_evidence_count integer := 0;
  v_has_required_role_evidence boolean := false;
  v_has_required_scale_evidence boolean := false;
  v_cx8_contract_valid boolean := false;
begin
  v_company_name := nullif(trim(coalesce(p_firmographic_json->>'company_name', '')), '');
  select nullif(trim(coalesce(mc.company_name, mc.company, '')), '')
  into v_customer_company
  from public.master_requests mr
  join public.master_customers mc on mc.id = mr.customer_id
  where mr.id = p_request_id;

  v_website := nullif(trim(coalesce(p_firmographic_json->>'website', '')), '');
  v_email_facts := public.neontrip_request_segmentation_domain_facts(
    p_firmographic_json->>'email_domain'
  );
  v_website_facts := public.neontrip_request_segmentation_domain_facts(v_website);
  v_email_domain := v_email_facts->>'email_domain';
  v_website_domain := v_website_facts->>'email_domain';

  if v_taxonomy_version is null then
    -- Exact Phase-1 compatibility until the held activation migration runs.
    v_cache_evidence_json := coalesce(p_evidence_json, '[]'::jsonb);
  elsif v_taxonomy_version = 'nt_taxonomy_v2_20260819_cx8' then
    if jsonb_typeof(v_provenance->'verified_sources') = 'array' then
      v_verified_sources := v_provenance->'verified_sources';
    end if;

    select d.required_evidence_code
    into v_required_evidence_code
    from public.segment_taxonomy_definitions d
    where d.taxonomy_version = v_taxonomy_version
      and d.segment = v_effective_segment
      and d.active
    limit 1;

    v_required_role_use := case
      when v_effective_segment = 'NT-10' then 'institution_status'
      when v_effective_segment in ('NT-1', 'NT-3', 'NT-4', 'NT-5', 'NT-6', 'NT-9') then 'segment_role'
      else null
    end;

    v_cx8_contract_valid :=
      p_effective_status = 'accepted'
      and p_classifier_version = 'segment_classifier_v3_20260819_cx8'
      and v_classifier_version_json = 'segment_classifier_v3_20260819_cx8'
      and v_prompt_version = 'segment_prompt_v4_20260819_cx8'
      and v_required_evidence_code is not null
      and v_required_role_use is not null
      and jsonb_typeof(v_provenance) = 'object'
      and v_provenance->>'validator_version' = 'n8n_cx8_validator_v1'
      and jsonb_typeof(v_provenance->'valid') = 'boolean'
      and lower(coalesce(v_provenance->>'valid', 'false')) = 'true'
      and jsonb_typeof(p_classifier_json->'db_validation'->'evidence_provenance_valid') = 'boolean'
      and lower(coalesce(p_classifier_json->'db_validation'->>'evidence_provenance_valid', 'false')) = 'true'
      and jsonb_typeof(p_classifier_json->'db_validation'->'positive_evidence_valid') = 'boolean'
      and lower(coalesce(p_classifier_json->'db_validation'->>'positive_evidence_valid', 'false')) = 'true'
      and exists (
        select 1
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(v_provenance->'validated_positive_evidence_codes') = 'array'
              then v_provenance->'validated_positive_evidence_codes'
            else '[]'::jsonb
          end
        ) code(value)
        where code.value = v_required_evidence_code
      );

    if not v_cx8_contract_valid then
      return false;
    end if;

    select
      coalesce(jsonb_agg(evidence.item order by evidence.ordinality), '[]'::jsonb),
      count(*)::integer,
      coalesce(bool_or(evidence.item->>'used_for' = v_required_role_use), false),
      coalesce(bool_or(evidence.item->>'used_for' = 'organization_scale'), false)
    into
      v_cache_evidence_json,
      v_cache_evidence_count,
      v_has_required_role_evidence,
      v_has_required_scale_evidence
    from jsonb_array_elements(
      case
        when jsonb_typeof(p_evidence_json) = 'array' then p_evidence_json
        else '[]'::jsonb
      end
    ) with ordinality evidence(item, ordinality)
    where jsonb_typeof(evidence.item) = 'object'
      and evidence.item ?& array['type', 'url', 'used_for', 'evidence_code']
      and evidence.item->>'type' in ('web_search', 'research_cache')
      and evidence.item->>'evidence_code' = v_required_evidence_code
      and (
        evidence.item->>'used_for' = v_required_role_use
        or (
          v_effective_segment in ('NT-5', 'NT-6')
          and evidence.item->>'used_for' = 'organization_scale'
        )
      )
      and coalesce(evidence.item->>'url', '') ~* '^https?://'
      and coalesce(
        ((public.neontrip_request_segmentation_domain_facts(evidence.item->>'url'))->>'is_valid_dns_host')::boolean,
        false
      )
      and exists (
        select 1
        from jsonb_array_elements(v_verified_sources) source(item)
        where jsonb_typeof(source.item) = 'object'
          and jsonb_typeof(source.item->'url') = 'string'
          and jsonb_typeof(source.item->'source_type') = 'string'
          and jsonb_typeof(source.item->'source_ref') = 'string'
          and source.item->>'url' = evidence.item->>'url'
          and nullif(btrim(coalesce(source.item->>'source_ref', '')), '') is not null
          and (
            (source.item->>'source_type' = 'web_search_call' and evidence.item->>'type' = 'web_search')
            or (
              source.item->>'source_type' = 'verified_db_cache'
              and evidence.item->>'type' = 'research_cache'
              and exists (
                select 1
                from public.segment_research_cache cached
                where cached.cache_key = source.item->>'source_ref'
                  and cached.status = 'ok'
                  and cached.expires_at > now()
                  and cached.summary_json->>'taxonomy_version' = v_taxonomy_version
                  and cached.summary_json->>'classifier_version' = v_classifier_version_json
                  and cached.summary_json->>'prompt_version' = v_prompt_version
                  and cached.summary_json->>'evidence_contract_valid' = 'true'
                  and cached.summary_json->>'required_evidence_code' = v_required_evidence_code
                  and exists (
                    select 1
                    from jsonb_array_elements(
                      case
                        when jsonb_typeof(cached.evidence_json) = 'array' then cached.evidence_json
                        else '[]'::jsonb
                      end
                    ) cached_evidence(item)
                    where cached_evidence.item->>'url' = evidence.item->>'url'
                      and cached_evidence.item->>'evidence_code' = evidence.item->>'evidence_code'
                      and cached_evidence.item->>'used_for' = evidence.item->>'used_for'
                  )
              )
            )
          )
          and jsonb_typeof(source.item->'validated_positive_evidence_codes') = 'array'
          and exists (
            select 1
            from jsonb_array_elements_text(source.item->'validated_positive_evidence_codes') source_code(value)
            where source_code.value = v_required_evidence_code
          )
      );

    if v_cache_evidence_count = 0
       or not v_has_required_role_evidence
       or (v_effective_segment in ('NT-5', 'NT-6') and not v_has_required_scale_evidence) then
      return false;
    end if;
  else
    -- An unknown future taxonomy must define its own writer instead of silently
    -- inheriting either the legacy or CX8 trust contract.
    return false;
  end if;

  select exists (
    select 1
    from jsonb_array_elements(
      case
        when jsonb_typeof(v_cache_evidence_json) = 'array' then v_cache_evidence_json
        else '[]'::jsonb
      end
    ) as evidence(item)
    cross join lateral (
      select public.neontrip_request_segmentation_domain_facts(evidence.item->>'url') as facts
    ) as evidence_domain
    where coalesce(evidence.item->>'url', '') ~* '^https?://'
      and evidence_domain.facts->>'email_domain' is not null
      and coalesce(
        (evidence_domain.facts->>'email_domain_cache_allowed')::boolean,
        false
      )
      and (
        evidence_domain.facts->>'email_domain' = v_website_domain
        or right(
          evidence_domain.facts->>'email_domain',
          length(v_website_domain) + 1
        ) = '.' || v_website_domain
        or right(
          v_website_domain,
          length(evidence_domain.facts->>'email_domain') + 1
        ) = '.' || (evidence_domain.facts->>'email_domain')
      )
  ) into v_has_matching_evidence_url;

  v_verified_company_identity :=
    p_effective_status = 'accepted'
    and p_policy_mode in ('followup_live', 'pricing_live')
    and lower(coalesce(p_evidence_grade, '')) = 'strong'
    and lower(coalesce(p_firmographic_json->>'is_company', 'false')) = 'true'
    and v_company_name is not null
    and v_customer_company is not null
    and regexp_replace(lower(v_company_name), '\s+', ' ', 'g')
      = regexp_replace(lower(v_customer_company), '\s+', ' ', 'g')
    and coalesce(v_website ~* '^https?://', false)
    and v_website_domain is not null
    and coalesce((v_website_facts->>'email_domain_cache_allowed')::boolean, false)
    and v_has_matching_evidence_url;

  if v_verified_company_identity is not true then
    return false;
  end if;

  v_email_matches_website :=
    coalesce((v_email_facts->>'email_domain_cache_allowed')::boolean, false)
    and (
      v_email_domain = v_website_domain
      or right(v_email_domain, length(v_website_domain) + 1) = '.' || v_website_domain
      or right(v_website_domain, length(v_email_domain) + 1) = '.' || v_email_domain
    );

  v_summary := jsonb_build_object(
    'request_id', p_request_id,
    'firmographic', coalesce(p_firmographic_json, '{}'::jsonb),
    'taxonomy_version', v_taxonomy_version,
    'classifier_version', p_classifier_version,
    'prompt_version', v_prompt_version,
    'model', p_model,
    'classifier_segment', coalesce(v_effective_segment, p_classifier_json->>'segment'),
    'classifier_confidence', p_classifier_json->>'confidence',
    'effective_status', p_effective_status,
    'policy_mode', p_policy_mode,
    'evidence_grade', p_evidence_grade,
    'verified_company_identity', true,
    'evidence_website_domain_verified', true,
    'evidence_contract_valid', case when v_taxonomy_version is null then null else v_cx8_contract_valid end,
    'required_evidence_code', v_required_evidence_code,
    'validated_evidence_count', v_cache_evidence_count,
    'validated_evidence_uses', coalesce(
      (
        select to_jsonb(array_agg(uses.used_for order by uses.used_for))
        from (
          select distinct evidence.item->>'used_for' as used_for
          from jsonb_array_elements(v_cache_evidence_json) evidence(item)
          where nullif(evidence.item->>'used_for', '') is not null
        ) uses
      ),
      '[]'::jsonb
    ),
    'cached_from', 'request_segmentation_classification',
    'cached_at', now()
  );

  if v_email_matches_website then
    insert into public.segment_research_cache (
      cache_key, lookup_type, lookup_value, provider, status, evidence_json,
      summary_json, fetched_at, expires_at
    ) values (
      public.neontrip_segment_research_cache_key('email_domain', v_email_domain),
      'email_domain', v_email_domain, 'openai_web_search', 'ok',
      v_cache_evidence_json, v_summary, now(), now() + interval '30 days'
    )
    on conflict (cache_key) do update set
      provider = excluded.provider,
      status = excluded.status,
      evidence_json = excluded.evidence_json,
      summary_json = excluded.summary_json,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at;
    v_written := true;
  end if;

  insert into public.segment_research_cache (
    cache_key, lookup_type, lookup_value, provider, status, evidence_json,
    summary_json, fetched_at, expires_at
  ) values (
    public.neontrip_segment_research_cache_key('domain', v_website_domain),
    'domain', v_website_domain, 'openai_web_search', 'ok',
    v_cache_evidence_json, v_summary, now(), now() + interval '30 days'
  )
  on conflict (cache_key) do update set
    provider = excluded.provider,
    status = excluded.status,
    evidence_json = excluded.evidence_json,
    summary_json = excluded.summary_json,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at;
  v_written := true;

  insert into public.segment_research_cache (
    cache_key, lookup_type, lookup_value, provider, status, evidence_json,
    summary_json, fetched_at, expires_at
  ) values (
    public.neontrip_segment_research_cache_key('company_name', v_customer_company),
    'company_name', regexp_replace(lower(v_customer_company), '\s+', ' ', 'g'),
    'openai_web_search', 'ok', v_cache_evidence_json,
    v_summary, now(), now() + interval '30 days'
  )
  on conflict (cache_key) do update set
    provider = excluded.provider,
    status = excluded.status,
    evidence_json = excluded.evidence_json,
    summary_json = excluded.summary_json,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at;
  v_written := true;

  return v_written;
end;
$function$;

comment on function public.neontrip_upsert_segment_research_cache_from_classification(
  uuid, text, text, text, jsonb, jsonb, jsonb, text, text
) is
  'Preserves the Phase-1 cache contract, but under CX8 persists only external evidence bound to the exact active taxonomy/classifier/prompt and canonical segment evidence code/use.';

revoke all on function public.neontrip_upsert_segment_research_cache_from_classification(
  uuid, text, text, text, jsonb, jsonb, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.neontrip_upsert_segment_research_cache_from_classification(
  uuid, text, text, text, jsonb, jsonb, jsonb, text, text
) to service_role;

create or replace function public.neontrip_get_request_segmentation_payload(p_job_id uuid)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  with job as (
    select j.*
    from public.request_segmentation_jobs j
    where j.id = p_job_id
  ),
  active_policy as (
    select p.*
    from public.segment_policy_versions p
    where p.active
    order by p.created_at desc
    limit 1
  ),
  contract_check as (
    select
      case
        when p.taxonomy_version is null then j.taxonomy_version is null
        else j.taxonomy_version = p.taxonomy_version
          and j.classifier_version = p.classifier_version
          and j.prompt_version = p.prompt_version
      end as valid
    from job j
    cross join active_policy p
  ),
  req as (
    select mr.*
    from public.master_requests mr
    join job j on j.request_id = mr.id
  ),
  customer as (
    select mc.*
    from public.master_customers mc
    join req r on r.customer_id = mc.id
  ),
  lookup_context as (
    select
      nullif(trim(coalesce(c.company_name, c.company, '')), '') as company_name,
      nullif(split_part(lower(coalesce(c.email, '')), '@', 2), '') as email_domain
    from customer c
  ),
  domain_facts as (
    select public.neontrip_request_segmentation_domain_facts(lc.email_domain) as facts
    from lookup_context lc
  ),
  research_cache as (
    select jsonb_agg(
      jsonb_build_object(
        'cache_key', src.cache_key,
        'lookup_type', src.lookup_type,
        'lookup_value', src.lookup_value,
        'provider', src.provider,
        'status', src.status,
        'evidence_json', src.evidence_json,
        'summary_json', src.summary_json,
        'fetched_at', src.fetched_at,
        'expires_at', src.expires_at
      ) order by src.lookup_type, src.fetched_at desc
    ) as items
    from public.segment_research_cache src
    join lookup_context lc on true
    join domain_facts df on true
    cross join active_policy ap
    where src.status = 'ok'
      and src.expires_at > now()
      and src.summary_json->>'effective_status' = 'accepted'
      and src.summary_json->>'verified_company_identity' = 'true'
      and src.summary_json->>'evidence_website_domain_verified' = 'true'
      and (
        ap.taxonomy_version is null
        or (
          src.summary_json->>'taxonomy_version' = ap.taxonomy_version
          and src.summary_json->>'classifier_version' = ap.classifier_version
          and src.summary_json->>'prompt_version' = ap.prompt_version
          and src.summary_json->>'evidence_contract_valid' = 'true'
          and nullif(btrim(src.summary_json->>'required_evidence_code'), '') is not null
          and jsonb_typeof(src.evidence_json) = 'array'
          and jsonb_array_length(src.evidence_json) > 0
          and exists (
            select 1
            from public.segment_taxonomy_definitions cached_definition
            where cached_definition.taxonomy_version = ap.taxonomy_version
              and cached_definition.segment = src.summary_json->>'classifier_segment'
              and cached_definition.required_evidence_code = src.summary_json->>'required_evidence_code'
              and cached_definition.active
              and cached_definition.segment in ('NT-10', 'NT-1', 'NT-3', 'NT-4', 'NT-5', 'NT-6', 'NT-9')
              and not exists (
                select 1
                from jsonb_array_elements(
                  case
                    when jsonb_typeof(src.evidence_json) = 'array' then src.evidence_json
                    else '[]'::jsonb
                  end
                ) cached_evidence(item)
                where jsonb_typeof(cached_evidence.item) <> 'object'
                   or not (cached_evidence.item ?& array['type', 'url', 'used_for', 'evidence_code'])
                   or cached_evidence.item->>'type' not in ('web_search', 'research_cache')
                   or cached_evidence.item->>'evidence_code' <> cached_definition.required_evidence_code
                   or cached_evidence.item->>'used_for' not in (
                     case when cached_definition.segment = 'NT-10' then 'institution_status' else 'segment_role' end,
                     case when cached_definition.segment in ('NT-5', 'NT-6') then 'organization_scale' else null end
                   )
                   or coalesce(cached_evidence.item->>'url', '') !~* '^https?://'
                   or not coalesce(
                     ((public.neontrip_request_segmentation_domain_facts(cached_evidence.item->>'url'))->>'is_valid_dns_host')::boolean,
                     false
                   )
              )
              and exists (
                select 1
                from jsonb_array_elements(
                  case
                    when jsonb_typeof(src.evidence_json) = 'array' then src.evidence_json
                    else '[]'::jsonb
                  end
                ) cached_role(item)
                where cached_role.item->>'evidence_code' = cached_definition.required_evidence_code
                  and cached_role.item->>'used_for' = case
                    when cached_definition.segment = 'NT-10' then 'institution_status'
                    else 'segment_role'
                  end
              )
              and (
                cached_definition.segment not in ('NT-5', 'NT-6')
                or exists (
                  select 1
                  from jsonb_array_elements(
                    case
                      when jsonb_typeof(src.evidence_json) = 'array' then src.evidence_json
                      else '[]'::jsonb
                    end
                  ) cached_scale(item)
                  where cached_scale.item->>'evidence_code' = cached_definition.required_evidence_code
                    and cached_scale.item->>'used_for' = 'organization_scale'
                )
              )
          )
        )
      )
      and (
        (
          lc.company_name is not null
          and src.cache_key = public.neontrip_segment_research_cache_key('company_name', lc.company_name)
        )
        or (
          coalesce((df.facts->>'email_domain_cache_allowed')::boolean, false)
          and src.cache_key in (
            public.neontrip_segment_research_cache_key('email_domain', lc.email_domain),
            public.neontrip_segment_research_cache_key('domain', lc.email_domain)
          )
        )
      )
  ),
  related_history_rows as (
    select mr.*
    from public.master_requests mr
    join customer c on mr.customer_id = c.id
    where mr.id <> (select id from req)
    order by mr.created_at desc, mr.id
    limit 10
  ),
  related_history as (
    select jsonb_agg(
      case
        when ap.taxonomy_version is null then
          jsonb_build_object(
            'id', mr.id,
            'request_id', mr.request_id,
            'title', mr.title,
            'description', left(coalesce(mr.description, ''), 1000),
            'segment', mr.segment,
            's_kategorie', mr.s_kategorie,
            'status', mr.status,
            'estimated_value', mr.estimated_value,
            'final_value', mr.final_value,
            'created_at', mr.created_at
          )
        else
          jsonb_build_object(
            'id', mr.id,
            'request_id', mr.request_id,
            'title', mr.title,
            'description', left(coalesce(mr.description, ''), 1000),
            'status', mr.status,
            'created_at', mr.created_at
          )
      end
      order by mr.created_at desc
    ) as items
    from related_history_rows mr
    cross join active_policy ap
  ),
  definitions as (
    select jsonb_agg(
      case
        when ap.taxonomy_version is null then
          jsonb_build_object(
            'segment', sd.segment,
            'label', sd.label,
            'default_s_kategorie', sd.default_s_kategorie,
            'description', sd.description,
            'positive_signals', sd.positive_signals,
            'negative_signals', sd.negative_signals,
            'review_threshold', sd.review_threshold
          )
        else
          jsonb_build_object(
            'segment', td.segment,
            'label', td.label,
            'default_s_kategorie', td.default_s_kategorie,
            'description', td.description,
            'inclusion_criteria', td.inclusion_criteria,
            'required_evidence', td.required_evidence,
            'required_evidence_code', td.required_evidence_code,
            'exclusion_criteria', td.exclusion_criteria,
            'tie_breaker', td.tie_breaker,
            'priority', td.priority,
            'review_threshold', td.review_threshold
          )
      end
      order by coalesce(td.priority, 0) desc, coalesce(td.segment, sd.segment)
    ) as items
    from active_policy ap
    left join public.segment_definitions sd
      on ap.taxonomy_version is null and sd.active
    left join public.segment_taxonomy_definitions td
      on ap.taxonomy_version is not null
      and td.taxonomy_version = ap.taxonomy_version
      and td.active
  ),
  contexts as (
    select jsonb_agg(
      jsonb_build_object(
        'context_tag', cd.context_tag,
        'label', cd.label,
        'description', cd.description
      ) order by cd.context_tag
    ) as items
    from active_policy ap
    join public.segment_context_definitions cd
      on cd.taxonomy_version = ap.taxonomy_version and cd.active
  ),
  policy_rules as (
    select jsonb_agg(
      case
        when ap.taxonomy_version is null then
          jsonb_build_object(
            'segment', r.segment,
            's_kategorie', r.s_kategorie,
            'min_confidence', r.min_confidence,
            'price_factor', r.price_factor,
            'max_followups', r.max_followups,
            'first_call_after_minutes', r.first_call_after_minutes,
            'sales_priority', r.sales_priority,
            'needs_human_review', r.needs_human_review,
            'automation_enabled', r.automation_enabled
          )
        else
          jsonb_build_object(
            'segment', r.segment,
            's_kategorie', r.s_kategorie,
            'min_confidence', r.min_confidence,
            'needs_human_review', r.needs_human_review,
            'automation_enabled', r.automation_enabled
          )
      end order by r.segment
    ) as rules
    from active_policy ap
    join public.segment_policy_rules r on r.policy_version = ap.version
  ),
  taxonomy as (
    select tv.*
    from active_policy ap
    join public.segment_taxonomy_versions tv on tv.version = ap.taxonomy_version
  ),
  quality_gate as (
    select q.*
    from active_policy ap
    join public.segment_quality_gate_versions q on q.version = ap.quality_gate_version
  )
  select case
    when not exists (select 1 from job) then
      jsonb_build_object(
        'job', null,
        'payload_error', jsonb_build_object(
          'code', 'segmentation_job_not_found',
          'message', 'Request segmentation job was not found for the supplied job id.',
          'job_id', p_job_id
        )
      )
    when not exists (select 1 from active_policy) then
      jsonb_build_object(
        'job', (select to_jsonb(job) from job),
        'payload_error', jsonb_build_object(
          'code', 'active_segmentation_contract_missing',
          'message', 'No active request segmentation policy exists.'
        )
      )
    when not coalesce((select valid from contract_check), false) then
      jsonb_build_object(
        'job', (select to_jsonb(job) from job),
        'payload_error', jsonb_build_object(
          'code', 'segmentation_job_contract_mismatch',
          'message', 'Job taxonomy, classifier, or prompt does not match the active contract.',
          'active_policy_version', (select version from active_policy)
        )
      )
    when not exists (select 1 from req) then
      jsonb_build_object(
        'job', (select to_jsonb(job) from job),
        'payload_error', jsonb_build_object(
          'code', 'segmentation_request_not_found',
          'message', 'Request segmentation job has no matching master_requests row.',
          'job_id', p_job_id
        )
      )
    when not exists (select 1 from customer) then
      jsonb_build_object(
        'job', (select to_jsonb(job) from job),
        'request', (select to_jsonb(req) from req),
        'payload_error', jsonb_build_object(
          'code', 'segmentation_customer_not_found',
          'message', 'Request segmentation payload has no matching master_customers row.',
          'job_id', p_job_id
        )
      )
    else
      jsonb_build_object(
        'contract', jsonb_build_object(
          'taxonomy_version', (select taxonomy_version from active_policy),
          'policy_version', (select version from active_policy),
          'policy_mode', (select mode from active_policy),
          'classifier_version', (select classifier_version from active_policy),
          'prompt_version', (select prompt_version from active_policy),
          'quality_gate_version', (select quality_gate_version from active_policy),
          'decision_unit', coalesce((select decision_unit from taxonomy), 'requesting_or_contracting_entity'),
          'default_outcome', coalesce((select default_outcome from taxonomy), 'needs_review'),
          'fallback_segment', null,
          'shadow_only', (select mode = 'shadow' from active_policy)
        ),
        'job', (select to_jsonb(job) from job),
        'request', case
          when (select taxonomy_version from active_policy) is null then
            (select to_jsonb(req) from req)
          else (
            select to_jsonb(req)
              - 'segment'
              - 's_kategorie'
              - 'segment_status'
              - 'segment_confidence'
              - 'segment_source'
              - 'segment_classified_at'
              - 'segment_policy_version'
              - 'segment_taxonomy_version'
              - 'segment_context_tags'
              - 'segment_organization_scale'
              - 'commercial_playbook'
            from req
          )
        end,
        'customer', coalesce((select to_jsonb(customer) from customer), '{}'::jsonb),
        'domain_facts', coalesce(
          (select facts from domain_facts),
          jsonb_build_object(
            'email_domain', null,
            'is_valid_dns_host', false,
            'is_freemail', false,
            'is_shared_provider', false,
            'email_domain_cache_allowed', false
          )
        ),
        'research_cache', coalesce((select items from research_cache), '[]'::jsonb),
        'related_history', coalesce((select items from related_history), '[]'::jsonb),
        'taxonomy', case
          when (select taxonomy_version from active_policy) is null then null
          else jsonb_build_object(
            'version', (select version from taxonomy),
            'lifecycle_status', (select lifecycle_status from taxonomy),
            'decision_unit', (select decision_unit from taxonomy),
            'default_outcome', (select default_outcome from taxonomy),
            'definitions', coalesce((select items from definitions), '[]'::jsonb),
            'tie_break_order', coalesce(
              (select jsonb_agg(d.segment order by d.priority desc, d.segment)
               from public.segment_taxonomy_definitions d
               where d.taxonomy_version = (select taxonomy_version from active_policy)
                 and d.active),
              '[]'::jsonb
            )
          )
        end,
        'segment_definitions', coalesce((select items from definitions), '[]'::jsonb),
        'context_definitions', coalesce((select items from contexts), '[]'::jsonb),
        'organization_scale_values', case
          when (select taxonomy_version from active_policy) is null then '[]'::jsonb
          else '["solo","micro","small","medium","large","enterprise"]'::jsonb
        end,
        'quality_gate', case
          when not exists (select 1 from quality_gate) then null
          else jsonb_build_object(
            'version', (select version from quality_gate),
            'min_unique_gold_total', (select min_unique_gold_total from quality_gate),
            'min_gold_per_segment', (select min_gold_per_segment from quality_gate),
            'min_precision_per_predicted_class', (select min_precision_per_predicted_class from quality_gate),
            'min_recall_per_actual_class', (select min_recall_per_actual_class from quality_gate),
            'min_accepted_coverage', (select min_accepted_coverage from quality_gate),
            'critical_segments', (select critical_segments from quality_gate),
            'min_critical_precision', (select min_critical_precision from quality_gate),
            'required_mapping_integrity', (select required_mapping_integrity from quality_gate),
            'max_provenance_violations', (select max_provenance_violations from quality_gate),
            'manual_activation_required', (select manual_activation_required from quality_gate)
          )
        end,
        'active_policy', jsonb_build_object(
          'version', (select version from active_policy),
          'mode', (select mode from active_policy),
          'taxonomy_version', (select taxonomy_version from active_policy),
          'classifier_version', (select classifier_version from active_policy),
          'prompt_version', (select prompt_version from active_policy),
          'rules', coalesce((select rules from policy_rules), '[]'::jsonb)
        )
      )
  end;
$function$;

comment on function public.neontrip_get_request_segmentation_payload(uuid) is
  'Returns the active versioned contract. Before the held v2 activation it preserves the Phase-1 definition/policy shape; CX8 removes legacy segment hints and commercial fields from model context.';

revoke all on function public.neontrip_get_request_segmentation_payload(uuid)
  from public, anon, authenticated;
grant execute on function public.neontrip_get_request_segmentation_payload(uuid)
  to service_role;

create or replace function public.neontrip_set_manual_request_segment(
  p_request_id uuid,
  p_segment text,
  p_source text default 'manual_ops_portal',
  p_actor jsonb default '{}'::jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request public.master_requests%rowtype;
  v_active_policy public.segment_policy_versions%rowtype;
  v_cx8_taxonomy constant text := 'nt_taxonomy_v2_20260819_cx8';
  v_requested_taxonomy text;
  v_target_taxonomy text;
  v_is_cx8 boolean := false;
  v_segment text := upper(trim(coalesce(p_segment, '')));
  v_source text := lower(trim(coalesce(p_source, '')));
  v_s_kategorie text;
  v_label text;
  v_now timestamptz := now();
  v_audit_id uuid;
  v_previous jsonb;
begin
  if v_source !~ '^manual_[a-z0-9_]+$' then
    raise exception 'invalid_manual_segment_source: %', p_source;
  end if;

  if jsonb_typeof(coalesce(p_actor, '{}'::jsonb)) <> 'object' then
    raise exception 'manual_segment_actor_must_be_object';
  end if;

  select * into v_active_policy
  from public.segment_policy_versions
  where active
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'no_active_segment_policy';
  end if;

  v_requested_taxonomy := nullif(btrim(coalesce(p_actor->>'segmentTaxonomyVersion', '')), '');

  if v_requested_taxonomy is null then
    if v_active_policy.taxonomy_version is not null then
      raise exception 'manual_segment_taxonomy_marker_required';
    end if;

    -- Exact Phase-1 lane for the old UI, available only while the unversioned
    -- v1 policy remains active.
    select sd.default_s_kategorie, sd.label
    into v_s_kategorie, v_label
    from public.segment_definitions sd
    where sd.segment = v_segment
      and sd.active
    limit 1;

    if not found then
      raise exception 'invalid_segment: %', p_segment;
    end if;

    v_target_taxonomy := null;
    v_is_cx8 := false;
  elsif v_requested_taxonomy = v_cx8_taxonomy then
    select d.default_s_kategorie, d.label
    into v_s_kategorie, v_label
    from public.segment_taxonomy_definitions d
    where d.taxonomy_version = v_cx8_taxonomy
      and d.segment = v_segment
      and d.active
    limit 1;

    if not found then
      raise exception 'invalid_cx8_segment: %', p_segment;
    end if;

    v_target_taxonomy := v_cx8_taxonomy;
    v_is_cx8 := true;
  else
    raise exception 'unsupported_manual_segment_taxonomy: %', v_requested_taxonomy;
  end if;

  select * into v_request
  from public.master_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found: %', p_request_id;
  end if;

  if not v_is_cx8
     and v_request.segment_taxonomy_version = v_cx8_taxonomy then
    raise exception 'legacy_manual_cannot_overwrite_cx8_authority';
  end if;

  if v_source = 'manual_ops_import'
     and lower(btrim(coalesce(v_request.segment_source, ''))) ~ '^manual_[a-z0-9_]+$' then
    raise exception using
      errcode = 'P0001',
      message = 'manual_ops_import_existing_manual_authority',
      detail = 'manual_ops_import cannot overwrite an existing manual_* segment authority';
  end if;

  v_previous := jsonb_build_object(
    'segment', v_request.segment,
    's_kategorie', v_request.s_kategorie,
    'segment_status', v_request.segment_status,
    'segment_confidence', v_request.segment_confidence,
    'segment_source', v_request.segment_source,
    'segment_classified_at', v_request.segment_classified_at,
    'segment_policy_version', v_request.segment_policy_version,
    'segment_taxonomy_version', v_request.segment_taxonomy_version,
    'segment_context_tags', v_request.segment_context_tags,
    'segment_organization_scale', v_request.segment_organization_scale
  );

  update public.master_requests
  set
    segment = v_segment,
    s_kategorie = v_s_kategorie,
    segment_status = 'accepted',
    segment_confidence = null,
    segment_source = v_source,
    segment_classified_at = v_now,
    segment_policy_version = 'manual_override_v1_20260819',
    segment_taxonomy_version = v_target_taxonomy,
    segment_context_tags = '{}',
    segment_organization_scale = null,
    commercial_playbook = '{}'::jsonb,
    updated_at = v_now
  where id = p_request_id;

  insert into public.workflow_audit_log (
    document_id, workflow_name, action, status, metadata
  ) values (
    v_request.request_id,
    'customer_records_console',
    'customer_request_segment_override',
    'success',
    jsonb_build_object(
      'request_id', v_request.request_id,
      'request_uuid', p_request_id,
      'summary', case when v_is_cx8 then 'CX8-Segment' else 'Segment' end
        || ' manuell bestätigt: ' || v_label,
      'reason', nullif(left(trim(coalesce(p_reason, '')), 1000), ''),
      'gold_label_created', false,
      'changed_fields', to_jsonb(array_remove(array[
        'master_requests.segment',
        'master_requests.s_kategorie',
        'master_requests.segment_status',
        'master_requests.segment_confidence',
        'master_requests.segment_source',
        case when v_is_cx8 then 'master_requests.segment_taxonomy_version' else null end,
        case when v_is_cx8 then 'master_requests.segment_context_tags' else null end,
        case when v_is_cx8 then 'master_requests.segment_organization_scale' else null end,
        'master_requests.commercial_playbook'
      ]::text[], null)),
      'actor_label', coalesce(
        nullif(trim(coalesce(p_actor->>'operatorName', '')), ''),
        nullif(trim(coalesce(p_actor->>'mode', '')), ''),
        nullif(trim(coalesce(p_actor->>'host', '')), '')
      ),
      'actor', coalesce(p_actor, '{}'::jsonb),
      'previous_segment', v_previous,
      'next_segment', jsonb_build_object(
        'segment', v_segment,
        'label', v_label,
        's_kategorie', v_s_kategorie,
        'segment_status', 'accepted',
        'segment_confidence', null,
        'segment_source', v_source,
        'segment_classified_at', v_now,
        'segment_policy_version', 'manual_override_v1_20260819',
        'segment_taxonomy_version', v_target_taxonomy,
        'segment_context_tags', jsonb_build_array(),
        'segment_organization_scale', null
      )
    )
  )
  returning id into v_audit_id;

  if not v_is_cx8 then
    return jsonb_build_object(
      'request_id', p_request_id,
      'public_request_id', v_request.request_id,
      'segment', v_segment,
      's_kategorie', v_s_kategorie,
      'segment_status', 'accepted',
      'segment_confidence', null,
      'segment_source', v_source,
      'segment_classified_at', v_now,
      'segment_policy_version', 'manual_override_v1_20260819',
      'authoritative', true,
      'audit_id', v_audit_id
    );
  end if;

  return jsonb_build_object(
    'request_id', p_request_id,
    'public_request_id', v_request.request_id,
    'segment', v_segment,
    's_kategorie', v_s_kategorie,
    'segment_status', 'accepted',
    'segment_confidence', null,
    'segment_source', v_source,
    'segment_classified_at', v_now,
    'segment_policy_version', 'manual_override_v1_20260819',
    'segment_taxonomy_version', v_target_taxonomy,
    'context_tags', '[]'::jsonb,
    'organization_scale', null,
    'authoritative', true,
    'gold_label_created', false,
    'audit_id', v_audit_id
  );
end;
$function$;

comment on function public.neontrip_set_manual_request_segment(uuid, text, text, jsonb, text) is
  'Dual-lane rollout: markerless Phase-1 calls remain legacy only while v1 is active; p_actor.segmentTaxonomyVersion selects exact CX8; after v2 activation markerless calls fail closed. Neither lane creates gold.';

revoke all on function public.neontrip_set_manual_request_segment(uuid, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.neontrip_set_manual_request_segment(uuid, text, text, jsonb, text)
  to service_role;

create or replace function public.neontrip_record_request_segment_classification(
  p_job_id uuid,
  p_request_id uuid,
  p_input_hash text,
  p_status text,
  p_segment text,
  p_confidence numeric,
  p_evidence_grade text,
  p_reasoning_short text,
  p_reason_codes text[],
  p_evidence_json jsonb,
  p_firmographic_json jsonb,
  p_classifier_json jsonb,
  p_risk_flags text[],
  p_model text,
  p_model_version text,
  p_prompt_version text,
  p_classifier_version text,
  p_accepted_by text default 'n8n-request-segmenter'::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_active_policy public.segment_policy_versions%rowtype;
  v_policy_rule public.segment_policy_rules%rowtype;
  v_job public.request_segmentation_jobs%rowtype;
  v_request public.master_requests%rowtype;
  v_policy_found boolean := false;
  v_definition_found boolean := false;
  v_is_versioned boolean := false;
  v_job_identity_valid boolean := false;
  v_contract_match boolean := false;
  v_current_input_hash text;
  v_input_hash_current boolean := false;
  v_effective_status text;
  v_effective_segment text;
  v_effective_risk_flags text[] := '{}';
  v_classifier_risk_flags text[] := '{}';
  v_effective_classifier_json jsonb;
  v_classification_id uuid;
  v_context_tags text[] := '{}';
  v_context_shape_valid boolean := false;
  v_context_tags_valid boolean := false;
  v_organization_scale text;
  v_organization_scale_valid boolean := false;
  v_provenance jsonb;
  v_verified_sources jsonb := '[]'::jsonb;
  v_verified_source_count integer := 0;
  v_verified_source_shape_valid boolean := false;
  v_evidence_json_shape_valid boolean := false;
  v_evidence_semantics_shape_valid boolean := false;
  v_all_evidence_urls_verified boolean := false;
  v_request_evidence_used boolean := false;
  v_positive_codes text[] := '{}';
  v_positive_codes_shape_valid boolean := false;
  v_required_positive_code text;
  v_positive_code_top_level boolean := false;
  v_positive_code_source_bound boolean := false;
  v_explicit_private_choice_claimed boolean := false;
  v_explicit_business_choice_claimed boolean := false;
  v_first_party_private_choice_valid boolean := false;
  v_first_party_business_choice_valid boolean := false;
  v_private_declaration_evidence_valid boolean := false;
  v_business_declaration_evidence_valid boolean := false;
  v_organization_scale_evidence_valid boolean := false;
  v_positive_evidence_valid boolean := false;
  v_evidence_provenance_valid boolean := false;
  v_mapping_integrity boolean := false;
  v_research_required boolean := false;
  v_has_external_url boolean := false;
  v_research_cache_written boolean := false;
  v_evaluation_only boolean := false;
  v_master_projection_authorized boolean := false;
  v_manual_authoritative boolean := false;
  v_existing_authoritative boolean := false;
  v_projection_applied boolean := false;
  v_projection_reason text;
  v_job_status text;
begin
  if p_status not in ('accepted', 'needs_review', 'rejected', 'error', 'shadow') then
    raise exception 'invalid_status: %', p_status;
  end if;

  if p_segment is not null and p_segment !~ '^NT-(1[0-8]|[1-9])$' then
    raise exception 'invalid_segment: %', p_segment;
  end if;

  if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
    raise exception 'invalid_confidence: %', p_confidence;
  end if;

  if nullif(trim(coalesce(p_input_hash, '')), '') is null then
    raise exception 'input_hash_required';
  end if;

  if nullif(trim(coalesce(p_prompt_version, '')), '') is null then
    raise exception 'prompt_version_required';
  end if;

  if nullif(trim(coalesce(p_classifier_version, '')), '') is null then
    raise exception 'classifier_version_required';
  end if;

  select * into v_request
  from public.master_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request_not_found: %', p_request_id;
  end if;

  perform 1
  from public.master_customers
  where id = v_request.customer_id
  for share;

  if p_job_id is not null then
    select * into v_job
    from public.request_segmentation_jobs j
    where j.id = p_job_id
    for update;

    v_job_identity_valid := found
      and v_job.request_id = p_request_id
      and v_job.input_hash = p_input_hash;

    if not v_job_identity_valid then
      raise exception 'segmentation_job_request_or_hash_mismatch: %', p_job_id;
    end if;
  end if;

  select * into v_active_policy
  from public.segment_policy_versions p
  where p.active
  order by p.created_at desc
  limit 1
  for share;

  if not found then
    raise exception 'no_active_segment_policy';
  end if;

  v_is_versioned := v_active_policy.taxonomy_version is not null;
  v_effective_classifier_json := coalesce(p_classifier_json, '{}'::jsonb);
  v_evaluation_only := case
    when p_job_id is null then false
    else lower(coalesce(v_job.metadata->>'evaluation_only', 'false')) = 'true'
  end;
  v_master_projection_authorized := case
    when not v_is_versioned then true
    when p_job_id is null then false
    else lower(coalesce(v_job.metadata->>'master_projection_authorized', 'false')) = 'true'
  end;

  -- A claimed job never changes semantic lane merely because the active policy
  -- flipped while n8n was processing it. Contract drift is a technical job
  -- failure and must not create a classification, cache entry, or master write.
  v_contract_match := case
    when p_job_id is null then not v_is_versioned
    when not v_is_versioned then
      v_job.taxonomy_version is null
      and v_job.classifier_version is null
      and v_job.prompt_version is null
    else
      v_job.taxonomy_version = v_active_policy.taxonomy_version
      and v_job.classifier_version = v_active_policy.classifier_version
      and v_job.prompt_version = v_active_policy.prompt_version
      and p_classifier_version = v_active_policy.classifier_version
      and p_prompt_version = v_active_policy.prompt_version
      and p_accepted_by = 'n8n-request-segmenter-v3'
      and jsonb_typeof(v_effective_classifier_json) = 'object'
      and v_effective_classifier_json->>'taxonomy_version' = v_active_policy.taxonomy_version
  end;

  if not v_contract_match then
    if p_job_id is not null then
      update public.request_segmentation_jobs
      set
        status = 'failed',
        completed_at = null,
        last_error_code = 'segmentation_job_active_contract_mismatch',
        last_error_message = 'Claimed job contract no longer matches the active segmentation policy contract.',
        updated_at = now(),
        lock_owner = null,
        locked_at = null
      where id = p_job_id;
    end if;

    return jsonb_build_object(
      'classification_id', null,
      'job_id', p_job_id,
      'request_id', p_request_id,
      'submitted_status', p_status,
      'proposed_segment', p_segment,
      'effective_status', 'error',
      'effective_segment', null,
      'policy_version', v_active_policy.version,
      'policy_mode', v_active_policy.mode,
      'taxonomy_version', v_active_policy.taxonomy_version,
      'classifier_version', p_classifier_version,
      'prompt_version', p_prompt_version,
      'job_status', 'failed',
      'input_hash_current', null,
      'contract_match', false,
      'error_code', 'segmentation_job_active_contract_mismatch',
      'research_cache_written', false,
      'projection', jsonb_build_object(
        'applied', false,
        'reason', 'active_contract_mismatch_no_classification',
        'authoritative_segment', v_request.segment,
        'authoritative_s_kategorie', v_request.s_kategorie,
        'authoritative_status', v_request.segment_status,
        'authoritative_source', v_request.segment_source,
        'authoritative_taxonomy_version', v_request.segment_taxonomy_version,
        'manual_authoritative_preserved', false
      )
    );
  end if;

  select public.neontrip_compute_request_segment_input_hash(p_request_id)
  into v_current_input_hash;
  v_input_hash_current := v_current_input_hash is not distinct from p_input_hash;

  if p_segment is not null then
    select * into v_policy_rule
    from public.segment_policy_rules r
    where r.policy_version = v_active_policy.version
      and r.segment = p_segment
      and (
        not v_is_versioned
        or r.taxonomy_version = v_active_policy.taxonomy_version
      )
    limit 1;
    v_policy_found := found;
  end if;

  if v_is_versioned and p_segment is not null then
    select d.required_evidence_code
    into v_required_positive_code
    from public.segment_taxonomy_definitions d
    where d.taxonomy_version = v_active_policy.taxonomy_version
      and d.segment = p_segment
      and d.active
    limit 1;
    v_definition_found := found;
  else
    v_definition_found := v_policy_found;
  end if;

  select coalesce(array_agg(flag), '{}'::text[])
  into v_classifier_risk_flags
  from jsonb_array_elements_text(
    case
      when jsonb_typeof(v_effective_classifier_json->'risk_flags') = 'array'
        then v_effective_classifier_json->'risk_flags'
      else '[]'::jsonb
    end
  ) as classifier_flags(flag);

  select coalesce(
    array_agg(distinct lower(trim(flag)) order by lower(trim(flag))),
    '{}'::text[]
  )
  into v_effective_risk_flags
  from unnest(coalesce(p_risk_flags, '{}'::text[]) || v_classifier_risk_flags) as flags(flag)
  where nullif(trim(flag), '') is not null;

  v_context_shape_valid :=
    jsonb_typeof(v_effective_classifier_json->'context_tags') = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(
        case
          when jsonb_typeof(v_effective_classifier_json->'context_tags') = 'array'
            then v_effective_classifier_json->'context_tags'
          else '[]'::jsonb
        end
      ) context_value(item)
      where jsonb_typeof(context_value.item) <> 'string'
         or nullif(btrim(context_value.item #>> '{}'), '') is null
    );
  if v_context_shape_valid then
    select coalesce(array_agg(distinct tag order by tag), '{}'::text[])
    into v_context_tags
    from jsonb_array_elements_text(v_effective_classifier_json->'context_tags') tags(tag)
    where nullif(btrim(tag), '') is not null;
  end if;

  if v_is_versioned and v_context_shape_valid then
    select not exists (
      select 1
      from unnest(v_context_tags) tags(tag)
      where not exists (
        select 1
        from public.segment_context_definitions cd
        where cd.taxonomy_version = v_active_policy.taxonomy_version
          and cd.context_tag = tags.tag
          and cd.active
      )
    ) into v_context_tags_valid;
  else
    v_context_tags_valid := not v_is_versioned;
  end if;

  v_organization_scale := case
    when jsonb_typeof(v_effective_classifier_json->'organization_scale') = 'string'
      then btrim(v_effective_classifier_json->>'organization_scale')
    else null
  end;
  v_organization_scale_valid := case
    when not v_is_versioned then true
    when not (v_effective_classifier_json ? 'organization_scale') then false
    when jsonb_typeof(v_effective_classifier_json->'organization_scale') = 'null' then true
    when jsonb_typeof(v_effective_classifier_json->'organization_scale') = 'string'
      then v_organization_scale in ('solo', 'micro', 'small', 'medium', 'large', 'enterprise')
    else false
  end;

  v_provenance := coalesce(v_effective_classifier_json->'evidence_provenance', '{}'::jsonb);
  if jsonb_typeof(v_provenance->'verified_sources') = 'array' then
    v_verified_sources := v_provenance->'verified_sources';
  end if;

  v_positive_codes_shape_valid :=
    jsonb_typeof(v_provenance->'validated_positive_evidence_codes') = 'array';
  if v_positive_codes_shape_valid then
    select coalesce(array_agg(distinct code order by code), '{}'::text[])
    into v_positive_codes
    from jsonb_array_elements_text(v_provenance->'validated_positive_evidence_codes') codes(code)
    where code in (
      'verified_public_or_institutional_entity',
      'verified_physical_project_supplier',
      'verified_client_project_intermediary',
      'verified_event_or_media_operator',
      'verified_multisite_or_franchise',
      'verified_enterprise',
      'explicit_private_use',
      'verified_direct_business'
    );

    v_positive_codes_shape_valid := not exists (
      select 1
      from jsonb_array_elements_text(v_provenance->'validated_positive_evidence_codes') codes(code)
      where code is null
         or code not in (
        'verified_public_or_institutional_entity',
        'verified_physical_project_supplier',
        'verified_client_project_intermediary',
        'verified_event_or_media_operator',
        'verified_multisite_or_franchise',
        'verified_enterprise',
        'explicit_private_use',
        'verified_direct_business'
      )
    );
  end if;

  v_positive_code_top_level := v_required_positive_code is not null
    and v_required_positive_code = any(v_positive_codes);
  v_explicit_private_choice_claimed := case
    when jsonb_typeof(v_provenance->'explicit_private_choice_verified') = 'boolean'
      then (v_provenance->>'explicit_private_choice_verified')::boolean
    else false
  end;
  v_explicit_business_choice_claimed := case
    when jsonb_typeof(v_provenance->'explicit_business_choice_verified') = 'boolean'
      then (v_provenance->>'explicit_business_choice_verified')::boolean
    else false
  end;
  v_first_party_private_choice_valid :=
    lower(btrim(coalesce(v_request.customer_type, ''))) = 'privat';
  v_first_party_business_choice_valid :=
    lower(btrim(coalesce(v_request.customer_type, ''))) in ('gewerblich', 'b2b');

  select
    count(*)::integer,
    coalesce(bool_and(
      jsonb_typeof(item) = 'object'
      and item ?& array['url', 'source_type', 'source_ref', 'validated_positive_evidence_codes']
      and jsonb_typeof(item->'url') = 'string'
      and jsonb_typeof(item->'source_type') = 'string'
      and jsonb_typeof(item->'source_ref') = 'string'
      and coalesce(item->>'url', '') ~* '^https?://'
      and coalesce(
        ((public.neontrip_request_segmentation_domain_facts(item->>'url'))->>'is_valid_dns_host')::boolean,
        false
      )
      and item->>'source_type' in ('web_search_call', 'verified_db_cache')
      and nullif(btrim(coalesce(item->>'source_ref', '')), '') is not null
      and jsonb_typeof(item->'validated_positive_evidence_codes') = 'array'
    ), true)
  into v_verified_source_count, v_verified_source_shape_valid
  from jsonb_array_elements(v_verified_sources) sources(item);

  v_verified_source_shape_valid := v_verified_source_shape_valid and not exists (
    select 1
    from jsonb_array_elements(v_verified_sources) source(item)
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(source.item->'validated_positive_evidence_codes') = 'array'
          then source.item->'validated_positive_evidence_codes'
        else '[]'::jsonb
      end
    ) source_code(code)
    where source_code.code is null
       or source_code.code not in (
      'verified_public_or_institutional_entity',
      'verified_physical_project_supplier',
      'verified_client_project_intermediary',
      'verified_event_or_media_operator',
      'verified_multisite_or_franchise',
      'verified_enterprise',
      'explicit_private_use',
      'verified_direct_business'
    )
  );

  v_evidence_json_shape_valid :=
    jsonb_typeof(coalesce(p_evidence_json, '[]'::jsonb)) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(
        case
          when jsonb_typeof(coalesce(p_evidence_json, '[]'::jsonb)) = 'array'
            then coalesce(p_evidence_json, '[]'::jsonb)
          else '[]'::jsonb
        end
      ) evidence(item)
      where jsonb_typeof(evidence.item) <> 'object'
    );
  v_evidence_semantics_shape_valid := v_evidence_json_shape_valid and not exists (
    select 1
    from jsonb_array_elements(
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end
    ) evidence(item)
    where not (evidence.item ?& array['type', 'url', 'used_for', 'evidence_code'])
       or evidence.item->>'type' not in (
         'request', 'customer_declared', 'related_history', 'web_search', 'research_cache'
       )
       or evidence.item->>'used_for' not in (
         'private_use', 'company_identity', 'segment_role', 'organization_scale',
         'institution_status', 'context_tag', 'conflict'
       )
       or evidence.item->>'evidence_code' not in (
         'verified_public_or_institutional_entity',
         'verified_physical_project_supplier',
         'verified_client_project_intermediary',
         'verified_event_or_media_operator',
         'verified_multisite_or_franchise',
         'verified_enterprise',
         'explicit_private_use',
         'verified_direct_business'
       )
       or jsonb_typeof(evidence.item->'url') not in ('string', 'null')
  );
  v_all_evidence_urls_verified := v_evidence_json_shape_valid and not exists (
    select 1
    from jsonb_array_elements(
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end
    ) evidence(item)
    where nullif(btrim(coalesce(item->>'url', '')), '') is not null
      and (
        coalesce(item->>'url', '') !~* '^https?://'
        or not coalesce(
          ((public.neontrip_request_segmentation_domain_facts(item->>'url'))->>'is_valid_dns_host')::boolean,
          false
        )
        or not exists (
          select 1
          from jsonb_array_elements(v_verified_sources) source(item)
          where source.item->>'url' = evidence.item->>'url'
        )
      )
  );
  v_request_evidence_used := case
    when jsonb_typeof(v_provenance->'request_evidence_used') = 'boolean'
      then (v_provenance->>'request_evidence_used')::boolean
    else false
  end;

  v_positive_code_source_bound := exists (
    select 1
    from jsonb_array_elements(v_verified_sources) source(item)
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(source.item->'validated_positive_evidence_codes') = 'array'
          then source.item->'validated_positive_evidence_codes'
        else '[]'::jsonb
      end
    ) source_code(code)
    join jsonb_array_elements(
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end
    ) evidence(item)
      on evidence.item->>'url' = source.item->>'url'
     and evidence.item->>'evidence_code' = source_code.code
    where source_code.code = v_required_positive_code
      and (
        (source.item->>'source_type' = 'web_search_call' and evidence.item->>'type' = 'web_search')
        or (
          source.item->>'source_type' = 'verified_db_cache'
          and evidence.item->>'type' = 'research_cache'
          and exists (
            select 1
            from public.segment_research_cache cached
            where cached.cache_key = source.item->>'source_ref'
              and cached.status = 'ok'
              and cached.expires_at > now()
              and cached.summary_json->>'taxonomy_version' = v_active_policy.taxonomy_version
              and cached.summary_json->>'classifier_version' = v_active_policy.classifier_version
              and cached.summary_json->>'prompt_version' = v_active_policy.prompt_version
              and cached.summary_json->>'evidence_contract_valid' = 'true'
              and cached.summary_json->>'required_evidence_code' = v_required_positive_code
              and exists (
                select 1
                from jsonb_array_elements(
                  case
                    when jsonb_typeof(cached.evidence_json) = 'array' then cached.evidence_json
                    else '[]'::jsonb
                  end
                ) cached_evidence(item)
                where cached_evidence.item->>'url' = evidence.item->>'url'
                  and cached_evidence.item->>'evidence_code' = evidence.item->>'evidence_code'
                  and cached_evidence.item->>'used_for' = evidence.item->>'used_for'
              )
          )
        )
      )
      and case
        when p_segment = 'NT-10' then evidence.item->>'used_for' = 'institution_status'
        when p_segment in ('NT-1', 'NT-4', 'NT-3', 'NT-5', 'NT-6', 'NT-9')
          then evidence.item->>'used_for' = 'segment_role'
        else false
      end
  );

  v_private_declaration_evidence_valid := exists (
    select 1
    from jsonb_array_elements(
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end
    ) evidence(item)
    where evidence.item->>'type' = 'customer_declared'
      and jsonb_typeof(evidence.item->'url') = 'null'
      and evidence.item->>'used_for' = 'private_use'
      and evidence.item->>'evidence_code' = 'explicit_private_use'
  );

  v_business_declaration_evidence_valid := exists (
    select 1
    from jsonb_array_elements(
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end
    ) evidence(item)
    where evidence.item->>'type' = 'customer_declared'
      and jsonb_typeof(evidence.item->'url') = 'null'
      and evidence.item->>'used_for' = 'segment_role'
      and evidence.item->>'evidence_code' = 'verified_direct_business'
  );

  v_organization_scale_evidence_valid := exists (
    select 1
    from jsonb_array_elements(
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end
    ) evidence(item)
    join jsonb_array_elements(v_verified_sources) source(item)
      on source.item->>'url' = evidence.item->>'url'
    where evidence.item->>'used_for' = 'organization_scale'
      and evidence.item->>'evidence_code' = v_required_positive_code
      and jsonb_typeof(source.item->'validated_positive_evidence_codes') = 'array'
      and exists (
        select 1
        from jsonb_array_elements_text(source.item->'validated_positive_evidence_codes') source_code(code)
        where source_code.code = v_required_positive_code
      )
      and (
        (source.item->>'source_type' = 'web_search_call' and evidence.item->>'type' = 'web_search')
        or (
          source.item->>'source_type' = 'verified_db_cache'
          and evidence.item->>'type' = 'research_cache'
          and exists (
            select 1
            from public.segment_research_cache cached
            where cached.cache_key = source.item->>'source_ref'
              and cached.status = 'ok'
              and cached.expires_at > now()
              and cached.summary_json->>'taxonomy_version' = v_active_policy.taxonomy_version
              and cached.summary_json->>'classifier_version' = v_active_policy.classifier_version
              and cached.summary_json->>'prompt_version' = v_active_policy.prompt_version
              and cached.summary_json->>'evidence_contract_valid' = 'true'
              and cached.summary_json->>'required_evidence_code' = v_required_positive_code
              and exists (
                select 1
                from jsonb_array_elements(
                  case
                    when jsonb_typeof(cached.evidence_json) = 'array' then cached.evidence_json
                    else '[]'::jsonb
                  end
                ) cached_evidence(item)
                where cached_evidence.item->>'url' = evidence.item->>'url'
                  and cached_evidence.item->>'evidence_code' = evidence.item->>'evidence_code'
                  and cached_evidence.item->>'used_for' = evidence.item->>'used_for'
              )
          )
        )
      )
  );

  v_positive_evidence_valid := case
    when not v_is_versioned then true
    when p_segment = 'NT-8' then
      v_positive_codes_shape_valid
      and v_positive_code_top_level
      and v_request_evidence_used
      and v_explicit_private_choice_claimed
      and v_first_party_private_choice_valid
      and v_private_declaration_evidence_valid
    when p_segment = 'NT-9' then
      v_positive_codes_shape_valid
      and v_positive_code_top_level
      and v_positive_code_source_bound
      and v_explicit_business_choice_claimed
      and v_first_party_business_choice_valid
      and v_business_declaration_evidence_valid
    when p_segment in ('NT-5', 'NT-6') then
      v_positive_codes_shape_valid
      and v_positive_code_top_level
      and v_positive_code_source_bound
      and v_organization_scale_evidence_valid
    else
      v_positive_codes_shape_valid
      and v_positive_code_top_level
      and v_positive_code_source_bound
  end;

  v_evidence_provenance_valid := not v_is_versioned or (
    jsonb_typeof(v_provenance) = 'object'
    and v_provenance->>'validator_version' = 'n8n_cx8_validator_v1'
    and jsonb_typeof(v_provenance->'valid') = 'boolean'
    and lower(coalesce(v_provenance->>'valid', 'false')) = 'true'
    and jsonb_typeof(v_provenance->'verified_sources') = 'array'
    and v_verified_source_shape_valid
    and v_evidence_semantics_shape_valid
    and v_all_evidence_urls_verified
    and v_positive_evidence_valid
    and case
      when p_segment = 'NT-8' then v_request_evidence_used and v_first_party_private_choice_valid
      else v_verified_source_count > 0
    end
  );

  v_mapping_integrity := v_policy_found
    and v_definition_found
    and (
      not v_is_versioned
      or exists (
        select 1
        from public.segment_taxonomy_definitions d
        where d.taxonomy_version = v_active_policy.taxonomy_version
          and d.segment = p_segment
          and d.default_s_kategorie = v_policy_rule.s_kategorie
          and d.active
      )
    );

  v_research_required := case
    when v_is_versioned then p_segment is distinct from 'NT-8'
    else lower(coalesce(v_effective_classifier_json #>> '{research_policy,external_research_required}', 'false')) = 'true'
  end;

  select exists (
    select 1
    from jsonb_array_elements(
      case
        when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb)
        else '[]'::jsonb
      end
    ) evidence(item)
    where coalesce(evidence.item->>'url', '') ~* '^https?://'
      and coalesce(
        ((public.neontrip_request_segmentation_domain_facts(evidence.item->>'url'))->>'is_valid_dns_host')::boolean,
        false
      )
  ) into v_has_external_url;

  v_effective_status := p_status;

  if p_status = 'accepted' and not v_input_hash_current then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'stale_input_hash');
  end if;

  if p_status = 'accepted' and v_research_required and not v_has_external_url then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := v_effective_risk_flags
      || array['missing_external_company_evidence', 'external_research_required'];
  end if;

  if p_status = 'accepted' and v_is_versioned and not v_contract_match then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'taxonomy_contract_mismatch');
  end if;

  if p_status = 'accepted' and v_is_versioned and not (v_context_shape_valid and v_context_tags_valid) then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'invalid_context_tags');
  end if;

  if p_status = 'accepted' and v_is_versioned and not v_organization_scale_valid then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'invalid_organization_scale');
  end if;

  if p_status = 'accepted'
     and v_is_versioned
     and p_segment = 'NT-8'
     and v_organization_scale is not null then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'invalid_organization_scale');
  end if;

  if p_status = 'accepted'
     and v_is_versioned
     and (
       (p_segment = 'NT-5' and v_organization_scale is null)
       or (p_segment = 'NT-6' and v_organization_scale is distinct from 'enterprise')
       or (p_segment in ('NT-5', 'NT-6') and not v_organization_scale_evidence_valid)
     ) then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'organization_scale_unverified');
  end if;

  if p_status = 'accepted'
     and v_is_versioned
     and v_first_party_private_choice_valid
     and p_segment is distinct from 'NT-8' then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'conflicting_evidence');
  end if;

  if p_status = 'accepted' and v_is_versioned and not v_evidence_provenance_valid then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'evidence_provenance_unverified');
  end if;

  if p_status = 'accepted' and v_is_versioned and not v_positive_evidence_valid then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'missing_validated_positive_evidence');
  end if;

  if p_status = 'accepted' and not v_mapping_integrity then
    v_effective_status := 'needs_review';
    v_effective_risk_flags := array_append(v_effective_risk_flags, 'segment_mapping_integrity_failed');
  end if;

  if p_status = 'accepted' and (
    p_segment is null
    or p_confidence is null
    or not v_policy_found
    or not v_definition_found
  ) then
    v_effective_status := 'needs_review';
  elsif p_status = 'accepted' and (
    p_confidence < v_policy_rule.min_confidence
    or v_policy_rule.needs_human_review
  ) then
    v_effective_status := 'needs_review';
  end if;

  if p_status = 'accepted' and v_effective_risk_flags && array[
    'conflicting_evidence',
    'ambiguous_segment',
    'insufficient_segment_evidence',
    'invalid_external_evidence',
    'missing_external_company_evidence',
    'prompt_injection_seen',
    'freemail_business_unclear',
    'missing_company_identity',
    'taxonomy_contract_mismatch',
    'invalid_context_tags',
    'invalid_organization_scale',
    'evidence_provenance_unverified',
    'missing_validated_positive_evidence',
    'segment_mapping_integrity_failed',
    'stale_input_hash',
    case when p_segment in ('NT-5', 'NT-6') then 'organization_scale_unverified' else null end,
    case when p_segment = 'NT-10' then 'institution_status_unverified' else null end
  ]::text[] then
    v_effective_status := 'needs_review';
  end if;

  select coalesce(
    array_agg(distinct lower(btrim(flag)) order by lower(btrim(flag))),
    '{}'::text[]
  )
  into v_effective_risk_flags
  from unnest(v_effective_risk_flags) flags(flag)
  where nullif(btrim(flag), '') is not null;

  v_effective_segment := case
    when v_effective_status = 'accepted' then p_segment
    else null
  end;

  v_effective_classifier_json := v_effective_classifier_json || jsonb_build_object(
    'risk_flags', to_jsonb(v_effective_risk_flags),
    'db_validation', case
        when jsonb_typeof(v_effective_classifier_json->'db_validation') = 'object'
          then v_effective_classifier_json->'db_validation'
        else '{}'::jsonb
      end
      || jsonb_build_object(
        'active_policy_version', v_active_policy.version,
        'expected_taxonomy_version', v_active_policy.taxonomy_version,
        'expected_classifier_version', v_active_policy.classifier_version,
        'expected_prompt_version', v_active_policy.prompt_version,
        'contract_match', v_contract_match,
        'input_hash_current', v_input_hash_current,
        'context_tags_valid', v_context_shape_valid and v_context_tags_valid,
        'organization_scale_valid', v_organization_scale_valid,
        'organization_scale_evidence_valid', v_organization_scale_evidence_valid,
        'evidence_semantics_shape_valid', v_evidence_semantics_shape_valid,
        'evidence_provenance_valid', v_evidence_provenance_valid,
        'required_positive_evidence_code', v_required_positive_code,
        'positive_evidence_valid', v_positive_evidence_valid,
        'first_party_private_choice_valid', v_first_party_private_choice_valid,
        'first_party_business_choice_valid', v_first_party_business_choice_valid,
        'private_declaration_evidence_valid', v_private_declaration_evidence_valid,
        'business_declaration_evidence_valid', v_business_declaration_evidence_valid,
        'mapping_integrity', v_mapping_integrity
      )
  );

  if v_is_versioned then
    v_effective_classifier_json := v_effective_classifier_json || jsonb_build_object(
      'taxonomy_version', v_active_policy.taxonomy_version,
      'classifier_version', v_active_policy.classifier_version,
      'prompt_version', v_active_policy.prompt_version,
      'effective_status', v_effective_status,
      'effective_segment', v_effective_segment
    );
  end if;

  if v_is_versioned then
    insert into public.request_segment_classifications (
      request_id, customer_id, input_hash, status, segment, s_kategorie,
      confidence, evidence_grade, reasoning_short, reason_codes, evidence_json,
      firmographic_json, classifier_json, policy_json, risk_flags, model,
      model_version, prompt_version, classifier_version, policy_version,
      accepted_at, accepted_by, taxonomy_version, context_tags,
      organization_scale, evidence_provenance_valid, mapping_integrity
    ) values (
      p_request_id,
      v_request.customer_id,
      p_input_hash,
      v_effective_status,
      p_segment,
      case when v_policy_found then v_policy_rule.s_kategorie else null end,
      p_confidence,
      p_evidence_grade,
      left(coalesce(p_reasoning_short, ''), 1000),
      coalesce(p_reason_codes, '{}'),
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end,
      coalesce(p_firmographic_json, '{}'::jsonb),
      v_effective_classifier_json,
      case when v_policy_found then to_jsonb(v_policy_rule) else '{}'::jsonb end
        || jsonb_build_object(
          'taxonomy_version', v_active_policy.taxonomy_version,
          'classifier_version', v_active_policy.classifier_version,
          'prompt_version', v_active_policy.prompt_version
        ),
      v_effective_risk_flags,
      p_model,
      p_model_version,
      p_prompt_version,
      p_classifier_version,
      v_active_policy.version,
      case when v_effective_status = 'accepted' then now() else null end,
      case when v_effective_status = 'accepted'
        then 'n8n-request-segmenter-v3'
        else null end,
      v_active_policy.taxonomy_version,
      case when v_context_shape_valid and v_context_tags_valid then v_context_tags else '{}'::text[] end,
      case when v_organization_scale_valid then v_organization_scale else null end,
      v_evidence_provenance_valid,
      v_mapping_integrity
    )
    on conflict (
      request_id, input_hash, taxonomy_version, classifier_version, prompt_version
    )
      where taxonomy_version is not null
    do update set
      status = excluded.status,
      segment = excluded.segment,
      s_kategorie = excluded.s_kategorie,
      confidence = excluded.confidence,
      evidence_grade = excluded.evidence_grade,
      reasoning_short = excluded.reasoning_short,
      reason_codes = excluded.reason_codes,
      evidence_json = excluded.evidence_json,
      firmographic_json = excluded.firmographic_json,
      classifier_json = excluded.classifier_json,
      policy_json = excluded.policy_json,
      risk_flags = excluded.risk_flags,
      model = excluded.model,
      model_version = excluded.model_version,
      policy_version = excluded.policy_version,
      accepted_at = excluded.accepted_at,
      accepted_by = excluded.accepted_by,
      context_tags = excluded.context_tags,
      organization_scale = excluded.organization_scale,
      evidence_provenance_valid = excluded.evidence_provenance_valid,
      mapping_integrity = excluded.mapping_integrity,
      created_at = now()
    returning id into v_classification_id;
  else
    insert into public.request_segment_classifications (
      request_id, customer_id, input_hash, status, segment, s_kategorie,
      confidence, evidence_grade, reasoning_short, reason_codes, evidence_json,
      firmographic_json, classifier_json, policy_json, risk_flags, model,
      model_version, prompt_version, classifier_version, policy_version,
      accepted_at, accepted_by, taxonomy_version, context_tags,
      organization_scale, evidence_provenance_valid, mapping_integrity
    ) values (
      p_request_id,
      v_request.customer_id,
      p_input_hash,
      v_effective_status,
      p_segment,
      case when v_policy_found then v_policy_rule.s_kategorie else null end,
      p_confidence,
      p_evidence_grade,
      left(coalesce(p_reasoning_short, ''), 1000),
      coalesce(p_reason_codes, '{}'),
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end,
      coalesce(p_firmographic_json, '{}'::jsonb),
      v_effective_classifier_json,
      case when v_policy_found then to_jsonb(v_policy_rule) else '{}'::jsonb end,
      v_effective_risk_flags,
      p_model,
      p_model_version,
      p_prompt_version,
      p_classifier_version,
      v_active_policy.version,
      case when v_effective_status = 'accepted' then now() else null end,
      case when v_effective_status = 'accepted'
        then coalesce(nullif(p_accepted_by, ''), 'n8n-request-segmenter')
        else null end,
      null,
      '{}',
      null,
      false,
      v_mapping_integrity
    )
    on conflict (request_id, input_hash, classifier_version)
      where taxonomy_version is null
    do update set
      status = excluded.status,
      segment = excluded.segment,
      s_kategorie = excluded.s_kategorie,
      confidence = excluded.confidence,
      evidence_grade = excluded.evidence_grade,
      reasoning_short = excluded.reasoning_short,
      reason_codes = excluded.reason_codes,
      evidence_json = excluded.evidence_json,
      firmographic_json = excluded.firmographic_json,
      classifier_json = excluded.classifier_json,
      policy_json = excluded.policy_json,
      risk_flags = excluded.risk_flags,
      model = excluded.model,
      model_version = excluded.model_version,
      prompt_version = excluded.prompt_version,
      policy_version = excluded.policy_version,
      accepted_at = excluded.accepted_at,
      accepted_by = excluded.accepted_by,
      mapping_integrity = excluded.mapping_integrity,
      created_at = now()
    returning id into v_classification_id;
  end if;

  if v_effective_status = 'accepted'
     and not v_evaluation_only
     and v_master_projection_authorized then
    select public.neontrip_upsert_segment_research_cache_from_classification(
      p_request_id,
      v_effective_status,
      v_active_policy.mode,
      p_evidence_grade,
      case when v_evidence_json_shape_valid then coalesce(p_evidence_json, '[]'::jsonb) else '[]'::jsonb end,
      coalesce(p_firmographic_json, '{}'::jsonb),
      v_effective_classifier_json,
      p_model,
      p_classifier_version
    ) into v_research_cache_written;
  end if;

  v_manual_authoritative := v_request.segment_status = 'accepted'
    and coalesce(v_request.segment_source, '') ~ '^manual_';
  v_existing_authoritative := v_request.segment_status = 'accepted'
    and v_request.segment ~ '^NT-(1[0-8]|[1-9])$';

  if v_evaluation_only or not v_master_projection_authorized then
    v_projection_reason := 'evaluation_only_no_projection';
  elsif v_active_policy.mode = 'shadow' then
    v_projection_reason := 'policy_mode_shadow';
  elsif v_manual_authoritative then
    v_projection_reason := 'manual_authoritative_preserved';
  elsif not v_input_hash_current then
    v_projection_reason := 'stale_input_hash';
  elsif v_effective_status = 'accepted' and (not v_is_versioned or v_contract_match) then
    update public.master_requests
    set
      segment = v_effective_segment,
      s_kategorie = v_policy_rule.s_kategorie,
      segment_status = 'accepted',
      segment_confidence = p_confidence,
      segment_source = 'request_segmenter',
      segment_classified_at = now(),
      segment_policy_version = v_active_policy.version,
      segment_taxonomy_version = case when v_is_versioned then v_active_policy.taxonomy_version else null end,
      segment_context_tags = case when v_is_versioned then v_context_tags else '{}'::text[] end,
      segment_organization_scale = case when v_is_versioned then v_organization_scale else null end,
      commercial_playbook = jsonb_build_object(
        'policy_version', v_active_policy.version,
        'taxonomy_version', v_active_policy.taxonomy_version,
        'segment', v_effective_segment,
        's_kategorie', v_policy_rule.s_kategorie,
        'price_factor', v_policy_rule.price_factor,
        'max_followups', v_policy_rule.max_followups,
        'first_call_after_minutes', v_policy_rule.first_call_after_minutes,
        'sales_priority', v_policy_rule.sales_priority,
        'automation_enabled', v_policy_rule.automation_enabled,
        'mode', v_active_policy.mode
      ),
      updated_at = now()
    where id = p_request_id;
    v_projection_applied := true;
    v_projection_reason := 'accepted_projected';
  elsif v_existing_authoritative then
    v_projection_reason := 'existing_authoritative_preserved';
  elsif v_effective_status in ('needs_review', 'rejected', 'error') then
    update public.master_requests
    set
      segment = null,
      s_kategorie = null,
      segment_status = v_effective_status,
      segment_confidence = null,
      segment_source = 'request_segmenter',
      segment_classified_at = now(),
      segment_policy_version = v_active_policy.version,
      segment_taxonomy_version = case when v_is_versioned then v_active_policy.taxonomy_version else null end,
      segment_context_tags = '{}',
      segment_organization_scale = null,
      commercial_playbook = '{}'::jsonb,
      updated_at = now()
    where id = p_request_id;
    v_projection_reason := 'classification_not_accepted';
  else
    v_projection_reason := 'classification_not_accepted';
  end if;

  v_job_status := case
    when v_effective_status = 'accepted' then 'completed'
    when v_effective_status = 'needs_review' then 'needs_review'
    when v_effective_status = 'error' then 'failed'
    else 'completed'
  end;

  if p_job_id is not null then
    update public.request_segmentation_jobs
    set
      status = v_job_status,
      last_classification_id = v_classification_id,
      completed_at = case
        when v_effective_status in ('accepted', 'needs_review', 'shadow', 'rejected') then now()
        else completed_at
      end,
      last_error_code = case
        when v_effective_status in ('accepted', 'needs_review', 'shadow', 'rejected') then null
        else last_error_code
      end,
      last_error_message = case
        when v_effective_status in ('accepted', 'needs_review', 'shadow', 'rejected') then null
        else last_error_message
      end,
      updated_at = now(),
      lock_owner = null,
      locked_at = null
    where id = p_job_id;
  end if;

  select * into v_request
  from public.master_requests
  where id = p_request_id;

  return jsonb_build_object(
    'classification_id', v_classification_id,
    'job_id', p_job_id,
    'request_id', p_request_id,
    'submitted_status', p_status,
    'proposed_segment', p_segment,
    'effective_status', v_effective_status,
    'effective_segment', v_effective_segment,
    'policy_version', v_active_policy.version,
    'policy_mode', v_active_policy.mode,
    'taxonomy_version', v_active_policy.taxonomy_version,
    'classifier_version', p_classifier_version,
    'prompt_version', p_prompt_version,
    'job_status', v_job_status,
    'input_hash_current', v_input_hash_current,
    'contract_match', v_contract_match,
    'context_tags', to_jsonb(case when v_context_tags_valid then v_context_tags else '{}'::text[] end),
    'organization_scale', case when v_organization_scale_valid then v_organization_scale else null end,
    'evidence_provenance_valid', v_evidence_provenance_valid,
    'mapping_integrity', v_mapping_integrity,
    'evaluation_only', v_evaluation_only,
    'master_projection_authorized', v_master_projection_authorized,
    'research_cache_written', v_research_cache_written,
    'projection', jsonb_build_object(
      'applied', v_projection_applied,
      'reason', v_projection_reason,
      'authoritative_segment', v_request.segment,
      'authoritative_s_kategorie', v_request.s_kategorie,
      'authoritative_status', v_request.segment_status,
      'authoritative_source', v_request.segment_source,
      'authoritative_taxonomy_version', v_request.segment_taxonomy_version,
      'manual_authoritative_preserved', v_manual_authoritative
    )
  );
end;
$function$;

comment on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) is
  'Preserves the existing 18-parameter n8n call. Cross-lane jobs fail without a classification; evaluation-only jobs may classify but never project to master/cache. CX8 acceptance requires exact contract, context/scale, provenance, mapping, and current input.';

revoke all on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) to service_role;

create function public.neontrip_lock_request_segmentation_input_hash(p_request_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_customer_id uuid;
  v_input_hash text;
begin
  -- The hash owns fields on both rows. Lock in the same deterministic order as
  -- Record (request, then customer) before computing it, so a concurrent edit
  -- cannot create stale gold or a stale evaluation job after validation.
  select mr.customer_id
  into v_customer_id
  from public.master_requests mr
  where mr.id = p_request_id
  for share;

  if not found then
    return null;
  end if;

  if v_customer_id is not null then
    perform 1
    from public.master_customers mc
    where mc.id = v_customer_id
    for share;
  end if;

  select public.neontrip_compute_request_segment_input_hash(p_request_id)
  into v_input_hash;

  return v_input_hash;
end;
$function$;

comment on function public.neontrip_lock_request_segmentation_input_hash(uuid) is
  'Locks every row that owns a segmentation-hash field (request then customer) and returns the hash from that stable locked state.';

revoke all on function public.neontrip_lock_request_segmentation_input_hash(uuid)
  from public, anon, authenticated;
grant execute on function public.neontrip_lock_request_segmentation_input_hash(uuid)
  to service_role;

create function public.neontrip_enqueue_request_segmentation_evaluation(
  p_request_id uuid,
  p_input_hash text,
  p_taxonomy_version text,
  p_classifier_version text,
  p_prompt_version text,
  p_source text default 'gold_re_evaluation'
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current_input_hash text;
  v_public_request_id text;
  v_job_id uuid;
  v_quality_gate_version text;
begin
  if num_nulls(p_taxonomy_version, p_classifier_version, p_prompt_version) <> 0 then
    raise exception 'evaluation_contract_required';
  end if;

  select q.version
  into v_quality_gate_version
  from public.segment_quality_gate_versions q
  where q.taxonomy_version = p_taxonomy_version
    and q.classifier_version = p_classifier_version
    and q.prompt_version = p_prompt_version
  order by q.created_at desc
  limit 1;

  if not found then
    raise exception 'evaluation_contract_not_configured';
  end if;

  v_current_input_hash := public.neontrip_lock_request_segmentation_input_hash(p_request_id);

  -- Read request fields only after the helper has locked request then customer.
  -- Separate PL/pgSQL statements avoid target-expression evaluation order and
  -- statement-snapshot ambiguity during a concurrent input update.
  select mr.request_id
  into v_public_request_id
  from public.master_requests mr
  where mr.id = p_request_id;

  if not found then
    raise exception 'request_not_found: %', p_request_id;
  end if;

  if v_current_input_hash is distinct from p_input_hash then
    raise exception 'gold_input_hash_not_current';
  end if;

  insert into public.request_segmentation_jobs (
    request_id, request_public_id, input_hash, source, status, priority,
    attempts, next_attempt_at, metadata,
    taxonomy_version, classifier_version, prompt_version
  ) values (
    p_request_id,
    v_public_request_id,
    p_input_hash,
    coalesce(nullif(btrim(p_source), ''), 'gold_re_evaluation'),
    'pending',
    900,
    0,
    now(),
    jsonb_build_object(
      'evaluation_only', true,
      'enqueued_at', now(),
      'taxonomy_version', p_taxonomy_version,
      'classifier_version', p_classifier_version,
      'prompt_version', p_prompt_version,
      'quality_gate_version', v_quality_gate_version,
      'master_projection_authorized', false
    ),
    p_taxonomy_version,
    p_classifier_version,
    p_prompt_version
  )
  on conflict (
    request_id, input_hash, taxonomy_version, classifier_version, prompt_version
  )
    where taxonomy_version is not null
      and classifier_version is not null
      and prompt_version is not null
  do update set
    source = excluded.source,
    priority = greatest(public.request_segmentation_jobs.priority, excluded.priority),
    status = case
      when public.request_segmentation_jobs.status = 'processing'
        then public.request_segmentation_jobs.status
      else 'pending'
    end,
    attempts = case
      when public.request_segmentation_jobs.status = 'processing'
        then public.request_segmentation_jobs.attempts
      else 0
    end,
    next_attempt_at = case
      when public.request_segmentation_jobs.status = 'processing'
        then public.request_segmentation_jobs.next_attempt_at
      else now()
    end,
    completed_at = case
      when public.request_segmentation_jobs.status = 'processing'
        then public.request_segmentation_jobs.completed_at
      else null
    end,
    last_error_code = case
      when public.request_segmentation_jobs.status = 'processing'
        then public.request_segmentation_jobs.last_error_code
      else null
    end,
    last_error_message = case
      when public.request_segmentation_jobs.status = 'processing'
        then public.request_segmentation_jobs.last_error_message
      else null
    end,
    metadata = public.request_segmentation_jobs.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_job_id;

  return v_job_id;
end;
$function$;

comment on function public.neontrip_enqueue_request_segmentation_evaluation(uuid, text, text, text, text, text) is
  'Safely enqueues the exact immutable input/contract for shadow evaluation without changing master segment authority. Pre-activation jobs stay unclaimable.';

revoke all on function public.neontrip_enqueue_request_segmentation_evaluation(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.neontrip_enqueue_request_segmentation_evaluation(uuid, text, text, text, text, text)
  to service_role;

create function public.neontrip_adjudicate_request_segmentation_gold(
  p_request_id uuid,
  p_input_hash text,
  p_taxonomy_version text,
  p_segment text,
  p_context_tags text[],
  p_organization_scale text,
  p_adjudicated_by text,
  p_adjudication_reason text,
  p_evidence_urls text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_expected_taxonomy constant text := 'nt_taxonomy_v2_20260819_cx8';
  v_labeling_version constant text := 'gold_labeling_v2_20260819_cx8';
  v_classifier_version constant text := 'segment_classifier_v3_20260819_cx8';
  v_prompt_version constant text := 'segment_prompt_v4_20260819_cx8';
  v_current_input_hash text;
  v_customer_type text;
  v_s_kategorie text;
  v_context_tags text[];
  v_evidence_urls text[];
  v_actor text := btrim(coalesce(p_adjudicated_by, ''));
  v_reason text := btrim(coalesce(p_adjudication_reason, ''));
  v_adjudication public.request_segmentation_gold_adjudications%rowtype;
  v_created boolean := false;
  v_job_id uuid;
begin
  if p_taxonomy_version is distinct from v_expected_taxonomy then
    raise exception 'gold_taxonomy_not_supported: %', p_taxonomy_version;
  end if;

  if nullif(btrim(coalesce(p_input_hash, '')), '') is null then
    raise exception 'gold_input_hash_required';
  end if;

  if length(v_actor) < 3 then
    raise exception 'gold_adjudicator_required';
  end if;

  if length(v_actor) > 320 then
    raise exception 'gold_adjudicator_too_long';
  end if;

  if length(v_reason) < 20 then
    raise exception 'gold_adjudication_reason_too_short';
  end if;

  if length(v_reason) > 4000 then
    raise exception 'gold_adjudication_reason_too_long';
  end if;

  if p_organization_scale is not null
     and p_organization_scale not in ('solo', 'micro', 'small', 'medium', 'large', 'enterprise') then
    raise exception 'invalid_gold_organization_scale: %', p_organization_scale;
  end if;

  select d.default_s_kategorie
  into v_s_kategorie
  from public.segment_taxonomy_definitions d
  where d.taxonomy_version = p_taxonomy_version
    and d.segment = p_segment
    and d.active
  limit 1;

  if not found then
    raise exception 'invalid_gold_segment: %', p_segment;
  end if;

  select coalesce(array_agg(distinct btrim(tag) order by btrim(tag)), '{}'::text[])
  into v_context_tags
  from unnest(coalesce(p_context_tags, '{}'::text[])) tags(tag)
  where nullif(btrim(tag), '') is not null;

  if cardinality(v_context_tags) > 10 then
    raise exception 'gold_context_tags_above_10';
  end if;

  if exists (
    select 1
    from unnest(v_context_tags) tags(tag)
    where length(tag) > 80
  ) then
    raise exception 'gold_context_tag_too_long';
  end if;

  if exists (
    select 1
    from unnest(v_context_tags) tags(tag)
    where not exists (
      select 1
      from public.segment_context_definitions cd
      where cd.taxonomy_version = p_taxonomy_version
        and cd.context_tag = tags.tag
        and cd.active
    )
  ) then
    raise exception 'invalid_gold_context_tags';
  end if;

  v_current_input_hash := public.neontrip_lock_request_segmentation_input_hash(p_request_id);

  -- Eligibility fields are read in a new statement after both input-owning rows
  -- are locked, so the Gold meaning and hash come from the same stable state.
  select lower(btrim(coalesce(mr.customer_type, '')))
  into v_customer_type
  from public.master_requests mr
  where mr.id = p_request_id;

  if not found then
    raise exception 'request_not_found: %', p_request_id;
  end if;

  if v_current_input_hash is distinct from p_input_hash then
    raise exception 'gold_input_hash_not_current';
  end if;

  if p_segment = 'NT-8' and v_customer_type <> 'privat' then
    raise exception 'gold_private_first_party_evidence_required';
  end if;

  if p_segment = 'NT-8' and p_organization_scale is not null then
    raise exception 'gold_private_organization_scale_must_be_null';
  end if;

  if p_segment = 'NT-9' and v_customer_type not in ('gewerblich', 'b2b') then
    raise exception 'gold_direct_business_first_party_evidence_required';
  end if;

  if p_segment = 'NT-5' and p_organization_scale is null then
    raise exception 'gold_multisite_organization_scale_required';
  end if;

  if p_segment = 'NT-6' and p_organization_scale is distinct from 'enterprise' then
    raise exception 'gold_enterprise_scale_required';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_evidence_urls, '{}'::text[])) urls(url)
    where nullif(btrim(url), '') is not null
      and length(btrim(url)) > 2048
  ) then
    raise exception 'gold_evidence_url_too_long';
  end if;

  select coalesce(array_agg(distinct btrim(url) order by btrim(url)), '{}'::text[])
  into v_evidence_urls
  from unnest(coalesce(p_evidence_urls, '{}'::text[])) urls(url)
  where nullif(btrim(url), '') is not null;

  if cardinality(v_evidence_urls) > 12 then
    raise exception 'gold_evidence_urls_above_12';
  end if;

  if exists (
    select 1 from unnest(v_evidence_urls) urls(url)
    where url !~* '^https?://'
       or not coalesce(
         ((public.neontrip_request_segmentation_domain_facts(url))->>'is_valid_dns_host')::boolean,
         false
       )
  ) then
    raise exception 'invalid_gold_evidence_url';
  end if;

  if cardinality(v_evidence_urls) = 0 and p_segment <> 'NT-8' then
    raise exception 'gold_external_evidence_required_for_non_private_segment';
  end if;

  insert into public.request_segmentation_gold_adjudications (
    request_id, input_hash, taxonomy_version, labeling_version,
    labeled_segment, labeled_s_kategorie, context_tags, organization_scale,
    adjudicated_by, adjudication_reason, evidence_urls
  ) values (
    p_request_id,
    p_input_hash,
    p_taxonomy_version,
    v_labeling_version,
    p_segment,
    v_s_kategorie,
    v_context_tags,
    p_organization_scale,
    v_actor,
    v_reason,
    v_evidence_urls
  )
  on conflict (request_id, input_hash, taxonomy_version) do nothing
  returning * into v_adjudication;

  v_created := found;

  if not v_created then
    select * into v_adjudication
    from public.request_segmentation_gold_adjudications g
    where g.request_id = p_request_id
      and g.input_hash = p_input_hash
      and g.taxonomy_version = p_taxonomy_version
    for update;

    if v_adjudication.labeling_version is distinct from v_labeling_version
       or v_adjudication.labeled_segment is distinct from p_segment
       or v_adjudication.labeled_s_kategorie is distinct from v_s_kategorie
       or v_adjudication.context_tags is distinct from v_context_tags
       or v_adjudication.organization_scale is distinct from p_organization_scale
       or v_adjudication.adjudicated_by is distinct from v_actor
       or v_adjudication.adjudication_reason is distinct from v_reason
       or v_adjudication.evidence_urls is distinct from v_evidence_urls then
      raise exception using
        errcode = '23505',
        message = 'gold_adjudication_conflict_requires_explicit_superseding_revision',
        detail = 'Existing insert-once gold differs; ordinary retries cannot mutate adjudicated truth.';
    end if;
  else
    v_job_id := public.neontrip_enqueue_request_segmentation_evaluation(
      p_request_id,
      p_input_hash,
      p_taxonomy_version,
      v_classifier_version,
      v_prompt_version,
      'gold_re_evaluation'
    );
  end if;

  if not v_created then
    select j.id into v_job_id
    from public.request_segmentation_jobs j
    where j.request_id = p_request_id
      and j.input_hash = p_input_hash
      and j.taxonomy_version = p_taxonomy_version
      and j.classifier_version = v_classifier_version
      and j.prompt_version = v_prompt_version
    order by j.created_at desc
    limit 1;
  end if;

  return jsonb_build_object(
    'gold_adjudication_id', v_adjudication.id,
    'request_id', p_request_id,
    'input_hash', p_input_hash,
    'taxonomy_version', p_taxonomy_version,
    'labeling_version', v_labeling_version,
    'labeled_segment', p_segment,
    'labeled_s_kategorie', v_s_kategorie,
    'context_tags', to_jsonb(v_context_tags),
    'organization_scale', p_organization_scale,
    'created', v_created,
    'idempotent_retry', not v_created,
    'evaluation_job_id', v_job_id,
    'master_segment_mutated', false
  );
end;
$function$;

comment on function public.neontrip_adjudicate_request_segmentation_gold(
  uuid, text, text, text, text[], text, text, text, text[]
) is
  'Creates insert-once explicit CX8 gold for the exact current input. Identical retry is idempotent; divergent retry conflicts and cannot silently rewrite truth. Manual segment override is a separate contract.';

revoke all on function public.neontrip_adjudicate_request_segmentation_gold(
  uuid, text, text, text, text[], text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.neontrip_adjudicate_request_segmentation_gold(
  uuid, text, text, text, text[], text, text, text, text[]
) to service_role;

create function public.neontrip_block_gold_adjudication_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'request_segmentation_gold_adjudications_are_immutable',
    detail = 'Create an explicitly reviewed superseding contract in a future migration; ordinary UPDATE/DELETE is forbidden.';
end;
$function$;

create trigger trg_request_segmentation_gold_adjudications_immutable
before update or delete on public.request_segmentation_gold_adjudications
for each row execute function public.neontrip_block_gold_adjudication_mutation();

revoke all on function public.neontrip_block_gold_adjudication_mutation()
  from public, anon, authenticated;

create function public.neontrip_get_request_segmentation_review_context(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current_input_hash text;
  v_result jsonb;
begin
  v_current_input_hash := public.neontrip_lock_request_segmentation_input_hash(p_request_id);

  if not exists (
    select 1 from public.master_requests mr where mr.id = p_request_id
  ) then
    return jsonb_build_object(
      'request_id', p_request_id,
      'payload_error', jsonb_build_object(
        'code', 'request_not_found',
        'message', 'No master request exists for this review context.'
      )
    );
  end if;

  with target_contract as (
    select q.*
    from public.segment_quality_gate_versions q
    where q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and q.classifier_version = 'segment_classifier_v3_20260819_cx8'
      and q.prompt_version = 'segment_prompt_v4_20260819_cx8'
    order by q.created_at desc
    limit 1
  ),
  request_row as (
    select
      mr.id,
      mr.request_id as public_request_id,
      v_current_input_hash as current_input_hash,
      case lower(btrim(coalesce(mr.customer_type, '')))
        when 'privat' then 'privat'
        when 'gewerblich' then 'gewerblich'
        when 'b2b' then 'b2b'
        else null
      end as normalized_customer_type
    from public.master_requests mr
    where mr.id = p_request_id
  ),
  latest_classification as (
    select c.*
    from public.request_segment_classifications c
    cross join target_contract tc
    where c.request_id = p_request_id
      and c.taxonomy_version = tc.taxonomy_version
      and c.classifier_version = tc.classifier_version
      and c.prompt_version = tc.prompt_version
    order by c.created_at desc, c.id desc
    limit 1
  ),
  current_gold as (
    select g.*
    from public.request_segmentation_gold_adjudications g
    cross join request_row rr
    cross join target_contract tc
    where g.request_id = rr.id
      and g.input_hash = rr.current_input_hash
      and g.taxonomy_version = tc.taxonomy_version
    limit 1
  )
  select case
    when not exists (select 1 from request_row) then
      jsonb_build_object(
        'request_id', p_request_id,
        'payload_error', jsonb_build_object(
          'code', 'request_not_found',
          'message', 'No master request exists for this review context.'
        )
      )
    when not exists (select 1 from target_contract) then
      jsonb_build_object(
        'request_id', p_request_id,
        'payload_error', jsonb_build_object(
          'code', 'cx8_review_contract_missing',
          'message', 'The exact CX8 evaluation contract is not configured.'
        )
      )
    else jsonb_build_object(
      'request_id', p_request_id,
      'public_request_id', (select public_request_id from request_row),
      'current_input_hash', (select current_input_hash from request_row),
      'taxonomy_version', (select taxonomy_version from target_contract),
      'classifier_version', (select classifier_version from target_contract),
      'prompt_version', (select prompt_version from target_contract),
      'quality_gate_version', (select version from target_contract),
      'gold_eligibility', jsonb_build_object(
        'normalized_customer_type', (select normalized_customer_type from request_row),
        'nt8_first_party_eligible', coalesce(
          (select normalized_customer_type = 'privat' from request_row),
          false
        ),
        'nt9_first_party_eligible', coalesce(
          (select normalized_customer_type in ('gewerblich', 'b2b') from request_row),
          false
        ),
        'nt8_requires_null_organization_scale', true,
        'nt5_requires_nonnull_organization_scale', true,
        'nt6_required_organization_scale', 'enterprise',
        'non_nt8_requires_external_evidence_url', true
      ),
      'latest_classification', case
        when not exists (select 1 from latest_classification) then null
        else jsonb_build_object(
          'classification_id', (select id from latest_classification),
          'input_hash', (select input_hash from latest_classification),
          'input_hash_current', (
            select lc.input_hash = rr.current_input_hash
            from latest_classification lc cross join request_row rr
          ),
          'status', (select status from latest_classification),
          'proposed_segment', (select segment from latest_classification),
          's_kategorie', (select s_kategorie from latest_classification),
          'confidence', (select confidence from latest_classification),
          'evidence_grade', (select evidence_grade from latest_classification),
          'reasoning_short', (select reasoning_short from latest_classification),
          'reason_codes', (select reason_codes from latest_classification),
          'evidence_json', (select evidence_json from latest_classification),
          'risk_flags', (select risk_flags from latest_classification),
          'context_tags', (select context_tags from latest_classification),
          'organization_scale', (select organization_scale from latest_classification),
          'evidence_provenance_valid', (select evidence_provenance_valid from latest_classification),
          'mapping_integrity', (select mapping_integrity from latest_classification),
          'classified_at', (select created_at from latest_classification)
        )
      end,
      'current_gold_adjudication', case
        when not exists (select 1 from current_gold) then null
        else jsonb_build_object(
          'gold_adjudication_id', (select id from current_gold),
          'input_hash', (select input_hash from current_gold),
          'labeled_segment', (select labeled_segment from current_gold),
          'labeled_s_kategorie', (select labeled_s_kategorie from current_gold),
          'context_tags', (select context_tags from current_gold),
          'organization_scale', (select organization_scale from current_gold),
          'labeling_version', (select labeling_version from current_gold),
          'created_at', (select created_at from current_gold)
        )
      end
    )
  end
  into v_result;

  return v_result;
end;
$function$;

comment on function public.neontrip_get_request_segmentation_review_context(uuid) is
  'Service-role review contract for the exact locked current input, deterministic Gold eligibility, and CX8 v3 proposal only; never mixes global/latest v1 classifications.';

revoke all on function public.neontrip_get_request_segmentation_review_context(uuid)
  from public, anon, authenticated;
grant execute on function public.neontrip_get_request_segmentation_review_context(uuid)
  to service_role;

-- CX8 quality is evaluated only against explicit immutable adjudications and
-- the exact taxonomy + classifier + prompt + input hash. "Latest" across
-- contracts is intentionally never used.
create view public.request_segmentation_v2_gold_evaluation
with (security_invoker = true)
as
with target_contract as (
  select q.*
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v2_20260819_cx8'
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v3_20260819_cx8'
    and q.prompt_version = 'segment_prompt_v4_20260819_cx8'
), latest_gold_per_request as (
  -- One request can acquire a later immutable input hash. Quality gates use
  -- only its latest explicit adjudication, so repeated versions cannot inflate
  -- either the 300-request total or any per-class metric.
  select distinct on (g.request_id) g.*
  from public.request_segmentation_gold_adjudications g
  cross join target_contract tc
  where g.taxonomy_version = tc.taxonomy_version
    and g.labeling_version = 'gold_labeling_v2_20260819_cx8'
  order by g.request_id, g.created_at desc, g.id desc
), exact_evaluation as (
  select
    g.id as gold_adjudication_id,
    g.request_id,
    g.input_hash,
    g.taxonomy_version,
    g.labeling_version,
    g.labeled_segment as actual_segment,
    g.labeled_s_kategorie as actual_s_kategorie,
    g.created_at as adjudicated_at,
    c.id as classification_id,
    c.status as classifier_status,
    c.segment as proposed_segment,
    case when c.status = 'accepted' then c.segment end as accepted_predicted_segment,
    c.s_kategorie as proposed_s_kategorie,
    case when c.status = 'accepted' then c.s_kategorie end as accepted_predicted_s_kategorie,
    c.confidence as predicted_confidence,
    c.evidence_grade,
    c.risk_flags,
    c.evidence_provenance_valid,
    c.mapping_integrity,
    c.policy_version,
    c.classifier_version,
    c.prompt_version,
    c.created_at as classified_at
  from latest_gold_per_request g
  cross join target_contract tc
  left join public.request_segment_classifications c
    on c.request_id = g.request_id
   and c.input_hash = g.input_hash
   and c.taxonomy_version = g.taxonomy_version
   and c.classifier_version = tc.classifier_version
   and c.prompt_version = tc.prompt_version
)
select
  e.*,
  case
    when e.classification_id is null then 'missing_prediction'
    when e.classifier_status <> 'accepted' then 'not_accepted'
    when e.accepted_predicted_segment = e.actual_segment then 'correct'
    else 'wrong_segment'
  end as evaluation_status,
  coalesce(
    e.classifier_status = 'accepted'
    and e.accepted_predicted_segment = e.actual_segment,
    false
  ) as segment_match,
  coalesce(
    e.classifier_status = 'accepted'
    and e.accepted_predicted_s_kategorie = e.actual_s_kategorie,
    false
  ) as s_kategorie_match
from exact_evaluation e;

comment on view public.request_segmentation_v2_gold_evaluation is
  'Exact CX8 v3 evaluation join using one latest immutable adjudication per unique request. Gold and predictions match on request, input hash, taxonomy, classifier, and prompt; legacy/latest classifications cannot leak in.';

create view public.request_segmentation_v2_confusion_matrix
with (security_invoker = true)
as
select
  actual_segment,
  case
    when classifier_status = 'accepted' then accepted_predicted_segment
    else '__ABSTAIN__'
  end as predicted_outcome,
  classifier_status,
  count(*)::integer as examples,
  count(*) filter (where evaluation_status = 'correct')::integer as correct_examples
from public.request_segmentation_v2_gold_evaluation
group by
  actual_segment,
  case
    when classifier_status = 'accepted' then accepted_predicted_segment
    else '__ABSTAIN__'
  end,
  classifier_status;

comment on view public.request_segmentation_v2_confusion_matrix is
  'True CX8 confusion matrix: only accepted classifications are predicted classes; review/reject/error/missing outcomes are explicit abstentions.';

create view public.request_segmentation_v2_segment_quality
with (security_invoker = true)
as
with target_contract as (
  select q.*
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v2_20260819_cx8'
), actual_stats as (
  select
    e.actual_segment as segment,
    count(*)::integer as gold_examples,
    count(*) filter (where e.classifier_status = 'accepted')::integer as accepted_on_actual,
    count(*) filter (where e.evaluation_status = 'correct')::integer as true_positives
  from public.request_segmentation_v2_gold_evaluation e
  group by e.actual_segment
), predicted_stats as (
  select
    e.accepted_predicted_segment as segment,
    count(*)::integer as accepted_predictions,
    count(*) filter (where e.actual_segment = e.accepted_predicted_segment)::integer as true_positives
  from public.request_segmentation_v2_gold_evaluation e
  where e.classifier_status = 'accepted'
    and e.accepted_predicted_segment is not null
  group by e.accepted_predicted_segment
), metrics as (
  select
    d.taxonomy_version,
    tc.classifier_version,
    tc.prompt_version,
    tc.version as quality_gate_version,
    d.segment,
    d.label,
    d.default_s_kategorie,
    d.required_evidence_code,
    coalesce(a.gold_examples, 0) as gold_examples,
    coalesce(p.accepted_predictions, 0) as accepted_predictions,
    coalesce(a.accepted_on_actual, 0) as accepted_on_actual,
    coalesce(a.true_positives, 0) as true_positives,
    greatest(coalesce(p.accepted_predictions, 0) - coalesce(p.true_positives, 0), 0) as false_positives,
    greatest(coalesce(a.gold_examples, 0) - coalesce(a.true_positives, 0), 0) as false_negatives,
    round(coalesce(a.accepted_on_actual, 0)::numeric / nullif(a.gold_examples, 0), 4) as accepted_coverage,
    round(coalesce(p.true_positives, 0)::numeric / nullif(p.accepted_predictions, 0), 4) as precision,
    round(coalesce(a.true_positives, 0)::numeric / nullif(a.gold_examples, 0), 4) as recall,
    case
      when d.segment = any(tc.critical_segments) then tc.min_critical_precision
      else tc.min_precision_per_predicted_class
    end as required_precision,
    tc.min_recall_per_actual_class as required_recall,
    tc.min_gold_per_segment
  from target_contract tc
  join public.segment_taxonomy_definitions d
    on d.taxonomy_version = tc.taxonomy_version
   and d.active
  left join actual_stats a on a.segment = d.segment
  left join predicted_stats p on p.segment = d.segment
)
select
  m.*,
  m.gold_examples >= m.min_gold_per_segment as has_minimum_gold,
  coalesce(m.precision >= m.required_precision, false) as precision_passed,
  coalesce(m.recall >= m.required_recall, false) as recall_passed,
  (
    m.gold_examples >= m.min_gold_per_segment
    and coalesce(m.precision >= m.required_precision, false)
    and coalesce(m.recall >= m.required_recall, false)
  ) as segment_gate_passed,
  array_remove(array[
    case when m.gold_examples < m.min_gold_per_segment then 'gold_below_segment_minimum' end,
    case when not coalesce(m.precision >= m.required_precision, false) then 'precision_below_required_or_missing' end,
    case when not coalesce(m.recall >= m.required_recall, false) then 'recall_below_required_or_missing' end
  ], null) as blocking_reasons
from metrics m;

comment on view public.request_segmentation_v2_segment_quality is
  'Per-class CX8 metrics with true precision grouped by predicted class and true recall grouped by actual class. Abstentions lower recall/coverage, not precision denominators.';

create view public.request_segmentation_v2_quality_summary
with (security_invoker = true)
as
with target_contract as (
  select q.*
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v2_20260819_cx8'
), evaluation as (
  select * from public.request_segmentation_v2_gold_evaluation
)
select
  tc.taxonomy_version,
  tc.classifier_version,
  tc.prompt_version,
  tc.version as quality_gate_version,
  count(e.gold_adjudication_id)::integer as unique_gold_examples,
  count(e.gold_adjudication_id) filter (where e.classification_id is not null)::integer as evaluated_examples,
  count(e.gold_adjudication_id) filter (where e.classifier_status = 'accepted')::integer as accepted_predictions,
  count(e.gold_adjudication_id) filter (where e.evaluation_status = 'correct')::integer as correct_predictions,
  count(e.gold_adjudication_id) filter (where e.evaluation_status = 'wrong_segment')::integer as wrong_segment_predictions,
  count(e.gold_adjudication_id) filter (where e.evaluation_status = 'not_accepted')::integer as abstained_predictions,
  count(e.gold_adjudication_id) filter (where e.evaluation_status = 'missing_prediction')::integer as missing_predictions,
  round(
    count(e.gold_adjudication_id) filter (where e.classifier_status = 'accepted')::numeric
      / nullif(count(e.gold_adjudication_id), 0),
    4
  ) as accepted_coverage,
  round(
    count(e.gold_adjudication_id) filter (where e.evaluation_status = 'correct')::numeric
      / nullif(count(e.gold_adjudication_id) filter (where e.classifier_status = 'accepted'), 0),
    4
  ) as overall_precision_on_accepted,
  round(
    count(e.gold_adjudication_id) filter (where e.classifier_status = 'accepted' and e.mapping_integrity)::numeric
      / nullif(count(e.gold_adjudication_id) filter (where e.classifier_status = 'accepted'), 0),
    4
  ) as accepted_mapping_integrity,
  count(e.gold_adjudication_id) filter (
    where e.classifier_status = 'accepted'
      and not coalesce(e.mapping_integrity, false)
  )::integer as accepted_mapping_violations,
  count(e.gold_adjudication_id) filter (
    where e.classifier_status = 'accepted'
      and not coalesce(e.evidence_provenance_valid, false)
  )::integer as accepted_provenance_violations
from target_contract tc
left join evaluation e on true
group by tc.taxonomy_version, tc.classifier_version, tc.prompt_version, tc.version;

comment on view public.request_segmentation_v2_quality_summary is
  'CX8 totals and accepted coverage. Mapping integrity is deliberately calculated only over accepted predictions; abstentions are not mapping violations.';

create view public.request_segmentation_v2_mapping_integrity
with (security_invoker = true)
as
with target_contract as (
  select q.*
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v2_20260819_cx8'
), configuration as (
  select
    tc.taxonomy_version,
    count(d.segment)::integer as active_definition_count,
    count(distinct d.required_evidence_code)::integer as unique_required_evidence_codes,
    count(r.segment)::integer as matching_policy_rule_count,
    count(*) filter (
      where r.segment is null
         or r.s_kategorie is distinct from d.default_s_kategorie
         or r.taxonomy_version is distinct from d.taxonomy_version
    )::integer as definition_rule_mismatches
  from target_contract tc
  join public.segment_taxonomy_definitions d
    on d.taxonomy_version = tc.taxonomy_version
   and d.active
  left join public.segment_policy_rules r
    on r.policy_version = 'nt_policy_v2_20260819_cx8_shadow'
   and r.taxonomy_version = d.taxonomy_version
   and r.segment = d.segment
  group by tc.taxonomy_version
)
select
  tc.taxonomy_version,
  tc.classifier_version,
  tc.prompt_version,
  tc.version as quality_gate_version,
  c.active_definition_count,
  c.unique_required_evidence_codes,
  c.matching_policy_rule_count,
  c.definition_rule_mismatches,
  (
    c.active_definition_count = 8
    and c.unique_required_evidence_codes = 8
    and c.matching_policy_rule_count = 8
    and c.definition_rule_mismatches = 0
  ) as configuration_integrity,
  qs.accepted_predictions,
  qs.accepted_mapping_violations,
  qs.accepted_mapping_integrity
from target_contract tc
join configuration c on c.taxonomy_version = tc.taxonomy_version
join public.request_segmentation_v2_quality_summary qs
  on qs.quality_gate_version = tc.version;

comment on view public.request_segmentation_v2_mapping_integrity is
  'Checks both the eight definition/rule/evidence-code mappings and accepted-prediction mapping integrity for the exact CX8 contract.';

create view public.request_segmentation_v2_activation_gate_status
with (security_invoker = true)
as
with target_contract as (
  select q.*
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v2_20260819_cx8'
), summary as (
  select * from public.request_segmentation_v2_quality_summary
), per_segment as (
  select
    count(*)::integer as active_segments,
    count(*) filter (where has_minimum_gold)::integer as segments_with_minimum_gold,
    count(*) filter (where not precision_passed)::integer as segments_below_precision,
    count(*) filter (where not recall_passed)::integer as segments_below_recall,
    coalesce(bool_and(segment_gate_passed), false) as all_segment_gates_passed
  from public.request_segmentation_v2_segment_quality
), mapping as (
  select * from public.request_segmentation_v2_mapping_integrity
)
select
  tc.version as quality_gate_version,
  tc.taxonomy_version,
  tc.classifier_version,
  tc.prompt_version,
  s.unique_gold_examples,
  s.evaluated_examples,
  s.accepted_predictions,
  s.correct_predictions,
  s.accepted_coverage,
  s.overall_precision_on_accepted,
  ps.active_segments,
  ps.segments_with_minimum_gold,
  ps.segments_below_precision,
  ps.segments_below_recall,
  m.configuration_integrity,
  s.accepted_mapping_integrity,
  s.accepted_mapping_violations,
  s.accepted_provenance_violations,
  s.unique_gold_examples >= tc.min_unique_gold_total as has_minimum_unique_gold,
  ps.active_segments = 8
    and ps.segments_with_minimum_gold = 8 as has_minimum_gold_per_segment,
  ps.segments_below_precision = 0 as has_required_per_class_precision,
  ps.segments_below_recall = 0 as has_required_per_class_recall,
  coalesce(s.accepted_coverage >= tc.min_accepted_coverage, false) as has_required_accepted_coverage,
  m.configuration_integrity
    and coalesce(s.accepted_mapping_integrity >= tc.required_mapping_integrity, false)
    and s.accepted_mapping_violations = 0 as has_required_mapping_integrity,
  s.accepted_provenance_violations <= tc.max_provenance_violations as has_no_provenance_violations,
  (
    s.unique_gold_examples >= tc.min_unique_gold_total
    and ps.active_segments = 8
    and ps.segments_with_minimum_gold = 8
    and ps.all_segment_gates_passed
    and coalesce(s.accepted_coverage >= tc.min_accepted_coverage, false)
    and m.configuration_integrity
    and coalesce(s.accepted_mapping_integrity >= tc.required_mapping_integrity, false)
    and s.accepted_mapping_violations = 0
    and s.accepted_provenance_violations <= tc.max_provenance_violations
  ) as technical_quality_gate_passed,
  array_remove(array[
    case when s.unique_gold_examples < tc.min_unique_gold_total then 'unique_gold_total_below_required' end,
    case when ps.active_segments <> 8 then 'active_taxonomy_definition_count_not_eight' end,
    case when ps.segments_with_minimum_gold <> 8 then 'gold_per_active_segment_below_required' end,
    case when ps.segments_below_precision <> 0 then 'per_predicted_class_precision_below_required' end,
    case when ps.segments_below_recall <> 0 then 'per_actual_class_recall_below_required' end,
    case when not coalesce(s.accepted_coverage >= tc.min_accepted_coverage, false) then 'accepted_coverage_below_required' end,
    case when not m.configuration_integrity then 'taxonomy_policy_evidence_mapping_incomplete' end,
    case when not coalesce(s.accepted_mapping_integrity >= tc.required_mapping_integrity, false)
           or s.accepted_mapping_violations <> 0 then 'accepted_prediction_mapping_integrity_below_required' end,
    case when s.accepted_provenance_violations > tc.max_provenance_violations then 'accepted_evidence_provenance_violations_present' end
  ], null) as technical_blocking_reasons,
  tc.manual_activation_required
from target_contract tc
cross join summary s
cross join per_segment ps
cross join mapping m;

comment on view public.request_segmentation_v2_activation_gate_status is
  'Versioned CX8 gate: 300 unique gold, 25/class, predicted-class precision, actual-class recall, accepted coverage, accepted-only mapping integrity, zero provenance violations. Manual activation remains separate.';

create view public.request_segmentation_v2_activation_approval_status
with (security_invoker = true)
as
with active_approval as (
  select a.*
  from public.request_segmentation_activation_approvals a
  where a.approval_scope = 'followup_pricing'
    and a.policy_version = 'nt_policy_v2_20260819_cx8_shadow'
    and a.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and a.quality_gate_version = 'nt_quality_gate_v2_20260819_cx8'
    and a.revoked_at is null
    and a.expires_at > now()
  order by a.approved_at desc
  limit 1
)
select
  a.id as approval_id,
  a.approval_scope,
  a.policy_version,
  a.taxonomy_version,
  a.quality_gate_version,
  a.approved_by,
  a.approval_reason,
  a.approved_at,
  a.expires_at,
  a.gate_snapshot,
  true as has_active_approval
from active_approval a
union all
select
  null::uuid,
  'followup_pricing'::text,
  'nt_policy_v2_20260819_cx8_shadow'::text,
  'nt_taxonomy_v2_20260819_cx8'::text,
  'nt_quality_gate_v2_20260819_cx8'::text,
  null::text,
  null::text,
  null::timestamptz,
  null::timestamptz,
  null::jsonb,
  false
where not exists (select 1 from active_approval);

create view public.request_segmentation_v2_production_readiness
with (security_invoker = true)
as
select
  g.quality_gate_version,
  g.taxonomy_version,
  g.classifier_version,
  g.prompt_version,
  g.unique_gold_examples as gold_examples,
  g.evaluated_examples,
  g.accepted_predictions,
  g.correct_predictions,
  g.accepted_coverage,
  g.overall_precision_on_accepted,
  g.technical_quality_gate_passed,
  a.has_active_approval as has_manual_activation_approval,
  a.approval_id as activation_approval_id,
  a.approved_by as activation_approved_by,
  a.approved_at as activation_approved_at,
  a.expires_at as activation_approval_expires_at,
  (
    g.technical_quality_gate_passed
    and (not g.manual_activation_required or a.has_active_approval)
  ) as followup_pricing_activation_allowed,
  array_remove(
    g.technical_blocking_reasons || array[
      case
        when g.manual_activation_required and not a.has_active_approval
          then 'manual_approval_required_before_followup_or_pricing'
      end
    ],
    null
  ) as blocking_reasons,
  g.active_segments,
  g.segments_with_minimum_gold,
  g.segments_below_precision,
  g.segments_below_recall,
  g.configuration_integrity,
  g.accepted_mapping_integrity,
  g.accepted_mapping_violations,
  g.accepted_provenance_violations
from public.request_segmentation_v2_activation_gate_status g
cross join public.request_segmentation_v2_activation_approval_status a;

comment on view public.request_segmentation_v2_production_readiness is
  'Fail-closed CX8 commercial readiness. Technical gate and exact version-scoped, unexpired manual approval are both required.';

create or replace function public.neontrip_approve_request_segmentation_activation(
  p_approved_by text,
  p_approval_reason text,
  p_expires_at timestamptz default now() + interval '14 days'
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_gate public.request_segmentation_v2_activation_gate_status%rowtype;
  v_approval_id uuid;
begin
  select * into v_gate
  from public.request_segmentation_v2_activation_gate_status;

  if not coalesce(v_gate.technical_quality_gate_passed, false) then
    raise exception 'request_segmentation_v2_activation_gate_blocked: %', v_gate.technical_blocking_reasons;
  end if;

  if length(btrim(coalesce(p_approved_by, ''))) < 3 then
    raise exception 'approved_by_required';
  end if;

  if length(btrim(coalesce(p_approval_reason, ''))) < 20 then
    raise exception 'approval_reason_too_short';
  end if;

  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'approval_expiry_must_be_within_30_days';
  end if;

  insert into public.request_segmentation_activation_approvals (
    approval_scope, approved_by, approval_reason, expires_at, gate_snapshot,
    policy_version, taxonomy_version, quality_gate_version
  ) values (
    'followup_pricing', btrim(p_approved_by), btrim(p_approval_reason), p_expires_at,
    to_jsonb(v_gate),
    'nt_policy_v2_20260819_cx8_shadow',
    'nt_taxonomy_v2_20260819_cx8',
    'nt_quality_gate_v2_20260819_cx8'
  )
  returning id into v_approval_id;

  return v_approval_id;
end;
$function$;

comment on function public.neontrip_approve_request_segmentation_activation(text, text, timestamptz) is
  'Creates a time-limited manual approval only for the exact passing CX8 quality-gate snapshot. Legacy approvals never authorize CX8.';

revoke all on function public.neontrip_approve_request_segmentation_activation(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.neontrip_approve_request_segmentation_activation(text, text, timestamptz)
  to service_role;

revoke all on table public.request_segmentation_v2_gold_evaluation from public, anon, authenticated;
revoke all on table public.request_segmentation_v2_confusion_matrix from public, anon, authenticated;
revoke all on table public.request_segmentation_v2_segment_quality from public, anon, authenticated;
revoke all on table public.request_segmentation_v2_quality_summary from public, anon, authenticated;
revoke all on table public.request_segmentation_v2_mapping_integrity from public, anon, authenticated;
revoke all on table public.request_segmentation_v2_activation_gate_status from public, anon, authenticated;
revoke all on table public.request_segmentation_v2_activation_approval_status from public, anon, authenticated;
revoke all on table public.request_segmentation_v2_production_readiness from public, anon, authenticated;

grant select on table public.request_segmentation_v2_gold_evaluation to service_role;
grant select on table public.request_segmentation_v2_confusion_matrix to service_role;
grant select on table public.request_segmentation_v2_segment_quality to service_role;
grant select on table public.request_segmentation_v2_quality_summary to service_role;
grant select on table public.request_segmentation_v2_mapping_integrity to service_role;
grant select on table public.request_segmentation_v2_activation_gate_status to service_role;
grant select on table public.request_segmentation_v2_activation_approval_status to service_role;
grant select on table public.request_segmentation_v2_production_readiness to service_role;

create or replace function public.neontrip_get_request_segmentation_automation_decision(
  p_request_id uuid
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  with request_row as (
    select mr.*
    from public.master_requests mr
    where mr.id = p_request_id
    limit 1
  ),
  active_policy as (
    select p.*
    from public.segment_policy_versions p
    where p.active
    order by p.created_at desc
    limit 1
  ),
  current_input as (
    select public.neontrip_compute_request_segment_input_hash(p_request_id) as input_hash
  ),
  latest_classification as (
    select c.*
    from public.request_segment_classifications c
    cross join active_policy ap
    where c.request_id = p_request_id
      and (
        (ap.taxonomy_version is null and c.taxonomy_version is null)
        or (
          ap.taxonomy_version is not null
          and c.taxonomy_version = ap.taxonomy_version
          and c.classifier_version = ap.classifier_version
          and c.prompt_version = ap.prompt_version
        )
      )
    order by c.created_at desc, c.id desc
    limit 1
  ),
  current_classification as (
    select c.*
    from public.request_segment_classifications c
    cross join active_policy ap
    cross join current_input ci
    where c.request_id = p_request_id
      and c.input_hash = ci.input_hash
      and (
        (ap.taxonomy_version is null and c.taxonomy_version is null)
        or (
          ap.taxonomy_version is not null
          and c.taxonomy_version = ap.taxonomy_version
          and c.classifier_version = ap.classifier_version
          and c.prompt_version = ap.prompt_version
        )
      )
    order by c.created_at desc, c.id desc
    limit 1
  ),
  policy_rule as (
    select r.*
    from public.segment_policy_rules r
    cross join active_policy ap
    cross join request_row mr
    where r.policy_version = ap.version
      and r.segment = mr.segment
      and (ap.taxonomy_version is null or r.taxonomy_version = ap.taxonomy_version)
    limit 1
  ),
  definition_state as (
    select coalesce(
      (
        select case
          when ap.taxonomy_version is null then exists (
            select 1
            from public.segment_definitions sd
            where sd.segment = mr.segment
              and sd.default_s_kategorie = mr.s_kategorie
              and sd.active
          )
          else exists (
            select 1
            from public.segment_taxonomy_definitions td
            where td.taxonomy_version = ap.taxonomy_version
              and td.segment = mr.segment
              and td.default_s_kategorie = mr.s_kategorie
              and td.active
          )
        end
        from request_row mr cross join active_policy ap
      ),
      false
    ) as mapping_valid
  ),
  readiness as (
    select
      legacy.followup_pricing_activation_allowed,
      legacy.blocking_reasons,
      legacy.technical_quality_gate_passed,
      legacy.has_manual_activation_approval
    from public.request_segmentation_production_readiness legacy
    cross join active_policy ap
    where ap.taxonomy_version is null
    union all
    select
      v2.followup_pricing_activation_allowed,
      v2.blocking_reasons,
      v2.technical_quality_gate_passed,
      v2.has_manual_activation_approval
    from public.request_segmentation_v2_production_readiness v2
    cross join active_policy ap
    where ap.taxonomy_version = v2.taxonomy_version
  ),
  authority as (
    select
      coalesce((
        select
          mr.segment_status = 'accepted'
          and mr.segment ~ '^NT-(1[0-8]|[1-9])$'
          and coalesce(mr.segment_source, '') ~ '^manual_[a-z0-9_]+$'
          and mr.segment_taxonomy_version is not distinct from ap.taxonomy_version
          and ds.mapping_valid
          and exists (
            select 1 from policy_rule pr
            where pr.s_kategorie = mr.s_kategorie
          )
        from request_row mr
        cross join active_policy ap
        cross join definition_state ds
      ), false) as manual_authority,
      coalesce((
        select
          mr.segment_status = 'accepted'
          and mr.segment_source = 'request_segmenter'
          and mr.segment_taxonomy_version is not distinct from ap.taxonomy_version
          and mr.segment_policy_version = ap.version
          and cc.status = 'accepted'
          and cc.segment = mr.segment
          and cc.s_kategorie = mr.s_kategorie
          and cc.input_hash = ci.input_hash
          and cc.policy_version = ap.version
          and cc.taxonomy_version is not distinct from ap.taxonomy_version
          and (
            ap.taxonomy_version is null
            or (
              cc.classifier_version = ap.classifier_version
              and cc.prompt_version = ap.prompt_version
              and cc.evidence_provenance_valid
              and cc.mapping_integrity
            )
          )
          and ds.mapping_valid
          and exists (
            select 1 from policy_rule pr
            where pr.s_kategorie = mr.s_kategorie
          )
        from request_row mr
        cross join current_classification cc
        cross join current_input ci
        cross join active_policy ap
        cross join definition_state ds
      ), false) as ai_authority
  ),
  checks as (
    select
      exists(select 1 from request_row) as request_exists,
      exists(select 1 from current_classification) as current_classification_exists,
      coalesce((select status = 'accepted' from current_classification), false) as current_classification_accepted,
      coalesce((select segment_status = 'accepted' from request_row), false) as request_segment_accepted,
      coalesce((select segment is not null from request_row), false) as request_has_segment,
      coalesce((select s_kategorie in ('S1', 'S2', 'S3', 'S4') from request_row), false) as request_has_valid_s_kategorie,
      coalesce((select mapping_valid from definition_state), false) as active_definition_mapping_valid,
      coalesce((
        select mr.segment_taxonomy_version is not distinct from ap.taxonomy_version
        from request_row mr cross join active_policy ap
      ), false) as master_taxonomy_matches_active,
      coalesce((
        select cc.taxonomy_version is not distinct from ap.taxonomy_version
        from current_classification cc cross join active_policy ap
      ), false) as classification_taxonomy_matches_active,
      coalesce((
        select cc.input_hash = ci.input_hash
        from current_classification cc cross join current_input ci
      ), false) as classification_input_current,
      coalesce((
        select cc.policy_version = ap.version
        from current_classification cc cross join active_policy ap
      ), false) as classification_policy_active,
      coalesce((select followup_pricing_activation_allowed from readiness), false) as readiness_allows_activation,
      coalesce((select mode from active_policy), 'missing') as policy_mode,
      coalesce((select mode in ('followup_canary', 'followup_live', 'pricing_canary', 'pricing_live') from active_policy), false) as mode_allows_followup,
      coalesce((select mode in ('pricing_canary', 'pricing_live') from active_policy), false) as mode_allows_pricing,
      coalesce((select automation_enabled from policy_rule), false) as policy_rule_automation_enabled,
      coalesce((select needs_human_review from policy_rule), true) as policy_rule_needs_human_review,
      coalesce((select max_followups > 0 from policy_rule), false) as policy_rule_has_followup,
      coalesce((select price_factor is not null from policy_rule), false) as policy_rule_has_price_factor,
      coalesce((select commercial_playbook->>'automation_enabled' = 'true' from request_row), false) as request_playbook_automation_enabled,
      coalesce((select manual_authority from authority), false) as manual_authority,
      coalesce((select ai_authority from authority), false) as ai_authority,
      coalesce((select manual_authority or ai_authority from authority), false) as authority_valid
  ),
  decisions as (
    select
      (
        request_exists
        and authority_valid
        and request_segment_accepted
        and request_has_segment
        and request_has_valid_s_kategorie
        and active_definition_mapping_valid
        and master_taxonomy_matches_active
        and readiness_allows_activation
        and mode_allows_followup
        and policy_rule_automation_enabled
        and not policy_rule_needs_human_review
        and policy_rule_has_followup
        and (manual_authority or request_playbook_automation_enabled)
      ) as can_use_for_followup,
      (
        request_exists
        and authority_valid
        and request_segment_accepted
        and request_has_segment
        and request_has_valid_s_kategorie
        and active_definition_mapping_valid
        and master_taxonomy_matches_active
        and readiness_allows_activation
        and mode_allows_pricing
        and policy_rule_automation_enabled
        and not policy_rule_needs_human_review
        and policy_rule_has_price_factor
        and (manual_authority or request_playbook_automation_enabled)
      ) as can_use_for_pricing
    from checks
  ),
  reason_codes as (
    select array_remove(array[
      case when not request_exists then 'request_not_found' end,
      case when request_exists and not authority_valid then 'no_current_authoritative_segmentation' end,
      case when request_exists and not master_taxonomy_matches_active then 'master_segment_taxonomy_not_active' end,
      case when request_exists and not active_definition_mapping_valid then 'active_taxonomy_definition_or_mapping_missing' end,
      case when request_exists and not manual_authority and not current_classification_exists then 'no_classification_for_current_input_and_contract' end,
      case when request_exists and not manual_authority and current_classification_exists and not current_classification_accepted then 'current_segmentation_classification_not_accepted' end,
      case when request_exists and not manual_authority and current_classification_exists and not classification_taxonomy_matches_active then 'classification_taxonomy_not_active' end,
      case when request_exists and not manual_authority and current_classification_exists and not classification_policy_active then 'classification_policy_not_active' end,
      case when request_exists and not request_segment_accepted then 'request_segment_status_not_accepted' end,
      case when request_exists and not request_has_segment then 'request_segment_missing' end,
      case when request_exists and not request_has_valid_s_kategorie then 'request_s_kategorie_missing_or_invalid' end,
      case when not readiness_allows_activation then 'production_readiness_or_manual_approval_blocked' end,
      case when not mode_allows_followup then 'active_policy_mode_does_not_allow_followup' end,
      case when not mode_allows_pricing then 'active_policy_mode_does_not_allow_pricing' end,
      case when request_exists and not policy_rule_automation_enabled then 'policy_rule_automation_disabled' end,
      case when request_exists and policy_rule_needs_human_review then 'policy_rule_requires_human_review' end,
      case when request_exists and not policy_rule_has_followup then 'policy_rule_has_no_followup_plan' end,
      case when request_exists and not policy_rule_has_price_factor then 'policy_rule_has_no_price_factor' end,
      case when request_exists and ai_authority and not request_playbook_automation_enabled then 'request_commercial_playbook_automation_disabled' end
    ], null) as items
    from checks
  )
  select jsonb_build_object(
    'request_id', p_request_id,
    'public_request_id', (select request_id from request_row),
    'generated_at', now(),
    'decision_status', case
      when (select can_use_for_followup or can_use_for_pricing from decisions) then 'allowed'
      else 'blocked'
    end,
    'can_use_for_followup', (select can_use_for_followup from decisions),
    'can_use_for_pricing', (select can_use_for_pricing from decisions),
    'reason_codes', coalesce((select to_jsonb(items) from reason_codes), '[]'::jsonb),
    'taxonomy', jsonb_build_object(
      'active_taxonomy_version', (select taxonomy_version from active_policy),
      'master_taxonomy_matches_active', (select master_taxonomy_matches_active from checks),
      'classification_taxonomy_matches_active', (select classification_taxonomy_matches_active from checks)
    ),
    'authority', jsonb_build_object(
      'kind', case
        when (select manual_authority from checks) then 'manual'
        when (select ai_authority from checks) then 'ai'
        else 'none'
      end,
      'valid', (select authority_valid from checks),
      'manual_authority', (select manual_authority from checks),
      'ai_authority', (select ai_authority from checks)
    ),
    'readiness', jsonb_build_object(
      'followup_pricing_activation_allowed', coalesce((select followup_pricing_activation_allowed from readiness), false),
      'blocking_reasons', coalesce((select to_jsonb(blocking_reasons) from readiness), '[]'::jsonb),
      'technical_quality_gate_passed', coalesce((select technical_quality_gate_passed from readiness), false),
      'has_manual_activation_approval', coalesce((select has_manual_activation_approval from readiness), false)
    ),
    'request_segment_state', jsonb_build_object(
      'segment_status', (select segment_status from request_row),
      'segment', (select segment from request_row),
      's_kategorie', (select s_kategorie from request_row),
      'segment_confidence', (select segment_confidence from request_row),
      'segment_source', (select segment_source from request_row),
      'segment_policy_version', (select segment_policy_version from request_row),
      'segment_taxonomy_version', (select segment_taxonomy_version from request_row),
      'context_tags', coalesce((select to_jsonb(segment_context_tags) from request_row), '[]'::jsonb),
      'organization_scale', (select segment_organization_scale from request_row),
      'segment_classified_at', (select segment_classified_at from request_row)
    ),
    'classification', jsonb_build_object(
      'latest_classification_id', (select id from latest_classification),
      'latest_status', (select status from latest_classification),
      'latest_segment', (select segment from latest_classification),
      'latest_confidence', (select confidence from latest_classification),
      'latest_taxonomy_version', (select taxonomy_version from latest_classification),
      'current_classification_id', (select id from current_classification),
      'current_status', (select status from current_classification),
      'current_segment', (select segment from current_classification),
      'current_confidence', (select confidence from current_classification),
      'current_input_hash_current', (select classification_input_current from checks),
      'current_policy_matches_active', (select classification_policy_active from checks),
      'current_taxonomy_matches_active', (select classification_taxonomy_matches_active from checks),
      'accepted_classification_id', (select case when status = 'accepted' then id end from current_classification),
      'accepted_segment', (select case when status = 'accepted' then segment end from current_classification),
      'accepted_confidence', (select case when status = 'accepted' then confidence end from current_classification),
      'accepted_evidence_grade', (select case when status = 'accepted' then evidence_grade end from current_classification),
      'accepted_at', (select case when status = 'accepted' then accepted_at end from current_classification)
    ),
    'policy', jsonb_build_object(
      'active_policy_version', (select version from active_policy),
      'active_policy_mode', (select mode from active_policy),
      'active_taxonomy_version', (select taxonomy_version from active_policy),
      'rule_automation_enabled', coalesce((select automation_enabled from policy_rule), false),
      'rule_needs_human_review', coalesce((select needs_human_review from policy_rule), true),
      'rule_max_followups', (select max_followups from policy_rule),
      'rule_first_call_after_minutes', (select first_call_after_minutes from policy_rule),
      'rule_sales_priority', (select sales_priority from policy_rule),
      'rule_has_price_factor', coalesce((select price_factor is not null from policy_rule), false)
    ),
    'allowed_playbook', case
      when (select can_use_for_followup or can_use_for_pricing from decisions) then
        jsonb_build_object(
          'segment', (select segment from request_row),
          's_kategorie', (select s_kategorie from request_row),
          'taxonomy_version', (select taxonomy_version from active_policy),
          'policy_version', (select version from active_policy),
          'mode', (select mode from active_policy),
          'sales_priority', (select sales_priority from policy_rule),
          'max_followups', case
            when (select can_use_for_followup from decisions) then (select max_followups from policy_rule)
            else 0
          end,
          'first_call_after_minutes', case
            when (select can_use_for_followup from decisions) then (select first_call_after_minutes from policy_rule)
            else null
          end,
          'pricing_enabled', (select can_use_for_pricing from decisions),
          'price_factor', case
            when (select can_use_for_pricing from decisions) then (select price_factor from policy_rule)
            else null
          end,
          'automation_enabled', true
        )
      else jsonb_build_object(
        'segment', null,
        's_kategorie', null,
        'taxonomy_version', null,
        'policy_version', null,
        'mode', null,
        'sales_priority', null,
        'max_followups', 0,
        'first_call_after_minutes', null,
        'pricing_enabled', false,
        'price_factor', null,
        'automation_enabled', false
      )
    end
  );
$function$;

comment on function public.neontrip_get_request_segmentation_automation_decision(uuid) is
  'Version-aware fail-closed authority. Manual and AI state must match the active taxonomy and active definition; legacy/null manual rows never authorize CX8 automation.';

revoke all on function public.neontrip_get_request_segmentation_automation_decision(uuid)
  from public, anon, authenticated;
grant execute on function public.neontrip_get_request_segmentation_automation_decision(uuid)
  to service_role;

commit;
