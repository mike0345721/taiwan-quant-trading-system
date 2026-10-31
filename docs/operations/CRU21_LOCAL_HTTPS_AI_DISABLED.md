# CRU-21 local HTTPS / AI-disabled runtime support

This is an opt-in runtime capability, **not a deployment approval or a completed rollout**.
Owner selected a narrower market/research-only delivery; the full AI lane remains separate.

## Explicit scope

`DASHBOARD_RELEASE_SCOPE=MARKET_RESEARCH_AI_DISABLED` requires host `127.0.0.1`, port
8787, production/LIVE configuration, secure cookies, no proxy trust, and
`ASK_GPT_INLINE_ENABLED=0`. Guest, preview, isolated integration, Node preload and
TLS-verification relaxation cannot be combined with this scope. No scope preserves
legacy HTTP behavior; TLS settings without the scope are rejected.

`DASHBOARD_TLS_BUNDLE` identifies a dedicated local DPAPI CurrentUser-protected TLS
bundle. `DASHBOARD_TLS_CERT_SHA256` pins the public certificate. The bundle schema
is `cru21-local-tls-bundle-v1`, containing a PKCS12 PFX, its random passphrase and
public certificate PEM. The private material is not a repository file, a real app
account, or an input to the model/broker services. Errors never print the material.
The loader checks bounded single-link files, path aliases, public-certificate pin,
loopback SANs, validity, non-CA status and server-auth EKU. TLS minimum is 1.2.

TLS is native to the Dashboard process. No public listener, reverse proxy, trustProxy
change, automatic certificate enrollment, browser security flag, or trust-store
modification is implemented by these source files. Existing normal login, password
hash, sessions and CSRF checks are retained. The TLS loader does not inspect an AI
or broker credential store. Disabled assistant status must not call its store or
transport factories; explicit account-load attempts remain refused.

The new local product-surface metadata describes the existing six rolling windows.
It retains deliveryAccepted=false, dataQualificationDeclared=false and all no-order
research-only restrictions. It is not evidence that current source data is qualified.

## Required checks before activation

An approved certificate-enrollment action must succeed through supported tooling.
Inspect the exact public certificate installed for the current user and verify the
actual served certificate, normal HTTPS browser login, secure-cookie round-trip,
recovery to the original service, and relevant data-read/source identities. Validate
that the served PKCS12 certificate matches the declared PEM/pin; source parsing alone
is not a successful TLS handshake or certificate-store test.

The existing V3 full-AI rollout helper is **unchanged** and still requires its own AI
gates. Do not relabel an AI-disabled plan as a full-AI pass. A reviewed, explicitly
scoped deployment/rollback path and the real private target configuration are still
required before production; this commit does not create those attestations.

## Validation limits

`tests/dashboard-local-tls.test.mjs` covers mode restrictions, bounded file reading
with a synthetic decoder, rejected/corrupt input sanitization, decoded-buffer cleanup,
legacy HTTP fallback, disabled-AI zero-account-access and honest product metadata.
It does not create or trust certificates, use DPAPI on real secrets, prove a successful
PKCS12 handshake, start formal services, or complete normal Owner login/rollback.
Existing UI/preview and read-only AI regressions remain separate evidence.

On 2026-10-31 a certificate-enrollment/trust request was rejected by the tool safety
check before any execution result was returned. Its destination directory was then
observed absent and the exact new certificate FriendlyName had zero matches in the
current-user personal store. No alternative enrollment method or repeat attempt was
used. This event does not imply all remote tools are unavailable.

Primary API references:
- https://nodejs.org/docs/latest-v24.x/api/https.html
- https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.dataprotectionscope
- https://learn.microsoft.com/en-us/powershell/module/pki/new-selfsignedcertificate
