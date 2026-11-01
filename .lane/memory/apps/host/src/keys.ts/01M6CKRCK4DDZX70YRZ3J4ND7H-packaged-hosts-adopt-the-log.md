---
id: 01M6CKRCK4DDZX70YRZ3J4ND7H
anchor: function catalog
created: 2026-11-01T22:30:21Z
norm: '1'
sig: 06a93ba20702c9f0
body_hash: 77e38dcb524a282e
raw_hash: 9578e44b495b3d1a
vouched: 2026-11-01T23:38:00Z
lines: 202-222
---

Packaged hosts adopt the login shell after startup, so local executable discovery must pass process.env.PATH to Bun.which instead of using Bun's cached startup path.
