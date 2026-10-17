/**
 * Guesses what an icon-only control does from the evidence developers leave behind:
 * symbol characters, icon class names (fa-search, icon-close, bi-list), SVG <use> ids,
 * data-icon attributes and the control's own id/name.
 */

const SYMBOLS: Record<string, string> = {
  '×': 'Close', '✕': 'Close', '✖': 'Close', '╳': 'Close', x: 'Close', X: 'Close',
  '☰': 'Menu', '≡': 'Menu', '⋮': 'More options', '⋯': 'More options', '…': 'More options', '...': 'More options',
  '›': 'Next', '»': 'Next', '>': 'Next', '→': 'Next', '❯': 'Next', '▶': 'Play',
  '‹': 'Previous', '«': 'Previous', '<': 'Previous', '←': 'Previous', '❮': 'Previous',
  '🔍': 'Search', '🔎': 'Search', '♥': 'Favorite', '❤': 'Favorite', '♡': 'Favorite', '⚙': 'Settings', '🛒': 'Cart',
  '+': 'Add', '−': 'Remove', '-': 'Remove', '✓': 'Confirm', '✔': 'Confirm',
};

/** Icon-name tokens → spoken names. Checked in order, so specific words come first. */
const WORDS: [RegExp, string][] = [
  [/^(search|magnif\w*|loupe|find)$/, 'Search'],
  [/^(close|times|xmark|cross|dismiss|cancel|clear)$/, 'Close'],
  [/^(menu|hamburger|burger|bars|navicon|toggler|drawer)$/, 'Menu'],
  [/^(cart|basket|bag|trolley)$/, 'Cart'],
  [/^(user|account|profile|person|avatar|login|signin)$/, 'Account'],
  [/^(heart|favou?rites?|like|wishlist)$/, 'Favorite'],
  [/^(share|sharing)$/, 'Share'],
  [/^(play)$/, 'Play'],
  [/^(pause)$/, 'Pause'],
  [/^(mute|volume|sound|speaker)$/, 'Mute'],
  [/^(next|forward|fwd)$/, 'Next'],
  [/^(prev|previous|back|backward)$/, 'Previous'],
  [/^(plus|add|create)$/, 'Add'],
  [/^(minus|remove|subtract)$/, 'Remove'],
  [/^(trash|delete|bin|garbage)$/, 'Delete'],
  [/^(edit|pencil|pen|compose)$/, 'Edit'],
  [/^(settings|gear|cog|preferences|config)$/, 'Settings'],
  [/^(bell|notifications?|alerts?)$/, 'Notifications'],
  [/^(download)$/, 'Download'],
  [/^(upload)$/, 'Upload'],
  [/^(filters?|funnel)$/, 'Filter'],
  [/^(sort)$/, 'Sort'],
  [/^(home|house)$/, 'Home'],
  [/^(more|ellipsis|dots|kebab|meatballs|overflow)$/, 'More options'],
  [/^(info|information)$/, 'Information'],
  [/^(help|question)$/, 'Help'],
  [/^(mail|envelope|email|newsletter)$/, 'Email'],
  [/^(print|printer)$/, 'Print'],
  [/^(copy|clipboard|duplicate)$/, 'Copy'],
  [/^(refresh|reload|sync|redo)$/, 'Refresh'],
  [/^(mic|microphone|voice)$/, 'Voice search'],
  [/^(expand|maximi[sz]e|fullscreen)$/, 'Expand'],
  [/^(collapse|minimi[sz]e)$/, 'Collapse'],
  [/^(calendar|date)$/, 'Calendar'],
  [/^(location|map|marker|pin)$/, 'Location'],
  [/^(phone|call)$/, 'Call'],
  [/^(chat|message|comment)s?$/, 'Chat'],
  [/^(globe|language|translate)$/, 'Language'],
  [/^(moon|sun|theme|darkmode)$/, 'Toggle theme'],
  [/^(twitter)$/, 'Twitter'],
  [/^(facebook|fb)$/, 'Facebook'],
  [/^(instagram|insta)$/, 'Instagram'],
  [/^(linkedin)$/, 'LinkedIn'],
  [/^(youtube)$/, 'YouTube'],
  [/^(github)$/, 'GitHub'],
  [/^(tiktok)$/, 'TikTok'],
  [/^(rss|feed)$/, 'RSS feed'],
];

const DIRECTION_WORDS = /^(arrow|chevron|caret|angle|triangle|carousel|slider|slide)$/;

/** Splits "fa-solid fa-magnifying-glass iconSearch" into lowercase words. */
export function tokens(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function fromTokens(ts: string[]): string | null {
  if (ts.some((t) => DIRECTION_WORDS.test(t)) || ts.includes('next') || ts.includes('prev')) {
    if (ts.includes('right') || ts.includes('next') || ts.includes('forward')) return 'Next';
    if (ts.includes('left') || ts.includes('prev') || ts.includes('previous') || ts.includes('back')) return 'Previous';
  }
  for (const t of ts) for (const [re, name] of WORDS) if (re.test(t)) return name;
  return null;
}

function evidence(el: Element): string {
  const parts = [el.getAttribute('class'), el.id, el.getAttribute('name'), el.getAttribute('data-icon'), el.getAttribute('data-testid'), el.getAttribute('aria-controls')];
  const use = el.querySelector('use');
  if (use) parts.push(use.getAttribute('href') ?? use.getAttribute('xlink:href'));
  for (const child of el.querySelectorAll('i, span, svg, img, use')) {
    parts.push(child.getAttribute('class'), child.getAttribute('data-icon'), child.id);
    const src = child.getAttribute('src');
    if (src) parts.push(src.split('/').pop()?.replace(/\.\w+$/, '') ?? '');
  }
  return parts.filter(Boolean).join(' ');
}

/** The visible symbol alone ("×", "☰") or what the class names say, else null. */
export function iconName(el: Element, visibleText: string): string | null {
  const symbol = SYMBOLS[visibleText.trim()];
  if (symbol) return symbol;
  return fromTokens(tokens(evidence(el)));
}

/** Visible text that is only a symbol, which screen readers read literally ("times", "greater than"). */
export function isSymbolOnly(text: string): boolean {
  return text.trim() in SYMBOLS;
}
