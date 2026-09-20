/** Orders two strings by UTF-16 code unit, matching canonical JSON's key order. */
export function compareText(left: string, right: string): number {
  if (left < right) {
    return -1
  }

  return left > right ? 1 : 0
}
