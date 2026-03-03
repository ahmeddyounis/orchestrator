/**
 * Utility type to make all properties of T and their nested properties optional.
 */
export type DeepPartial<T> = T extends (...args: unknown[]) => unknown
  ? T
  : T extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepPartial<U>>
    : T extends object
      ? { [P in keyof T]?: DeepPartial<T[P]> }
      : T;
