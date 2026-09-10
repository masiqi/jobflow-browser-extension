# ADR 0015: Parse resumes locally before model extraction

- Status: Accepted
- Date: 2026-09-10

## Context

Users commonly have PDF and DOCX resumes, while the existing prototype supports only text-layer PDF, TXT, and Markdown. Scanned documents require OCR and introduce larger dependencies and lower-confidence extraction.

The accepted BYOK protocol is text-oriented OpenAI-compatible Chat Completions. Provider-specific binary upload APIs would create multiple privacy and compatibility paths.

## Decision

Support these first-milestone resume sources:

- text-layer PDF;
- DOCX;
- UTF text and Markdown;
- pasted plain text.

Uploaded files have a 10 MiB maximum. Validate actual structure and content rather than trusting extension or MIME type.

The Chrome client extracts and normalizes text, computes the source hash, and keeps the original source locally. The selected model receives normalized text and required metadata and performs semantic extraction into a schema-validated draft resume profile.

Do not send PDF or DOCX binary data to a model provider. Do not persist normalized full resume text in Supabase after processing.

Reject scanned or image-only PDF, legacy DOC, images, damaged sources, and sources with insufficient text. Explain that the user can provide DOCX, a text-layer PDF, TXT, Markdown, or pasted text. OCR is deferred.

Pasted text becomes an authoritative local text source and follows the same hash, review, replacement, and deletion lifecycle as a file.

When an identical source hash already has a draft or active profile, reopen that profile without another model call.

## Consequences

- DOCX parsing becomes a new client dependency and needs hostile-container and size-limit tests.
- Text extraction may lose layout, images, comments, and tracked changes; the model sees normalized text only.
- Image-resume users must convert their source or paste text.
- One text-based extraction contract works for managed and BYOK model routes.
