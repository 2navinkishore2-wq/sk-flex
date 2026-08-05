# SK Flex — Flex &amp; Frame Billing App

A production-ready, offline-first billing app for a Flex printing and Photo Frame shop.
Built with plain HTML5 / CSS3 / vanilla JavaScript — no frameworks, no build step.

## Getting started

Just open `index.html` in a browser — everything works from disk (`file://`).
For the best experience (and so the app can load `data/frame-prices.json` over
`fetch`), serve the folder with any static server:

```bash
cd SK-Flex
python3 -m http.server 8080
# open http://localhost:8080
```

## Folder structure

```
SK-Flex/
├── index.html              Markup for every screen (billing, settings, invoice)
├── css/style.css            Full theme + responsive layout
├── js/app.js                All application logic (calculators, storage, invoice)
├── assets/
│   ├── logo.png              SK logo (header, invoice, favicon, loading screen)
│   └── icons/                 (reserved for future custom icon assets)
├── data/
│   └── frame-prices.json     Editable, data-driven frame price list
└── README.md
```

## Editing the frame price list

`data/frame-prices.json` holds every size × frame-width price shown in the
Frame tab. When the app is served over http(s) it is loaded automatically; if
opened directly from disk, an identical copy embedded in `js/app.js`
(`EMBEDDED_FRAME_DATA`) is used instead — keep both in sync if you edit prices.

```json
{ "size": "12x18", "beeding": 255, "1in": 350, "1.5in": 400, "2in": 450 }
```

Leave a width's value as `null` if that size isn't offered in that width
(matches the blank cells on the original printed price list).

## Data storage

Everything is stored in the browser's `localStorage` — no backend required:

- Company profiles (multi-brand support: SK Flex, SK Digital, SK Ads, etc.)
- Customer database (auto-fills phone/address by name)
- Billing defaults (flex rate, min/max size, currency symbol)
- The current in-progress bill (so a refresh doesn't lose your work)

Use **Settings → Data** to export a JSON backup or restore one, and to reset
the app to a clean state.

## Invoices

**Preview Invoice** builds a printable A4-style invoice with your active
company's logo/name/phone/address, an auto-incrementing invoice number, the
customer's details, a line-item table, and the grand total.

- **Print** — opens the standard browser print dialog.
- **Download PDF** — renders the invoice to a real `.pdf` file and downloads
  it directly, no print dialog involved. This uses `html2canvas` +
  `jsPDF`, loaded from a CDN in `index.html`. If you're working fully
  offline and those scripts can't load, the button automatically falls
  back to the print dialog instead.
- **Share** — uses the device's native share sheet (`navigator.share`) where
  available (most mobile browsers), and falls back to a pre-filled WhatsApp
  message on desktop.

## Calculation logic (unchanged from the original calculator)

- **Flex:** `Width × Height = Square Feet`, then `Square Feet × Rate = Amount`
- **Frame:** price is looked up directly from the price list by Size + Frame
  Width, then multiplied by Quantity — no manual typing required.

## Customizing the theme

All colors, fonts and radii are defined as CSS custom properties at the top
of `css/style.css` (`:root { ... }`) — change them there to re-theme the
whole app.
