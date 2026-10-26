const TIMEZONE = "Asia/Seoul";
const DEFAULT_PUBLISHERS = [
  { id: "mk", name: "매일경제", domain: "mk.co.kr" },
  { id: "chosun", name: "조선일보", domain: "chosun.com" },
  { id: "segye", name: "세계일보", domain: "segye.com" },
  { id: "hankyung", name: "한국경제", domain: "hankyung.com" },
  { id: "joongang", name: "중앙일보", domain: "joongang.co.kr" },
  { id: "sedaily", name: "서울경제", domain: "sedaily.com" },
  { id: "hani", name: "한겨레신문", domain: "hani.co.kr" },
  { id: "donga", name: "동아일보", domain: "donga.com" },
  { id: "kmib", name: "국민일보", domain: "kmib.co.kr" },
];

// Use a verified Naver article permalink when available; otherwise use the exact original article.
// Never route article clicks to the publisher's Naver newspaper landing page.
function articleDestination(article) {
  const naver = safeUrl(article.naverUrl);
  if (naver && new URL(naver).hostname === "n.news.naver.com" &&
      (/^\/mnews\/article\/\d{3}\/\d+\/?$/.test(new URL(naver).pathname) ||
       /^\/article\/newspaper\/\d{3}\/\d+\/?$/.test(new URL(naver).pathname))) {
    return { url: naver, label: "네이버 기사 보기" };
  }
  const original = safeUrl(article.url);
  return original ? { url: original, label: "언론사 원문 보기" } : null;
}

const STATUS_LABELS = {
  checked: "확인 완료",
  partial: "일부 확인",
  blocked: "접근 제한",
  not_checked: "미확인",
};

const state = {
  archive: { publishers: DEFAULT_PUBLISHERS, runs: [], updatedAt: null },
  date: "all",
  publisher: "all",
  type: "all",
  query: "",
  sort: "latest",
  loaded: false,
  hasLoadedSuccessfully: false,
  loading: false,
  failed: false,
  calendarOpen: false,
  calendarYear: null,
  calendarMonth: null,
};

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateParts(value) {
  const date = validDate(value);
  if (!date) return null;
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(({ type, value: part }) => [type, part]));
}

export function formatDate(value, options = {}) {
  const parts = dateParts(/^\d{4}-\d{2}-\d{2}$/.test(value || "") ? `${value}T12:00:00+09:00` : value);
  if (!parts) return "날짜 미확인";
  if (options.long) return `${Number(parts.month)}월 ${Number(parts.day)}일`;
  return `${parts.year}.${parts.month}.${parts.day}`;
}

export function formatTime(value, options = {}) {
  const parts = dateParts(value);
  if (!parts) return "시각 미확인";
  const time = `${parts.hour}:${parts.minute}`;
  return options.date ? `${parts.month}.${parts.day} ${time}` : time;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function articleKey(article) {
  const raw = safeUrl(article.url);
  if (!raw) return `${article.publisherId}:${article.id || article.title}`;
  const url = new URL(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  return `${article.publisherId}:${url.href}`;
}

export function normalizeArchive(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.runs)) {
    throw new Error("Invalid archive structure");
  }
  const publishers = Array.isArray(raw.publishers) && raw.publishers.length
    ? raw.publishers.filter((item) => item && typeof item.id === "string" && typeof item.name === "string")
    : DEFAULT_PUBLISHERS;
  if (!publishers.length) throw new Error("Invalid publishers");
  const runs = raw.runs.filter((run) => run && /^\d{4}-\d{2}-\d{2}$/.test(run.date))
    .map((run) => ({
      ...run,
      articles: Array.isArray(run.articles) ? run.articles.filter((article) => article &&
        typeof article.title === "string" && typeof article.publisherId === "string" &&
        ["exclusive", "feature"].includes(article.type)) : [],
      coverage: Array.isArray(run.coverage) ? run.coverage : [],
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
  return { ...raw, publishers, runs };
}

export function selectArticles(archive, filters = {}) {
  const { date = "all", publisher = "all", type = "all", query = "", sort = "latest" } = filters;
  const seen = new Set();
  const queryText = String(query).trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
  const publisherOrder = new Map(archive.publishers.map((item, index) => [item.id, index]));
  const rows = [];
  for (const run of archive.runs) {
    if (date !== "all" && run.date !== date) continue;
    for (const article of run.articles) {
      const key = articleKey(article);
      if (seen.has(key)) continue;
      seen.add(key);
      if (publisher !== "all" && article.publisherId !== publisher) continue;
      if (type !== "all" && article.type !== type) continue;
      const searchable = `${article.title} ${article.summary || ""}`.toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
      if (queryText && !searchable.includes(queryText)) continue;
      rows.push({ ...article, archiveDate: run.date });
    }
  }
  const timestamp = (article) => validDate(article.publishedAt)?.getTime() ??
    validDate(article.collectedAt)?.getTime() ??
    validDate(`${article.archiveDate}T00:00:00+09:00`)?.getTime() ?? 0;
  rows.sort((a, b) => {
    if (sort === "publisher") {
      const order = (publisherOrder.get(a.publisherId) ?? 999) - (publisherOrder.get(b.publisherId) ?? 999);
      if (order !== 0) return order;
    }
    return timestamp(b) - timestamp(a) || a.title.localeCompare(b.title, "ko");
  });
  return rows;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function $(id) { return document.getElementById(id); }

function renderPublishers() {
  const dateArticles = selectArticles(state.archive, { date: state.date });
  const counts = new Map();
  for (const article of dateArticles) counts.set(article.publisherId, (counts.get(article.publisherId) || 0) + 1);
  const fragment = document.createDocumentFragment();
  const choices = [{ id: "all", name: "모든 언론사" }, ...state.archive.publishers];
  for (const publisher of choices) {
    const button = element("button", `publisher-button${publisher.id === state.publisher ? " is-active" : ""}`);
    button.type = "button";
    button.dataset.publisher = publisher.id;
    button.setAttribute("aria-pressed", String(publisher.id === state.publisher));
    const name = element("span", "publisher-name");
    const dot = element("span", "publisher-dot");
    dot.setAttribute("aria-hidden", "true");
    name.append(dot, document.createTextNode(publisher.name));
    const count = publisher.id === "all" ? dateArticles.length : counts.get(publisher.id) || 0;
    const countText = element("span", "publisher-number", String(count));
    countText.setAttribute("aria-label", `${count}개 기사`);
    button.append(name, countText);
    button.addEventListener("click", () => {
      state.publisher = publisher.id;
      render();
      document.querySelector(`.publisher-button[data-publisher="${CSS.escape(publisher.id)}"]`)?.focus({ preventScroll: true });
    });
    fragment.append(button);
  }
  $("publisher-list").replaceChildren(fragment);
  $("publisher-count").textContent = String(state.archive.publishers.length).padStart(2, "0");
}

function todayInSeoul() {
  const parts = dateParts(new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function setCalendarMonth(date) {
  const monthDate = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : todayInSeoul();
  state.calendarYear = Number(monthDate.slice(0, 4));
  state.calendarMonth = Number(monthDate.slice(5, 7)) - 1;
}

function renderCalendar() {
  if (state.calendarYear === null || state.calendarMonth === null) {
    setCalendarMonth(state.date === "all" ? state.archive.runs[0]?.date : state.date);
  }
  const label = state.date === "all" ? "전체 날짜" : formatDate(state.date);
  $("calendar-date-label").textContent = label;
  $("calendar-toggle").setAttribute("aria-label", `아카이브 날짜 선택, ${label}`);
  $("calendar-toggle").setAttribute("aria-expanded", String(state.calendarOpen));
  $("calendar-popover").hidden = !state.calendarOpen;
  $("calendar-month").textContent = `${state.calendarYear}년 ${state.calendarMonth + 1}월`;
  $("calendar-all").setAttribute("aria-pressed", String(state.date === "all"));
  $("calendar-latest").disabled = !state.archive.runs.length;

  const year = state.calendarYear;
  const month = state.calendarMonth;
  const available = new Map(state.archive.runs.map((run) => [run.date, run]));
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const numberOfDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = todayInSeoul();
  const fragment = document.createDocumentFragment();
  let recordedDays = 0;
  for (let index = 0; index < firstWeekday; index += 1) {
    const blank = element("span", "calendar-blank");
    blank.setAttribute("aria-hidden", "true");
    fragment.append(blank);
  }
  for (let day = 1; day <= numberOfDays; day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const run = available.get(date);
    const selected = date === state.date;
    const button = element("button", `calendar-day${run ? " has-archive" : ""}${selected ? " is-selected" : ""}${date === today ? " is-today" : ""}`, String(day));
    button.type = "button";
    button.dataset.date = date;
    button.disabled = !run;
    button.setAttribute("aria-pressed", String(selected));
    if (date === today) button.setAttribute("aria-current", "date");
    const dateLabel = new Intl.DateTimeFormat("ko-KR", {
      year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: TIMEZONE,
    }).format(new Date(`${date}T12:00:00+09:00`));
    button.setAttribute("aria-label", `${dateLabel}, ${run ? `기록 있음, 기사 ${run.articles.length}개` : "아카이브 없음"}`);
    button.title = run ? `${formatDate(date)}의 기록 보기` : "아카이브가 없는 날짜입니다.";
    if (run) {
      recordedDays += 1;
      button.addEventListener("click", () => selectArchiveDate(date));
    }
    fragment.append(button);
  }
  $("calendar-days").replaceChildren(fragment);
  $("calendar-empty").hidden = recordedDays > 0;
}

function closeCalendar(restoreFocus = true) {
  if (!state.calendarOpen) return;
  state.calendarOpen = false;
  $("calendar-popover").hidden = true;
  $("calendar-toggle").setAttribute("aria-expanded", "false");
  if (restoreFocus) $("calendar-toggle").focus({ preventScroll: true });
}

function openCalendar() {
  state.calendarOpen = true;
  setCalendarMonth(state.date === "all" ? state.archive.runs[0]?.date : state.date);
  renderCalendar();
  const focusTarget = $("calendar-days").querySelector(".is-selected:not(:disabled)") ||
    $("calendar-days").querySelector(".has-archive:not(:disabled)") || $("calendar-all");
  focusTarget.focus({ preventScroll: true });
}

function selectArchiveDate(date) {
  if (date !== "all" && !state.archive.runs.some((run) => run.date === date)) return;
  state.date = date;
  closeCalendar(false);
  render();
  $("calendar-toggle").focus({ preventScroll: true });
}

function moveCalendarMonth(direction) {
  const nextMonth = new Date(Date.UTC(state.calendarYear, state.calendarMonth + direction, 1));
  state.calendarYear = nextMonth.getUTCFullYear();
  state.calendarMonth = nextMonth.getUTCMonth();
  renderCalendar();
}

function renderHeading() {
  const articles = selectArticles(state.archive, { date: state.date });
  const count = articles.length;
  $("stat-total").textContent = String(count);
  $("stat-exclusive").textContent = String(articles.filter((article) => article.type === "exclusive").length);
  $("stat-feature").textContent = String(articles.filter((article) => article.type === "feature").length);
  const selectedRun = state.archive.runs.find((run) => state.date === "all" || run.date === state.date);
  $("run-note").textContent = selectedRun?.note || "";
  $("run-note").hidden = !selectedRun?.note;
  const updated = state.archive.updatedAt || state.archive.runs[0]?.generatedAt;
  $("last-updated").textContent = updated ? formatTime(updated, { date: true }) : "아직 없음";
  if (state.date === "all" && state.archive.runs.length) {
    $("edition-title").textContent = "모든 날의 기록";
    $("edition-description").textContent = "차곡차곡 모아둔 단독·기획 기사를 다시 읽어보세요.";
  } else if (selectedRun) {
    $("edition-title").textContent = `${formatDate(state.date, { long: true })}의 브리핑`;
    const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "long", timeZone: TIMEZONE })
      .format(new Date(`${selectedRun.date}T12:00:00+09:00`));
    $("edition-description").textContent = `${formatDate(selectedRun.date)} ${weekday} · 단독·기획으로 살펴보는 오늘의 기록`;
  } else {
    $("edition-title").textContent = "오늘의 브리핑";
    $("edition-description").textContent = "하루의 시작에 읽어둘 단독과 기획을 모읍니다.";
  }
  if (state.archive.runs.length) {
    const dates = state.archive.runs.map((run) => run.date).sort();
    $("archive-range").textContent = `${formatDate(dates[0])} — ${formatDate(dates.at(-1))}`;
  }
}

function renderArticle(article, index) {
  const publisher = state.archive.publishers.find((item) => item.id === article.publisherId);
  const card = element("article", `article-card${index === 0 ? " article-card--lead" : ""}`);
  const meta = element("div", "article-meta");
  meta.append(element("span", "article-publisher", publisher?.name || article.publisherId));
  meta.append(element("span", `article-type${article.type === "exclusive" ? " article-type--exclusive" : ""}`,
    article.type === "exclusive" ? "단독" : "기획"));
  const number = element("span", "article-number", String(index + 1).padStart(2, "0"));
  number.setAttribute("aria-hidden", "true");
  meta.append(number);
  const title = element("h3", "article-title");
  const destination = articleDestination(article);
  const url = destination?.url;
  const destinationLabel = destination?.label || "기사 보기";
  if (url) {
    const link = element("a", "", article.title);
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", `${article.title} — ${destinationLabel}, 새 탭`);
    title.append(link);
  } else {
    title.textContent = article.title;
  }
  card.append(meta, title, element("p", "article-summary", article.summary || "확인 가능한 요약이 없습니다."));
  if (article.summaryBasis && article.summaryBasis !== "full_text") {
    card.append(element("p", "basis-note", article.summaryBasis === "metadata_only"
      ? "제목·공개정보 확인 · 본문 전체를 확인하지 못했습니다."
      : "일부 내용 확인 · 열람 가능한 범위를 바탕으로 정리했습니다."));
  }
  const bottom = element("div", "article-bottom");
  const time = element("time", "article-date");
  if (validDate(article.publishedAt)) {
    time.dateTime = article.publishedAt;
    time.textContent = `${formatDate(article.publishedAt)} · ${formatTime(article.publishedAt)} 발행`;
  } else {
    time.textContent = `${formatDate(article.archiveDate)} 수집 · 발행 시각 미확인`;
  }
  bottom.append(time);
  if (url) {
    const source = element("a", "article-source", destinationLabel);
    source.href = url;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    source.setAttribute("aria-label", `${destinationLabel}, 새 탭`);
    const arrow = element("span", "", "↗");
    arrow.setAttribute("aria-hidden", "true");
    source.append(arrow);
    bottom.append(source);
  }
  card.append(bottom);
  if (article.classificationEvidence) {
    const details = element("details", "article-evidence");
    details.append(element("summary", "", "기사 유형 확인 근거"), element("p", "", article.classificationEvidence));
    card.append(details);
  }
  return card;
}

function renderCoverage() {
  const run = state.archive.runs.find((item) => state.date === "all" || item.date === state.date);
  $("coverage-date").textContent = run ? `${formatDate(run.date)} 기준` : "첫 수집 대기";
  $("coverage-intro").textContent = run
    ? "검색으로 확인한 범위를 기록합니다. ‘확인 완료’는 해당 언론사의 모든 기사 수집을 뜻하지 않습니다."
    : "첫 브리핑이 도착하면 언론사별 기사 확인 상태를 함께 표시합니다.";
  const fragment = document.createDocumentFragment();
  for (const publisher of state.archive.publishers) {
    const check = run?.coverage.find((item) => item.publisherId === publisher.id);
    const status = Object.hasOwn(STATUS_LABELS, check?.status) ? check.status : "not_checked";
    const row = element("div", "coverage-item");
    if (check?.note) row.title = check.note;
    const name = element("span", "coverage-publisher", publisher.name);
    const label = element("span", `coverage-status coverage-status--${status}`, STATUS_LABELS[status]);
    if (check?.note) label.setAttribute("aria-label", `${STATUS_LABELS[status]}: ${check.note}`);
    row.append(name, label);
    fragment.append(row);
  }
  $("coverage-list").replaceChildren(fragment);
}

function renderEmpty(articles) {
  const show = state.loaded && !state.failed && articles.length === 0;
  $("empty-state").hidden = !show;
  if (!show) return;
  const isFiltered = state.publisher !== "all" || state.type !== "all" || state.query.trim();
  const run = state.archive.runs.find((item) => state.date === "all" || item.date === state.date);
  $("reset-filters").hidden = !isFiltered;
  if (!state.archive.runs.length) {
    $("empty-eyebrow").textContent = "A NEW DAY, A NEW STORY";
    $("empty-title").textContent = "첫 브리핑을 기다리고 있어요";
    $("empty-description").textContent = "새롭게 모은 단독·기획 기사가 이곳에 차곡차곡 쌓입니다.\n기록이 쌓이면 달력에서 날짜를 골라 읽을 수 있어요.";
  } else if (isFiltered) {
    $("empty-eyebrow").textContent = "A DIFFERENT POINT OF VIEW";
    $("empty-title").textContent = "조건에 맞는 기사가 없어요";
    $("empty-description").textContent = "검색어를 바꾸거나 언론사·기사 유형 필터를 조정해 보세요.";
  } else if (run?.status === "failed") {
    $("empty-eyebrow").textContent = "COLLECTION UPDATE";
    $("empty-title").textContent = "이번 브리핑을 수집하지 못했어요";
    $("empty-description").textContent = "아래 언론사 확인 현황에서 접근 상태를 확인할 수 있습니다.\n다른 날짜의 기록은 계속 열람할 수 있어요.";
  } else if (run?.status === "partial") {
    $("empty-eyebrow").textContent = "COLLECTION UPDATE";
    $("empty-title").textContent = "확인된 새 기사가 없어요";
    $("empty-description").textContent = "일부 언론사의 확인이 제한되었습니다.\n아래 확인 현황을 함께 살펴보세요.";
  } else {
    $("empty-eyebrow").textContent = "A QUIET MORNING";
    $("empty-title").textContent = "이날 확인된 새 기사가 없어요";
    $("empty-description").textContent = "수집 범위에서 조건에 맞는 단독·기획 기사를 찾지 못했습니다.\n다른 날짜의 기록을 둘러보세요.";
  }
}

function render() {
  renderPublishers();
  renderCalendar();
  renderHeading();
  renderCoverage();
  document.querySelectorAll("[data-type]").forEach((button) => {
    const active = button.dataset.type === state.type;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const articles = selectArticles(state.archive, state);
  const fragment = document.createDocumentFragment();
  articles.forEach((article, index) => fragment.append(renderArticle(article, index)));
  $("article-grid").replaceChildren(fragment);
  $("article-grid").setAttribute("aria-busy", String(state.loading));
  $("result-count").textContent = state.loading ? "기사를 불러오고 있어요" : state.failed ? "불러오기 실패" : `${articles.length}개의 기사`;
  $("load-error").hidden = !state.failed;
  renderEmpty(articles);
}

async function loadArchive() {
  if (state.loading) return;
  state.loading = true;
  state.failed = false;
  render();
  try {
    const response = await fetch(new URL("../data/archive.json", import.meta.url), { cache: "no-cache" });
    if (!response.ok) throw new Error(`Archive response ${response.status}`);
    state.archive = normalizeArchive(await response.json());
    if (!state.hasLoadedSuccessfully) state.date = state.archive.runs[0]?.date || "all";
    else if (state.date !== "all" && !state.archive.runs.some((run) => run.date === state.date)) state.date = "all";
    if (state.publisher !== "all" && !state.archive.publishers.some((publisher) => publisher.id === state.publisher)) state.publisher = "all";
    state.loaded = true;
    state.hasLoadedSuccessfully = true;
    setCalendarMonth(state.date === "all" ? state.archive.runs[0]?.date : state.date);
  } catch (error) {
    state.failed = true;
    state.loaded = true;
    console.error("Unable to load news archive:", error);
  } finally {
    state.loading = false;
    render();
  }
}

function initialize() {
  $("search-input").addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });
  $("calendar-toggle").addEventListener("click", () => state.calendarOpen ? closeCalendar() : openCalendar());
  $("calendar-previous").addEventListener("click", () => moveCalendarMonth(-1));
  $("calendar-next").addEventListener("click", () => moveCalendarMonth(1));
  $("calendar-all").addEventListener("click", () => selectArchiveDate("all"));
  $("calendar-latest").addEventListener("click", () => {
    if (state.archive.runs.length) selectArchiveDate(state.archive.runs[0].date);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.calendarOpen) {
      event.preventDefault();
      closeCalendar();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (state.calendarOpen && !$("date-picker").contains(event.target)) closeCalendar(false);
  });
  document.addEventListener("focusin", (event) => {
    if (state.calendarOpen && !$("date-picker").contains(event.target)) closeCalendar(false);
  });
  $("sort-select").addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });
  document.querySelectorAll("[data-type]").forEach((button) => {
    button.addEventListener("click", () => {
      state.type = button.dataset.type;
      render();
    });
  });
  $("reset-filters").addEventListener("click", () => {
    state.publisher = "all";
    state.type = "all";
    state.query = "";
    $("search-input").value = "";
    render();
    $("search-input").focus();
  });
  $("retry-button").addEventListener("click", loadArchive);
  renderCalendar();
  loadArchive();
}

if (typeof document !== "undefined") initialize();
