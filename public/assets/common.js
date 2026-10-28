// 목록 화면(app.js)과 기사 상세 화면(article.js)이 함께 쓰는 도구.

export const TIMEZONE = "Asia/Seoul";
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export const TYPE_LABEL = { exclusive: "단독", feature: "기획" };
export const SECTIONS = ["정치", "경제", "사회", "생활·문화", "세계", "IT·과학", "스포츠"];

export function $(id) { return document.getElementById(id); }

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

// 네이버 신문보기 개별 기사 주소만 허용한다.
export function naverLink(article) {
  const url = safeUrl(article.naverUrl);
  if (!url) return null;
  const parsed = new URL(url);
  const ok = parsed.hostname === "n.news.naver.com" &&
    (/^\/article\/newspaper\/\d{3}\/\d+\/?$/.test(parsed.pathname) || /^\/mnews\/article\/\d{3}\/\d+\/?$/.test(parsed.pathname));
  return ok ? url : null;
}

// "2026-10-28" → "2026.10.28.수"
export function formatEditionDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return "";
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${date.replaceAll("-", ".")}.${weekday}`;
}

export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(({ type, value: part }) => [type, part]));
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
}

// 면 번호를 정렬 가능한 값으로: A1 < A2 < A10 < B1 < 1 < 2
export function pageOrder(page) {
  const match = String(page || "").match(/^([A-Z]*)(\d+)$/);
  if (!match) return [9, 999];
  return [match[1] ? match[1].charCodeAt(0) - 64 : 0, Number(match[2])];
}

export function comparePages(a, b) {
  const [sa, na] = pageOrder(a.page);
  const [sb, nb] = pageOrder(b.page);
  return sa - sb || na - nb || (a.type === b.type ? 0 : a.type === "exclusive" ? -1 : 1);
}

export async function loadArchive() {
  const response = await fetch(`./data/archive.json?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const raw = await response.json();
  if (!raw || !Array.isArray(raw.runs) || !Array.isArray(raw.publishers)) throw new Error("아카이브 형식이 올바르지 않습니다.");
  const runs = raw.runs
    .filter((run) => run && /^\d{4}-\d{2}-\d{2}$/.test(run.date))
    .map((run) => ({
      ...run,
      articles: (run.articles || []).filter((article) => article && typeof article.title === "string" && TYPE_LABEL[article.type]),
      coverage: Array.isArray(run.coverage) ? run.coverage : [],
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return { ...raw, runs };
}

// 화면 표시용 제목: 배지와 겹치는 앞머리 [단독] 표기를 뗀다(데이터는 그대로 둔다).
export function displayTitle(article) {
  return article.title.replace(/^\s*[\[〈<【]\s*단독\s*[\]〉>】]\s*/, "");
}

export function typeBadge(type) {
  return element("span", `badge badge-${type}`, TYPE_LABEL[type]);
}

export function sectionBadge(section) {
  return SECTIONS.includes(section) ? element("span", "badge badge-section", section) : null;
}

// 언론사 로고: 빌드 때 만든 assets/logos.json에 있는 언론사만 표시한다(파일은 public/assets/logos/).
let logoManifest = null;
export async function loadLogos() {
  try {
    const response = await fetch("./assets/logos.json", { cache: "no-store" });
    logoManifest = response.ok ? await response.json() : {};
  } catch {
    logoManifest = {};
  }
}

// 엠블럼 안에서 로고의 심볼 부분만 보여줄 언론사 (로고 이미지에서 심볼이 있는 쪽)
const SYMBOL_CROP = { hani: "right", hankookilbo: "left" };

// 네이버 신문보기처럼 동그란 엠블럼. 로고 파일이 없으면 null.
export function pressLogo(publisherId) {
  const file = logoManifest?.[publisherId];
  if (!file) return null;
  const crop = SYMBOL_CROP[publisherId];
  const badge = element("span", `press-emblem${crop ? ` is-symbol is-${crop}` : ""}`);
  badge.setAttribute("aria-hidden", "true");
  const img = element("img");
  img.alt = "";
  img.decoding = "async";
  img.src = `./assets/logos/${encodeURIComponent(file)}`;
  img.addEventListener("error", () => badge.remove());
  badge.append(img);
  return badge;
}
