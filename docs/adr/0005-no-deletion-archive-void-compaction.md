# Nothing is deleted; Settled items archive, mistakes are Voided, storage is compacted

Entries are never hard-deleted. Settled items auto-archive out of the active view after 14 days (configurable per group), open items never auto-hide, mistakes are corrected with a Void Entry while both lines remain, and storage is reclaimed by periodically folding old settled periods into a checkpoint.

## Considered Options

- **Auto-delete after 7/14 days** — silently cancels outstanding debts, cannot propagate safely to offline phones whose copies still hold the Entry, and destroys the audit trail.
- **Hard delete on request** — same divergence and audit problems, for no meaningful storage win: at typical usage the whole book grows under 1 MB per year.

## Consequences

A Void is visible in history, and compaction must preserve open (unsettled) Entries in full detail.
