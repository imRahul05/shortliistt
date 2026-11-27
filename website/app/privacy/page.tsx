import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — Shortlist',
  description: 'How the Shortlist Chrome extension handles your resume, profile and job data. Everything stays in your browser.',
};

const REPO = 'https://github.com/imRahul05/shortliistt';
const UPDATED = 'November 28, 2026';

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="mt-12 scroll-mt-24 text-xl font-semibold tracking-tight text-fg">{children}</h2>;
}

const toc: [string, string][] = [
  ['summary', 'Summary'],
  ['access', 'Information Shortlist accesses'],
  ['storage', 'Where your information is stored'],
  ['ai', 'On-device AI (Gemini Nano)'],
  ['servers', 'No Shortlist servers'],
  ['sharing', 'When information leaves your browser'],
  ['permissions', 'Why Shortlist needs its permissions'],
  ['delete', 'Deleting your information'],
  ['website', 'This website'],
  ['commitments', 'Our commitments'],
  ['changes', 'Changes and contact'],
];

export default function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-[15px] leading-7 text-fg/85">
      <a href="/" className="font-mono text-xs text-dim hover:text-fg">← Shortlist</a>
      <h1 className="mt-6 text-4xl font-semibold tracking-tight text-fg">Privacy Policy</h1>
      <p className="mt-2 font-mono text-xs text-dim">Last updated {UPDATED}</p>

      <nav className="mt-8 rounded-xl border border-line bg-ink-2 p-5 text-sm">
        <div className="mb-2 font-mono text-xs tracking-widest text-dim uppercase">Contents</div>
        <ol className="grid gap-1 sm:grid-cols-2">
          {toc.map(([id, t], i) => <li key={id}><a href={`#${id}`} className="text-fg/80 hover:text-fg">{i + 1}. {t}</a></li>)}
        </ol>
      </nav>

      <H id="summary">1. Summary</H>
      <p className="mt-3">Shortlist is a Chrome extension that compares your resume with job postings, helps you tailor your resume and fills in job applications. <b className="text-fg">It runs entirely in your browser.</b> Shortlist has no accounts, no API keys and no servers that receive your data. Your resume, profile and history are stored locally on your device. Nothing is sold, shared or used for advertising.</p>

      <H id="access">2. Information Shortlist accesses</H>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li><b className="text-fg">Your resume file</b> (PDF, DOCX or TXT) when you upload it, and the text, formatting and links extracted from it.</li>
        <li><b className="text-fg">Profile details</b> you enter or that are pre-filled from your resume: name, email, phone, location, links (LinkedIn, GitHub, portfolio), target title, current company, years of experience, notice period, salary expectations and skills.</li>
        <li><b className="text-fg">Content of the web pages you visit</b>, read locally to detect job postings (title, company, description) and application forms. Pages that are not job postings or application forms are not analysed further.</li>
        <li><b className="text-fg">Job history</b>: the jobs you open (title, company, URL, match score, date).</li>
        <li><b className="text-fg">Application tracker</b>: jobs you mark as applied (or that Shortlist detects from a site’s “thank you for applying” screen), their status, dates and match score, used for follow-up reminders.</li>
        <li><b className="text-fg">Profile photo</b>, only if you upload one, used to fill photo fields on application forms.</li>
        <li><b className="text-fg">Documents you create</b>: tailored resumes and cover letters.</li>
        <li><b className="text-fg">Imported profile data</b>, only if you choose to import it: from <b className="text-fg">GitHub</b> (your public profile and public repositories: languages, topics, descriptions, stars) and from a <b className="text-fg">LinkedIn data export</b> you upload (positions, education, skills, certifications, and basic profile and contact details).</li>
        <li><b className="text-fg">Site logins created by Shortlist</b>: if you use Autofill on a job site’s create-account form, Shortlist generates a password and saves the email and password for that site so it can fill them when you sign in later.</li>
      </ul>
      <p className="mt-3">Shortlist does not collect browsing history beyond the job pages listed above, analytics, device identifiers, location or payment information.</p>

      <H id="storage">3. Where your information is stored</H>
      <p className="mt-3">Everything listed above is stored in <code className="rounded bg-ink-2 px-1.5 py-0.5 font-mono text-[13px] text-fg">chrome.storage.local</code>, inside your Chrome profile on your device. It is not synced to other devices by Shortlist and is not uploaded anywhere. Like other data in your browser profile, it is not encrypted by Shortlist, so keep your computer and Chrome profile secure. A few interface preferences (for example which panels are collapsed) are kept in the extension’s own local storage.</p>

      <H id="ai">4. On-device AI (Gemini Nano)</H>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li>AI features (insights, job summaries, rewrites, proofreading, cover letters, answers, resume parsing) are optional. They use <b className="text-fg">Chrome’s built-in AI (Gemini Nano) through the Prompt, Summarizer and Proofreader APIs</b>.</li>
        <li>The resume and job text sent to the model are <b className="text-fg">processed locally on your device</b>. Shortlist does not send them to Google, Anthropic, OpenAI or any other AI service.</li>
        <li><b className="text-fg">Chrome downloads the built-in model separately</b>, from Google, the first time AI is enabled. That download is handled by Chrome under Google’s terms and policies, not by Shortlist.</li>
        <li>You can turn AI off in Profile → Settings. Matching, scoring, tailoring and autofill all work without it.</li>
      </ul>

      <H id="servers">5. No Shortlist servers</H>
      <p className="mt-3">Shortlist does not operate any server that receives, stores or processes your resume, profile, job history or documents. The extension sends no telemetry, analytics or crash reports and loads no remote code. Its only network request of its own is optional: when you click <b className="text-fg">Import from GitHub</b>, it requests your <b className="text-fg">public</b> profile and repositories from <code className="font-mono text-[13px]">api.github.com</code> using the username you enter, with no sign-in or token. That request goes to GitHub under GitHub’s privacy statement; nothing else is sent. A LinkedIn data export is read entirely on your device. All of its code is bundled in the extension and is <a href={REPO} className="text-fg underline underline-offset-2">publicly available</a> for anyone to inspect.</p>

      <H id="sharing">6. When information leaves your browser</H>
      <p className="mt-3">Information only leaves your device through actions you take:</p>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li><b className="text-fg">Applying for jobs.</b> Autofill places your details, and can attach your resume file, into the form on the job website you are viewing. When you choose to submit that form (or click a page button such as “Create Account” or “Submit” from Shortlist), that information is <b className="text-fg">sent to that website and its hiring platform</b> (for example Workday, Greenhouse or LinkedIn) under their privacy policies. Always review a form before submitting it. Shortlist never ticks terms-and-conditions boxes for you.</li>
        <li><b className="text-fg">Files you export.</b> PDF, DOCX and TXT files you download are saved to your computer. What you do with them is up to you.</li>
        <li><b className="text-fg">Copying text.</b> Copy buttons place text on your clipboard.</li>
      </ul>

      <H id="permissions">7. Why Shortlist needs its permissions</H>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li><b className="text-fg">Read and change data on websites you visit</b> (<code className="font-mono text-[13px]">&lt;all_urls&gt;</code>, scripting): needed to detect job postings on any job site or careers page, show the floating score card, and fill application forms. Page content is processed locally and is never transmitted by Shortlist.</li>
        <li><b className="text-fg">Storage / unlimited storage</b>: keep your resume file, profile and drafts on your device.</li>
        <li><b className="text-fg">Side panel, tabs</b>: show the Shortlist panel and know which tab’s job to analyse.</li>
        <li><b className="text-fg">Alarms and notifications</b>: check your tracker every few hours and show a local Chrome notification when an application has had no reply for a week. Nothing is sent anywhere.</li>
      </ul>

      <H id="delete">8. Deleting your information</H>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li><b className="text-fg">Everything at once:</b> open Shortlist → <b className="text-fg">Profile → Privacy → Delete all my data</b>. This removes your resume, profile, photo, history, tracked applications, tailored resumes, cover letters and saved site logins.</li>
        <li><b className="text-fg">Backups you export</b> (Profile → Privacy → Export data) are files on your computer and include everything above, including saved logins; keep them private and delete them when no longer needed.</li>
        <li><b className="text-fg">A single saved login:</b> Apply → Saved login → <b className="text-fg">Forget</b>.</li>
        <li><b className="text-fg">Individual items:</b> replace your resume, edit or clear profile fields, remove skills, or remove imported work history, education, projects and certifications in Profile → Structured profile.</li>
        <li><b className="text-fg">Uninstalling</b> Shortlist from <code className="font-mono text-[13px]">chrome://extensions</code> removes all of its locally stored data.</li>
        <li>Information already submitted to a job website is held by that website. Contact them to delete it.</li>
      </ul>

      <H id="website">9. This website</H>
      <p className="mt-3">shortliistt.vercel.app is a static page hosted on Vercel. It uses no cookies, analytics or tracking scripts. Like any host, Vercel may keep standard server logs (such as IP address and user agent) to operate and secure the service; see Vercel’s privacy policy. The download buttons link to the extension’s releases on GitHub, which is subject to GitHub’s privacy statement. The version number shown on the page is fetched by the server from GitHub, not by your browser.</p>

      <H id="commitments">10. Our commitments</H>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li>We do not sell, rent or share your information with anyone.</li>
        <li>We do not use your information for advertising, profiling or creditworthiness, or for any purpose unrelated to Shortlist’s features.</li>
        <li>Use of information received through Chrome APIs follows the <a href="https://developer.chrome.com/docs/webstore/program-policies/limited-use" className="text-fg underline underline-offset-2">Chrome Web Store User Data Policy</a>, including its Limited Use requirements.</li>
        <li>Shortlist is not directed at children under 13.</li>
      </ul>

      <H id="changes">11. Changes and contact</H>
      <p className="mt-3">If Shortlist starts handling data differently, this page will be updated before the change ships, and the date above will change. Questions or concerns: open an issue at <a href={`${REPO}/issues`} className="text-fg underline underline-offset-2">github.com/imRahul05/shortliistt/issues</a>.</p>

      <div className="mt-16 border-t border-line pt-6 font-mono text-xs text-dim"><a href="/" className="hover:text-fg">← Back to Shortlist</a></div>
    </main>
  );
}
