# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `rndb install wda` CLI command to clone WebDriverAgent sources locally.
- Open-source project metadata and policy docs:
  - `LICENSE`
  - `CONTRIBUTING.md`
  - `CODE_OF_CONDUCT.md`
  - `SECURITY.md`
  - `.env.example`

### Changed

- Publish packaging now uses a `files` allowlist in `package.json`.
- `.gitignore` now ignores local `.env*` files while allowing `.env.example`.

## [0.1.0] - 2026-02-28

### Added

- Initial public release of React Native Debug Bridge MCP server.
