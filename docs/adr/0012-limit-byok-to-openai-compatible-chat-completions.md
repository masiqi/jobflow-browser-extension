# ADR 0012: Limit BYOK to OpenAI-compatible Chat Completions

- Status: Accepted
- Date: 2026-09-10

## Context

Provider-native APIs differ in authentication, message schemas, structured output, model discovery, error handling, and streaming. Implementing many protocols in the first milestone would multiply privacy and validation paths.

A completely unrestricted compatible endpoint would also turn the Edge Function into an authenticated arbitrary URL forwarder and create SSRF, credential leakage, and inconsistent-output risks.

## Decision

First-milestone BYOK supports only the OpenAI-compatible Chat Completions protocol.

Provide presets for OpenAI, DeepSeek, and OpenRouter. Also provide an advanced custom compatible provider with exactly:

- a public HTTPS base URL;
- a model identifier;
- a Bearer API key.

Do not support HTTP, URL-embedded credentials, query-string credentials, arbitrary request headers, localhost, IP literals, private networks, loopback, link-local, reserved ranges, or cloud metadata targets. Revalidate every redirect target and the resolved destination before sending credentials or user data.

Every provider configuration must pass a connection test and the product's required structured JSON output test using only synthetic product-owned text. Changing the endpoint, model, or credential invalidates the test and blocks resume or JD processing until it passes again.

The interface displays the normalized final endpoint, provider, and model before the user activates the configuration.

Native Anthropic, Gemini, Ollama, and other provider-specific protocols are deferred. A user may reach those models through a supported OpenAI-compatible gateway.

## Consequences

- One backend adapter and validation contract cover first-milestone BYOK.
- Custom endpoints require defense against redirects, DNS rebinding, sensitive error propagation, and response-size abuse.
- Users of native-only APIs need a compatible gateway or must wait for a later adapter.
- Provider presets are configuration conveniences, not permission to skip connection or structured-output tests.
