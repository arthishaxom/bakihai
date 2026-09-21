import { compareText } from '../compare'
import type { EntryEnvelope } from '../entry-envelope'
import { EXPENSE_ENTRY_TYPE, expenseEntryPayloadSchema, splitExpense } from './expenses'
import { foldVoids } from './voids'

/**
 * The net position between two Members, always in the direction money moves: a
 * debtor owes a creditor positive integer paise. Balances are never stored;
 * they are folded from the whole book on every device (ADR-0001, ADR-0004).
 */
export interface Balance {
  debtorDeviceId: string
  creditorDeviceId: string
  amountPaise: number
}

interface PairNet {
  lowerDeviceId: string
  higherDeviceId: string
  /** Paise the higher device id owes the lower one; negative means the reverse. */
  netPaise: number
}

/** Nets what a debtor owes into its pair, keeping the pair keyed by sorted device ids. */
function addNet(
  nets: Map<string, PairNet>,
  debtorDeviceId: string,
  creditorDeviceId: string,
  amountPaise: number,
): void {
  const debtorIsLower = debtorDeviceId < creditorDeviceId
  const lowerDeviceId = debtorIsLower ? debtorDeviceId : creditorDeviceId
  const higherDeviceId = debtorIsLower ? creditorDeviceId : debtorDeviceId
  const key = `${lowerDeviceId}\n${higherDeviceId}`
  const pair = nets.get(key) ?? { lowerDeviceId, higherDeviceId, netPaise: 0 }

  pair.netPaise += debtorIsLower ? -amountPaise : amountPaise
  nets.set(key, pair)
}

/**
 * Folds the book's Expense Entries into pairwise Balances (ADR-0004): every
 * participant owes the payer their equal share, and what a pair owes each
 * other across Entries is netted. The result is a pure function of the Entries
 * — the same book yields the same Balances in any order — and pairs that net
 * to zero are left out, so a pair that has squared up never appears. Entries
 * this version cannot read are ignored rather than misread. Voided Entries
 * drop out of the sum entirely, while both lines stay in the book (#12,
 * ADR-0005). Settlements will join this sum when they land (P2), so the fold
 * stays the whole book's arithmetic.
 */
export function foldBalances(entries: EntryEnvelope[]): Balance[] {
  const nets = new Map<string, PairNet>()
  const voidedByTarget = foldVoids(entries)

  for (const entry of entries) {
    if (entry.type !== EXPENSE_ENTRY_TYPE || voidedByTarget.has(entry.id)) {
      continue
    }

    const payload = expenseEntryPayloadSchema.safeParse(entry.payload)

    if (!payload.success) {
      continue
    }

    const { amountPaise, payerDeviceId, participantDeviceIds } = payload.data

    for (const share of splitExpense(amountPaise, participantDeviceIds)) {
      if (share.deviceId === payerDeviceId || share.amountPaise === 0) {
        continue
      }

      addNet(nets, share.deviceId, payerDeviceId, share.amountPaise)
    }
  }

  const balances: Balance[] = []

  for (const { lowerDeviceId, higherDeviceId, netPaise } of nets.values()) {
    if (netPaise > 0) {
      balances.push({
        debtorDeviceId: higherDeviceId,
        creditorDeviceId: lowerDeviceId,
        amountPaise: netPaise,
      })
    } else if (netPaise < 0) {
      balances.push({
        debtorDeviceId: lowerDeviceId,
        creditorDeviceId: higherDeviceId,
        amountPaise: -netPaise,
      })
    }
  }

  return balances.sort(
    (left, right) =>
      compareText(left.debtorDeviceId, right.debtorDeviceId) ||
      compareText(left.creditorDeviceId, right.creditorDeviceId),
  )
}
