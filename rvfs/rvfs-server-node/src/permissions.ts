export function checkPermission(
  mode: number,
  fileUid: number,
  fileGid: number,
  callerUid: number,
  callerGid: number,
  operation: 'read' | 'write' | 'execute',
): boolean {
  if (callerUid === 0) return true

  const opBit = operation === 'read' ? 4 : operation === 'write' ? 2 : 1

  let relevant: number
  if (callerUid === fileUid) {
    relevant = (mode >> 6) & 7
  } else if (callerGid === fileGid) {
    relevant = (mode >> 3) & 7
  } else {
    relevant = mode & 7
  }

  return (relevant & opBit) !== 0
}
