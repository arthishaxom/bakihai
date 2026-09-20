import {
  type Bytes,
  exportSigningPublicKey,
  GROUP_KEY_BYTES,
  GROUP_NAME_MAX_LENGTH,
  generateGroupKey,
  generateStorableSigningKeyPair,
  INVITE_VERSION,
  type Invite,
  importSigningPrivateKey,
  importSigningPublicKey,
  isBase64UrlOfByteLength,
  MEMBER_DISPLAY_NAME_MAX_LENGTH,
  SIGNING_PUBLIC_KEY_BYTES,
  signBytes,
  toBase64Url,
  uuidv7,
  verifyBytes,
} from '@bakihai/shared'
import { loadDeviceKey, saveDeviceKey } from './device-keys'

/** Storage key of the device's Group identity. */
const IDENTITY_STORAGE_KEY = 'bakihai/identity'

/** Identity record version. Other versions are treated as no identity at all. */
const IDENTITY_VERSION = 1

/**
 * Everything this phone needs to be a Member: which Group it belongs to, the
 * Group secret, and its own device keys (ADR-0002). The signing key lives in
 * IndexedDB as a non-extractable `CryptoKey`; `privateKeyPkcs8` survives only
 * on installs made before that, and is migrated away on first use (#8).
 */
export interface Identity {
  version: typeof IDENTITY_VERSION
  /** Relay room of the Group, and its local id. */
  groupId: string
  groupName: string
  relayUrl: string
  /** Group secret, unpadded base64url. */
  groupKey: string
  deviceId: string
  displayName: string
  /** Device public key, unpadded base64url. */
  signerPublicKey: string
  /** Legacy PKCS8 of the device private key, unpadded base64url. */
  privateKeyPkcs8?: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** A stored relay URL must be one the sync provider can turn into a WebSocket URL. */
function isHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false
  }

  try {
    const protocol = new URL(value).protocol

    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function parseIdentity(value: unknown): Identity | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const record = value as Record<string, unknown>

  if (
    record.version !== IDENTITY_VERSION ||
    !isNonEmptyString(record.groupId) ||
    !isNonEmptyString(record.groupName) ||
    !isHttpUrl(record.relayUrl) ||
    !isBase64UrlOfByteLength(record.groupKey, GROUP_KEY_BYTES) ||
    !isNonEmptyString(record.deviceId) ||
    !isNonEmptyString(record.displayName) ||
    !isBase64UrlOfByteLength(record.signerPublicKey, SIGNING_PUBLIC_KEY_BYTES) ||
    (record.privateKeyPkcs8 !== undefined && !isNonEmptyString(record.privateKeyPkcs8))
  ) {
    return null
  }

  return {
    version: IDENTITY_VERSION,
    groupId: record.groupId,
    groupName: record.groupName,
    relayUrl: record.relayUrl,
    groupKey: record.groupKey,
    deviceId: record.deviceId,
    displayName: record.displayName,
    signerPublicKey: record.signerPublicKey,
    ...(record.privateKeyPkcs8 === undefined ? {} : { privateKeyPkcs8: record.privateKeyPkcs8 }),
  }
}

/** Reads this device's Group identity, or null on a first run or unreadable storage. */
export function loadIdentity(): Identity | null {
  let raw: string | null

  try {
    raw = window.localStorage.getItem(IDENTITY_STORAGE_KEY)
  } catch {
    return null
  }

  if (!raw) {
    return null
  }

  try {
    return parseIdentity(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

function saveIdentity(identity: Identity): void {
  window.localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity))
}

interface NewIdentityInput {
  groupId: string
  groupName: string
  relayUrl: string
  groupKey: string
  displayName: string
}

async function newIdentity(input: NewIdentityInput): Promise<Identity> {
  const groupName = input.groupName.trim()
  const displayName = input.displayName.trim()

  if (groupName.length === 0 || groupName.length > GROUP_NAME_MAX_LENGTH) {
    throw new Error(`Group name must be between 1 and ${GROUP_NAME_MAX_LENGTH} characters`)
  }

  if (displayName.length === 0 || displayName.length > MEMBER_DISPLAY_NAME_MAX_LENGTH) {
    throw new Error(`Your name must be between 1 and ${MEMBER_DISPLAY_NAME_MAX_LENGTH} characters`)
  }

  const keys = await generateStorableSigningKeyPair()
  const deviceId = uuidv7()
  let legacyPrivateKeyPkcs8: string | undefined

  try {
    await saveDeviceKey(deviceId, keys.privateKey)
  } catch {
    // A browser without usable IndexedDB keeps the storable PKCS8 form, which
    // is what this app shipped before device keys moved (#8).
    legacyPrivateKeyPkcs8 = keys.privateKeyPkcs8
  }

  const identity: Identity = {
    version: IDENTITY_VERSION,
    groupId: input.groupId,
    groupName,
    relayUrl: input.relayUrl,
    groupKey: input.groupKey,
    deviceId,
    displayName,
    signerPublicKey: await exportSigningPublicKey(keys.publicKey),
    ...(legacyPrivateKeyPkcs8 === undefined ? {} : { privateKeyPkcs8: legacyPrivateKeyPkcs8 }),
  }

  saveIdentity(identity)

  return identity
}

/** Creates a Group on this phone: a fresh Group key, room, and device key pair. */
export function createGroupIdentity(input: {
  groupName: string
  displayName: string
  relayUrl: string
}): Promise<Identity> {
  return newIdentity({
    groupId: uuidv7(),
    groupName: input.groupName,
    relayUrl: input.relayUrl,
    groupKey: toBase64Url(generateGroupKey()),
    displayName: input.displayName,
  })
}

/** Joins the Group an invite names, taking the Group secret and relay from the link. */
export function joinGroupIdentity(invite: Invite, displayName: string): Promise<Identity> {
  return newIdentity({
    groupId: invite.room,
    groupName: invite.name,
    relayUrl: invite.relay,
    groupKey: invite.key,
    displayName,
  })
}

const IDENTITY_PROBE = new TextEncoder().encode('bakihai/identity-probe/v1') as Bytes

/**
 * Restores the device's signing keys and checks that they are a pair, so a
 * half-written or tampered identity fails loudly instead of signing Entries
 * that no one can verify. A key stored as PKCS8 by an older install is moved
 * into IndexedDB and dropped from local storage on the way through (#8).
 */
export async function importDeviceSigningKey(identity: Identity): Promise<CryptoKey> {
  const privateKey =
    (await loadDeviceKey(identity.deviceId).catch(() => null)) ??
    (await migrateLegacyDeviceKey(identity))

  if (!privateKey) {
    throw new Error('This device has no signing key; join the Group again from an invite link')
  }

  const publicKey = await importSigningPublicKey(identity.signerPublicKey)
  const signature = await signBytes(privateKey, IDENTITY_PROBE)

  if (!(await verifyBytes(publicKey, signature, IDENTITY_PROBE))) {
    throw new Error('Stored device key does not match the stored public key')
  }

  return privateKey
}

/** Moves a legacy PKCS8 key out of local storage, returning it for this session. */
async function migrateLegacyDeviceKey(identity: Identity): Promise<CryptoKey | null> {
  if (!identity.privateKeyPkcs8) {
    return null
  }

  const privateKey = await importSigningPrivateKey(identity.privateKeyPkcs8)

  try {
    await saveDeviceKey(identity.deviceId, privateKey)

    const stripped: Identity = { ...identity }

    delete stripped.privateKeyPkcs8
    saveIdentity(stripped)
  } catch {
    // Without IndexedDB the key stays where it was; migration is retried next time.
  }

  return privateKey
}

/** The invite that lets another device join this Group. */
export function inviteForIdentity(identity: Identity): Invite {
  return {
    v: INVITE_VERSION,
    room: identity.groupId,
    relay: identity.relayUrl,
    key: identity.groupKey,
    name: identity.groupName,
  }
}
