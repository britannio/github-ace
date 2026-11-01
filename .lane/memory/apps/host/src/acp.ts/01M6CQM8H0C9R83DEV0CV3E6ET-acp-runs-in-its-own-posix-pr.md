---
id: 01M6CQM8H0C9R83DEV0CV3E6ET
anchor: function run
created: 2026-11-01T23:38:00Z
norm: '1'
supersedes: 01M6CKB37N968W1X31FR9KVCKY
---

ACP runs in its own POSIX process group, and Stop snapshots and terminates its descendant process tree because clients can launch tool commands in separate groups; normal completion only stops the client so intentionally backgrounded work can survive.
