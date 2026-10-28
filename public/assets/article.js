import { $, displayTitle, element, sectionBadge, formatEditionDate, loadArchive, naverLink, safeUrl, typeBadge } from "./common.js";

function fail(message) {
  $("article-error").textContent = message;
  $("article-error").hidden = false;
}

function section(title, ...children) {
  const block = element("section", "story-section");
  block.append(element("h2", null, title), ...children);
  return block;
}

async function initialize() {
  const params = new URLSearchParams(location.search);
  const date = params.get("date");
  const id = params.get("id");
  let archive;
  try {
    archive = await loadArchive();
  } catch {
    fail("아카이브 데이터를 불러오지 못했습니다. 새로고침해 주세요.");
    return;
  }
  const run = archive.runs.find((item) => item.date === date);
  const article = run?.articles.find((item) => item.id === id);
  if (!article) {
    fail("해당 기사를 찾지 못했습니다. 지면 목록에서 다시 선택해 주세요.");
    return;
  }
  const publisher = archive.publishers.find((item) => item.id === article.publisherId);
  document.title = `${article.title} · 혜원이의 뉴스 아카이브`;
  $("back-link").href = `./?date=${encodeURIComponent(date)}`;

  $("story-meta").append(
    typeBadge(article.type),
    ...[sectionBadge(article.section)].filter(Boolean),
    element("span", "story-press", publisher?.name ?? article.publisherId),
    element("span", null, formatEditionDate(date)),
  );
  $("story-title").textContent = displayTitle(article);
  $("story-lede").textContent = article.summary || "";
  $("story-lede").hidden = !article.summary;

  const body = $("story-body");
  const detail = article.detail;
  if (detail) {
    body.append(section("배경", element("p", null, detail.background)));
    const points = element("ul", "points");
    for (const point of detail.points) points.append(element("li", null, point));
    body.append(section("핵심 정리", points));
    body.append(section("왜 중요한가", element("p", null, detail.significance)));
    if (detail.terms?.length) {
      const terms = element("dl", "terms");
      for (const item of detail.terms) terms.append(element("dt", null, item.term), element("dd", null, item.description));
      body.append(section("용어 풀이", terms));
    }
  } else {
    body.append(element("p", "story-empty", "이 기사는 상세 요약이 아직 없습니다. 아래 버튼으로 원문을 확인하세요."));
  }

  const naver = naverLink(article);
  if (naver) { $("naver-button").href = naver; $("naver-button").hidden = false; }
  const origin = safeUrl(article.url);
  if (origin) { $("origin-button").href = origin; $("origin-button").hidden = false; }
  $("article").hidden = false;
}

initialize();
