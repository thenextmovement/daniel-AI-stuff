# Neon reference sizing implementation plan

Goal: Select sizes and acrylic contour treatment from supplier drawings; absence of a suitable reference stops automatic publication for review.

Scope: NEONTRIP services/neon-studio and its existing authenticated Ops proxy allowlist, plus a private Supabase reference catalog. Preserve prices, explicit dimensions, manual overrides, customer messaging restrictions and existing alert opt-out.

1. Persist the 100-card audit and a versioned selection of unambiguous supplier design references. Keep size evidence separate from requested/offered sizes and price training. Runtime uses the checked-in catalog snapshot; database changes require a reviewed snapshot release. Never ingest generated Studio attachments.
2. Add visual reference matching against actual supplier images and the current design. Validate selected IDs, evidence, line/print configuration and confidence. Copy the selected supplier width, never calculate a new floor. Cache decisions only for the exact model/spec/catalog fingerprint.
3. Remove automatic geometry minimum optimization from intake, reread and publication. Preserve manual sizes and explicit height conversion. Keep geometric fit checks as review gates, never enlargement. Exports label transferred values as reference recommendations.
4. Apply a supplier-inspired connected, rounded local silhouette when the image comparison supports it. Suppress artificial level text bands for this policy. Retain broad inter-row bridges and clearance checks. Compare resulting artwork visually before publication and direct downloads.
5. Test missing/malformed match, requested-size-only evidence, stale model, single/double and print mismatch, height/manual dimensions, fixed boards and actual contour geometry. Run existing cloud and geometry tests, review scoped diff, deploy exact Coolify Studio and Ops proxy targets, verify live commit and review behavior without customer sends.

Decisions: Supabase audit/reference records are separate from price training to avoid accidental price-anchor approval. Immutable deployment snapshot avoids adding database credentials to the Python renderer and makes a release reproducible. Catalog source image IDs stay auditable in both stores.

Verification: 100 audited cards persisted privately in Supabase; 47 supplier drawing references, 21 eligible size examples. 106 Python tests pass, authenticated proxy route test passes, production Next build passes. Actual NEW YORKER raster (200 cm) rendered: artificial top shelf removed, deep baseline slots closed. Live visual-model check accepted the revised cut and rejected VIKING as a size analogue. No customer messages.
