// Minimal server-rendered page for capability links opened straight from an
// inbox (no SPA, no session, no App Check). Lifted out of routes/beats.ts
// (HOME_TASK_8's dial-in respond page) by the unsubscribe sync (2026-10-01) so
// the unsubscribe confirm/done pages share it instead of a second copy. With
// no options the output is byte-for-byte what beats.ts always rendered.
//
// `message`, `heading` and `actionHtml` are inserted as HTML: callers pass
// fixed copy, never user input.

export interface ResponsePageOptions {
  /** Optional heading above the message. */
  heading?: string;
  /** Optional HTML below the message (a form button, a link). */
  actionHtml?: string;
}

export function renderResponsePage(message: string, { heading, actionHtml }: ResponsePageOptions = {}): string {
  const headingHtml = heading
    ? `\n        <p style="margin:0 0 16px;font-size:26px;color:#a33726;line-height:1.3;max-width:420px;">${heading}</p>`
    : '';
  const actionBlock = actionHtml
    ? `\n        <div style="margin:32px 0 0;">${actionHtml}</div>`
    : '';
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Axis &amp; Bloom</title>
</head>
<body style="margin:0;padding:0;background:#f2f1ea;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f1ea;min-height:100vh;">
    <tr>
      <td align="center" style="padding:80px 24px;">
        <p style="margin:0 0 24px;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#a33726;">Axis &amp; Bloom</p>${headingHtml}
        <p style="margin:0;font-size:20px;color:#6b5a56;line-height:1.6;max-width:420px;">${message}</p>${actionBlock}
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
