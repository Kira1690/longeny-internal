# Textract — OCR for scanned report pages

ai-content's report reader sends a page to Textract only when it has no text of
its own (a scan, a screenshot, a phone photo). Pages go in the request itself
(`Document.Bytes`), one page at a time, so Textract never reads the bucket and
needs no S3 permission of its own.

Region: `ap-south-1` (`TEXTRACT_REGION`), the bucket's region — report data stays
in India. Textract is HIPAA-eligible.

Textract actions do not support resource-level scoping, hence `"Resource": "*"`;
the policy grants only the two synchronous read actions.

## Apply (project credentials — never the global ~/.aws)

```bash
source internal-notes/aws/env.sh
aws iam put-role-policy --role-name longeny-dev-bedrock \
  --policy-name textract-read-report-pages \
  --policy-document file://longeny-internal/infrastructure/textract/role-policy.json
```

Server `.env`: `REPORT_OCR_PROVIDER=textract`. ai-content refuses to boot deployed
with `fake`.

## Cost (AWS list price, verify before scaling)

AnalyzeDocument with TABLES ≈ $15 per 1,000 pages. Pay per page; nothing when idle.
Text-layer PDFs cost nothing. `REPORT_OCR_MAX_PAGES` (default 30) caps one report,
and a failed read can be retried 3 times per report per hour.
