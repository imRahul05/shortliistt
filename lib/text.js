// Small text helpers shared by matcher, parser and UI.

export function normalizeText(t = '') {
  return String(t)
    .replace(/\r\n?/g, '\n')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, m => (m === '—' ? ' — ' : '-'))
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const BULLET_RE = /^\s*(?:[•●▪◦○■□▸►▶➢➤✓✔✦★\-*–·]|||o(?=\s))\s*/;

export const STOPWORDS = new Set(`a about above across after again against all almost also am among an and any are aren't as at be because been before being below between both but by can can't cannot could did do does doing don't down during each either else etc even ever every few for from further get gets getting give given go going had has have having he her here hers him his how however i if in into is isn't it it's its itself just least less let like likely made make makes making many may me might more most much must my need needs neither no nor not now of off often on once one only or other others our ours out over own per perhaps please rather really said same shall she should since so some such than that the their theirs them then there these they this those though through thus to too toward towards under until up upon us use used uses using very via was way we well were what whatever when where whether which while who whom whose why will with within without would yet you your yours yourself yourselves
ability able across actively additional along already always amazing another anyone apply applicants applicant around based benefits best better big bring build building built business candidate candidates career careers change closely come company competitive complex consider core create creating culture currently day days deliver delivering description desired develop developing development different do drive driving dynamic eager employees employer employment enjoy ensure environment equal equivalent excellent exciting existing expect expected experience experienced experiences extensive familiar familiarity fast field first focus focused following found full fun future gender global goal goals good great grow growing growth hands help helping high highly hire hiring hours ideal identity impact include includes including individuals information interest interested job join key knowledge large lead leading learn learning level life looking love make manage management meet minimum mission modern month months multiple national new next offer offers office open opportunities opportunity origin part people place plus position positions preferred previous product products professional proven provide quality range related relevant remote required requirement requirements responsibilities responsible role roles salary see seeking self senior set skill skills small solutions solve someone status strong success successful support take team teams technical technologies technology things time today together tools top type understanding unique us value values want ways week who wide work working world year years`.split(/\s+/));

export function tokenize(text) {
  return (text.toLowerCase().match(/[a-z][a-z0-9+#.\-]{1,}/g) || [])
    .map(w => w.replace(/[.\-]+$/, ''))
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

export function stem(w) {
  return w
    .replace(/(ies)$/, 'y')
    .replace(/(ing|ed|es|s)$/, '')
    .replace(/(ment|ness|ity)$/, '');
}

export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
