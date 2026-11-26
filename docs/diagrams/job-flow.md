# What happens when you open a job

From reading the job on the page to the floating score card, including the optional AI insights path.

```mermaid
sequenceDiagram
  autonumber
  participant P as Job page
  participant C as Content script
  participant B as Background
  participant S as chrome.storage
  participant SP as Side panel
  participant O as Offscreen page
  P->>C: page loads / SPA navigates (URL or DOM change)
  C->>C: extract job (title, company, description)
  C->>B: match(job)
  B->>S: read resume + profile
  B->>B: analyzeJob + matchJob (no AI)
  B-->>C: score, verdict, missing must-haves
  B->>B: set toolbar badge
  C->>P: show floating card
  B-->>SP: job-detected (if panel is open)
  opt "AI insights" clicked on the card
    C->>B: ai-insights(job)
    B->>B: ensure offscreen document
    B->>O: ai-insights(job)
    O->>O: Prompt API → Gemini Nano (on device)
    O-->>B: insights text
    B-->>C: insights text
  end
```

[← All diagrams](README.md) · [← Project README](../../README.md)
