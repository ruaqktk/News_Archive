import { $, SECTIONS, displayTitle, element, loadLogos, pressLogo, sectionBadge, formatEditionDate, formatDateTime, loadArchive, naverLink, comparePages, typeBadge } from "./common.js";

const STATUS_LABEL = { checked: "확인 완료", partial: "일부 확인", blocked: "접근 실패", not_checked: "미확인" };

const state = { archive: null, date: null, press: "all", type: "all", section: "all" };

function readUrl() {
  const params = new URLSearchParams(location.search);
  state.date = params.get("date");
  state.press = params.get("press") || "all";
  state.type = ["exclusive", "feature"].includes(params.get("type")) ? params.get("type") : "all";
  state.section = SECTIONS.includes(params.get("section")) ? params.get("section") : "all";
}

function writeUrl() {
  const params = new URLSearchParams();
  if (state.date) params.set("date", state.date);
  if (state.press !== "all") params.set("press", state.press);
  if (state.type !== "all") params.set("type", state.type);
  if (state.section !== "all") params.set("section", state.section);
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
}

const dates = () => state.archive.runs.map((run) => run.date);
const currentRun = () => state.archive.runs.find((run) => run.date === state.date);

function articleHref(article) {
  return `./article.html?date=${encodeURIComponent(state.date)}&id=${encodeURIComponent(article.id)}`;
}

function titleLink(article, className) {
  const link = element("a", className, displayTitle(article));
  link.href = articleHref(article);
  return link;
}

function meta(article) {
  const row = element("p", "article-meta");
  row.append(typeBadge(article.type));
  const section = sectionBadge(article.section);
  if (section) row.append(section);
  return row;
}

function leadArticle(article) {
  const block = element("article", "lead");
  const text = element("div", "lead-text");
  text.append(meta(article), titleLink(article, "lead-title"));
  if (article.summary) text.append(element("p", "lead-summary", article.summary));
  block.append(text);
  return block;
}

function restList(articles) {
  const list = element("ul", "rest-list");
  for (const article of articles) {
    const item = element("li", "rest-item");
    const badges = element("span", "rest-badges");
    badges.append(typeBadge(article.type));
    const section = sectionBadge(article.section);
    if (section) badges.append(section);
    item.append(badges, titleLink(article, "rest-title"));
    list.append(item);
  }
  return list;
}

// 언론사 하나만 볼 때는 모든 기사를 요약과 함께 펼친다.
function fullList(articles) {
  const list = element("div", "full-list");
  for (const article of articles) {
    const block = element("article", "full-item");
    block.append(meta(article), titleLink(article, "full-title"));
    if (article.summary) block.append(element("p", "full-summary", article.summary));
    const naver = naverLink(article);
    if (naver) {
      const link = element("a", "naver-link", "네이버 기사 보기");
      link.href = naver;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      block.append(link);
    }
    list.append(block);
  }
  return list;
}

function pressCard(publisher, articles, expanded) {
  const card = element("section", `press-card${expanded ? " is-expanded" : ""}`);
  card.setAttribute("aria-label", publisher.name);
  const head = element("header", "press-head");
  const name = element("h2", "press-name");
  // 엠블럼(로고가 있을 때) + 언론사 이름
  const label = () => {
    const wrap = element("span", "press-label");
    const emblem = pressLogo(publisher.id);
    if (emblem) wrap.append(emblem);
    wrap.append(element("span", "press-title", publisher.name));
    return wrap;
  };
  if (!expanded) {
    const link = element("a");
    link.append(label());
    link.href = `?date=${state.date}&press=${publisher.id}`;
    link.addEventListener("click", (event) => { event.preventDefault(); setPress(publisher.id); });
    name.append(link);
  } else {
    name.append(label());
  }
  const exclusive = articles.filter((article) => article.type === "exclusive").length;
  const feature = articles.length - exclusive;
  const counts = element("p", "press-counts");
  if (exclusive) counts.append(element("span", "count-exclusive", `단독 ${exclusive}`));
  if (feature) counts.append(element("span", "count-feature", `기획 ${feature}`));
  head.append(name, counts);
  card.append(head);

  if (expanded) {
    card.append(fullList(articles));
  } else {
    card.append(leadArticle(articles[0]));
    if (articles.length > 1) card.append(restList(articles.slice(1)));
  }
  return card;
}

function render() {
  writeUrl();
  const run = currentRun();
  const publishers = state.archive.publishers;
  $("date-label").textContent = run ? formatEditionDate(run.date) : "기록 없음";
  const index = dates().indexOf(state.date);
  $("date-prev").disabled = index === -1 || index === dates().length - 1;
  $("date-next").disabled = index <= 0;
  $("press-select").value = state.press;
  for (const button of document.querySelectorAll(".type-filter button")) button.setAttribute("aria-pressed", String(button.dataset.type === state.type));
  $("section-select").value = state.section;

  const grid = $("editions");
  grid.replaceChildren();
  grid.setAttribute("aria-busy", "false");
  if (!run) {
    $("edition-count").textContent = "아직 저장된 지면이 없습니다.";
    $("quiet-press").hidden = true;
    $("coverage").hidden = true;
    return;
  }

  const visible = run.articles
    .filter((article) => state.type === "all" || article.type === state.type)
    .filter((article) => state.section === "all" || article.section === state.section)
    .filter((article) => state.press === "all" || article.publisherId === state.press);
  const exclusive = visible.filter((article) => article.type === "exclusive").length;
  $("edition-count").textContent = `단독 ${exclusive}건, 기획 ${visible.length - exclusive}건`;

  const quiet = [];
  const shown = publishers.filter((publisher) => state.press === "all" || publisher.id === state.press);
  for (const publisher of shown) {
    const articles = visible.filter((article) => article.publisherId === publisher.id).sort(comparePages);
    if (articles.length) grid.append(pressCard(publisher, articles, state.press !== "all"));
    else quiet.push(publisher);
  }
  grid.classList.toggle("is-single", state.press !== "all");

  const coverage = new Map(run.coverage.map((entry) => [entry.publisherId, entry]));
  $("quiet-press").hidden = quiet.length === 0;
  $("quiet-title").textContent = state.type === "all" && state.section === "all"
    ? "이 날 단독·기획 기사가 없는 언론사"
    : "선택한 조건에 맞는 기사가 없는 언론사";
  $("quiet-list").replaceChildren(...quiet.map((publisher) => {
    const status = coverage.get(publisher.id)?.status;
    const item = element("li", null, publisher.name);
    if (status && status !== "checked") item.append(element("span", "quiet-status", STATUS_LABEL[status]));
    return item;
  }));

  $("coverage").hidden = false;
  const when = formatDateTime(run.generatedAt);
  $("coverage-note").textContent = `${when ? `${when} 정리` : ""}${run.note ? ` — ${run.note}` : ""}`;
  $("coverage-list").replaceChildren(...publishers.map((publisher) => {
    const entry = coverage.get(publisher.id);
    const item = element("li");
    item.append(element("strong", null, publisher.name), element("span", `status status-${entry?.status ?? "not_checked"}`, STATUS_LABEL[entry?.status] ?? "미확인"));
    if (entry?.note) item.append(element("span", "coverage-detail", entry.note));
    return item;
  }));
}

function setPress(press) {
  state.press = press;
  render();
  window.scrollTo({ top: 0 });
}

function setDate(date) {
  if (!dates().includes(date)) return;
  state.date = date;
  closeDateList();
  render();
}

// 달력 팝업: 기사가 있는 날짜만 고를 수 있다.
const calendar = { year: 0, month: 0 };
const pad = (n) => String(n).padStart(2, "0");

function setCalendarMonth(date) {
  calendar.year = Number(date.slice(0, 4));
  calendar.month = Number(date.slice(5, 7)) - 1;
}

function shiftCalendarMonth(step) {
  const next = new Date(Date.UTC(calendar.year, calendar.month + step, 1));
  calendar.year = next.getUTCFullYear();
  calendar.month = next.getUTCMonth();
  renderCalendar();
}

function renderCalendar() {
  const counts = new Map(state.archive.runs.map((run) => [run.date, run.articles.length]));
  const sorted = dates().slice().sort();
  const monthKey = `${calendar.year}-${pad(calendar.month + 1)}`;
  $("cal-title").textContent = `${calendar.year}년 ${calendar.month + 1}월`;
  $("cal-prev").disabled = !sorted.length || sorted[0].slice(0, 7) >= monthKey;
  $("cal-next").disabled = !sorted.length || sorted.at(-1).slice(0, 7) <= monthKey;

  const first = new Date(Date.UTC(calendar.year, calendar.month, 1)).getUTCDay();
  const days = new Date(Date.UTC(calendar.year, calendar.month + 1, 0)).getUTCDate();
  const grid = $("cal-grid");
  grid.replaceChildren();
  for (let i = 0; i < first; i += 1) grid.append(element("span", "cal-blank"));
  for (let day = 1; day <= days; day += 1) {
    const date = `${monthKey}-${pad(day)}`;
    const count = counts.get(date);
    const button = element("button", "cal-day");
    button.type = "button";
    button.append(element("span", "cal-num", String(day)));
    if (count !== undefined) {
      button.append(element("span", "cal-count", count ? `${count}건` : "0건"));
      button.setAttribute("aria-label", `${calendar.month + 1}월 ${day}일, 기사 ${count}건`);
      button.addEventListener("click", () => { setDate(date); $("date-button").focus(); });
    } else {
      button.disabled = true;
      button.setAttribute("aria-label", `${calendar.month + 1}월 ${day}일, 기록 없음`);
    }
    if (date === state.date) { button.classList.add("is-selected"); button.setAttribute("aria-current", "date"); }
    const weekday = (first + day - 1) % 7;
    if (weekday === 0) button.classList.add("is-sunday");
    if (weekday === 6) button.classList.add("is-saturday");
    grid.append(button);
  }
}

function openDateList() {
  setCalendarMonth(state.date);
  renderCalendar();
  $("date-calendar").hidden = false;
  $("date-button").setAttribute("aria-expanded", "true");
  ($("cal-grid").querySelector(".is-selected") ?? $("cal-grid").querySelector(".cal-day:not(:disabled)"))?.focus();
}

function closeDateList() {
  $("date-calendar").hidden = true;
  $("date-button").setAttribute("aria-expanded", "false");
}

async function initialize() {
  readUrl();
  try {
    [state.archive] = await Promise.all([loadArchive(), loadLogos()]);
  } catch {
    $("load-error").hidden = false;
    $("editions").setAttribute("aria-busy", "false");
    return;
  }
  if (!dates().includes(state.date)) state.date = dates()[0] ?? null;
  const select = $("press-select");
  for (const publisher of state.archive.publishers) {
    const option = element("option", null, publisher.name);
    option.value = publisher.id;
    select.append(option);
  }
  if (!state.archive.publishers.some((publisher) => publisher.id === state.press)) state.press = "all";

  select.addEventListener("change", () => setPress(select.value));
  $("date-prev").addEventListener("click", () => setDate(dates()[dates().indexOf(state.date) + 1]));
  $("date-next").addEventListener("click", () => setDate(dates()[dates().indexOf(state.date) - 1]));
  $("date-button").addEventListener("click", () => ($("date-calendar").hidden ? openDateList() : closeDateList()));
  $("cal-prev").addEventListener("click", () => shiftCalendarMonth(-1));
  $("cal-next").addEventListener("click", () => shiftCalendarMonth(1));
  document.addEventListener("click", (event) => { if (!event.target.closest(".date-picker")) closeDateList(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("date-calendar").hidden) { closeDateList(); $("date-button").focus(); } });
  const sectionSelect = $("section-select");
  for (const section of SECTIONS) {
    const option = element("option", null, section);
    option.value = section;
    sectionSelect.append(option);
  }
  sectionSelect.addEventListener("change", () => { state.section = sectionSelect.value; render(); });
  for (const button of document.querySelectorAll(".type-filter button")) {
    button.addEventListener("click", () => { state.type = button.dataset.type; render(); });
  }
  render();
}

initialize();
