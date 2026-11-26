// Reads a job posting from the DOM (no screenshots, no AI).
// Loaded as a content script (defines the function) and injected on demand by the side panel
// (the last expression's value is returned to chrome.scripting.executeScript).
var __shortlistExtract = __shortlistExtract || (() => {
  const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'TR', 'TABLE', 'HEADER', 'FOOTER', 'BLOCKQUOTE', 'PRE', 'DD', 'DT', 'DL']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'BUTTON', 'IFRAME', 'TEMPLATE', 'INPUT', 'SELECT', 'TEXTAREA', 'NAV', 'FORM', 'SHORTLIST-CARD']);

  // DOM -> text keeping headings, paragraphs and bullets (also reads collapsed "see more" content).
  function nodeToText(root) {
    let out = '';
    const nl = () => { if (out && !out.endsWith('\n')) out += '\n'; };
    const walk = n => {
      if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, ' '); return; }
      if (n.nodeType !== 1 || SKIP.has(n.tagName)) return;
      if (n.classList?.contains('visually-hidden') || n.classList?.contains('sr-only')) return;
      const block = BLOCK.has(n.tagName);
      if (block) nl();
      if (n.tagName === 'LI') out += '• ';
      if (n.tagName === 'BR') { out += '\n'; return; }
      for (const c of n.childNodes) walk(c);
      if (block) nl();
      if (/^H[1-6]$/.test(n.tagName)) out += '\n';
    };
    walk(root);
    return out.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^• *$/gm, '').trim();
  }
  const htmlToText = html => nodeToText(new DOMParser().parseFromString(html || '', 'text/html').body);
  const q = sel => { for (const s of [].concat(sel)) { try { const e = document.querySelector(s); if (e && e.textContent.trim()) return e; } catch {} } return null; };
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const txt = sel => clean(q(sel)?.textContent);
  const JD_SIGNALS = /(responsibilit|qualification|requirement|what you'?ll do|what you will do|what we'?re looking for|must[\s-]have|nice[\s-]to[\s-]have|preferred|years of (?:professional |relevant )?experience|about the (?:job|role)|job description|you will|who you are|benefits)/gi;
  const signalCount = t => new Set((t.match(JD_SIGNALS) || []).map(x => x.toLowerCase().slice(0, 12))).size;

  // 1) schema.org JobPosting (most job boards publish this for Google Jobs)
  function fromJsonLd() {
    const nodes = [];
    const visit = o => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(visit);
      const t = o['@type'];
      if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) nodes.push(o);
      if (o['@graph']) visit(o['@graph']);
    };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { visit(JSON.parse(s.textContent)); } catch {} }
    const j = nodes.find(n => n.description && String(n.description).length > 150);
    if (!j) return null;
    const org = j.hiringOrganization;
    const loc = [].concat(j.jobLocation || []).map(l => l?.address ? [l.address.addressLocality, l.address.addressRegion, l.address.addressCountry?.name || l.address.addressCountry].filter(Boolean).join(', ') : '').filter(Boolean).join(' / ');
    let extra = '';
    for (const k of ['qualifications', 'skills', 'experienceRequirements', 'educationRequirements', 'responsibilities']) {
      const v = j[k]; if (!v) continue;
      const s = typeof v === 'string' ? v : v.description || v.name || (Array.isArray(v) ? v.join(', ') : '');
      if (s && !String(j.description).includes(String(s).slice(0, 40))) extra += `\n\n${k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())}:\n${htmlToText(String(s))}`;
    }
    return { title: htmlToText(j.title || ''), company: typeof org === 'string' ? org : org?.name || '', location: loc || (j.jobLocationType === 'TELECOMMUTE' ? 'Remote' : ''), description: htmlToText(String(j.description)) + extra, source: 'structured data' };
  }

  // 2) Known job sites
  const SITES = [
    { host: /linkedin\.com$/, name: 'LinkedIn',
      desc: ['#job-details', '.jobs-description__content', '.jobs-description-content__text', '.jobs-box__html-content', '.jobs-description', '.show-more-less-html__markup', '.description__text', '[data-testid="expandable-text-box"]'],
      title: ['.job-details-jobs-unified-top-card__job-title h1', '.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', '.t-24.job-details-jobs-unified-top-card__job-title', '.top-card-layout__title', '.jobs-details-top-card__job-title', 'h1'],
      company: ['.job-details-jobs-unified-top-card__company-name a', '.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name', '.topcard__org-name-link', '.jobs-details-top-card__company-url'],
      location: ['.job-details-jobs-unified-top-card__primary-description-container .tvm__text', '.job-details-jobs-unified-top-card__bullet', '.topcard__flavor--bullet'] },
    { host: /indeed\./, name: 'Indeed', desc: ['#jobDescriptionText', '.jobsearch-JobComponent-description'], title: ['[data-testid="jobsearch-JobInfoHeader-title"]', '.jobsearch-JobInfoHeader-title', 'h1'], company: ['[data-testid="inlineHeader-companyName"]', '[data-company-name]'] },
    { host: /greenhouse\.io/, name: 'Greenhouse', desc: ['.job__description', '#content', '#app_body .content', '.job-post'], title: ['.job__title h1', '.app-title', 'h1'], company: ['.company-name', '.job__header .company'] },
    { host: /lever\.co/, name: 'Lever', desc: ['.posting-page [data-qa="job-description"]', '.posting-page .content', '.section-wrapper.page-full-width'], title: ['.posting-headline h2', 'h2'], company: [] },
    { host: /myworkdayjobs|workday/, name: 'Workday', desc: ['[data-automation-id="jobPostingDescription"]'], title: ['[data-automation-id="jobPostingHeader"]', 'h2', 'h1'], company: [] },
    { host: /naukri\.com/, name: 'Naukri', desc: ['[class*="JDC__dang-inner-html"]', '[class*="job-desc"]', '.dang-inner-html', 'section.job-desc'], title: ['[class*="jd-header-title"]', 'h1'], company: ['[class*="jd-header-comp-name"] a', '[class*="jd-header-comp-name"]'] },
    { host: /glassdoor\./, name: 'Glassdoor', desc: ['[class*="JobDetails_jobDescription"]', '#JobDescriptionContainer', '.jobDescriptionContent'], title: ['[data-test="job-title"]', 'h1'], company: ['[data-test="employer-name"]', '[class*="EmployerProfile_employerName"]'] },
    { host: /ashbyhq\.com/, name: 'Ashby', desc: ['[class*="_descriptionText"]', '.ashby-job-posting-right-pane'], title: ['h1'], company: [] },
    { host: /smartrecruiters\.com/, name: 'SmartRecruiters', desc: ['.job-sections', '[itemprop="description"]'], title: ['h1.job-title', 'h1'], company: [] },
    { host: /wellfound\.com|angel\.co/, name: 'Wellfound', desc: ['[data-test="JobDescription"]', '[class*="description"]'], title: ['h1'], company: [] },
    { host: /dice\.com/, name: 'Dice', desc: ['[data-testid="jobDescriptionHtml"]', '#jobdescSec'], title: ['h1'], company: ['[data-cy="companyNameLink"]'] },
    { host: /instahyre|hirist|cutshort|iimjobs|foundit|monster/, name: 'job board', desc: ['[class*="job-description"]', '[class*="jobDescription"]', '[class*="description"]'], title: ['h1'], company: [] },
    { host: /amazon\.jobs/, name: 'Amazon Jobs', desc: ['#job-detail-body', '.section'], title: ['h1.title', 'h1'], company: [] },
    { host: /workable\.com/, name: 'Workable', desc: ['[data-ui="job-description"]', '[data-ui="job-breakdown"]', 'section[class*="description"]'], title: ['[data-ui="job-title"]', 'h1'], company: [] },
    { host: /bamboohr\.com/, name: 'BambooHR', desc: ['.BambooHR-ATS-Description', '[class*="jss-description"]', '.ResAts__page'], title: ['h2', 'h1'], company: [] },
    { host: /recruitee\.com/, name: 'Recruitee', desc: ['[data-testid="job-description"]', '.job-description', 'section[class*="description"]'], title: ['h1'], company: [] },
    { host: /teamtailor\.com/, name: 'Teamtailor', desc: ['.job-ad-body', '[class*="prose"]', 'main'], title: ['h1'], company: [] },
    { host: /jobs\.personio\./, name: 'Personio', desc: ['[class*="job-description"]', '.description', 'main'], title: ['h1'], company: [] },
    { host: /jobvite\.com/, name: 'Jobvite', desc: ['.jv-job-detail-description', '.jv-wrapper'], title: ['.jv-header', 'h2', 'h1'], company: [] },
    { host: /icims\.com/, name: 'iCIMS', desc: ['.iCIMS_JobContent', '.iCIMS_InfoMsg_Job', '.iCIMS_Expandable_Container'], title: ['.iCIMS_Header', 'h1'], company: [] },
    { host: /taleo\.net/, name: 'Taleo', desc: ['[id*="requisitionDescription"]', '.requisitionDescriptionInterface', '.contentlinepanel'], title: ['[id*="reqTitle"]', 'h1'], company: [] },
    { host: /successfactors|jobs\.sap\.com/, name: 'SuccessFactors', desc: ['.jobdescription', '[data-careersite-propertyid="description"]', '.job'], title: ['[data-careersite-propertyid="title"]', 'h1'], company: [] },
    { host: /zohorecruit|zoho\.com/, name: 'Zoho Recruit', desc: ['#spandesc', '.job-description', '[class*="jobdesc"]'], title: ['h1'], company: [] },
    { host: /internshala\.com/, name: 'Internshala', desc: ['.internship_details', '.text-container', '.about_company_text_container'], title: ['.heading_4_5.profile', '.profile', 'h1'], company: ['.company_name a', '.company_name'] },
    { host: /shine\.com|apna\.co|hirect\.in/, name: 'job board', desc: ['[class*="jobDescription"]', '[class*="job-description"]', '[class*="JobDescription"]'], title: ['h1'], company: [] },
    { host: /workatastartup\.com|ycombinator\.com/, name: 'YC', desc: ['.prose', '[class*="description"]'], title: ['h1'], company: [] },
    { host: /welcometothejungle|otta\.com/, name: 'Welcome to the Jungle', desc: ['[data-testid="job-section-description"]', '[class*="description"]'], title: ['h1', 'h2'], company: [] },
  ];

  // 2b) Generic: elements named like a job description on any careers site.
  const GENERIC = '[class*="job-description" i],[class*="jobdescription" i],[class*="job_description" i],[id*="job-description" i],[id*="jobdescription" i],[id*="job_description" i],[class*="description__text" i],[class*="posting-description" i],[data-testid*="description" i],[data-automation-id*="description" i],[data-qa*="description" i],[itemprop="description"]';
  function fromGeneric() {
    let best = null, bestLen = 0;
    for (const el of document.querySelectorAll(GENERIC)) {
      const t = el.textContent || '', len = t.length;
      if (len < 150 || len > 30000 || signalCount(t) < 1) continue;
      if (len > bestLen) { best = el; bestLen = len; }
    }
    if (!best) return null;
    return { title: nearestTitle(best), company: '', description: nodeToText(best), source: 'job description block' };
  }
  function fromSite() {
    const s = SITES.find(x => x.host.test(location.hostname));
    if (!s) return null;
    const el = q(s.desc);
    if (!el) return null;
    const d = nodeToText(el);
    if (d.length < 150) return null;
    let title = txt(s.title), company = txt(s.company);
    if (s.name === 'LinkedIn') {
      // "(3) Senior Engineer | Acme | LinkedIn" — reliable even when class names change.
      const parts = document.title.replace(/^\(\d+\)\s*/, '').split(' | ');
      if (parts.length >= 3 && parts[parts.length - 1] === 'LinkedIn') { title ||= parts[0]; company ||= parts[1]; }
      if (/^(about the job|jobs?|linkedin)$/i.test(title)) title = '';
    }
    return { title, company, location: s.location ? txt(s.location) : '', description: d, source: s.name };
  }

  // 3) Anchor heading: "About the job", "Job description", ... -> its section. Survives class-name churn.
  const ANCHOR = /^(about (?:the|this) (?:job|role|position|opportunity)|job description|description|the role|role description|job details|position (?:summary|overview|description)|job summary|role overview)\s*:?$/i;
  function fromAnchor() {
    for (const h of document.querySelectorAll('h1,h2,h3,h4,strong,b,[role="heading"]')) {
      if (!ANCHOR.test(clean(h.textContent))) continue;
      let el = h.parentElement;
      for (let i = 0; i < 8 && el && el !== document.body; i++, el = el.parentElement) {
        const len = el.textContent.length;
        if (len > 25000) break;
        if (len >= 250 && signalCount(el.textContent) >= 2) {
          return { title: nearestTitle(el), company: '', description: nodeToText(el), source: 'page section' };
        }
      }
    }
    return null;
  }
  function nearestTitle(el) {
    for (let a = el, i = 0; a && i < 8; a = a.parentElement, i++) {
      const h = [...a.querySelectorAll('h1,h2')].find(x => { const t = clean(x.textContent); return t.length > 3 && t.length < 120 && !ANCHOR.test(t); });
      if (h) return clean(h.textContent);
    }
    return txt('h1') || document.title;
  }

  // 4) Heuristic: densest JD-looking block (textContent only — no layout cost).
  function fromHeuristic() {
    let best = null, bestScore = 0;
    for (const el of document.querySelectorAll('main, article, section, div, [role="main"]')) {
      const t = el.textContent || '';
      const len = t.length;
      if (len < 300 || len > 30000) continue;
      const sig = signalCount(t);
      if (sig < 3) continue;
      const linkText = [...el.getElementsByTagName('a')].reduce((a, x) => a + x.textContent.length, 0);
      const lis = el.getElementsByTagName('li').length;
      const score = sig * 60 + Math.min(lis, 40) * 6 + Math.min(len, 9000) / 40 - (linkText / len) * 900 - Math.max(0, len - 12000) / 30;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    if (!best) return null;
    return { title: txt('h1') || document.title, company: '', description: nodeToText(best), source: 'page heuristic', weak: signalCount(best.textContent) < 4 };
  }

  // Heuristic sources (block/heading/density) must also look like a job page — avoids portfolios, blogs, resumes.
  const STRONG = new Set(['structured data', 'your selection']);
  function jobContext() {
    if (/apply|career|jobs?\b|job[-_/]|position|opening|vacanc|requisition|recruit|hiring|posting/i.test(location.pathname + location.search + ' ' + location.hostname)) return true;
    if (/\b(jobs?|careers?|hiring|vacanc(y|ies)|opening|position)\b/i.test(document.title)) return true;
    for (const el of document.querySelectorAll('a, button, [role=button], input[type=submit]')) {
      const t = (el.textContent || el.value || '').replace(/\s+/g, ' ').trim();
      if (t.length < 40 && /^(easy )?apply( now| for (this|the) (job|role|position))?$|^submit (your )?application$|^i'?m interested$/i.test(t)) return true;
    }
    return false;
  }

  return function extract() {
    if (!document.body) return { ok: false };
    const sel = (window.getSelection?.().toString() || '').trim();
    let job = null;
    if (sel.length > 200) job = { title: txt('h1') || document.title, company: '', description: sel, source: 'your selection' };
    if (!job) job = fromJsonLd();
    const site = fromSite();
    if (site) {
      if (!job || site.description.length > job.description.length * 1.25) job = { ...site, title: site.title || job?.title, company: site.company || job?.company, location: site.location || job?.location };
      else { job.title ||= site.title; job.company ||= site.company; }
    }
    if (!job) {
      // Cheap gate before the DOM-wide scans, so normal pages cost ~nothing.
      const sample = document.body.textContent.slice(0, 200000);
      if (signalCount(sample) < 2) return { ok: false, url: location.href, pageTitle: document.title };
      job = fromGeneric() || fromAnchor() || fromHeuristic();
    }
    if (!job || job.description.length < 150) return { ok: false, url: location.href, pageTitle: document.title };
    if (/(^|\.)linkedin\.com$/.test(location.hostname)) {
      const parts = document.title.replace(/^\(\d+\)\s*/, '').split(' | ');
      if (parts.length >= 3 && parts[parts.length - 1] === 'LinkedIn') {
        if (!job.title || /^(about the job|linkedin)$/i.test(job.title)) job.title = parts[0];
        job.company ||= parts[1];
      }
    }
    const company =job.company || document.querySelector('meta[property="og:site_name"]')?.content || '';
    return {
      ok: true, url: location.href, pageTitle: document.title,
      title: clean(job.title || document.title).slice(0, 160),
      company: clean(company).slice(0, 100),
      location: clean(job.location).slice(0, 120),
      description: job.description.slice(0, 30000),
      source: job.source,
      confident: !job.weak && (STRONG.has(job.source) || SITES.some(x => x.name === job.source) || jobContext()),
    };
  };
})();
__shortlistExtract();
