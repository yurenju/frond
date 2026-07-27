# Changelog

frond is `0.x`, which in semver means nothing is promised. A minor bump can
break you. This file is where the breaks are written down — read it before you
move a version.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Changed

- **frond is now published to npm as `@yurenju/frond`.** It used to be installed
  as a git dependency (`npm install github:yurenju/frond#v0.1.1`). That path
  still works, but the supported one is now:

  ```bash
  npm install @yurenju/frond
  ```

  The entry points keep their shape and gain the scope prefix:
  `frond/epub` → `@yurenju/frond/epub`, `frond/renderer` →
  `@yurenju/frond/renderer`. Nothing else about the API changed.

  The name is scoped because plain `frond` was taken on npm in 2015 by an
  unrelated package. See
  [ADR-0008](docs/adr/0008-distribution-and-license.md).

### Added

- The published tarball now carries `src/`, so the source maps and declaration
  maps resolve — "go to definition" lands on frond's own TypeScript instead of a
  path that does not exist. `src/test-fixtures/` is still excluded; it is a
  build-time tool, not part of the shipping surface.
- `engines` declares Node `>=20`, and `author` / `bugs` are filled in.

## 0.1.1 and earlier

Released as git tags only, never on npm. See the
[commit history](https://github.com/yurenju/frond/commits/main).
