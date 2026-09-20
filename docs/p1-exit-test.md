# P1 exit test: a week with two to three phones

The P1 exit criterion is human: two to three people use BakiHai on their own phones for a week. The automated suite rehearses the mechanics — offline Entries merge after reconnect, a reload reads the whole book, a fresh device rebuilds it from the relay, and a modified client cannot slip in forged, tampered, or malformed Entries (`apps/web/e2e`) — but only real days catch what a test cannot. Run this after the hardening in #8 ships.

## Setup

- One phone creates the Group and sends the invite link to the others.
- Everyone opens the link, types a name, and installs the app to their home screen.
- Each phone adds at least one Expense on day one, and one of them is written in airplane mode.

## Daily checks

- Every phone shows the same Members, Entries, and Balances when the app is opened.
- An Expense added on one phone reaches the others within seconds while everyone is online.
- The airplane-mode Expense reaches the others once that phone is back online, with no forwarding or re-adding.
- The sync chip reads Online while connected and Offline otherwise; nothing hangs or spins.
- Reopening the app — and restarting a phone — loses nothing.

## End of the week

- Each Member reads out their Balances; every phone agrees, and the numbers match what people believe happened.
- If a phone disagrees: note the Entries it shows or misses and the order they were added, and file it on #8.
- Note anything slow, confusing, or broken with the phone, browser, and rough time.

The week's result decides the ticket: passing closes P1; any disagreement becomes a P2 bug with the sequence that produced it.
