# Contribution

An agent-native macOS workspace utility for preserving completed Git work, coordinating development across Macs, and following explicit publication through delivery and checks. An optional Remote Devices module targets verified iPhone development from either Mac.

**Status: S0 development foundation implemented.** The native app/menu-bar shell and private development CLI build locally. The service and product workflows remain unavailable. No live installation is performed by setup.

Start with the [documentation index](docs/README.md), [local build instructions](docs/BUILD.md), and [setup evidence](docs/SETUP_STATUS.md). M0–M6 and D0–D4 require a later implementation request.

On Apple Silicon with the pinned Xcode, run:

```sh
bash scripts/setup.sh
bash scripts/dev.sh check
bash scripts/dev.sh native:test
bash scripts/dev.sh native:build
.tools/node/bin/node packages/cli/dist/main.js version --json
open .build/native/Build/Products/Debug/Contribution.app
```

These commands create scoped development tools and build output. They do not install a global CLI or background service.

- [Vision](docs/VISION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Requirements review and amendments](docs/REQUIREMENTS_REVIEW.md)
- [Setup deliverables](docs/REPOSITORY_SETUP.md)
- [Verification status](docs/VERIFICATION.md)

Original Contribution code is MIT licensed; see [LICENSE](LICENSE). Private reference material is excluded from this repository and release artifacts.
