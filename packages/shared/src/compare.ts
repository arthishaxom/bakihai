/** Orders two strings by UTF-16 code unit, matching canonical JSON's key order. */
export function compareText(left: string, right: string): number {
  if (left < right) {
    return -1
  }

  return left > right ? 1 : 0
}

/**
 * The later of two clock readings. Used where one Entry cannot have happened
 * before another however the devices' clocks disagree — a Settled item never
 * settled before it existed.
 */
export function laterText(left: string, right: string): string {
  return compareText(left, right) >= 0 ? left : right
}
