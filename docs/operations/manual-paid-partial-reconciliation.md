# NEONTRIP: equal manual instalments

The active manual reconciliation workflow is `6NZnfGpyfUVikqpf`. Equal instalments cannot be assigned from amounts alone. A complete Easybill payment history with an exact Qonto-ID, amount, date and document match can prove which instalment is already booked. Missing or conflicting proof remains blocked.

The central `billing_payment_ingest` function normally creates an Easybill job for the cumulative paid total. That job must not accompany an exact remainder job for an invoice that is already partially paid.

Migration `20261013111500_manual_paid_partial_projection.sql` adds the bounded `EXACT_EXISTING_INVOICE_REMAINDER` evidence contract to that existing function. It verifies the provider, manual reconciliation source, provider transaction membership, positive paid/remainder amounts, total and existing finalized invoice binding before suppressing only the cumulative Easybill job. The manual workflow remains responsible for its existing per-Qonto projection job. Bank ledger registration, provider idempotency, Shopify state and other payment policies retain their existing behavior. No schema, queue or new workflow is introduced.

The migration patches the current function at two unique anchors and aborts on drift. This preserves deployed policy logic that is not present in the older baseline migration, including Skonto. Capture and compare the complete live function before applying it.

Release order:

1. Approve the exact clean Ops commit, complete predeploy and publish through the repository helpers.
2. Apply and read back this database migration before enabling the ledger-based instalment release in the manual workflow.
3. The manual workflow sets `projectionPolicy` only after the exact live ledger proof. Its remainder job carries `manualPaidQontoProof`.
4. Payment projection worker `K9poQw3a1DOO16Vd` reads the invoice and full payment history again. It blocks conflicting amounts and uncertain retries, reuses an existing payment with the exact Qonto-ID, and verifies the provider response. This path applies only to jobs carrying that proof; collective payments retain their existing path.
5. Observe scheduled operation without replaying a payment or customer email. Verify the canonical bank/payment records, exact existing Easybill invoice, final balance and existing delivery proof.

Rollback order: first restore the manual workflow to the previous amount-only guard, then apply the scoped rollback SQL. Restoring code cannot reverse an already booked payment. Keep the independently deployed intake deduplication and atomic internal-alert claim.

Local verification: `tests/sql/billing-manual-paid-partial-projection.test.sql` runs in a transaction on a disposable PostgreSQL instance with the current function and billing schema. It verifies equal instalments, duplicate provider IDs, invalid evidence, absence of duplicate document/mail jobs, and unchanged full-payment and Skonto paths. Never run this fixture against production.
