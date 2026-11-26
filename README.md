# Shortlist — Local Job Match & Resume Tailor (Chrome extension)

Free, private job-application helper. No sign-in, no API keys, no servers. Everything runs in your browser.

## Install (2 minutes)
1. Unzip `shortlist.zip`.
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
| Toolbar badge | Shows the match % on job pages automatically. | No |
| Resume Studio | Live editor and preview with the score updating as you type. One-click: add missing skills, order skills by relevance, put relevant bullets first, generate a summary. Export **PDF** (print → Save as PDF), **DOCX** or **TXT**. | No |
| Autofill | Fills name, email, phone, LinkedIn/GitHub, location, title, years, notice period and salary, and attaches your resume file. Works in iframes too (e.g. Greenhouse embeds). | No |
| AI review, AI summary, AI bullet rewrite, cover letter, application answers | Chrome's **built-in Gemini Nano** (Prompt API), running on your device | Optional |

### About the on-device AI
* Uses `LanguageModel` (Chrome's Prompt API, available to extensions since Chrome 138). It is free and local, with no key.
* Needs desktop Chrome on Windows / macOS / Linux / ChromeOS, about 22 GB free disk, and a GPU with more than 4 GB VRAM or 16 GB RAM. Click **“Enable on-device AI”** in the panel header once to download the model.
* If it isn't available, Shortlist falls back to rule-based tools and templates. Matching never uses AI, so scores are deterministic and explainable.
* Prompts tell the model never to invent employers, dates, metrics or skills. AI bullet rewrites are shown as a diff you accept or reject line by line.

## Privacy
Your resume, profile, history and tailored resumes are stored in `chrome.storage.local` on your machine. **Profile → Delete all my data** wipes them. The extension makes no network requests.

## Project layout
```
manifest.json            MV3 manifest (side panel, scripting, storage)
background.js            opens side panel, scores job tabs for the badge
content/extract.js       DOM → job {title, company, description} (injected on demand)
lib/skills.js            skill taxonomy, aliases, families, implications
lib/matcher.js           deterministic scoring + suggestions
lib/resume-parser.js     PDF (pdf.js) / DOCX (native unzip) / TXT → text
lib/resume-model.js      text ↔ editable model, HTML render, tailoring helpers
lib/docx.js              dependency-free DOCX writer
lib/ai.js                optional Chrome built-in AI (Gemini Nano)
lib/autofill.js          form autofill (injected into all frames)
sidepanel/               Match · Apply · Profile UI
studio/                  full-page Resume Studio
lib/pdfjs/               Mozilla pdf.js 4.10 (Apache-2.0), bundled locally
test/                    `node test/run.mjs` — matcher smoke test
```

## Tips
* Wrong or empty job text? Select the description on the page and click **Analyze**, or use **Edit job text**.
* Click a red (missing) skill in the Match tab if you really have it. It's added to your profile skills and the score updates.
* Set **Years of experience** in Profile if the value computed from your resume dates is off.
