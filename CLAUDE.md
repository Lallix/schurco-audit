# Schurco Site Audit

Site survey / pump audit app for Schurco sales reps, with opportunities and an admin dashboard.

- **Work / personal:** Work (Schurco Slurry)
- **Port:** 8092
- **Start:** `python -m http.server 8092 --bind 127.0.0.1` (or the `schurco-audit` entry in `.claude\launch.json`), then open http://127.0.0.1:8092/
- **GitHub:** https://github.com/Lallix/schurco-audit (public — hosted on GitHub Pages; never commit secrets)
- **Stack:** Static HTML / JavaScript PWA (no build step), Supabase (database, auth, edge function `sharepoint-upload`)
- **Non-code files:** `_files\` — user documentation and deployment notes in `_files\docs\`, `Pump Companies.xlsx` in `_files\data\`, old versions (v2–v39) in `_files\archive\`. Synced by OneDrive, gitignored.

## Rules
- Only work inside this folder. Never start another app's server.
- Use relative paths only. This folder is opened on two PCs with different Windows usernames (`GideonV` and `lalli`).
- The repo is public: never commit `.env` files, keys, service-role tokens or Excel/PDF reference files.

## Previous discussions
Before starting work, read `_files\docs\claude-history\HANDOVER.md`: where the build stands, key decisions, and open questions from earlier Claude sessions. The full past conversations are in the same folder; search them when you need detail.
