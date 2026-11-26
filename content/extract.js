// Injected on demand into the active tab. Reads the job posting from the DOM (no screenshots, no AI).
// The value of the last expression is returned to chrome.scripting.executeScript.
(() => {
  const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'TR', 'TABLE', 'HEADER', 'FOOTER', 'BLOCKQUOTE', 'PRE', 'DD', 'DT', 'DL']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'BUTTON', 'IFRAME', 'TEMPLATE', 'INPUT', 'SELECT', 'TEXTAREA', 'NAV', 'FORM']);

  // DOM -> text that keeps headings, paragraphs and bullets (works even for collapsed "show more" content).
  function nodeToText(root) {
    let out = '';
    const nl = () => { if (out && !out.endsWith('\n')) out += '\n'; };
    const walk = n => {
      if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, ' '); return; }
      if (n.nodeType !== 1 || SKIP.has(n.tagName)) return;
      if (n.getAttribute('aria-hidden') === 'true' && !n.textContent.trim()) return;
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
  const txt = sel => (q(sel)?.textContent || '').replace(/\s+/g, ' ').trim();

  // 1) Structured data (schema.org JobPosting) — used by most job boards for Google Jobs.
  function fromJsonLd() {
    const nodes = [];
    const visit = o => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(visit);
      const t = o['@type'];
      if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) nodes.push(o);
      if (o['@graph']) visit(o['@graph']);
    };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { visit(JSON.parse(s.textContent)); } catch {}
    }
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
    return {
      title: htmlToText(j.title || ''), company: typeof org === 'string' ? org : org?.name || '',
      location: loc || (j.jobLocationType === 'TELECOMMUTE' ? 'Remote' : ''),
      description: htmlToText(String(j.description)) + extra, source: 'structured data',
    };
  }

  // 2) Known job sites.
  const SITES = [
    { host: /linkedin\.com/, desc: ['.jobs-description__content', '.jobs-description-content__text', '#job-details', '.jobs-box__html-content', '.show-more-less-html__markup', '.description__text'],
      title: ['.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', '.top-card-layout__title', 'h1'], company: ['.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name', '.topcard__org-name-link'] },
    { host: /indeed\./, desc: ['#jobDescriptionText', '.jobsearch-JobComponent-description'], title: ['[data-testid="jobsearch-JobInfoHeader-title"]', '.jobsearch-JobInfoHeader-title', 'h1'], company: ['[data-testid="inlineHeader-companyName"]', '[data-company-name]'] },
    { host: /greenhouse\.io/, desc: ['.job__description', '#content', '#app_body .content', '.job-post'], title: ['.job__title h1', '.app-title', 'h1'], company: ['.company-name', '.job__header .company'] },
    { host: /lever\.co/, desc: ['.posting-page [data-qa="job-description"]', '.posting-page .content', '.section-wrapper.page-full-width'], title: ['.posting-headline h2', 'h2'], company: ['.main-header-logo img[alt]'] },
    { host: /myworkdayjobs|workday/, desc: ['[data-automation-id="jobPostingDescription"]'], title: ['[data-automation-id="jobPostingHeader"]', 'h2', 'h1'], company: [] },
    { host: /naukri\.com/, desc: ['[class*="JDC__dang-inner-html"]', '[class*="job-desc"]', '.dang-inner-html', 'section.job-desc'], title: ['[class*="jd-header-title"]', 'h1'], company: ['[class*="jd-header-comp-name"] a', '[class*="jd-header-comp-name"]'] },
    { host: /glassdoor\./, desc: ['[class*="JobDetails_jobDescription"]', '#JobDescriptionContainer', '.jobDescriptionContent'], title: ['[data-test="job-title"]', 'h1'], company: ['[data-test="employer-name"]', '[class*="EmployerProfile_employerName"]'] },
    { host: /ashbyhq\.com/, desc: ['[class*="_descriptionText"]', '.ashby-job-posting-right-pane'], title: ['h1'], company: [] },
    { host: /smartrecruiters\.com/, desc: ['.job-sections', '[itemprop="description"]'], title: ['h1.job-title', 'h1'], company: [] },
    { host: /wellfound\.com|angel\.co/, desc: ['[class*="description"]', '[data-test="JobDescription"]'], title: ['h1'], company: [] },
    { host: /monster\.|foundit\./, desc: ['[class*="description"]', '#JobDescription'], title: ['h1'], company: [] },
    { host: /dice\.com/, desc: ['[data-testid="jobDescriptionHtml"]', '#jobdescSec'], title: ['h1'], company: ['[data-cy="companyNameLink"]'] },
    { host: /instahyre|hirist|cutshort|iimjobs/, desc: ['[class*="job-description"]', '[class*="jobDescription"]', '.description'], title: ['h1'], company: [] },
    { host: /careers\.google\.com|google\.com\/about\/careers/, desc: ['[class*="qualifications"]', 'main'], title: ['h2', 'h1'], company: [] },
    { host: /amazon\.jobs/, desc: ['#job-detail-body', '.section'], title: ['h1.title', 'h1'], company: [] },
  ];
  function fromSite() {
    const s = SITES.find(x => x.host.test(location.hostname));
    if (!s) return null;
    const el = q(s.desc);
    if (!el) return null;
    const d = nodeToText(el);
    if (d.length < 150) return null;
    return { title: txt(s.title), company: txt(s.company) || q(s.company)?.getAttribute?.('alt') || '', description: d, source: location.hostname.replace(/^www\./, '') };
  }

  // 3) Heuristic: find the DOM block that looks most like a job description.
  const JD_WORDS = /(responsibilit|requirement|qualification|experience|you will|you'll|what we|about the role|skills|must have|nice to have|preferred|years|benefits|apply)/gi;
  function fromHeuristic() {
    let best = null, bestScore = 0;
    for (const el of document.querySelectorAll('main, article, section, div, [role="main"]')) {
      const t = el.innerText || '';
      const len = t.length;
      if (len < 400 || len > 40000) continue;
      const hits = (t.match(JD_WORDS) || []).length;
      if (hits < 3) continue;
      const linkText = [...el.querySelectorAll('a')].reduce((a, x) => a + (x.innerText || '').length, 0);
      const linkDensity = linkText / len;
      const lis = el.querySelectorAll('li').length;
      const score = hits * 40 + Math.min(lis, 40) * 8 + Math.min(len, 9000) / 30 - linkDensity * 900 - Math.max(0, len - 12000) / 40;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    if (!best) return null;
    return { title: txt(['h1']) || document.title, company: '', description: nodeToText(best), source: 'page heuristic' };
  }

  const sel = (window.getSelection?.().toString() || '').trim();
  let job = null;
  if (sel.length > 200) job = { title: txt(['h1']) || document.title, company: '', description: sel, source: 'your text selection' };
  if (!job) job = fromJsonLd();
  const site = fromSite();
  if (site) {
    if (!job || site.description.length > job.description.length * 1.25) job = { ...site, title: site.title || job?.title, company: site.company || job?.company, location: job?.location };
    else { job.title ||= site.title; job.company ||= site.company; }
  }
  if (!job) job = fromHeuristic();
  if (!job) return { ok: false, url: location.href, pageTitle: document.title };

  const company = job.company || document.querySelector('meta[property="og:site_name"]')?.content || '';
  return {
    ok: true, url: location.href, pageTitle: document.title,
    title: (job.title || document.title).replace(/\s+/g, ' ').trim().slice(0, 160),
    company: company.replace(/\s+/g, ' ').trim().slice(0, 100),
    location: (job.location || '').slice(0, 120),
    description: job.description.slice(0, 30000),
    source: job.source,
    confident: job.source !== 'page heuristic',
  };
})();
