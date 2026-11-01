---
id: 01M6CJWZP6B4ZR3N1CA3DQ7BGD
anchor: function run
created: 2026-11-01T22:15:23Z
norm: '1'
sig: 5e75f6e48a81e549
body_hash: d9db21a68df30032
raw_hash: 582e04f19dcc4946
lines: 165-308
---

ACP runs in its own POSIX process group so Stop terminates agent-owned foreground commands, while normal completion only stops Devin so intentionally backgrounded work can survive.
