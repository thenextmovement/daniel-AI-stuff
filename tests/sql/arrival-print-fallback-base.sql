\set ON_ERROR_STOP on
CREATE TABLE arrival_label_print_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid,
 printer_key text DEFAULT 'shipping-a6', document_kind text DEFAULT 'label',
 status text DEFAULT 'queued', attempts int DEFAULT 0, max_attempts int DEFAULT 3,
 lease_owner text, lease_expires_at timestamptz, claimed_at timestamptz,
 created_at timestamptz DEFAULT '2026-10-08 10:00Z', updated_at timestamptz, last_error text
);
CREATE TABLE arrival_label_cases (id uuid PRIMARY KEY, run_id uuid, status text, delivery_note_status text, manual_review_reason text, updated_at timestamptz);
CREATE TABLE arrival_label_events (run_id uuid,case_id uuid,event_key text UNIQUE,event_type text,severity text,actor text,payload jsonb);
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
