# Project instructions for Claude

## Git workflow (standing instruction from the repository owner)

- **Always automatically commit and push all changes to the `main` branch** (the default branch) — current and future
  work alike. Do not wait to be asked, and do not leave work only on feature branches.
- If a session is assigned a feature branch, still push to it as required, but also push the same commits to `main`
  (`git push origin HEAD:main`). Prefer fast-forward pushes; if `main` has diverged, merge `origin/main` first —
  never force-push `main`.
- Run `npm test` before pushing; push only when tests pass (report failures instead of pushing broken code).

## Project quick reference

- Start: `npm start` (http://127.0.0.1:5177) · Sync: `npm run sync` · Tests: `npm test`
- Architecture and model docs: `README.md`, `docs/DESIGN.md`, `docs/VALUATION_MODEL.md`, `docs/ADDING_A_SOURCE.md`
- Never hard-code source names outside `adapters/` and `config/sources.json`; bump `model_version` in
  `config/model.json` whenever valuation formulas or defaults change.

## Project handoff (keep current)

- Read `docs/CLAUDE_CODE_HANDOFF.md` at the start of a session; it records the actual project state, known bugs and
  the next task ("PICK UP HERE").
- Update it in the same commit whenever architecture, features, formulas/defaults (with the `model_version` bump),
  data sources, important bugs, priorities or blockers change.
