/** Joins truthy class names. */
export function cx(...classes: Array<string | false | null | undefined>): string {
  let out = '';
  for (const c of classes) {
    if (c) out = out ? `${out} ${c}` : c;
  }
  return out;
}
