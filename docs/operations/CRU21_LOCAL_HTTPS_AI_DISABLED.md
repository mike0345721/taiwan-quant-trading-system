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

The V3 full-AI path still requires its own AI gates. The rollout helper now also
accepts the separate `cru21-rollout-plan-v4-local-market` schema, with scope
`MARKET_RESEARCH_AI_DISABLED`. It uses `check-cru21-local-market-target-env.mjs`;
the V3 checker and its AI requirement remain unchanged. Neither path is an approval.

## V4 preparation and controlled rollout

The V4 plan retains the exact candidate HEAD/tree, original main, formal/primary
roots, original process fingerprint, preserved report, Producer routing and hashed
original/target environment backups from V3. Its additional fields are `scope`,
`tlsBundle`, `tlsCertSha256`, `tlsBundleSha256` and `tlsEvidenceSha256`. Private
configuration and backups must stay outside Git. A pending plan with missing TLS
fields is deliberately non-executable; never substitute placeholder hashes.

`local-tls-preflight.json` must be real evidence, hashed by `tlsEvidenceSha256`, with
schema `cru21-local-tls-preflight-v1`, the same scope, `candidateHead`, certificate
pin and bundle hash. It requires actual `windowsTrustVerified`, `pfxLeafPinVerified`,
`loopbackHandshakeVerified` and `hostnameVerified` observations within one hour.
The cookie migration evidence hash must identify this same receipt. The runtime
also parses the PFX in memory and binds its actual leaf to the validated PEM before
opening any listener. No certificate creation or trust-store operation is provided.

`hard-gates.json` uses schema `cru21-local-market-hard-gates-v1`, binds scope/HEAD/
merged main, and requires Windows tests, CI, author review, reviewed rollback and
existing Owner authorization. Its two distinct `independentReviews` must each name
the reviewer, candidate HEAD, APPROVE verdict and evidence hash. Populate these only
from actual results. A model-content or formal-runtime-acceptance PASS is rejected
at this pre-cutover stage. AI stays disabled; no model test is needed for this scope.

Run `Preflight` before any approved `Deploy`. Deployment still checks existing
Bridge/Producer safety and identity; unavailable services are blockers, not permission
to restart them. It changes only the formal dashboard source/environment, starts the
server directly and records `STARTED_UNACCEPTED`. Then verify the trusted served pin,
normal browser login and Secure-cookie round trip, actual read/data identities and
honest missing-data display, plus recovery to the original service. A started process
or synthetic test is never formal acceptance. Preserve post-cutover evidence separately.

On failure, use the same plan and exact merged main with `Rollback`. The controller
rechecks source/configuration/backups and the recorded process fingerprint before
stopping only that dashboard; it restores the original base and environment. It does
not require working TLS material or the TLS prerequisite receipt to restore the old
HTTP service. Verify original health/version and login after rollback. Unknown PIDs,
source/configuration drift or corrupt backups stop recovery for reconciliation;
they must not be overwritten. Never restart Bridge/Producer or alter raw ledgers.

## Validation limits

`tests/dashboard-local-tls.test.mjs` covers mode restrictions, bounded file reading
with a synthetic decoder, rejected/corrupt input sanitization, decoded-buffer cleanup,
legacy HTTP fallback, disabled-AI zero-account-access and honest product metadata.
It also checks PFX leaf binding using static public Node test fixtures without opening
a connection. These fixtures do not qualify as the production localhost certificate.
The target checker uses synthetic configuration. The Windows V4 lifecycle suite
intercepts Git, network and process mutations, including failed startup and missing-TLS
rollback. These tests do not establish Windows trust, a production HTTPS handshake,
normal Owner login, real data acceptance or actual service recovery.
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
