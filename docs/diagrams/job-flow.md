# What happens when you open a job

From reading the job on the page to the floating score card, including the AI insights path (run in the side panel) and automatic application tracking.

```mermaid
sequenceDiagram
  autonumber
  participant P as Job page
  participant C as Content script
  participant B as Background
  participant S as chrome.storage
  participant SP as Side panel
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
    C->>B: open-panel-with(ai-insights)
    B->>SP: open side panel
    SP->>SP: Prompt API → Gemini Nano (on device), streamed
  end
  opt "Thank you for applying" screen
    C->>B: applied-confirmation
    B->>S: tracker: status = Applied
  end
```

[← All diagrams](README.md) · [← Project README](../../README.md)
