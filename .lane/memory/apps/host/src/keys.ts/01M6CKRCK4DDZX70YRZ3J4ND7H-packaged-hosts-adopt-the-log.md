---
id: 01M6CKRCK4DDZX70YRZ3J4ND7H
anchor: function catalog
created: 2026-11-01T22:30:21Z
norm: '1'
sig: 06a93ba20702c9f0
body_hash: ca30bd4e5dae60d5
raw_hash: 09930b49a4a30942
lines: 202-222
---

Packaged hosts adopt the login shell after startup, so local executable discovery must pass process.env.PATH to Bun.which instead of using Bun's cached startup path.
