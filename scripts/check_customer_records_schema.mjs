const checks = [
  {
    table: "master_customers",
    select: "cc_emails",
    label: "master_customers.cc_emails",
    migration: "supabase/migrations/202605210005_add_customer_cc_emails.sql",
  },
  {
    table: "sales_call_list_items",
    select: "visual_candidates_json,visual_snapshot_created_at",
    label: "sales_call_list_items.visual_candidates_json + visual_snapshot_created_at",
    migration: "supabase/migrations/202605210004_add_sales_call_visual_snapshots.sql",
  },
  {
    table: "design_jobs",
    select: "id,job_key,status,prompt_version_id,selected_asset_id",
    label: "design_jobs core columns",
    migration: "supabase/migrations/20260706102534_create_design_ops_tables.sql",
  },
  {
    table: "design_prompt_versions",
    select: "id,job_id,version_number,prompt_hash",
    label: "design_prompt_versions core columns",
    migration: "supabase/migrations/20260706102534_create_design_ops_tables.sql",
  },
  {
    table: "design_assets",
    select: "id,asset_key,job_id,status,public_url,trello_attachment_id",
    label: "design_assets core columns",
    migration: "supabase/migrations/20260706102534_create_design_ops_tables.sql",
  },
  {
    table: "design_trello_removal_backups",
    select: "id,backup_key,status,attachments",
    label: "design_trello_removal_backups core columns",
    migration: "supabase/migrations/20260706102534_create_design_ops_tables.sql",
  },
  {
    table: "design_offer_asset_links",
    select: "id,link_key,asset_id,offer_id,status",
    label: "design_offer_asset_links core columns",
    migration: "supabase/migrations/20260706102534_create_design_ops_tables.sql",
  },
  {
    table: "offer_size_quote_anchor_sets",
    select: "id,set_key,trello_card_id,product_model,customer_factor,status,confidence",
    label: "offer_size_quote_anchor_sets core columns",
    migration: "supabase/migrations/20260707131358_create_offer_size_ladder_quotes.sql",
  },
  {
    table: "offer_size_quote_anchors",
    select: "id,anchor_set_id,role,width_cm,height_cm,production_price,shipping_price",
    label: "offer_size_quote_anchors core columns",
    migration: "supabase/migrations/20260707131358_create_offer_size_ladder_quotes.sql",
  },
  {
    table: "offer_size_options",
    select: "id,anchor_set_id,size_label,customer_unit_price_net,review_status,is_default",
    label: "offer_size_options core columns",
    migration: "supabase/migrations/20260707131358_create_offer_size_ladder_quotes.sql",
  },
];

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} fehlt.`);
  }
  return value;
}

async function checkTable(baseUrl, serviceRoleKey, check) {
  const url = new URL(`/rest/v1/${check.table}`, baseUrl);
  url.searchParams.set("select", check.select);
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "count=exact",
    },
  });

  if (response.ok) {
    return { ok: true, check };
  }

  const body = await response.text();
  return {
    ok: false,
    check,
    status: response.status,
    body: body.slice(0, 500),
  };
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const results = await Promise.all(checks.map((check) => checkTable(supabaseUrl, serviceRoleKey, check)));
  const failures = results.filter((result) => !result.ok);

  if (failures.length) {
    console.error("Customer Records Ops Schema-Check fehlgeschlagen.");
    for (const failure of failures) {
      console.error(`- ${failure.check.label} fehlt oder ist nicht lesbar.`);
      console.error(`  Migration: ${failure.check.migration}`);
      console.error(`  HTTP ${failure.status}: ${failure.body}`);
    }
    process.exit(1);
  }

  console.log("Customer Records Ops Schema-Check: Pflichtspalten vorhanden.");
}

main().catch((error) => {
  console.error(`Customer Records Ops Schema-Check fehlgeschlagen: ${error.message}`);
  process.exit(1);
});
