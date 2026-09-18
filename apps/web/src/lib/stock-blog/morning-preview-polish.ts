type WriterSection = {
  heading?: string;
  body?: string;
};

const BALANCED_SUMMARY_PATTERNS = [
  /(?:낙관|긍정|기대)[^.\n]{0,50}(?:경계|부담)[^.\n]{0,50}(?:한쪽|동시|함께|정하기|어렵)/,
  /(?:경계|부담)[^.\n]{0,50}(?:낙관|긍정|기대)[^.\n]{0,50}(?:한쪽|동시|함께|정하기|어렵)/,
  /기대와\s*부담[^.\n]{0,30}(?:동시|함께)/,
];

const FORWARD_LOOKING_REVIEW_PATTERNS = [
  /오늘[^.\n]{0,60}(?:외국인|환율|매매\s*방향)[^.\n]{0,60}(?:봐|확인|비교|배경)/,
];

const EXTRA_SCENARIO_PATTERNS = [
  /(?:장\s*시작\s*전|개장\s*직후|그\s*뒤에는|높게\s*출발|장중에는)/,
];

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sentences(paragraph: string) {
  return paragraph
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function removeMatchingSentences(value: string, patterns: readonly RegExp[]) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => sentences(paragraph).filter((sentence) => !patterns.some((pattern) => pattern.test(sentence))).join("\n"))
    .filter(Boolean)
    .join("\n\n");
}

function firstSentences(value: string, count: number) {
  return value
    .split(/\n{2,}/)
    .flatMap(sentences)
    .slice(0, count)
    .join("\n");
}

function normalizeSections(value: unknown): WriterSection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const heading = text(record.heading);
    const body = text(record.body);
    return heading || body ? [{ heading, body }] : [];
  });
}

export function polishKoreaDailyPreviewWriterResult(result: Record<string, unknown>) {
  const polished: Record<string, unknown> = { ...result };
  const introduction = text(result.introduction);
  if (introduction) polished.introduction = removeMatchingSentences(introduction, BALANCED_SUMMARY_PATTERNS);

  const sections = normalizeSections(result.sections);
  if (sections) {
    polished.sections = sections.map((section) => {
      const heading = text(section.heading);
      let body = removeMatchingSentences(text(section.body), BALANCED_SUMMARY_PATTERNS);
      if (/전일|어제/.test(heading)) {
        body = removeMatchingSentences(body, FORWARD_LOOKING_REVIEW_PATTERNS);
      }
      if (/환율/.test(heading) && /외국인/.test(heading)) {
        body = removeMatchingSentences(body, EXTRA_SCENARIO_PATTERNS);
      }
      return { heading, body };
    });
  }

  const conclusion = text(result.conclusion);
  if (conclusion) polished.conclusion = firstSentences(conclusion, 2);
  return polished;
}
