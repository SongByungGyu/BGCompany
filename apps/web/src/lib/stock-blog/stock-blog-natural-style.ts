// Presentation checks, not an AI detector or a substitute for factual QA.
export const STOCK_BLOG_NATURAL_STYLE_GUIDELINES = [
  "2026-09-08 대표 승인 문체: 차분한 개인 투자자의 해설을 유지합니다. 지나친 축약이나 억지 구어체로 바꾸지 않습니다.",
  "도입은 검증된 당일 장면·숫자 또는 독자의 검색 질문에서 시작합니다. 관찰한 사실, 그 사실에 대한 해석, 판단이 달라지는 조건을 연결합니다.",
  "소제목은 내용에 맞게 2~5개를 직접 짓습니다. 기존 bodyStructure는 빠뜨릴 내용의 참고용이지 공개 제목 목록이 아닙니다. 30초 요약·변수 1/2·오늘의 초보자 설명·BG Market Note 판단을 매번 그대로 제목으로 쓰지 않습니다. 번호도 강제하지 않습니다.",
  "같은 결론을 도입·본문·끝에서 바꿔 말하며 반복하지 않습니다. 새로운 근거·예외·해석이 없는 문단은 합치거나 삭제합니다. 분량을 채우기 위한 반복 설명은 금지합니다.",
  "문단 길이는 설명에 필요한 만큼 정합니다. 짧은 판단은 한 문장으로 끝내도 됩니다. 모든 문단을 같은 문장 수로 맞추거나 무작위로 문단 길이를 바꾸지 않습니다.",
  "초보자에게 필요한 개념은 해당 숫자를 설명하는 자리에서 풀고, 확인 항목과 조건은 관련 문단에 자연스럽게 연결합니다. 별도 강의·정형 체크리스트를 억지로 만들지 않습니다.",
  "보려 합니다·확인하고 싶습니다·궁금합니다만 반복하지 말고 제공된 자료로 어떤 판단을 할 수 있는지 씁니다. 없는 종목별 사례, 개인 매매, 수익, 경험, 감정은 지어내지 않습니다.",
  "출처는 실제 기사 제목과 원문 URL의 연결을 보존합니다. 공개 화면에서는 제목에 원문 링크를 걸고 기사끼리 빈 줄 없이 한 줄씩 연속 배치하며, 투자 유의문구 앞에서만 한 줄 띄웁니다.",
  "제출 전 의미 반복·문단 리듬·번역투·상투적 구성·판단의 구체성 다섯 항목을 자체 검토하고 수정합니다. AI 느낌 점수를 객관적인 탐지 결과처럼 쓰거나 목표 점수에 맞춰 임의로 낮추지 않습니다.",
] as const;

const SOURCE_HEADING = /^(?:함께 확인한 기사|참고한 기사와 자료|기사[·\s]*자료)$/;
const OLD_SUMMARY = /^\s*(?:#{1,6}\s*)?\d+\.\s*(?:30초\s*요약|.*핵심\s*변수\s*2가지|BG\s*Market\s*Note\s*(?:의\s*)?판단)\s*$/im;

export function inspectNaturalStockBlogLayout(body: string) {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const sourceAt = lines.findIndex(line => SOURCE_HEADING.test(line.replace(/^#{1,6}\s*/, "").trim()));
  const content = (sourceAt < 0 ? lines : lines.slice(0, sourceAt)).join("\n");
  const headings = content.split("\n").flatMap((line, index, all) => {
    const text = line.trim().replace(/^#{1,6}\s*/, "");
    if (!text || text === "마무리" || text.length > 72 || /^[-*•]|^https?:\/\//.test(text)) return [];
    if (/^#{2,4}\s/.test(line.trim())) return [text];
    if (/^\d+\.\s/.test(text)) return [text];
    if (index > 0 && !all[index - 1].trim() && index + 1 < all.length && !all[index + 1].trim()
      && !/[.!。]$|(?:니다|어요|아요|죠|겁니다)[.?]?$/.test(text) && text.length >= 6) return [text];
    return [];
  });
  const paragraphs = content.split(/\n{2,}/).map(p => p.trim())
    .filter(p => p && p !== "마무리" && !headings.includes(p.replace(/^#{1,6}\s*/, "")));
  const prose = paragraphs.join("\n\n");
  const numericFacts = [...new Set(prose.match(/\d[\d,.]*(?:\s*(?:%|%p|bp|조\s*원|억\s*원|원|달러|포인트|배|만\s*명|건))/g) ?? [])];
  const conditionalSentences = prose.split(/(?<=[.!?。])\s+|\n+/).filter(p => /다면|으면|경우|조건|때는/.test(p));
  const explanationSentences = prose.split(/(?<=[.!?。])\s+|\n+/).filter(p => /때문|이유|뜻|의미|말합니다|계산|차이|달라|다릅/.test(p));
  const observationSentences = prose.split(/(?<=[.!?。])\s+|\n+/).filter(p => /확인|비교|살펴|보겠|볼\s|판단/.test(p));
  return {
    active: !OLD_SUMMARY.test(content),
    headingCount: headings.length,
    headings,
    paragraphCount: paragraphs.length,
    openingLength: paragraphs[0]?.length ?? 0,
    numericFactCount: numericFacts.length,
    conditionalSentenceCount: conditionalSentences.length,
    explanationSentenceCount: explanationSentences.length,
    observationSentenceCount: observationSentences.length,
    hasJudgment: /봅니다|보겠습니다|보겠|읽지는|판단|해석|중요한\s*것|우선|더\s*궁금/.test(prose),
  };
}
