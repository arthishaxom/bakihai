import { compareText } from '../compare'
import type { EntryEnvelope } from '../entry-envelope'
import { EXPENSE_ENTRY_TYPE, expenseEntryPayloadSchema, splitExpense } from './expenses'
import { SETTLEMENT_ENTRY_TYPE, settlementEntryPayloadSchema } from './settlements'
import { clampToExactSum } from './totals'
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
  /** Paise the higher device id owes the lower one, exactly; negative means the reverse. */
  netPaise: bigint
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
  const pair = nets.get(key) ?? { lowerDeviceId, higherDeviceId, netPaise: 0n }

  pair.netPaise += BigInt(debtorIsLower ? -amountPaise : amountPaise)
  nets.set(key, pair)
}

/**
 * Folds the book's Expense and Settlement Entries into pairwise Balances
 * (ADR-0004): every participant owes the payer their equal share, every
 * Settlement moves money from its payer to its receiver, and what a pair owes
 * each other across Entries is netted. A Settlement counts from the moment it
 * is appended, whether it is a payer's claim or the receiver's own record
 * (ADR-0007, ADR-0015). The result is a pure function of the Entries — the same
 * book yields the same Balances in any order — and pairs that net to zero are
 * left out, so a pair that has squared up never appears. Entries this version
 * cannot read are ignored rather than misread. Voided Entries drop out of the
 * sum entirely, while both lines stay in the book (#12, ADR-0005). The net of a
 * pair is summed exactly and only then narrowed into the exact-integer range,
 * so an absurd pair of Entries saturates at the ceiling instead of folding a
 * number no formatter can read (#21).
 */
export function foldBalances(entries: EntryEnvelope[]): Balance[] {
  const nets = new Map<string, PairNet>()
  const voidedByTarget = foldVoids(entries)

  for (const entry of entries) {
    if (voidedByTarget.has(entry.id)) {
      continue
    }

    if (entry.type === SETTLEMENT_ENTRY_TYPE) {
      const payload = settlementEntryPayloadSchema.safeParse(entry.payload)

      if (!payload.success) {
        continue
      }

      // Money moved from the payer to the receiver, so the receiver's net
      // position rises by the amount: the payer's debt to them falls.
      addNet(nets, payload.data.toDeviceId, payload.data.fromDeviceId, payload.data.amountPaise)
      continue
    }

    if (entry.type !== EXPENSE_ENTRY_TYPE) {
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

  for (const { lowerDeviceId, higherDeviceId, netPaise: exactNet } of nets.values()) {
    const netPaise = clampToExactSum(exactNet)

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
