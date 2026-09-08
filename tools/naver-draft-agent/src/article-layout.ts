export type NaverArticleLink = { title: string; url: string };
const sourceHeading = /^(?:함께 확인한 기사|참고한 기사와 자료|기사[·\s]*자료)$/;
const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const headingText = (text: string) => text.trim().replace(/^#{1,6}\s*/, "").replace(/^\*\*(.*)\*\*$/, "$1");
const tailStart = (text: string) => text === "마무리" || /^(?:본 글은 |본 자료는 |본 콘텐츠는 |투자 유의|이 글은 시장)/.test(text);

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
