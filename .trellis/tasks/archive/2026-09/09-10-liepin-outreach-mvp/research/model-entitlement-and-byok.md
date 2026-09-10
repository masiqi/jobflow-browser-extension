# Managed model entitlement and BYOK reference

- Researched: 2026-09-10
- Reference product: Immersive Translate

## Publicly documented pattern

Immersive Translate offers a paid membership with managed AI translation benefits. Its service documentation also lets users choose services that require their own API key, including OpenAI and Azure OpenAI, and documents custom OpenAI API addresses.

Sources:

- [Immersive Translate pricing](https://immersivetranslate.com/pricing/)
- [Immersive Translate translation services](https://immersivetranslate.com/docs/services/)
- [Immersive Translate OpenAI service](https://immersivetranslate.com/en/docs/services/openai/)
- [Immersive Translate Azure OpenAI service](https://immersivetranslate.com/docs/services/azure-openai/)

## Applicable lesson

Separate product entitlement from provider configuration:

- membership can include a managed service and quota;
- BYOK remains available as an explicit user-selected route;
- provider choice and current route must be visible;
- a managed-service failure must not silently spend a user's BYOK balance, and a BYOK failure must not silently spend managed quota.

## Limitation

The reviewed public documentation did not clearly establish whether Immersive Translate stores user API keys only on the current device, synchronizes them through an account, or applies additional client-side protection. This product must define and disclose its own credential persistence model rather than claim the reference product's behavior.
