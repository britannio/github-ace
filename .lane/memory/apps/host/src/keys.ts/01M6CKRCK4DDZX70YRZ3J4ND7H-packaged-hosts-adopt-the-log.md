---
id: 01M6CKRCK4DDZX70YRZ3J4ND7H
anchor: function catalog
created: 2026-11-01T22:30:21Z
norm: '1'
---

Packaged hosts adopt the login shell after startup, so local executable discovery must pass process.env.PATH to Bun.which instead of using Bun's cached startup path.
