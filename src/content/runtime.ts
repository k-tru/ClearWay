import type { FeatureStats } from '../shared/messages';
import type { FeatureId, Settings } from '../shared/settings';
import { setMutationSuppressor } from './registry';

export interface Feature {
  id: FeatureId;
  /** Scan the whole document and start fixing. */
  start(settings: Settings): void;
  /** Undo every change and stop. */
  stop(): void;
  /** The page changed under these roots. */
  rescan(roots: Element[]): void;
  stats(): FeatureStats;
}

type Listener = (roots: Element[]) => void;
const listeners = new Set<Listener>();
let pending = new Set<Element>();
let timer: number | undefined;

function collect(records: MutationRecord[]) {
  const add = (n: Node | null) => {
    const el = n && (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement);
    if (el) pending.add(el);
  };
  for (const r of records) {
    // For insertions only the new nodes need a look, not the whole parent.
    if (r.type === 'childList') r.addedNodes.forEach(add);
    else add(r.target);
  }
  if (pending.size && timer === undefined) timer = window.setTimeout(flush, 250);
}

function flush() {
  timer = undefined;
  // Drop roots already covered by an ancestor in the batch.
  const roots = [...pending].filter((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (pending.has(p)) return false;
    return el.isConnected;
  });
  pending = new Set();
  if (roots.length) for (const l of listeners) l(roots);
}

const observer = new MutationObserver(collect);

/** One observer for every feature; writes made through the registry are ignored. */
export function startObserving() {
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'alt', 'src', 'aria-label', 'href'],
  });
  setMutationSuppressor((fn) => {
    const theirs = observer.takeRecords();
    fn();
    observer.takeRecords(); // ours: discard
    if (theirs.length) collect(theirs);
  });
}

export function onPageChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Runs `work` over `items` in idle-time chunks so large pages stay responsive. */
export function inIdleChunks<T>(items: T[], work: (item: T) => void, chunk = 150): () => void {
  let i = 0;
  let cancelled = false;
  const step = (deadline?: IdleDeadline) => {
    if (cancelled) return;
    const first = i;
    const end = Math.min(items.length, i + chunk);
    while (i < end && (i === first || !deadline || deadline.timeRemaining() > 1)) work(items[i++]);
    if (i < items.length) requestIdleCallback(step, { timeout: 500 });
  };
  step();
  return () => {
    cancelled = true;
  };
}
