export function preferRuntimeData<T>(
  runtimeItems: readonly T[],
  demoItems: readonly T[],
  runtimeConnected: boolean,
): T[] {
  return [...(runtimeConnected ? runtimeItems : demoItems)]
}
