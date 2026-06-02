import { useState } from 'react';

const BRAND = '#a33726';
const CREAM = '#f0ebe1';
const TERRACOTTA = '#c45040';
const LOGO_COLOR = '#f0ebe1';

function LogoLines() {
  return (
    <svg
      viewBox="0 0 162.4763 171.4078"
      xmlns="http://www.w3.org/2000/svg"
      style={{ maxWidth: '380px', width: '65%' }}
      aria-label="Axis & Bloom"
    >
      <g>
        <path d="M93.5146,66.9044l46.2837-46.5338-1.7404-1.6709C123.5387,7.299,105.2346.5,85.3425.5h-.0039v67.7873" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M85.4858,63.0539V.5h-.0039c-19.8921,0-38.1962,6.799-52.7154,18.1997l-1.7404,1.6709,44.969,45.212" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M69.7303,93.2506l-60.8333,28.8617c4.5542,9.6492,10.8713,18.3015,18.539,25.5408l47.7477-47.6522c-2.3381-1.7486-4.2215-4.0688-5.4534-6.7504Z" fill="none" stroke={LOGO_COLOR} strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M54.9149,127.6212c8.5949,6.3462,19.2059,10.1114,30.6805,10.1342v-14.7921c-7.4083-.0207-14.3058-2.2295-20.0973-6.0019l-10.5832,10.6599Z" fill="none" stroke={LOGO_COLOR} strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M40.3707,101.713c-1.7446-4.9278-2.712-10.2197-2.7476-15.7298h-20.1577c0,8.5938,1.6017,16.8108,4.5073,24.3815l18.398-8.6517Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M43.2637,139.3566c11.6257,9.2342,26.3316,14.7565,42.3316,14.7565v-12.1223c-12.638-.0231-24.3086-4.2426-33.6937-11.3348l-8.638,8.7005Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M68.5527,113.8844c4.9693,3.0496,10.8009,4.8237,17.0426,4.8431v-15.0808c-2.0621,0-4.0403-.3563-5.88-1.0057l-11.1626,11.2434Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M68.1388,88.6548c-.1331-.8716-.2067-1.7627-.2067-2.6717h-26.0734c.0344,4.8664.8702,9.5436,2.372,13.9147l23.908-11.243Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M100.9779,93.2506l60.8333,28.8617c-4.5542,9.6492-10.8713,18.3015-18.539,25.5408l-47.7477-47.6522c2.3381-1.7486,4.2215-4.0688,5.4534-6.7504Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M130.3375,101.713c1.7446-4.9278,2.712-10.2197,2.7476-15.7298h20.1577c0,8.5938-1.6017,16.8108-4.5073,24.3815l-18.398-8.6517Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M102.5694,88.6548c.1331-.8716.2067-1.7627.2067-2.6717h26.0734c-.0344,4.8664-.8702,9.5436-2.372,13.9147l-23.908-11.243Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M69.7303,78.7758L8.897,49.9141c4.5542-9.6492,10.8713-18.3015,18.539-25.5408l47.7477,47.6522c-2.3381,1.7486-4.2215,4.0688-5.4534,6.7504Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M37.6231,86.0432h-20.1577c0-8.5938,1.6017-16.8108,4.5073-24.3815l18.398,8.6517" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M43.2637,32.6698c11.6257-9.2342,26.3316-14.7565,42.3316-14.7565v12.1223c-12.638.0231-24.3086,4.2426-33.6937,11.3348l-8.638-8.7005Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M68.5527,58.142c4.9693-3.0496,10.8009-4.8237,17.0426-4.8431v15.0808c-2.0621,0-4.0403.3563-5.88,1.0057l-11.1626-11.2434Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M100.9779,78.7758l60.8333-28.8617c-4.5542-9.6492-10.8713-18.3015-18.539-25.5408l-47.7477,47.6522c2.3381,1.7486,4.2215,4.0688,5.4534,6.7504Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M130.3375,70.3134c1.7446,4.9278,2.712,10.2197,2.7476,15.7298h20.1577c0-8.5938-1.6017-16.8108-4.5073-24.3815l-18.398,8.6517Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M127.4445,32.6698c-11.6257-9.2342-25.9609-14.7565-41.961-14.7565v12.1223c12.638.0231,23.9379,4.2426,33.323,11.3348l8.638-8.7005Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M102.1555,58.142c-4.9693-3.0496-10.8009-4.8237-17.0426-4.8431v15.0808c2.0621,0,4.0403.3563,5.88,1.0057l11.1626-11.2434Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M102.5694,83.3716c.1331.8716.2067,1.7627.2067,2.6717h26.0734c-.0344-4.8664-.8702-9.5436-2.372-13.9147l-23.908,11.243Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M67.143,47.196c2.4481-1.1487,4.9796-2.0668,7.6206-2.6496,2.7537-.6078,5.5793-.9537,8.39-1.1597.7767-.0567,1.5544-.0964,2.3323-.1293V.5h-.0039c-19.8921,0-38.1962,6.799-52.7154,18.1997l-1.7404,1.6709,30.363,30.5271c1.7663-1.4516,3.6856-2.7311,5.754-3.7017Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M115.7933,44.4052c-8.5949-6.3462-18.7052-10.1114-30.1798-10.1342v14.7921c7.4083.0207,13.8051,2.2295,19.5966,6.0019l10.5832-10.6599Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M92.9448,104.5033c-.0133.0208-.0296.0397-.0431.0604l-1.9089-1.9227c-1.8397.6495-3.3298,1.0058-5.3919,1.0058v4.7654c-.0252.0032-.1722,62.4956-.1722,62.4956h.4921c19.8921,0,37.0481-6.799,51.5673-18.1997l1.7403-1.6709-46.2836-46.5339Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M85.3425,154.3124c-.1677,0,.2646-.0052.0972-.0063l-.0683,16.6017h0c19.8921,0,37.5975-6.799,52.1167-18.1997l1.7404-1.6709-11.4348-11.4969c-11.6627,9.2475-26.4111,14.7721-42.4511,14.7721Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M44.3073,72.1868L6.637,54.6155c-3.481,6.5613-6.3632,20.4121-6.123,31.4607l41.3529-.1235" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M54.9149,44.4052c8.5949-6.3462,19.1405-10.046,30.6151-10.0688v14.7921c-7.4083.0207-14.2404,2.1641-20.0319,5.9365l-10.5832-10.6599Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
        <path d="M68.1388,83.3716c-.1331.8716-.2067,1.7627-.2067,2.6717h-26.0734c.0344-4.8664.8702-9.5436,2.372-13.9147l23.908,11.243Z" fill="none" stroke={LOGO_COLOR} strokeMiterlimit="10"/>
      </g>
    </svg>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  borderBottom: `1.5px solid ${BRAND}`,
  background: 'transparent',
  padding: '14px 0',
  fontFamily: 'Genova, sans-serif',
  fontSize: '1rem',
  color: BRAND,
  outline: 'none',
};

export default function PreLaunch() {
  const [firstName, setFirstName] = useState('');
  const [email, setEmail]         = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    try {
      await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firstName, source: 'pre_launch' }),
      });
    } catch {
      // fail silently — still show confirmation
    }
    setSubmitted(true);
  };

  return (
    <>
      <style>{`
        .pl-input::placeholder {
          color: ${BRAND};
          opacity: 0.45;
          font-family: Genova, sans-serif;
        }
      `}</style>

      <div
        className="fixed inset-0 z-[9999] flex flex-col md:flex-row"
        style={{ fontFamily: 'Genova, sans-serif' }}
      >
        {/* ── Left — terracotta ─────────────────────────────────── */}
        <div
          className="w-full h-2/5 md:w-1/2 md:h-full"
          style={{
            backgroundColor: TERRACOTTA,
            borderRight: '1px solid #a3372630',
            borderBottom: '1px solid #a3372630',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <LogoLines />
        </div>

        {/* ── Right — beige ─────────────────────────────────────── */}
        <div
          className="w-full h-3/5 md:w-1/2 md:h-full flex items-center justify-center p-10 md:p-20"
          style={{ backgroundColor: CREAM }}
        >
          <div style={{ width: '100%' }}>

            {/* Tagline */}
            <p style={{
              fontFamily: 'Genova, sans-serif',
              fontWeight: 400,
              color: BRAND,
              fontSize: '1rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              lineHeight: 1.8,
              margin: 0,
            }}>
              Your coffee identity.<br />Coming September 1.
            </p>

            {/* Separator */}
            <div style={{ height: '1px', backgroundColor: '#a3372640', margin: '32px 0' }} />

            {/* Form / confirmation */}
            {submitted ? (
              <p style={{
                fontFamily: 'Genova, sans-serif',
                fontWeight: 400,
                color: BRAND,
                fontSize: '0.95rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}>
                You're on the list.
              </p>
            ) : (
              <form
                onSubmit={handleSubmit}
                style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}
              >
                <input
                  type="text"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  placeholder="your first name"
                  className="pl-input"
                  style={inputStyle}
                />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your email"
                  required
                  className="pl-input"
                  style={inputStyle}
                />
                <button
                  type="submit"
                  style={{
                    background: 'none',
                    border: 'none',
                    fontFamily: 'Genova, sans-serif',
                    fontWeight: 400,
                    fontSize: '0.95rem',
                    color: BRAND,
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    padding: 0,
                    textAlign: 'left',
                    transition: 'opacity 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.6')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                >
                  JOIN →
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
