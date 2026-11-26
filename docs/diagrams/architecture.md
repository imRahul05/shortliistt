# Architecture

How the pieces fit together: content scripts on the job page, the extension (background, side panel, Studio, offscreen page), the shared `lib/` code, storage and the optional on-device AI.

Everything runs inside the browser. There is no backend: the only network traffic is the job page itself and, optionally, Chrome's one-time download of its built-in model.

```mermaid
flowchart LR
  subgraph TAB["① Job site tab"]
    direction TB
    DOM["Job posting DOM<br/>LinkedIn · Naukri · Workday · …"] --> EX["content/extract.js<br/>reads title, company, description"] --> CARD["content/widget.js<br/>floating score card"]
  end

  subgraph EXT["② Extension"]
    direction TB
    BG["background.js<br/>scores jobs · badge · opens panel"] --- OFF["offscreen/<br/>runs AI for the card"]
    SP["sidepanel/<br/>Match · Apply · Profile"] ~~~ ST["studio/<br/>resume + cover letter editor"]
  end

  subgraph CORE["③ lib/ — shared logic"]
    direction TB
    MATCH["matcher.js + skills.js<br/>deterministic score"] ~~~ PARSE["resume-parser.js<br/>PDF / DOCX → rich text"]
    MODEL["resume-model · docx · letter<br/>render & export"] ~~~ AI["ai.js<br/>prompts"]
  end

  STORE[("chrome.storage.local<br/>resume · profile · drafts")]
  NANO["Chrome built-in AI<br/>Gemini Nano · optional"]

  TAB <-- "runtime messages" --> EXT
  EXT -- "imports" --> CORE
  EXT <-- "read / write" --> STORE
  CORE -. "Prompt API" .-> NANO
```

[← All diagrams](README.md) · [← Project README](../../README.md)
