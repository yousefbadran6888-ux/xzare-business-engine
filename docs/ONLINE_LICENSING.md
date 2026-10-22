# Public-source license notice

This document describes branded desktop activation and historical deployment requirements. It does not restrict the AGPL-3.0-only rights granted for this source revision. Core examples and tests do not require a paid license. See [OPEN_SOURCE.md](OPEN_SOURCE.md) for the distinction.

---

# Xzare POS 0.2 — Online licensing and release gates

Implemented locally; the service has **not** been deployed. No real HTTPS host/domain or Windows signing certificate was supplied. `apps/pos/licensing.json` deliberately has `origin: null`; activation stays disabled until the publisher sets the real origin and rebuilds. This installer is for review before commercial distribution.

## Customer behavior

- First-run setup creates the actual store and owner account. Commercial writes require activation; there is no resettable local 30-day trial in the Windows 0.2 client. Reading/export/backup and shift close remain available.
- A purchase has a cryptographically random 256-bit activation code. The operator delivers it privately; issuance does not log it. The server stores its SHA-256 digest, not the code. Never send a code through an application log.
- Activation binds the purchase to one Ed25519 installation public key. A second identity cannot reuse the same code. Renewals require proof of the matching private key. Device keys and the signed lease are protected with Windows DPAPI in `device-license.protected`, outside the business database and `.xzbak` archive.
- The issuer signs a version-2 lease bound to device, purchase, expiry and the fresh request nonce. A paid perpetual purchase still receives leases of at most **7 days**, never a perpetual offline token. Term purchases are additionally bounded by their purchase expiry.
- Renewal runs on startup and hourly; the administrator can retry from settings. Network outages and HTTP 400/429/503 do not extend grace or discard a healthy lease. An authenticated HTTP 403 from the publisher stops the current license. Revocation takes effect on the next successful check; an offline device may retain its existing grace.
- The default strongest policy requires a new online renewal after **Windows reboots**. Within the same boot, application restarts can use the remaining signed grace; kernel uptime plus signed server issue time prevents old-file/frozen-clock replay. If the trusted Windows boot provider is unavailable, renewal is required after **each application launch**. This restricted coding environment cannot access WMI/CIM; normal Windows provider acceptance remains to be tested.
- The supported boot helper resides under `C:\Windows`; it imports only absolute Windows PowerShell Utility/CimCmdlets modules and receives a fixed minimal environment. A different Windows installation directory uses the safe per-launch renewal fallback. Caller `SystemRoot`/`PSModulePath` cannot select an executable/module. `requireOnlineAfterReboot:false` is a publisher-only weaker policy; it forfeits the reboot rollback protection and is not the shipped default.
- Correct an accidental clock jump in Windows, then renew online. A fresh nonce-bound signed response repairs the protected high-water time. Old signed responses cannot repair or unblock a revoked license.
- The activation field is masked, is cleared as soon as submission begins, and is never populated with a stored code. Public device IDs and the issuer public verification key are not secrets. The issuer **private** key must stay on the operator/server only.

## Run the backend on an actual host

Build with `node tools/tasks.mjs build`. Transfer server tooling, the built `packages/db` and `packages/engine` dependencies, and **privately** provision the existing issuer key that matches `apps/pos/license-public-key.pem`. The customer installer does not include `license-authority.js`, server tooling or an issuer private key. Native dependencies must match the host OS/architecture; the local verified backend is Windows/Node 22. A different host requires its own dependency install and acceptance tests.

Create a private operator JSON configuration, not a public client file:

```json
{
  "database": "ABSOLUTE_PRIVATE_SERVER_DATABASE_PATH",
  "privateKey": "ABSOLUTE_PRIVATE_ISSUER_KEY_PATH",
  "port": 5291,
  "proxyToken": "64_HEX_CHARACTERS_FROM_32_CRYPTOGRAPHICALLY_RANDOM_BYTES"
}
```

Those strings are placeholders and must be replaced with real host paths and a newly generated secret. Use restricted file ACLs (only service/operator) and keep the database, key, proxy configuration and purchase output files outside Git, the web root and client packages. Windows `mode:0600` alone does not establish a Windows ACL. Existing local issuer key restrictions were retained; no issuer key was rotated.

```powershell
node tools/license-server.mjs serve PRIVATE_CONFIG_JSON
node tools/license-server.mjs issue PRIVATE_CONFIG_JSON "اسم العميل الحقيقي" PRIVATE_NEW_PURCHASE_JSON
node tools/license-server.mjs issue PRIVATE_CONFIG_JSON "اسم العميل الحقيقي" PRIVATE_NEW_PURCHASE_JSON 2027-01-01T00:00:00Z
node tools/license-server.mjs revoke PRIVATE_CONFIG_JSON PURCHASE_ID
```

The issue command requires a new output file and commits the purchase only after successful private delivery to that file. Manage purchases through the operator CLI; there are no exposed issue/revoke/admin HTTP routes. Revocation is intentionally supported; self-service device transfer is not. Lost protected device keys need operator-assisted reissue. Revoke the old purchase and account for its outstanding offline grace before transferring a seat.

Place a real HTTPS reverse proxy in front of loopback `127.0.0.1:5291`. Never expose the Node port publicly. TLS certificates must validate normally; the client disallows HTTP, URL credentials, paths and redirects in the publisher origin. The renderer cannot choose an activation URL. Proxy configuration must **overwrite**, not pass through, these headers:

```nginx
proxy_pass http://127.0.0.1:5291;
proxy_set_header X-Xzare-Client-IP $remote_addr;
proxy_set_header X-Xzare-Proxy-Token REPLACE_WITH_PRIVATE_PROXY_TOKEN;
client_max_body_size 4k;
proxy_connect_timeout 5s;
proxy_read_timeout 10s;
```

These are directives for the actual HTTPS location block, not a complete deployment. Use per-IP edge limits, patch the host and proxy, restrict service filesystem rights, monitor availability without logging bodies/codes/private headers, and maintain protected authority database backups. Backend limits use the authenticated proxy source, bound request bodies, timeouts and concurrent connections. Proxy/database faults return retryable 503, not license revocation. Preserve the authority database and issuer key together; restoring an older authority database can restore old revocation/seat state. Review revocations before bringing a restored service online.

After HTTPS is configured, set the actual origin in `apps/pos/licensing.json`, rebuild the installer, issue a real purchase, and verify activate/renew/revoke and restore on normal Windows. Certificate/private key material never goes in that client JSON.

## Package hardening and remaining limits

The production binary disables RunAsNode, NODE_OPTIONS, CLI inspection and DevTools, requires ASAR loading and ASAR integrity, and ignores QA data/debug environment overrides. It refuses the diagnostic no-sandbox/debug switches. Renderer sandbox/context isolation remain configured. These protections reduce simple editing/debug bypasses, but an administrator can patch an unsigned executable or run modified code. This build is **not Authenticode signed**. Obtain a real commercial signing certificate and protect the build/signing pipeline before sale.

DPAPI protects data from other Windows users and normal device copies; it does not prevent other programs running as the same user from invoking decryption. It is not TPM attestation. Malware, administrator access, whole OS/VM cloning, extracted device keys and binary patching are not eliminated by this release. Preventing all piracy in a fully offline, attacker-controlled client is not a defensible promise. No penetration-test percentage or 'zero risk' result has been measured. See [Electron safeStorage semantics](https://www.electronjs.org/docs/latest/api/safe-storage) and [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses).

Legacy 0.1 offline licenses do not activate 0.2; operator reissue is required for the new installation identity. Upgrade preserves store data, but do not replace a working customer installation before the real service and its purchase are ready. New backups scrub legacy license strings; historical database/backup files are not claimed to have been forensically erased.

## Verification

`node tools/tasks.mjs verify` checks strict source/test types and all unit/integration tests. Licensing tests include one-device binding, request/response replay, revocation, clock correction, same-boot snapshot/frozen-clock expiry, reboot gating, signature/grace/term bounds, encrypted-state corruption and missing-key protection. `node tools/license-server-check.mjs` exercises real loopback HTTP, per-source throttling, proxy/database retry behavior and failed issuance rollback with synthetic test keys. `node tools/ui-workflows.mjs` covers scanner Enter, leading zeros, existing-product opening and normal sales/returns/stock flows. `node tools/inspect-package.mjs` checks actual binary fuses and package contents. Development native integration verified DPAPI-backed store creation, SQLite/Argon2, IPC and renderer isolation; its explicit diagnostic renderer sandbox bypass is not shipped and does not prove normal Windows sandbox acceptance.
