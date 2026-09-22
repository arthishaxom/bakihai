import {
  BookSyncProvider,
  createBookDoc,
  createExpenseEntry,
  createLoanEntry,
  createMemberArchivedEntry,
  createMemberEntry,
  createPaymentAddressEntry,
  createReturnEntry,
  createSettlementConfirmEntry,
  createSettlementEntry,
  createVoidEntry,
  type EntryEnvelope,
  fromBase64Url,
  MEMBER_ENTRY_TYPE,
  putEntry,
  readEntries,
  type SettlementTag,
  uuidv7,
  verifyEntryEnvelope,
} from '@bakihai/shared'
import type { IndexeddbPersistence } from 'y-indexeddb'
import type * as Y from 'yjs'
import { type Identity, importDeviceSigningKey } from '../identity/identity'
import { persistBook } from './persistence'

/** The fields an Add Expense form decides; the session signs and writes the Entry. */
export interface ExpenseDraft {
  amountPaise: number
  payerDeviceId: string
  participantDeviceIds: string[]
}

/** The fields an Add Loan form decides; the session signs and writes the Entry. */
export interface LoanDraft {
  itemLabel: string
  quantityHundredths: number
  /** Optional free-text unit, like "kg" or "dozen". */
  unit?: string
  lenderDeviceId: string
  borrowerDeviceId: string
}

/** The fields a Return form decides; the session signs and writes the Entry. */
export interface ReturnDraft {
  loanEntryId: string
  quantityHundredths: number
}

/** The fields a Loan's Settle decides; the session signs and writes the closing Return and, when money moved, the tagged Settlement. */
export interface LoanSettleDraft {
  loanEntryId: string
  quantityHundredths: number
  /** The money that changed hands, written as a Settlement tagged to the Loan. */
  settlement?: {
    fromDeviceId: string
    toDeviceId: string
    amountPaise: number
  }
}

/** The fields a detail sheet decides when correcting an Entry; the session signs and writes it. */
export interface VoidDraft {
  targetEntryId: string
  reason?: string
}

/** The fields a Member row decides when archiving; the session signs and writes it. */
export interface MemberArchiveDraft {
  /** The device id of the Member whose phone is gone. */
  memberDeviceId: string
}

/** The fields the Add-a-person sheet decides; the session signs and writes it. */
export interface ShadowMemberDraft {
  displayName: string
}

/** The fields a Settlement form decides; the session signs and writes the Settlement. */
export interface SettlementDraft {
  fromDeviceId: string
  toDeviceId: string
  amountPaise: number
  /** Optional free-text note, like "for dinner". */
  note?: string
  /** Optional tag naming the Expense or Loan this payment pays off. */
  tag?: SettlementTag
}

/** The fields a Settlement detail sheet decides when confirming; the session signs and writes it. */
export interface SettlementConfirmDraft {
  settlementEntryId: string
}

/** The fields the Payment address sheet decides; the session signs and writes it. */
export interface PaymentAddressDraft {
  upiId: string
  payeeName: string
}

/** One Group's live book: the document, its local copy, and its relay connection. */
export interface BookSession {
  doc: Y.Doc
  persistence: IndexeddbPersistence
  provider: BookSyncProvider
  /** Resolves once this device's own Member Entry is in the local book. */
  ready: Promise<void>
  /** Signs and writes an Expense to the local book; it syncs like any other Entry. */
  writeExpense(input: ExpenseDraft): Promise<void>
  /** Signs and writes a Loan to the local book; it syncs like any other Entry. */
  writeLoan(input: LoanDraft): Promise<void>
  /** Signs and writes a Return to the local book; it syncs like any other Entry. */
  writeReturn(input: ReturnDraft): Promise<void>
  /**
   * Signs and writes a Loan's closing Return and, when money changed hands,
   * its tagged Settlement, in one action; both sync like any other Entry.
   */
  writeLoanSettle(input: LoanSettleDraft): Promise<void>
  /** Signs and writes a Void to the local book; it syncs like any other Entry. */
  writeVoid(input: VoidDraft): Promise<void>
  /**
   * Signs and writes a Member-archive marker to the local book; it syncs like
   * any other Entry, and Voiding it is how an archive is undone.
   */
  writeMemberArchive(input: MemberArchiveDraft): Promise<void>
  /**
   * Signs and writes a Member Entry for a person with no phone (ADR-0020): a
   * fresh device id, bound to this device's key, so the book can name them in
   * any Entry. It syncs like any other Entry.
   */
  writeShadowMember(input: ShadowMemberDraft): Promise<void>
  /** Signs and writes a Settlement to the local book; it syncs like any other Entry. */
  writeSettlement(input: SettlementDraft): Promise<void>
  /** Signs and writes a Confirm of a Settlement to the local book. */
  writeSettlementConfirm(input: SettlementConfirmDraft): Promise<void>
  /**
   * Signs and writes this device's Payment address: where money sent to its
   * Member should go. It syncs like any other Entry.
   */
  writePaymentAddress(input: PaymentAddressDraft): Promise<void>
}

let current: { groupId: string; session: BookSession } | null = null

/**
 * The session for this device's Group, created on first use. One module-level
 * session keeps the document and relay connection alive across navigation;
 * opening a different Group tears the old one down.
 */
export function getBookSession(identity: Identity): BookSession {
  if (current?.groupId === identity.groupId) {
    return current.session
  }

  current?.session.provider.destroy()
  current?.session.persistence.destroy()

  const session = createBookSession(identity)

  current = { groupId: identity.groupId, session }

  return session
}

function createBookSession(identity: Identity): BookSession {
  const doc = createBookDoc()
  const persistence = persistBook(doc, identity.groupId)
  const provider = new BookSyncProvider({
    doc,
    groupKey: fromBase64Url(identity.groupKey),
    room: identity.groupId,
    relayUrl: identity.relayUrl,
  })
  const deviceKey = memoizedDeviceKey(identity)

  return {
    doc,
    persistence,
    provider,
    ready: ensureOwnMemberEntry(doc, persistence, identity, deviceKey),
    async writeExpense(input) {
      const privateKey = await deviceKey()
      const entry = await createExpenseEntry({
        deviceId: identity.deviceId,
        signerPublicKey: identity.signerPublicKey,
        privateKey,
        ...input,
      })

      putEntry(doc, entry)
    },
    async writeLoan(input) {
      const privateKey = await deviceKey()
      const entry = await createLoanEntry({
        deviceId: identity.deviceId,
        signerPublicKey: identity.signerPublicKey,
        privateKey,
        itemLabel: input.itemLabel,
        quantityHundredths: input.quantityHundredths,
        ...(input.unit === undefined ? {} : { unit: input.unit }),
        lenderDeviceId: input.lenderDeviceId,
        borrowerDeviceId: input.borrowerDeviceId,
      })

      putEntry(doc, entry)
    },
    async writeReturn(input) {
      const privateKey = await deviceKey()
      const entry = await createReturnEntry({
        deviceId: identity.deviceId,
        signerPublicKey: identity.signerPublicKey,
        privateKey,
        loanEntryId: input.loanEntryId,
        quantityHundredths: input.quantityHundredths,
      })

      putEntry(doc, entry)
    },
    async writeLoanSettle(input) {
      const privateKey = await deviceKey()
      // Both Entries are signed before either is written, so a failure while
      // building one leaves the book untouched rather than half-closed.
      const returned = await createReturnEntry({
        deviceId: identity.deviceId,
        signerPublicKey: identity.signerPublicKey,
        privateKey,
        loanEntryId: input.loanEntryId,
        quantityHundredths: input.quantityHundredths,
      })
      const settlement =
        input.settlement === undefined
          ? undefined
          : await createSettlementEntry({
              deviceId: identity.deviceId,
              signerPublicKey: identity.signerPublicKey,
              privateKey,
              fromDeviceId: input.settlement.fromDeviceId,
              toDeviceId: input.settlement.toDeviceId,
              amountPaise: input.settlement.amountPaise,
              tag: { kind: 'loan', entryId: input.loanEntryId },
            })

      putEntry(doc, returned)

      if (settlement !== undefined) {
        putEntry(doc, settlement)
      }
    },
    async writeVoid(input) {
      const privateKey = await deviceKey()
      const entry = await createVoidEntry({
        deviceId: identity.deviceId,
        signerPublicKey: identity.signerPublicKey,
        privateKey,
        targetEntryId: input.targetEntryId,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      })

      putEntry(doc, entry)
    },
    async writeMemberArchive(input) {
      const privateKey = await deviceKey()
      const entry = await createMemberArchivedEntry({
        deviceId: identity.deviceId,
        signerPublicKey: identity.signerPublicKey,
        privateKey,
        memberDeviceId: input.memberDeviceId,
      })

      putEntry(doc, entry)
    },
    async writeShadowMember(input) {
      const privateKey = await deviceKey()
      // A person with no phone gets a fresh device id of their own; the Entry
      // is signed with this device's key, which then holds theirs (ADR-0020).
      // The id is minted after this device's own, so a clock that moved
      // backwards cannot invert the pair in the holder fold (#27).
      const ownEntryId = await ownBindingEntryId(doc, identity)
      const entry = await createMemberEntry({
        deviceId: uuidv7(),
        signerPublicKey: identity.signerPublicKey,
        privateKey,
        displayName: input.displayName,
        ...(ownEntryId === undefined ? {} : { mintedAfterEntryId: ownEntryId }),
      })

      putEntry(doc, entry)
    },
    async writeSettlement(input) {
      const privateKey = await deviceKey()
      const entry = await createSettlementEntry({
        deviceId: identity.deviceId,
        signerPublicKey: identity.signerPublicKey,
        privateKey,
        fromDeviceId: input.fromDeviceId,
        toDeviceId: input.toDeviceId,
        amountPaise: input.amountPaise,
        ...(input.note === undefined ? {} : { note: input.note }),
        ...(input.tag === undefined ? {} : { tag: input.tag }),
      })

      putEntry(doc, entry)
    },
    async writeSettlementConfirm(input) {
      const privateKey = await deviceKey()
      const entry = await createSettlementConfirmEntry({
        deviceId: identity.deviceId,
        signerPublicKey: identity.signerPublicKey,
        privateKey,
        settlementEntryId: input.settlementEntryId,
      })

      putEntry(doc, entry)
    },
    async writePaymentAddress(input) {
      const privateKey = await deviceKey()
      const entry = await createPaymentAddressEntry({
        deviceId: identity.deviceId,
        signerPublicKey: identity.signerPublicKey,
        privateKey,
        upiId: input.upiId,
        payeeName: input.payeeName,
      })

      putEntry(doc, entry)
    },
  }
}

/** Imports this device's signing key once per session, however many Entries it writes. */
function memoizedDeviceKey(identity: Identity): () => Promise<CryptoKey> {
  let deviceKey: Promise<CryptoKey> | null = null

  return () => {
    deviceKey ??= importDeviceSigningKey(identity)

    return deviceKey
  }
}

/**
 * Writes this device's Member Entry unless the local book already has one, so
 * a joining device announces itself as soon as its book is loaded and a reload
 * never adds a second membership. The Entry syncs like any other.
 */
async function ensureOwnMemberEntry(
  doc: Y.Doc,
  persistence: IndexeddbPersistence,
  identity: Identity,
  deviceKey: () => Promise<CryptoKey>,
): Promise<void> {
  await persistence.whenSynced

  if (await hasOwnMemberEntry(doc, identity)) {
    return
  }

  const privateKey = await deviceKey()
  const entry = await createMemberEntry({
    deviceId: identity.deviceId,
    signerPublicKey: identity.signerPublicKey,
    privateKey,
    displayName: identity.displayName,
  })

  putEntry(doc, entry)
}

/**
 * Whether this device's own Member Entry is in the book. A well-formed claim
 * on our device id only counts when it carries a signature by our key: a
 * forged Entry must not stop the real device from announcing itself (#8).
 */
async function hasOwnMemberEntry(doc: Y.Doc, identity: Identity): Promise<boolean> {
  for (const entry of readEntries(doc)) {
    if (!isOwnMemberClaim(entry, identity)) {
      continue
    }

    try {
      await verifyEntryEnvelope(entry)

      return true
    } catch {
      // Not signed by this device; keep looking.
    }
  }

  return false
}

/**
 * Whether an Entry claims this device's own Member Entry: its id and signing
 * key, before the signature is checked. A claim matching our id and key that
 * we did not sign is a forgery the checks in the callers drop (#8, ADR-0012).
 */
function isOwnMemberClaim(entry: EntryEnvelope, identity: Identity): boolean {
  return (
    entry.type === MEMBER_ENTRY_TYPE &&
    entry.authorDeviceId === identity.deviceId &&
    entry.signerPublicKey === identity.signerPublicKey
  )
}

/**
 * The Entry id that binds this device: the earliest Member Entry it wrote
 * under its own key, verified like an announcement, so a tampered claim cannot
 * move the floor. A Shadow Member's Entry is minted after it, whatever the
 * clock says, so the holder fold always reads the phone before the person it
 * tracks (ADR-0020, #27). Entry ids are UUIDv7 strings, so lexical order is
 * the fold's order (ADR-0012). Undefined only while no verified Member Entry
 * of this device has reached the local book.
 */
async function ownBindingEntryId(doc: Y.Doc, identity: Identity): Promise<string | undefined> {
  let binding: string | undefined

  for (const entry of readEntries(doc)) {
    if (!isOwnMemberClaim(entry, identity)) {
      continue
    }

    if (binding !== undefined && entry.id >= binding) {
      continue
    }

    try {
      await verifyEntryEnvelope(entry)
    } catch {
      // Not signed by this device; it cannot be the Entry that binds us.
      continue
    }

    binding = entry.id
  }

  return binding
}
