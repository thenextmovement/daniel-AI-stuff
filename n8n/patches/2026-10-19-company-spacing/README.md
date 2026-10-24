# Exact company spacing in Qonto reference matches

PROJ-001 / NEONTRIP; issue #178. Only `Validate Order` in workflow `2fRdyqdyVDMWwH4O` changes.

After a strictly parsed NEONT reference and the existing amount/cancellation checks, company fields may match when their normalized spelling is identical after removing word separators. Requires distinctive words on both sides and at least six characters. The new rule does not apply to personal-name fields, fuzzy references or amount-only rematching. Existing matching behavior is otherwise unchanged.

Apply to a fresh copy of the affected node's JavaScript (not a full workflow export):

```sh
node patch.mjs input-node.js output-node.js
VALIDATE_ORDER_SOURCE=/absolute/path/output-node.js node --test matching.test.mjs
```

24 behavioral tests: original node 16 passed / 8 failed; patched node 24 passed. A read-only native n8n preview with the actual bank and Shopify responses changed the failure into EXACT_COMPANY_COMPACT and requested no duplicate Shopify payment. Four existing internal-alert routing/deduplication checks also passed without sending mail.

Service version `f7717f54-3453-4e05-b8aa-1d686f20e388` was published under the user's focused repair request. Only one node changed; all other nodes, credentials, connections, settings and active state were verified unchanged. The validator's 10 existing findings and 98 warnings are unchanged; no new finding belongs to this patch. Runtime preview succeeded. No app code, schema migration, application build or app deployment is involved.

The separately initiated manual-paid reconciliation completed the concrete payment while this repair was being tested. No replay, new financial mutation or customer message was initiated by this repair. Production/customer data used for verification stays outside Git.
