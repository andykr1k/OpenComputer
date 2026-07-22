# Security policy

OpenComputer processes screenshots and model output and can control the user's desktop. Security reports are taken seriously.

## Supported versions

Until stable releases exist, security fixes are made on the latest `main` branch. After releases begin, the latest released minor version and `main` will be supported.

## Report a vulnerability

Do **not** open a public issue. Use GitHub's private vulnerability reporting:

<https://github.com/andykr1k/OpenComputer/security/advisories/new>

Include:

- affected commit or version;
- operating system and desktop session;
- impact and realistic attack scenario;
- reproduction steps or proof of concept;
- suggested mitigation, if known.

Avoid including real credentials, personal screenshots, or data from systems you do not own. Reports should receive an initial response within seven days, although this is a volunteer project and response times may vary.

## High-priority areas

- renderer sandbox or IPC boundary escapes;
- approval bypasses or stale approval reuse;
- unintended keyboard/mouse actions;
- unsafe URL or tool-argument validation;
- API-key disclosure;
- prompt injection that crosses an explicit application safety boundary;
- persistence or execution outside the user's requested scope;
- insecure packaging or update behavior.

Model mistakes that are contained by the documented permission system may be handled as normal bugs. Demonstrable bypasses of those controls should be reported privately.

## Known dependency advisory

The current `@nut-tree-fork/nut-js` dependency brings in Jimp and `file-type`, which npm reports under moderate advisory [`GHSA-5v7r-6r5c-r473`](https://github.com/advisories/GHSA-5v7r-6r5c-r473). The advisory concerns malformed ASF parsing and currently has no upstream fix in this dependency chain. OpenComputer does not expose a user-facing ASF import path, but the dependency will be updated or replaced when a compatible remediation is available. Do not add features that pass untrusted media files into Jimp without addressing this advisory.

## Disclosure

Please allow maintainers a reasonable opportunity to investigate and release a fix before public disclosure. Coordinated attribution is welcome.
