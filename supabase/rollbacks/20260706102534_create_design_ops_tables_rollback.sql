alter table if exists public.design_jobs
  drop constraint if exists design_jobs_selected_asset_id_fkey,
  drop constraint if exists design_jobs_prompt_version_id_fkey;

drop table if exists public.design_offer_asset_links;
drop table if exists public.design_trello_removal_backups;
drop table if exists public.design_assets;
drop table if exists public.design_prompt_versions;
drop table if exists public.design_jobs;

delete from storage.objects where bucket_id = 'design-assets';
delete from storage.buckets where id = 'design-assets';
