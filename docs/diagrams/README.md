# Diagrams

GitHub renders these Mermaid diagrams directly.

- [Architecture](architecture.md) — How the pieces fit together: content scripts on the job page, the extension (background, side panel, Studio, offscreen page), the shared `lib/` code, storage and the optional on-device AI.
- [What happens when you open a job](job-flow.md) — From reading the job on the page to the floating score card, including the optional AI insights path.
- [How the match score is calculated](scoring.md) — The score is deterministic — no AI. Same resume + same job = same score.
- [Release pipeline](release-pipeline.md) — Which merges publish a new extension version, and how the website always serves the latest zip.

[← Project README](../../README.md)
