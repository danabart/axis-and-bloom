// Shared "share or copy" (Family Household 1, 2026-11-07; extracted from
// ShareMatchRow so the match row and the household join links use one
// helper). Native share sheet where the browser has one (feature-detected,
// never UA-sniffed), otherwise the link goes to the clipboard.
//   'shared'    the share sheet opened (or the person closed it)
//   'copied'    the link is on the clipboard
//   'failed'    neither was possible
export type ShareOutcome = 'shared' | 'copied' | 'failed';

export async function shareOrCopy(url: string, title?: string, text?: string): Promise<ShareOutcome> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text, url });
    } catch {
      // the person closed the sheet: not an error
    }
    return 'shared';
  }
  return copyLink(url);
}

export async function copyLink(url: string): Promise<ShareOutcome> {
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
