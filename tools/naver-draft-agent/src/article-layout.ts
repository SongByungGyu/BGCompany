export type NaverArticleLink = { title: string; url: string };
const sourceHeading = /^(?:함께 확인한 기사|참고한 기사와 자료|기사[·\s]*자료)$/;
const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const headingText = (text: string) => text.trim().replace(/^#{1,6}\s*/, "").replace(/^\*\*(.*)\*\*$/, "$1");
// Keep the canonical data-availability disclosures out of the article parser.
const dataDisclosures = new Set([
  "미국 금리와 경제지표는 확인 가능한 최신 공식 수치만 반영했습니다.",
  "FRED 거시지표 조회 지연으로 미국 국채금리 또는 경제지표 일정 일부를 이번 브리핑에서 제외했습니다.",
  "KIS 업종 등락 자료가 일시적으로 비어 있어 강세·약세 업종 항목은 제외하고, 검증된 지수·수급·환율·거시자료만 사용했습니다.",
  "※ 확인되지 않은 해외지수·환율 수치와 관련 그래프는 제외하고, 검증된 국내 지수·수급·미국 금리 자료만 사용했습니다.",
]);
const tailStart = (text: string) => text === "마무리" || dataDisclosures.has(text) || /^(?:본 글은 |본 자료는 |본 콘텐츠는 |투자 유의|이 글은 시장)/.test(text);

export function buildNaverArticleLayout(value: string): { body: string; links: NaverArticleLink[] } {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex(line => sourceHeading.test(headingText(line)));
  if (start < 0) return { body: value, links: [] };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (tailStart(headingText(lines[i]))) { end = i; break; }
  }
  const links: NaverArticleLink[] = [];
  let pendingTitle = "";
  let publisher = "";
  const push = (url: string, title = pendingTitle) => {
    if (!title) throw new Error("NAVER_ARTICLE_LINK_TITLE_MISSING");
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("NAVER_ARTICLE_LINK_URL_INVALID");
    links.push({ title: publisher && !title.includes(publisher) ? `${publisher} | ${title}` : title, url });
    pendingTitle = "";
    publisher = "";
  };
  for (const raw of lines.slice(start + 1, end)) {
    const line = clean(raw);
    if (!line) continue;
    const markdown = line.match(/^(?:[-*•]\s*)?\[([^\]]+)\]\((https?:\/\/\S+)\)$/);
    if (markdown) { push(markdown[2], markdown[1]); continue; }
    const url = line.match(/^(?:-\s*원문\s*[:：]\s*)?(https?:\/\/\S+)$/);
    if (url) { push(url[1]); continue; }
    const source = line.match(/^-\s*출처\s*[:：]\s*(.+)$/);
    if (source) { publisher = source[1]; continue; }
    if (/^-\s*(?:발행일|핵심 내용|시장 영향)\s*[:：]/.test(line)) continue;
    if (pendingTitle) throw new Error("NAVER_ARTICLE_LINK_UNPAIRED_TITLE");
    pendingTitle = line.replace(/^\d+[.)]\s*/, "");
  }
  if (pendingTitle) throw new Error("NAVER_ARTICLE_LINK_URL_MISSING");
  if (!links.length) return { body: value, links };
  const before = lines.slice(0, start).join("\n").trimEnd();
  const tail = lines.slice(end).join("\n").trim();
  const section = [headingText(lines[start]), ...links.map(item => item.title)].join("\n");
  return { body: [before, section, tail].filter(Boolean).join("\n\n"), links };
}
