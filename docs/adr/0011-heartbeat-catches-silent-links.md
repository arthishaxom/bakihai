# A heartbeat catches links that die without closing

A WebSocket can stay open in the browser while nothing crosses it — a phone that slept, a network that switched, a middlebox that dropped the path. Writes on such a link vanish, and every later write vanishes too: Yjs updates only converge when they actually arrive, so the book on other devices stops applying Entries with no error anywhere. ADR-0010 assumed a lost frame heals on the next connection, but nothing forces a next connection when the socket never closes, and the relay cannot tell a quiet room from a dead subscriber because it only ever sees sealed frames.

The provider now sends a heartbeat frame (`{t:'heartbeat'}`) that the relay echoes to its sender and never stores or broadcasts. The provider calls a link dead when a heartbeat goes unanswered for longer than a timeout, and treats reconnects as untrusted: an open socket only reads as `connected` once an echo comes back. Declaring a link dead forces a fresh connection, and because the frame that vanished may have carried the whole book, the provider publishes the whole book again once the new link has proven itself. Browser `online` and page-visible events force the same fresh connection, since they are strong hints that any socket predates the change.

## Considered Options

- **Acknowledgements for every update** — would detect each lost frame, but doubles the frames and adds per-update state, while the book needs no acknowledgement to converge: one republish heals everything (ADR-0010). A heartbeat catches the case that matters, a broadly silent link, without a protocol per Entry.
- **Server-sent heartbeats only** — the relay could ping idle clients; that catches a dead direction into the device but not a dead direction out of it, and it asks a hibernating room to start traffic on a timer.
- **Do nothing, rely on browser events** — `online` and `visibilitychange` are not fired for a middlebox black hole or a half-open NAT entry, so the zombie link survives until a reload.

## Consequences

The watchdog window is bounded by `heartbeatIntervalMs + heartbeatTimeoutMs` (2 s + 4 s by default), under the 10 s target, at the cost of one tiny frame each way per interval. Heartbeats carry no book data, so the relay still cannot read anything (ADR-0002). While the page is hidden the watchdog pauses: browser timers are throttled and the OS may suspend the socket, so silence proves nothing, and becoming visible forces a fresh connection anyway. A connected device keeps a hibernating Durable Object awake at the heartbeat cadence. Duplicates stay harmless because Yjs updates are idempotent and commutative (ADR-0010), so a republish after a false death costs a duplicate snapshot in the relay log and no correctness.

The watchdog catches silence that outlasts a heartbeat round trip. A blackout shorter than that can swallow one update without being noticed, because nothing acknowledges individual updates (ADR-0010); a frame merely delayed by TCP is retransmitted, so the gap only matters for a path that discards traffic outright, and the next fresh connection heals it.
