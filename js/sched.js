// Anki-style SM-2 scheduler. Pure functions, no DOM or storage.
//
// Card fields used here:
//   type: 0 new, 1 learning, 2 review, 3 relearning
//   due:  new -> position; learning/relearning -> ms timestamp; review -> day number
//   ivl (days), factor (permille, 2500 = 250%), reps, lapses, step (index into steps)

export const MIN = 60_000;
export const DAY = 86_400_000;

export const DEFAULT_CONFIG = {
  newPerDay: 20,
  revPerDay: 200,
  learnSteps: [1, 10], // minutes
  relearnSteps: [10],
  graduatingIvl: 1,
  easyIvl: 4,
  startingEase: 2.5,
  easyBonus: 1.3,
  hardIvl: 1.2,
  ivlMod: 1.0,
  lapseMult: 0,
  minIvl: 1,
  maxIvl: 36500,
  leechThreshold: 8,
  leechAction: 'tag', // 'tag' | 'suspend'
  newOrder: 'added', // 'added' | 'random'
  newMix: 'mix', // 'mix' | 'first' | 'last'
  rollover: 4, // hour the next day starts
  learnAheadMins: 20,
  showIntervals: true,
  autoplay: true,
  theme: 'auto',
};

/** Local day number (days since epoch) accounting for the rollover hour. */
export function dayNumber(ts, rollover = 4) {
  const d = new Date(ts - rollover * 3_600_000);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

/** Timestamp at which a given day number starts (local time, rollover hour). */
export function dayStart(day, rollover = 4) {
  const d = new Date(day * DAY);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), rollover).getTime();
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FUZZ_RANGES = [
  [2.5, 7.0, 0.15],
  [7.0, 20.0, 0.1],
  [20.0, Infinity, 0.05],
];

/** Anki v3 style fuzz: deterministic for a given seed so previews match answers. */
export function fuzz(ivl, seed) {
  if (ivl < 2.5) return Math.round(ivl);
  let delta = 1.0;
  for (const [start, end, f] of FUZZ_RANGES) delta += f * Math.max(0, Math.min(ivl, end) - start);
  const lo = Math.max(2, Math.round(ivl - delta));
  const hi = Math.max(lo, Math.round(ivl + delta));
  const r = mulberry32(Math.floor(seed % 2 ** 31))();
  return lo + Math.floor(r * (hi - lo + 1));
}

function seedOf(card, salt) {
  return (Number(card.id) % 1_000_003) * 31 + (card.reps || 0) * 7 + salt;
}

function capIvl(x, conf) {
  return Math.min(conf.maxIvl, Math.max(1, Math.round(x)));
}

/** Intervals in days for Hard / Good / Easy on a review card. */
export function reviewIntervals(card, today, conf) {
  const ivl = Math.max(1, card.ivl || 1);
  const delay = Math.max(0, today - card.due);
  const ease = (card.factor || conf.startingEase * 1000) / 1000;
  const mod = conf.ivlMod;
  const hardMin = conf.hardIvl > 1 ? ivl + 1 : 1;
  const hard = capIvl(Math.max(fuzz(ivl * conf.hardIvl * mod, seedOf(card, 1)), hardMin), conf);
  const good = capIvl(Math.max(fuzz((ivl + delay / 2) * ease * mod, seedOf(card, 2)), hard + 1), conf);
  const easy = capIvl(Math.max(fuzz((ivl + delay) * ease * conf.easyBonus * mod, seedOf(card, 3)), good + 1), conf);
  return { hard, good, easy };
}

function learnSteps(card, conf) {
  return card.type === 3 ? conf.relearnSteps : conf.learnSteps;
}

/**
 * Answer a card. ease: 1 Again, 2 Hard, 3 Good, 4 Easy.
 * Returns { card, log, leech } without mutating the input.
 */
export function answerCard(card, ease, now, conf) {
  const c = { ...card };
  const today = dayNumber(now, conf.rollover);
  let logType;
  let leech = false;
  const lastIvl = card.type === 2 || card.type === 3 ? card.ivl : card.type === 1 ? -stepSecs(card, conf) : 0;

  if (c.type === 0) {
    c.type = 1;
    c.step = 0;
    c.factor = Math.round(conf.startingEase * 1000);
  }

  if (c.type === 1 || c.type === 3) {
    logType = c.type === 3 ? 2 : 0;
    learn(c, ease, now, today, conf, learnSteps(c, conf), card);
  } else {
    logType = 1;
    if (ease === 1) {
      c.lapses = (c.lapses || 0) + 1;
      c.factor = Math.max(1300, c.factor - 200);
      c.ivl = Math.max(conf.minIvl, Math.round(c.ivl * conf.lapseMult));
      if (conf.relearnSteps.length) {
        c.type = 3;
        c.step = 0;
        c.due = now + conf.relearnSteps[0] * MIN;
      } else {
        c.due = today + c.ivl;
      }
      const t = conf.leechThreshold;
      if (t > 0 && c.lapses >= t && (c.lapses - t) % Math.max(1, Math.ceil(t / 2)) === 0) leech = true;
    } else {
      const ivls = reviewIntervals(card, today, conf);
      c.ivl = ease === 2 ? ivls.hard : ease === 3 ? ivls.good : ivls.easy;
      if (ease === 2) c.factor = Math.max(1300, c.factor - 150);
      if (ease === 4) c.factor += 150;
      c.due = today + c.ivl;
    }
  }

  c.reps = (c.reps || 0) + 1;
  c.mod = now;
  const ivl = c.type === 1 || c.type === 3 ? -Math.round((c.due - now) / 1000) : c.ivl;
  return { card: c, log: { ease, ivl, lastIvl, factor: c.factor, type: logType }, leech };
}

function stepSecs(card, conf) {
  const steps = learnSteps(card, conf);
  if (!steps.length) return 60;
  return Math.round(steps[Math.min(card.step || 0, steps.length - 1)] * 60);
}

function learn(c, ease, now, today, conf, steps, orig) {
  const relearn = c.type === 3;
  const graduate = (easy) => {
    if (relearn) {
      c.ivl = Math.max(conf.minIvl, c.ivl || 1) + (easy ? 1 : 0);
    } else {
      const base = easy ? conf.easyIvl : conf.graduatingIvl;
      c.ivl = capIvl(fuzz(base, seedOf(orig, easy ? 5 : 4)), conf);
    }
    c.type = 2;
    c.step = 0;
    c.due = today + c.ivl;
  };
  if (!steps.length) return graduate(ease === 4);
  const step = Math.min(c.step || 0, steps.length - 1);
  switch (ease) {
    case 1:
      c.step = 0;
      c.due = now + steps[0] * MIN;
      break;
    case 2: {
      let d = steps[step];
      if (step === 0) d = steps.length > 1 ? (steps[0] + steps[1]) / 2 : Math.min(steps[0] * 1.5, steps[0] + 1440);
      c.step = step;
      c.due = now + d * MIN;
      break;
    }
    case 3:
      if (step + 1 >= steps.length) graduate(false);
      else {
        c.step = step + 1;
        c.due = now + steps[c.step] * MIN;
      }
      break;
    default:
      graduate(true);
  }
}

/** Human readable "next interval" labels for the four buttons. */
export function previewLabels(card, now, conf) {
  const today = dayNumber(now, conf.rollover);
  return [1, 2, 3, 4].map((ease) => {
    const { card: c } = answerCard(card, ease, now, conf);
    if (c.type === 1 || c.type === 3) return formatIvl(c.due - now);
    return formatIvl((c.due - today) * DAY, true);
  });
}

export function formatIvl(ms, days = false) {
  const m = ms / MIN;
  if (!days && m < 60) return `${Math.max(1, Math.round(m))}m`;
  if (!days && m < 1440) return `${trim(m / 60)}h`;
  const d = ms / DAY;
  if (d < 30) return `${Math.max(1, Math.round(d))}d`;
  if (d < 365) return `${trim(d / 30)}mo`;
  return `${trim(d / 365)}y`;
}

function trim(x) {
  return x < 10 ? (Math.round(x * 10) / 10).toString() : Math.round(x).toString();
}

/** Describe when a card is due, for lists. */
export function dueLabel(card, now, conf) {
  if (card.suspended) return 'Suspended';
  if (card.type === 0) return 'New';
  if (card.type === 1 || card.type === 3) {
    return card.due <= now ? 'Learning, due now' : `Learning, ${formatIvl(card.due - now)}`;
  }
  const today = dayNumber(now, conf.rollover);
  const diff = card.due - today;
  if (diff < 0) return `Overdue ${formatIvl(-diff * DAY, true)}`;
  if (diff === 0) return 'Due today';
  return `Due in ${formatIvl(diff * DAY, true)}`;
}
