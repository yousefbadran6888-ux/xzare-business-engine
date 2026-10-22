# Security policy

## Report privately

Email **hello@xzare.com** with the subject `Xzare security report`. Include the affected commit, component, impact and a minimal reproduction using synthetic data. Do not put exploit details, credentials, private keys or real customer/patient data in a public issue. Start with a description; arrange any sensitive transfer privately.

The maintainer will assess reports as capacity permits. There is no guaranteed response SLA, bounty or dedicated security team. Coordinate public disclosure with the maintainer once the impact and a fix are understood.

## Supported development line

The current `main` branch is the security-fix target for this early public source release. Historical commercial installers and older snapshots have no published support-window commitment here. Report your exact commit so a finding can be reproduced.

## Boundaries and known limitations

- Business databases and backups are not automatically encrypted at rest. Deployment must account for filesystem access and backup protection.
- Public verification keys are intentionally distributed; private issuing keys must never be bundled or committed.
- Windows credential protection and licensing do not make a client controlled by an attacker tamper-proof.
- Local preview servers are development tools and must not be exposed as production services.
- Source availability and automated tests are not an independent security audit or a guarantee against compromise.
- Branded installers still need production infrastructure, publisher signing and real-device acceptance.

Read [CORE_SECURITY.md](docs/CORE_SECURITY.md) and [ONLINE_LICENSING.md](docs/ONLINE_LICENSING.md) for implementation details. License rights are described separately in [OPEN_SOURCE.md](docs/OPEN_SOURCE.md).

## Safe research

Use your own disposable local instance and synthetic data. Do not probe other people's installations or the maintainer's services. Keep reproduction steps narrowly scoped to demonstrating the problem without collecting unrelated information.
