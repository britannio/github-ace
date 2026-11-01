---
id: 01M6CJWZP6B4ZR3N1CA3DQ7BGD
anchor: function run
created: 2026-11-01T22:15:23Z
norm: '1'
---

ACP runs in its own POSIX process group so Stop terminates agent-owned foreground commands, while normal completion only stops Devin so intentionally backgrounded work can survive.
