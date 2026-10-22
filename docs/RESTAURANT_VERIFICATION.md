# Restaurant 0.2 verification — 2026-10-04

Update built in this writable Documents workspace. D:/Xzare-POS remained unchanged: writes still fail there despite permission grant. Source-only copy; no vendor private key, business database, backups or default account copied. Existing installed dependencies are linked from D: for local development; the Windows installer contains its own required runtime.

## Verification performed

- Source build and test typecheck passed. Full suite: **29 files, 339 tests, zero failures**. New regressions were observed failing before implementation and passing afterward: monotonic ten-minute idle expiry despite polling; explicit activity cannot revive expired/revoked sessions or bypass absolute expiry; persisted session rejected after engine restart; license device/customer metadata restricted to administrators; strict authenticated activity payload; exact payment, discount, tax, delivery subtotal and cash change validation.
- Restaurant and POS frontend production builds passed. Barcode renderer remains a separate lazy chunk (966.72 KB uncompressed); Vite reports its size warning. No added dependency or network download.
- Actual selected-browser QA used the documented in-app Browser plugin and isolated data on port 5200 in .cache. Empty two-step setup, collapsible management, table save, quick shift opening, ingredient barcode 00123 with preserved zeroes, stock 10 kg at 10 EGP/kg, recipe 0.25 kg/portion, direct table order, two portions, kitchen send/preparation/ready, serving, payment tabs and live change, mixed payment and discount, persisted receipt, table release and single-step takeaway all verified.
- QA settlement: subtotal 40.00 EGP, discount 5.00, cash 30.00 + card 10.00, total 35.00, change 5.00. Stock became 9.5 kg / 95.00 EGP, with exactly one preparation movement of -0.5 kg / -5.00 EGP. These are isolated test records, never user preview records.
- After loading the final bundle, shared management had exactly one main landmark and one h1, no activation input mounted by default, device support details collapsed, no viewport overflow. Barcode-label canvas renders. Physical barcode reader/printer and print-media acceptance still need the actual hardware.
- Independent read-only review found no actionable issue in identity/runtime/activity/privacy/activation/payment/quick-order/navigation changes.
- Both product development Electron diagnostics passed: native SQLite, Argon2 setup, Windows DPAPI device keys, initial activation gate, private main-process session, action allowlist and no renderer Node. The development diagnostic uses the existing environment-specific sandbox override; ordinary installed Windows execution remains a separate acceptance check.

## Installer

Review installer: artifacts/restaurant/Xzare-Restaurant-0.2.0-Setup.exe
Size: **112929085 bytes**.
SHA256: **C7D55EEC913128024B6EA6CCAD22C518E8DB055551A15277EDDCB077D72E4CD3**.
Adjacent .sha256 file saved. PowerShell Authenticode inspection: **NotSigned**.

Packaged ASAR: 440 entries. Updated compiled identity.js and runtime.js byte-match the verified local build. Required public issuer key, native bindings, notices and icons included; no private issuer key, issuance authority, database, backups, test files or cache. Actual production fuses disable RunAsNode, NodeOptions and NodeCLIInspect and enable embedded ASAR integrity and OnlyLoadAppFromAsar. Desktop source configures sandbox, context isolation, no renderer Node, sender/main-frame/path validation, production debug rejection and DPAPI storage.

Pinned HTTPS issuer origin remains **null**. This is a review installer, with financial writes gated until online activation. Commercial distribution needs the actual HTTPS licensing host configured and end-to-end activation/renewal/revocation checks, a publisher signing certificate, and normal Windows/hardware acceptance. No claim of zero hacking or piracy risk.

## Working preview

tools/start-preview.mjs restaurant passed; healthz reports restaurant / 0.2.0 / preview=true on http://127.0.0.1:5196. auth.status reports configured=false: user preview has no default accounts. Start-Restaurant.cmd starts the helper hidden and opens the loopback preview when the user runs it.

The selected browser rejected reloading the old error tab because its internal error-page URL used a blocked protocol. No alternate browser surface or policy workaround was used. The preview server itself was checked directly through its HTTP health and public authentication-status endpoints. The user can open the HTTP link manually.

Legacy standalone restaurant-ui-test.mjs was adapted to quick orders, collapsed management and one heading, but not invoked this turn; current visible QA used only the Browser plugin.

Final boundary checks: unauthenticated restaurant.state, license.status and session.activity rejected; foreign Origin rejected with HTTP403. Repeating the preview launcher returns the existing healthy 0.2 URL without launching a duplicate server.
