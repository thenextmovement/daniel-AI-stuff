# AI email facts package

This phase replaces loosely assembled commerce facts with a versioned, read-only
evidence contract.

## Architecture

The nine-node commerce resolver performs:

1. strict identity, organization-domain, phone, and time-window normalization;
2. service-role-only lookup of the local Shopify correlation index;
3. live Shopify Admin verification of candidate orders;
4. extraction of trusted offer and PDF-snapshot references from Shopify custom
   attributes and the order note without exposing the note itself;
5. deterministic selection that refuses a domain-only cross-contact guess;
6. read-only retrieval of the signed offer snapshot;
7. deterministic financial reconciliation from the signed totals snapshot,
   Shopify payment state, one unique internal corrected net price, and a matching
   invoice/additional-order amount;
8. construction of `commerce-facts-package-v2` with typed facts, provenance,
   conflicts, missing evidence, and risk gates.

The production draft agent keeps 30 nodes. Surgical patches make its existing
`Build Draft Prompt` node assemble `email-facts-package-v1` from Outlook message
metadata, conversation and organization coverage, deterministic attachment
presence, the commerce package, and approved knowledge version IDs.

Only facts marked `customer_safe: true` are claimable. The model must return exact
fact IDs. `Validate and Render` rejects unknown fact IDs, unverified money,
unverified order/offer references, unverified dates and URLs, malformed JSON, unsafe
commitments, missing attachment follow-ups, and internal telemetry disclosures.

The workflow still creates Outlook drafts only. Automatic sending remains disabled,
and every draft requires human approval.

## Shopify contract

The live query reads `Order.note` and `Order.customAttributes` in addition to the
order ID, name, creation time, financial status, and total. The query was validated
against Shopify's current Admin GraphQL schema.

- [Shopify orders query](https://shopify.dev/docs/api/admin-graphql/latest/queries/orders)
- [Shopify Order financial status](https://shopify.dev/docs/api/admin-graphql/latest/enums/OrderDisplayFinancialStatus)

## Tests

```bash
node workflows/email-facts-package/build-workflows.mjs
node workflows/email-facts-package/test-workflows.mjs
```

The tests cover organization-wide lookup, exact order selection, Shopify note offer
references, cross-contact ambiguity, GraphQL errors, signed-snapshot calculations,
German thousands separators, conflicting corrected prices, safety gates, workflow
structure, and every production patch anchor.

## Rollout

1. Create the v2 resolver as a new inactive workflow; leave v1 unchanged.
2. Validate the new workflow and run an isolated read-only live test.
3. Create an inactive exact backup of the production draft agent.
4. Activate v2 and atomically patch the draft agent plus its resolver reference.
5. Verify active published graphs, execution output, source coverage, facts package,
   draft-only behavior, and durable log snapshot.
6. Keep v1 active until the later staged rollout is complete.

## Rollback

1. Restore the inactive production-draft backup to workflow
   `aE1v0KxbgXbWjUm8`, including every recorded `onError` value.
2. Or surgically point `Resolve Commerce Evidence` back to
   `DldbjbPaVbAS3Avs` and reverse the patches in `mainWorkflowPatches`.
3. Deactivate the v2 resolver.
4. No database rollback is needed for this phase because the facts package is
   stored inside the existing `context_snapshot` JSONB field.
