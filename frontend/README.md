# RetinaEdge frontend

Offline diabetic-retinopathy screening UI for ASHA workers, PHC nurses and vision-centre technicians, with a district dashboard. Vite + React 18 + TypeScript, React Router, plain CSS with custom properties. No UI kit, no chart library, no icon font.

## Requirements

- Node 22 (any 18+ works)
- The FastAPI backend running on `http://127.0.0.1:8000` (`python run.py` from the project root)

## Development

```bash
cd frontend
npm install
npm run dev
```

Vite serves the app on `http://localhost:5173` and proxies `/api`, `/images` and `/models` to the backend, so no CORS setup is needed. The camera capture step needs a secure context: `localhost` counts, a LAN IP over plain HTTP does not.

## Production build

```bash
npm run build
```

This runs `tsc --noEmit` and then `vite build`, writing to `frontend/dist`. The backend serves that folder as the single-page app when it exists (`backend/app.py` mounts `dist/assets` and falls back to `dist/index.html`), so after building, open `http://127.0.0.1:8000` with only the Python server running.

Other scripts:

- `npm run typecheck` runs the TypeScript compiler only.
- `npm run preview` serves the built `dist` folder locally (still needs the backend for data).

## Layout

```
src/
  api/          client.ts (fetch wrapper, typed endpoints), types.ts (API shapes)
  components/   Layout, ThemeToggle, Stepper, ImageViewer, GradeCard, TierPill,
                QualityCoach, PatientSheet, CameraCapture, StatTile, BarChart, ui (alerts,
                loading, dialog, toast), Icons
  hooks/        useTheme (light/dark/system), useHealth (server + model status), useLocalStorage
  i18n/         en.json, hi.json, index.tsx (LangProvider, useT, tFor)
  pages/        Home, Screen (4-step stepper), Records, RecordDetail, SecondLook, Dashboard, About
  styles/       tokens.css (design tokens), base.css, layout.css, components.css, sheet.css (print)
  utils/        format.ts
```

## Design notes

- Tokens live in `src/styles/tokens.css`. Light values are on `:root`, dark values under `[data-theme="dark"]`, and the same dark set applies under `prefers-color-scheme: dark` when the theme is set to System (no `data-theme` attribute). The choice is stored in `localStorage` under `retinaedge.theme` and applied before first paint by a small inline script in `index.html`.
- UI language (`retinaedge.lang`) is separate from the report language chosen per patient in Step 1 (`retinaedge.reportLang`), which only affects the printed patient sheet.
- Site, worker and reviewer names are remembered in `localStorage`.
- Lesion and heat-map overlays are produced on the black-border-cropped image; `ImageViewer` positions them over the original image using `crop_box` relative to the natural image size.
- `hi.json` must contain every key in `en.json`; the build fails otherwise (`satisfies Record<TKey, string>` in `src/i18n/index.tsx`).
