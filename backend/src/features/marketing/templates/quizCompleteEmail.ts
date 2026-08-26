// Step 07 (C3): quiz-complete "Your coffee archetype card is here" email — ported 1:1 from
// the Mailchimp source (`launch/40_email-marketing/resend/quiz-complete-source.html`,
// Camila's copy, locked) for a direct Resend send. Same markup, same inline styles,
// same images, same spacing, same six archetype variants + fallback — the only
// change is Mailchimp merge tags becoming plain string interpolation. Merge-tag
// conversions (see the prompt for the full list):
//   - *|IF:ARCHETYPE=<slug>|* ... *|ELSEIF...|* ... *|ELSE:|* → switch on archetypeSlug
//   - *|IF:FNAME|* ... *|ELSE:|* → firstName !== null
//   - *|UPPER:*|FNAME|*|* → firstName.toUpperCase()
//   - *|LIST:ADDRESSLINE|* → hardcoded address line (Mailchimp's list address block)
//   - *|UNSUB|* / *|UPDATE_PROFILE|* → single mailto Unsubscribe link (Resend has no
//     hosted equivalent) — unsubscribe handling proper is a follow-up, not this step.
// Banned anywhere including alt text (Camila's brief): "AI", "film", "photo essay".
// The source already complies — porting verbatim preserves that.

export type ArchetypeSlug = 'floral' | 'fruity' | 'balanced' | 'chocolate' | 'earthy' | 'experimental';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const IMAGE_BASE = 'https://storage.googleapis.com/axis-bloom-assets/raw/email/archetype-card';

interface ArchetypeVariant {
  displayName: string; // used verbatim (with "&") in preheader/promise/alt text
  image: string;       // filename under IMAGE_BASE
  colorLine: string;   // hex
  words: string[];
  why: string;
}

const VARIANTS: Record<ArchetypeSlug, ArchetypeVariant> = {
  floral: {
    displayName: 'Floral',
    image: 'floral-email.jpg',
    colorLine: '#b1698d',
    words: ['FRAGRANT', 'BRIGHT', 'DELICATE', 'CLEAN'],
    why: 'Your answers leaned toward the delicate end of flavor. Lift over weight, fragrance over force. Jasmine and soft citrus, a tea-like clarity, sweetness that arrives gently and stays. Yours are the coffees people call beautiful before they call them anything else.',
  },
  fruity: {
    displayName: 'Fruity',
    image: 'fruity-email.jpg',
    colorLine: '#d16378',
    words: ['SWEET', 'VIBRANT', 'EXPRESSIVE', 'LIVELY'],
    why: 'Your answers pointed to brightness, to flavor that moves. Berries and ripe stone fruit, citrus that sparkles, a tropical sweetness that makes the cup feel awake before you are. Yours is the archetype for palates that want the cup to do something.',
  },
  balanced: {
    displayName: 'Balanced & Sweet',
    image: 'balanced-sweet-email.jpg',
    colorLine: '#d7b838',
    words: ['SMOOTH', 'SWEET', 'HARMONIOUS', 'EASY'],
    why: 'Your answers favored harmony, flavor where everything sits in its place. Caramel and honey, a touch of gentle fruit, a sweetness that feels effortless. Yours is the cup that’s exactly right every morning, before you’ve asked anything of it.',
  },
  chocolate: {
    displayName: 'Chocolate & Nutty',
    image: 'chocolate-nutty-email.jpg',
    colorLine: '#b36a4f',
    words: ['RICH', 'GROUNDED', 'FULL', 'COMFORTING'],
    why: 'Your answers chose depth you can lean on. This is the classic register of coffee, done precisely. Cocoa and roasted nuts, a fuller body, a warm, grounding presence. Yours is the archetype of comfort with a backbone.',
  },
  earthy: {
    displayName: 'Earthy',
    image: 'earthy-email.jpg',
    colorLine: '#a25251',
    words: ['WARM', 'DEEP', 'BOLD', 'LASTING'],
    why: 'Your answers reached for the deep end, where flavor has weight and a long finish. Spice and wood, dark herbs, a trace of smoke. Complexity that unfolds slowly and rewards attention. Yours are the cups that keep offering more.',
  },
  experimental: {
    displayName: 'Experimental',
    image: 'experimental-email.jpg',
    colorLine: '#30848e',
    words: ['WILD', 'UNIQUE', 'SURPRISING'],
    why: 'Your answers kept choosing the unexpected. Flavor as discovery, rare processes, cups that refuse to repeat themselves. Yours is the archetype for palates that want to be taken somewhere new.',
  },
};

function isArchetypeSlug(value: string | null): value is ArchetypeSlug {
  return value !== null && Object.prototype.hasOwnProperty.call(VARIANTS, value);
}

// ── preheader (hidden) ──────────────────────────────────────────────────────────
// Same zero-width-joiner padding trick as the source, so Gmail/Apple Mail don't
// pull in the first visible line of body copy as a preview.
const PREHEADER_PADDING =
  '&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;';

function renderPreheaderHtml(variant: ArchetypeVariant | null): string {
  const label = variant ? escapeHtml(variant.displayName) : 'Your archetype';
  return `${label}, explained. Doors open this fall.${PREHEADER_PADDING}`;
}

// ── the big variant block: full-bleed card, colorline, word set, why, promise ───
function renderVariantHtml(variant: ArchetypeVariant): string {
  const name = escapeHtml(variant.displayName);
  return `
      <!-- variant card -->
      <tr>
        <td style="padding:0;line-height:0;">
          <img src="${IMAGE_BASE}/${variant.image}" width="598" alt="${name}, your archetype card"
               style="width:100%;height:auto;display:block;border:0;outline:none;" />
        </td>
      </tr>
      <tr><td height="36" style="font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td align="center" style="padding:0 40px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0">
            <tr><td width="56" height="3" bgcolor="${variant.colorLine}" style="font-size:0;line-height:0;">&nbsp;</td></tr>
          </table>
        </td>
      </tr>
      <tr><td height="18" style="font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td align="center" style="padding:0 40px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:4px;color:#45474a;">
          ${variant.words.join(' &nbsp;&middot;&nbsp; ')}
        </td>
      </tr>
      <tr><td height="24" style="font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td align="center" class="inner" style="padding:0 40px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="max-width:432px;">
            <tr>
              <td align="center" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:28px;color:#45474a;">
                ${escapeHtml(variant.why)}
              </td>
            </tr>
            <tr><td height="38" style="font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr>
              <td align="center" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:10.5px;letter-spacing:4.5px;color:#9a2918;font-weight:bold;">
                DOORS&nbsp;OPEN&nbsp;THIS&nbsp;FALL
              </td>
            </tr>
            <tr><td height="14" style="font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr>
              <td align="center" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:28px;color:#45474a;">
                Your card is only the beginning. When we open, you will tune exactly how ${name} comes through in your cup, softer or deeper, until the match is unmistakably yours.
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
}

// Fallback: archetype missing or unrecognized (should not happen; see brief)
function renderFallbackHtml(): string {
  return `
      <tr>
        <td align="center" class="inner" style="padding:0 40px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="max-width:432px;">
            <tr>
              <td align="center" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:28px;color:#45474a;">
                Your match is ready and your archetype card is waiting. Your card is only the beginning, and when we open this fall, your match will only get more personal.
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
}

function renderHtml(firstName: string | null, archetypeSlug: string | null): string {
  const variant = isArchetypeSlug(archetypeSlug) ? VARIANTS[archetypeSlug] : null;
  const escapedName = firstName ? escapeHtml(firstName) : null;

  const headline = escapedName
    ? `${escapedName}, your <span style="background-color:#ee5974;color:#f2f1ea;padding:1px 8px;">match</span> is in.`
    : `Your <span style="background-color:#ee5974;color:#f2f1ea;padding:1px 8px;">match</span> is in.`;

  const footerTo = escapedName ? escapedName.toUpperCase() : 'YOU';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>Your coffee archetype card is here</title>
<style type="text/css">
  html, body { margin:0 !important; padding:0 !important; height:100% !important; width:100% !important; }
  * { -ms-text-size-adjust:100%; -webkit-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt !important; mso-table-rspace:0pt !important; }
  img { -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  @media screen and (max-width:620px) {
    .container { width:100% !important; }
    .inner { padding-left:24px !important; padding-right:24px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
  <!-- preheader (hidden) -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    ${renderPreheaderHtml(variant)}
  </div>

  <!-- page: white. the email itself is the only beige object. -->
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#ffffff">
    <tr>
      <td align="center" style="padding:34px 12px 48px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" class="container" bgcolor="#f2f1ea" style="width:600px;max-width:600px;background-color:#f2f1ea;border:1px solid #c5c7c8;">

          <!-- mark + wordmark -->
          <tr>
            <td align="center" style="padding:46px 40px 0;">
              <img src="${IMAGE_BASE}/logo-quarter.png" width="26" alt=""
                   style="display:block;border:0;outline:none;width:26px;height:auto;" />
            </td>
          </tr>
          <tr><td height="14" style="font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr>
            <td align="center" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:5px;color:#9a2918;font-weight:bold;">
              AXIS&nbsp;&amp;&nbsp;BLOOM
            </td>
          </tr>
          <tr><td height="38" style="font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- headline -->
          <tr>
            <td align="center" class="inner" style="padding:0 40px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:29px;line-height:40px;color:#9a2918;">
              ${headline}
            </td>
          </tr>
          <tr><td height="34" style="font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- archetype variants: full-bleed card, colorline, word set, the why, the promise -->
          ${variant ? renderVariantHtml(variant) : renderFallbackHtml()}

          <tr><td height="34" style="font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- instagram + stay tuned -->
          <tr>
            <td align="center" class="inner" style="padding:0 40px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr><td style="border-top:1px solid #c5c7c8;font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr><td height="22" style="font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td align="center" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:24px;color:#45474a;">
                    Until then, the road to opening day is on Instagram.
                  </td>
                </tr>
                <tr><td height="24" style="font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td align="center">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" bgcolor="#9a2918">
                          <a href="https://www.instagram.com/axisandbloom/" target="_blank"
                             style="display:inline-block;padding:17px 38px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:3px;color:#f2f1ea;font-weight:bold;text-decoration:none;">
                            @AXISANDBLOOM&nbsp;&nbsp;&rarr;
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td height="22" style="font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td align="center" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:4px;color:#7b7f80;">
                    STAY&nbsp;TUNED.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td height="40" style="font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- footer -->
          <tr>
            <td style="border-top:1px solid #c5c7c8;padding:24px 40px 42px;" align="center">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:2.5px;color:#45474a;">
                    FROM: AXIS &amp; BLOOM &mdash; TO: ${footerTo}
                  </td>
                </tr>
                <tr><td height="12" style="font-size:0;line-height:0;">&nbsp;</td></tr>
                <tr>
                  <td align="center" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:10.5px;line-height:19px;color:#7b7f80;">
                    Axis &amp; Bloom &middot; Creative Box LLC &middot; Union City, NJ 07087<br />
                    <a href="mailto:hello@axisandbloomcoffee.com?subject=Unsubscribe" style="color:#7b7f80;text-decoration:underline;">Unsubscribe</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function renderText(firstName: string | null, archetypeSlug: string | null): string {
  const variant = isArchetypeSlug(archetypeSlug) ? VARIANTS[archetypeSlug] : null;
  const headline = firstName ? `${firstName}, your match is in.` : 'Your match is in.';
  const footerTo = firstName ? firstName.toUpperCase() : 'YOU';

  const body = variant
    ? [
        `${variant.displayName.toUpperCase()}`,
        variant.words.join(' · '),
        '',
        variant.why,
        '',
        'DOORS OPEN THIS FALL',
        '',
        `Your card is only the beginning. When we open, you will tune exactly how ${variant.displayName} comes through in your cup, softer or deeper, until the match is unmistakably yours.`,
      ].join('\n')
    : 'Your match is ready and your archetype card is waiting. Your card is only the beginning, and when we open this fall, your match will only get more personal.';

  return [
    'AXIS & BLOOM',
    '',
    headline,
    '',
    body,
    '',
    'Until then, the road to opening day is on Instagram.',
    '@AXISANDBLOOM -> https://www.instagram.com/axisandbloom/',
    '',
    'STAY TUNED.',
    '',
    `FROM: AXIS & BLOOM — TO: ${footerTo}`,
    'Axis & Bloom · Creative Box LLC · Union City, NJ 07087',
    'Unsubscribe: mailto:hello@axisandbloomcoffee.com?subject=Unsubscribe',
  ].join('\n');
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Render the quiz-complete email for a given recipient. archetypeSlug must already
 * be normalized to one of the six known slugs (see mailchimp.ts's toArchetypeSlug) —
 * anything else, including null, renders the fallback variant.
 */
export function renderQuizCompleteEmail(firstName: string | null, archetypeSlug: string | null): RenderedEmail {
  return {
    subject: 'Your coffee archetype card is here',
    html: renderHtml(firstName, archetypeSlug),
    text: renderText(firstName, archetypeSlug),
  };
}
