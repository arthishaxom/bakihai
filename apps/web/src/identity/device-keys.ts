/**
 * This device's signing key, kept in IndexedDB as a live `CryptoKey` rather
 * than as PKCS8 bytes in `localStorage` (#8). The key can sign Entries, but
 * nothing on the device — not even this app — can read its bytes back out, so
 * a script that reads local storage finds no private key to copy.
 */
const DATABASE_NAME = 'bakihai/identity'
const DATABASE_VERSION = 1
const DEVICE_KEY_STORE = 'device-keys'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(DEVICE_KEY_STORE)) {
        database.createObjectStore(DEVICE_KEY_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open the device key store'))
  })
}

/** Stores the device's signing key so the next visit can restore it. */
export async function saveDeviceKey(deviceId: string, key: CryptoKey): Promise<void> {
  const database = await openDatabase()

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DEVICE_KEY_STORE, 'readwrite')

      // A put is only durable once the transaction commits, so wait for that
      // rather than for the request that queued it.
      transaction.objectStore(DEVICE_KEY_STORE).put(key, deviceId)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Could not store the device key'))
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Storing the device key was aborted'))
    })
  } finally {
    database.close()
  }
}

/** Restores the device's signing key, or null when none was stored yet. */
export async function loadDeviceKey(deviceId: string): Promise<CryptoKey | null> {
  const database = await openDatabase()

  try {
    const key = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const request = database
        .transaction(DEVICE_KEY_STORE, 'readonly')
        .objectStore(DEVICE_KEY_STORE)
        .get(deviceId)

      request.onsuccess = () => resolve(request.result as CryptoKey | undefined)
      request.onerror = () => reject(request.error ?? new Error('Could not read the device key'))
    })

    return key ?? null
  } finally {
    database.close()
  }
}
