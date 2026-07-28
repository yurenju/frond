# Third-party notices

This file covers material incorporated into the repository itself, across every
package in the workspace. It is deliberately **not** shipped inside any tarball:
`npm` cannot reach outside a package directory, and a per-package copy would be
a second document to keep in sync with this one.

`@yurenju/frond` ships no runtime dependencies at all. `@yurenju/frond-react`
declares `react` and `@yurenju/frond` as peer dependencies and bundles neither —
so neither tarball carries third-party code, and the notices below are about the
repository, not about anything a consumer installs.

## foliate-js

<https://github.com/johnfactotum/foliate-js>

frond is a reimplementation, not a port: no foliate-js code is used in
`packages/frond/src/`, and foliate-js is not a dependency of any published
package (ADR-0001).

What *is* incorporated is upstream's `tests/epubcfi-tests.js` — the CFI strings
and comparison cases from it are used verbatim as an acceptance table in
`tests/node/cfi/foliate-acceptance.test.ts`. That file is test material, not
part of the published package, but it lives in this public repository and so
carries the notice below.

```
MIT License

Copyright (c) 2022 John Factotum

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The browser quirk knowledge recorded in `docs/browser-quirks.md` was learned by
reading foliate-js, but knowledge is not code and carries no licence obligation
(ADR-0001).
