---
id: 01M6CKB37N968W1X31FR9KVCKY
anchor: function run
created: 2026-11-01T22:23:05Z
norm: '1'
sig: 5e75f6e48a81e549
body_hash: 690f149ff0d27f3b
raw_hash: c49a0a792c311446
lines: 204-339
supersedes: 01M6CJWZP6B4ZR3N1CA3DQ7BGD
---

ACP runs in its own POSIX process group, and Stop snapshots and terminates its descendant process tree because Devin launches tool commands in separate groups; normal completion only stops Devin so intentionally backgrounded work can survive.
