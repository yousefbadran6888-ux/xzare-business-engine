# Build and explore the engine

## Development environment

Use Windows x64, Node.js 24 and pnpm 10.12.1. The root declares Node 22+ but this onboarding path and CI choose Node 24. The full workspace explicitly includes a Windows x64 Argon2 native package. Full installation on Linux/macOS is not currently claimed.

```sh
git clone https://github.com/yousefbadran6888-ux/xzare-business-engine.git
cd xzare-business-engine
npm install --global pnpm@10.12.1
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
node examples/core-money.mjs
```

`verify` builds TypeScript projects, checks test types, then runs Vitest. Some tests open temporary loopback listeners. They do not require a production license issuer. The locked `better-sqlite3` 13.0.3 package includes native prebuilt binaries. Use `--ignore-scripts`: pnpm 10 can otherwise attempt an unnecessary node-gyp build on this package. The lockfile also supplies the platform-specific esbuild binary. The full verification checks that these native dependencies actually load. Do not bypass a native-load failure; report your platform and package versions.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm build` | Compile TypeScript projects |
| `pnpm typecheck` | Check source and test types |
| `pnpm test` | Run the suite once |
| `pnpm verify` | Build, check types and run tests |
| `node examples/core-money.mjs` | Exercise exact money after building |
| `pnpm build:pos` | Build POS desktop assets |
| `pnpm dev:pos` | Build and start a local HTTP preview server |
| `pnpm start:pos` | Build and launch Electron, if its runtime is installed |

The root `package.json` lists equivalent application tasks. Run focused tests with the root configuration:

```sh
pnpm exec vitest run packages/core --configLoader runner
```

## Desktop runtime and activation

Electron's download script is outside the automatic install-script allowlist. After reviewing the locked dependency, explicitly download its runtime if you need the desktop application:

```sh
node node_modules/electron/install.js
pnpm start:pos
```

The example and tests do not need Electron's runtime. Branded applications still use the activation system in [ONLINE_LICENSING.md](ONLINE_LICENSING.md). No production license server, preactivated customer account or private issuing key is provided. A local preview is for development and must not be exposed to the internet as a production service.

Use disposable synthetic data. Databases and backups may contain sensitive information and are not automatically encrypted at rest. Keep private credentials and real data outside Git.

Start reading with `packages/core/src/money.ts` and its tests, then the barcode package. The database and engine entry points expose shared services. New products should reuse these rules rather than fork the core. The example imports the compiled package by relative path because packages are not published to npm.
