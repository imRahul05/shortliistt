# Shortlist — Local Job Match & Resume Tailor (Chrome extension)

Free, private job-application helper. No sign-in, no API keys, no servers. Everything runs in your browser.

## Install (2 minutes)
1. Download **[shortlist-extension.zip](https://github.com/imRahul05/shortliistt/releases/latest/download/shortlist-extension.zip)** (latest release) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped `shortlist` folder.
4. Pin Shortlist and click the icon (or press **Alt+J**). The side panel opens.
5. **Profile** tab: drop your resume (PDF / DOCX / TXT). Check the auto-filled profile fields.

## What it does
| Feature | How | AI needed? |
|---|---|---|
| Read the job | From the page's HTML (the DOM): schema.org `JobPosting` data first, then site-specific selectors (LinkedIn, Indeed, Greenhouse, Lever, Workday, Naukri, Glassdoor, Ashby, Dice, …), then a text-density heuristic. Text you select on the page overrides all of these. | No |
| Match score | About 250 skills with aliases. Detects **must-have / important / nice-to-have** from the job's sections. Adds years of experience (from your resume's date ranges), degree, title and ATS keyword coverage. Each missing must-have caps the score. | No |
| Suggestions | Missing and related skills, experience gaps, keywords, unquantified bullets, weak verbs, missing sections and contact info. | No |
| Floating score card | Appears on any detected job page — LinkedIn, Indeed, Naukri, Greenhouse/Lever/Workday/Ashby/Workable/iCIMS/Taleo/SuccessFactors and more, any page with a job-description block, and jobs embedded in iframes with the match %, must-haves, missing skills and an **AI insights** button that answers right in the card. Minimise to a pill, hide per page, or choose the corner in Settings. **Full report** opens the side panel. | No |
| Toolbar badge | Shows the match % on job pages automatically. | No |
| Resume Studio | Keeps your original formatting: bold/italic, **hyperlinks**, right-aligned dates and links, and a **LaTeX** style (bundled Computer Modern) for LaTeX resumes. **Fit to 1 page** or allow 2 pages (it asks when needed), Letter/A4, page-break guides. Live score, one-click tailoring. Export PDF, DOCX (with links) or TXT. | No |
| Cover letter | Drafted automatically for every job from your profile, best-matching experience and a relevant project; **Generate with AI** for a fully written version. Same header as your resume; export PDF/DOCX. | Optional |
| Autofill | Fills name, email, phone, LinkedIn/GitHub, location, title, years, notice period and salary, and attaches your resume file. Works in iframes too (e.g. Greenhouse embeds). | No |
| Resume auto-detection | Experience timeline from date ranges (`Sep 2025 – Present`, `2025-09`, `Sep '25`, `Since …`), skills, title, company, location — editable in Profile. | No |
| AI layer | Chrome's **built-in Gemini Nano**: fills gaps in resume parsing (extra skills, years when no dates), gives a second-opinion read of job requirements, review, summary, bullet rewrites, cover letter, application answers. Never changes the deterministic score. | Optional |

### About the on-device AI
* Uses `LanguageModel` (Chrome's Prompt API, available to extensions since Chrome 138). It is free and local, with no key.
* Needs desktop Chrome on Windows / macOS / Linux / ChromeOS, about 22 GB free disk, and a GPU with more than 4 GB VRAM or 16 GB RAM. Click **“Enable on-device AI”** in the panel header once to download the model.
* If it isn't available, Shortlist falls back to rule-based tools and templates. Matching never uses AI, so scores are deterministic and explainable.
* Prompts tell the model never to invent employers, dates, metrics or skills. AI bullet rewrites are shown as a diff you accept or reject line by line.

## Privacy
Your resume, profile, history and tailored resumes are stored in `chrome.storage.local` on your machine. **Profile → Delete all my data** wipes them. The extension makes no network requests.

## Architecture

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

### What happens when you open a job

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

### Scoring (deterministic)

```mermaid
flowchart TD
  JD["Job text"] --> SEC["Split into sections<br/>must-have · responsibilities · nice-to-have · company"]
  SEC --> SK["Detect ~250 skills with aliases<br/>weight by section + frequency"]
  RES["Resume text + profile skills"] --> HAVE["Your skills<br/>direct · implied (Next.js → React) · related family"]
  SK & HAVE --> S1["Skills 55%"]
  JD --> Y["Years asked"] --> S2["Experience 15%"]
  RES --> YR["Years from date ranges<br/>(Sep 2025 – Present)"] --> S2
  JD --> KW["Top repeated keywords"] --> S3["Keywords 15%"]
  S4["Title 10%"]
  S5["Education 5%"]
  S1 & S2 & S3 & S4 & S5 --> SCORE["Weighted score<br/>capped if must-haves are missing"]
```

### Release pipeline

```mermaid
flowchart LR
  M["Merge to main"] --> Q{"Extension files changed?<br/>(not website/, test/, .github/, *.md)"}
  Q -- no --> N["No release<br/>(Vercel redeploys website/ if changed)"]
  Q -- yes --> T["Test matcher"] --> V["Version = major.minor.run#"] --> Z["Zip extension"] --> R["GitHub Release<br/>shortlist-extension.zip"]
  R --> W["Website buttons → releases/latest/download"]
```

## Project layout
```
manifest.json            MV3 manifest (side panel, scripting, storage, offscreen)
background.js            scores detected jobs, toolbar badge, opens side panel, routes AI to offscreen
content/extract.js       DOM → job {title, company, description}
content/widget.js        floating score card on job pages (runs in all frames)
offscreen/               hidden page that runs Chrome's built-in AI for the card
lib/skills.js            skill taxonomy, aliases, families, implications
lib/matcher.js           deterministic scoring, date parsing, suggestions
lib/resume-parser.js     PDF (pdf.js) / DOCX → rich text with bold, italic and links
lib/resume-model.js      rich text ↔ editable model, HTML render, tailoring helpers
lib/docx.js              dependency-free DOCX writer (hyperlinks included)
lib/letter.js            cover letter drafting from resume + job
lib/ai.js                optional Chrome built-in AI (Gemini Nano)
lib/autofill.js          form autofill (injected into all frames)
lib/fonts/               Geist, Geist Mono, CMU Serif (OFL)
lib/pdfjs/               Mozilla pdf.js 4.10 (Apache-2.0), bundled locally
sidepanel/               Match · Apply · Profile UI
studio/                  Resume Studio + cover letter
website/                 landing page (Next.js), deployed on Vercel
test/                    `node test/run.mjs` — matcher smoke test
.github/workflows/       release.yml — versioned zip + GitHub Release
```

## Releases
Every push to `main` that changes extension files (anything outside `website/`, `test/`, `.github/` and `*.md`) runs `.github/workflows/release.yml`: it tests the matcher, sets the version to `<major>.<minor>.<build number>` (from `manifest.json`), zips the extension and publishes a GitHub Release. The link above always points to the newest one. Bump `major.minor` in `manifest.json` for bigger releases.

## Website
The landing page lives in `website/` (Next.js + Tailwind + Geist). Deploy on Vercel: **New Project → import this repo → set Root Directory to `website`** → Deploy. Local dev: `cd website && npm install && npm run dev`.

## Tips
* Wrong or empty job text? Select the description on the page and click **Analyze**, or use **Edit job text**.
* Click a red (missing) skill in the Match tab if you really have it. It's added to your profile skills and the score updates.
* Set **Years of experience** in Profile if the value computed from your resume dates is off.
