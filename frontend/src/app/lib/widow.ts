// The handoff's widow fix, shared (Website 3 wrote it for Home's quotes;
// Website 6 reuses it on The Axis): join the last two words with a no-break
// space so a line never ends on one word alone.
export function widow(t: string): string {
  const k = t.lastIndexOf(' ');
  return k > 0 ? `${t.slice(0, k)} ${t.slice(k + 1)}` : t;
}
