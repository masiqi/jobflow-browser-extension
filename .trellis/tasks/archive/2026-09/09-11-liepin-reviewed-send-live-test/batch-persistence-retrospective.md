# Bug Analysis: batch stops after the first detail

## 1. Root Cause Category

- **Category**: B / D / E - Cross-layer contract, test coverage gap, and implicit structural-typing assumption.
- **Specific Cause**: `handleDetail` spread a validated `DetailJob` into the narrower `BatchItem.candidate`. TypeScript accepted the structurally compatible value, while the strict persisted `ListCandidate` schema rejected its detail-only fields on the next read. The first item could finish from the in-memory object, but the next alarm read `null` and stopped the queue.

## 2. Why The Existing Checks Missed It

1. Batch unit tests covered state transitions without crossing the Chrome Storage encode/decode boundary.
2. Storage tests covered malformed reads but not validation before writes.
3. The first item finishing made the failure look like a rule-driven queue stop instead of persisted-state corruption.

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Ownership boundary | Keep `DetailJob` fields only in the owner-scoped opportunity record | Done |
| P0 | Runtime validation | Strictly parse batch runs and scan previews before overwriting Chrome Storage | Done |
| P0 | Integration test | Exercise `DETAIL_READY` through background handling, storage, strict decoding, and next-item state | Done |
| P1 | Contract documentation | Record the summary/detail separation and write/read validation rule | Done |

## 4. Systematic Expansion

- Other persisted extension records can fail the same way when a richer object is assigned through structural typing or object spread.
- Durable state must be validated at the write boundary so the error is attributed to the mutation that caused it.
- Queue recovery tests must cross the actual persistence boundary; pure reducer tests cannot prove recoverability.

## 5. Knowledge Capture

- `.trellis/spec/frontend/jobflow-cross-layer-contracts.md` now owns the JobFlow batch summary/detail and write-validation contracts.
- `tests/batch-persistence.test.ts` covers the real background/storage seam for review and exclusion outcomes.
- `tests/storage.test.ts` proves invalid run and scan writes cannot overwrite the last stored value.
