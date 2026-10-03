# BOEKUNA — document review beginner UX implementation plan

**Date:** 2026-10-03  
**Base:** `5ee8e6f16fc1e98553fb4c073ab57807953d38a8`  
**Scope:** app-only post-scan review. The OCR/document processor stays unchanged unless a proven blocker requires otherwise.

## Approved design contract

The supplied master specification is the approved product design for this implementation. The implementation must preserve the existing cent-based financial engine and document processor, while replacing the post-scan presentation and resolution flow.

### Requirement matrix

| Field | Receipt | Purchase invoice | Sales/self-bill invoice | Credit invoice | Default state |
|---|---|---|---|---|---|
| party | required; uncertainty may defer when a recognized value exists | blocking | blocking | blocking | core |
| issueDate | blocking | blocking | blocking | blocking | core |
| invoiceNumber | optional | blocking | blocking | blocking | core when invoice |
| category | attention/non-blocking | attention/non-blocking | hidden/not applicable | attention/non-blocking | core for purchase |
| net | blocking when VAT is present; otherwise derived/confirmed | blocking | blocking | blocking | core |
| vatAmount | blocking when VAT is present | blocking | blocking | blocking | core |
| gross | blocking | blocking | blocking | blocking | core |
| vatRate | blocking for single-rate VAT | blocking for single-rate VAT | blocking for single-rate VAT | blocking for single-rate VAT | core |
| vatLines | blocking only when mixed VAT | blocking only when mixed VAT | blocking only when mixed VAT | blocking only when mixed VAT | conditional |
| currency | hidden for EUR; shown when non-EUR | same | same | same | optional/conditional |
| address / postal / city / KVK / VAT ID / IBAN / email / phone | optional | optional | optional | optional | More gegevens |
| payment reference / order number / payment term / due date / description / payment method | optional unless existing product logic requires it | optional | optional | optional | More gegevens |
| document type / booking type | required system context | required system context | required system context | required system context | More gegevens unless uncertain |

Rules:
- Blocking = cannot definitively save.
- Attention = may save with an explicit `Later controleren` flag.
- Optional = never warned about solely because it is missing.
- No generic `Negeren`.
- User-confirmed data outranks calculated data, which outranks recognition.
- Mixed VAT always has `vatRate = null` and exact editable VAT lines.
- All money invariants are integer-cent exact.

## Delivery slices

### 1. Tests first
Add a dedicated Chromium/WebKit regression that asserts:
- 3-step beginner review and progressive disclosure;
- context-dependent requirements;
- no confidence percentages / no generic ignore action;
- exact financial mismatch detection;
- two-of-three proposal continuity;
- editable 9% + 21% VAT lines with exact reconciliation;
- duplicate acknowledgement;
- defer-only non-blocking attention;
- mobile overflow/touch targets;
- saved review snapshot/provenance can be reopened.

### 2. Beginner review runtime
Add `document-review-v2.js` and `document-review-v2.css` as an app-only layer. Reuse:
- `BookunaFinancialCorrection`;
- existing persistence;
- existing document-processing jobs;
- existing provenance helpers.

Do not create a second money engine.

### 3. Persistence and attention
Before save:
- validate blocking issues;
- revalidate on every relevant edit;
- persist user confirmation and mixed VAT edits.

After successful save:
- persist a review snapshot on the document;
- persist non-blocking deferred fields as `reviewAttentionFields`;
- mark manually resolved OCR uncertainty as user-reviewed;
- expose deferred fields in Actie nodig;
- allow resolving deferred party/category without creating a duplicate booking.

### 4. Regression gate
Run the new Chromium/WebKit test plus existing:
- smart financial correction;
- document upload;
- document background processing;
- document verification;
- product UI/Axe;
- mobile;
- contextual resolution;
- tenant isolation;
- production calculations;
- invoice/email regressions.

### 5. Release
Freeze exact PR HEAD, inspect diff and checks, fix all findings, squash-merge only on green, deploy the app surface only, then smoke:
- normal receipt;
- missing/uncertain supplier;
- missing optional company data;
- exact financial mismatch;
- single VAT;
- mixed VAT;
- correction;
- save/reopen;
- attention clearing.

No marketing, processor, or Supabase deployment unless the diff actually requires it.
