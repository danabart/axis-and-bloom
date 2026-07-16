# Task: Unlist About, Shop, and How It Works from the public nav — keep pages live, add Admin quick-links

## Context

Three public pages — `/about`, `/shop`, `/how-it-works` — should no longer be reachable from the site's main navigation or footer, but they must **not** be deleted or retired. The routes, components, and URLs stay exactly as-is in `frontend/src/app/App.tsx`:

```tsx
<Route path="/how-it-works" element={<HowItWorks />} />
<Route path="/about" element={<About />} />
<Route path="/shop" element={<Shop />} />
```

Do not touch those three lines. This is purely an "unlist from navigation, keep reachable by URL" change.

Instead, add a link to each of them from a new section in the Admin sidebar, so they stay one click away for internal reference.

---

## 1. Remove the three links from the main nav — `frontend/src/app/components/Navigation.tsx`

Desktop nav block (the `<div className="hidden md:flex" ...>` list of `<Link>`s): remove these three lines —

```tsx
<Link to="/how-it-works" ...>HOW IT WORKS</Link>
<Link to="/about" ...>ABOUT</Link>
<Link to="/shop" ...>SHOP</Link>
```

Mobile menu array (the array mapped in the mobile panel): remove the matching three objects —

```tsx
{ to: '/how-it-works', label: 'HOW IT WORKS' },
{ to: '/about', label: 'ABOUT' },
{ to: '/shop', label: 'SHOP' },
```

Leave every other link (The Axis, The Bloom, Find My Flavor, Flavor Intelligence, Admin) untouched in both places.

---

## 2. Remove the same three links from the footer — `frontend/src/app/components/Footer.tsx`

"Explore" column array: remove `{ to: '/shop', label: 'Shop' }` and `{ to: '/how-it-works', label: 'How it works' }`.

"Company" column array: remove `{ to: '/about', label: 'About' }`.

(Leaving them in the footer would defeat the point of unlisting — the footer renders on every public page.)

---

## 3. Add an "Unlisted Pages" section to the Admin sidebar — `frontend/src/app/components/admin/AdminLayout.tsx`

The sidebar currently renders `NAV_TOP` (Dashboard) followed by `NAV_SECTIONS.map(...)` (Catalogue & Supply, Cupping & QC, Sommelier AI, Company Gifts), each using `NavLink` with active-state highlighting. These three pages are **public pages, not admin sub-routes**, so don't add them to `NAV_SECTIONS` or wrap them in `NavLink` — add a separate block below the existing `NAV_SECTIONS.map(...)` using plain `<a>` tags that open in a new tab, so clicking one doesn't navigate the admin away from the admin panel.

Add a new constant near the top, alongside `NAV_TOP` / `NAV_SECTIONS`:

```tsx
const NAV_UNLISTED = [
  { to: '/about', label: 'About' },
  { to: '/shop', label: 'Shop' },
  { to: '/how-it-works', label: 'How It Works' },
];
```

Render it directly after the closing of the `{NAV_SECTIONS.map(section => ( ... ))}` block, before the "Back to site + Sign out" div, using the same header style as the other section labels but plain `<a>` links for the items:

```tsx
<div>
  <p className="text-xs font-normal tracking-widest uppercase mt-6 mb-2 px-3" style={{ color: '#b05642' }}>
    Unlisted Pages
  </p>
  <nav className="flex flex-col gap-1">
    {NAV_UNLISTED.map(({ to, label }) => (
      <a
        key={to}
        href={to}
        target="_blank"
        rel="noopener noreferrer"
        className="px-3 py-2 rounded text-sm text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
      >
        {label}
      </a>
    ))}
  </nav>
</div>
```

---

## 4. Verify

- `npm run build` in `frontend/` with no type errors.
- `/about`, `/shop`, and `/how-it-works` still load correctly when visited directly by URL.
- None of those three links appear anywhere in the top nav (desktop or mobile) or the footer.
- Every other nav/footer link is unchanged.
- Admin sidebar shows a new "Unlisted Pages" section below Company Gifts, with About / Shop / How It Works, each opening in a new tab and not disturbing the current admin page.
