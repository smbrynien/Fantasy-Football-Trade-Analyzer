# Project instructions for Claude

## Git workflow (standing instruction from the repository owner)

- **Always automatically commit and push all changes to the `main` branch** (the default branch) — current and future
  work alike. Do not wait to be asked, and do not leave work only on feature branches.
- If a session is assigned a feature branch, still push to it as required, but also push the same commits to `main`
  (`git push origin HEAD:main`). Prefer fast-forward pushes; if `main` has diverged, merge `origin/main` first —
  never force-push `main`.
- Run `npm test` before pushing; push only when tests pass (report failures instead of pushing broken code).

## Target platform: desktop only (standing instruction from the repository owner, 2026-10-03)

- **This analyzer is meant for desktop use only, not for phones or other mobile devices.** It runs in a desktop
  browser on the same computer as its local server.
- **Do not make changes or improvements whose only purpose is mobile use**: no new phone layouts, phone-only
  features, touch-specific work, phone-width polish, or phone access (e.g. LAN/"phone mode" serving). Treat existing
  backlog items that are mobile-only as out of scope.
- **Do not delete existing mobile features or responsive CSS just because they are mobile-only.** Remove or simplify
  them only when that improves the desktop experience (e.g. it simplifies desktop code or fixes a desktop problem).
- **Prioritize desktop in all future improvements, bug checks and tests.** Verify UI changes first at desktop widths
  (1360 px primary; narrower desktop/laptop windows down to about 1024 px should stay usable). Existing phone-width
  E2E checks (390 px) stay as regression guards for what already exists, but add no new phone-only checks; when a
  desktop improvement changes phone-width behaviour, update those checks to match rather than adding mobile work.

## Project quick reference

- Start: `npm start` (http://127.0.0.1:5177) · Sync: `npm run sync` · Tests: `npm test`
- Architecture and model docs: `README.md`, `docs/DESIGN.md`, `docs/VALUATION_MODEL.md`, `docs/ADDING_A_SOURCE.md`
- Never hard-code source names outside `adapters/` and `config/sources.json`; bump `model_version` in
  `config/model.json` whenever valuation formulas or defaults change.

## Project handoff (keep current)

- Read `docs/CLAUDE_CODE_HANDOFF.md` at the start of a session; it records the actual project state, known bugs and
  the next task ("PICK UP HERE").
- **Standing instruction from the repository owner: after ANY change to the project, update
  `docs/CLAUDE_CODE_HANDOFF.md` so it reflects the current status** — in the same commit, before pushing. At minimum
  refresh the status (§2), known bugs (§19), backlog and next steps (§34–35), PICK UP HERE and git state (§38), plus
  any section the change touches (architecture, features, formulas/defaults with the `model_version` bump, data
  sources, priorities, blockers). A change is not finished until the handoff matches the code.
