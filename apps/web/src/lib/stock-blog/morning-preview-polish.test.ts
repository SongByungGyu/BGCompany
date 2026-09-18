import assert from "node:assert/strict";
import test from "node:test";
import { polishKoreaDailyPreviewWriterResult } from "./morning-preview-polish.ts";

test("아침 글의 반복 요약과 여분의 장중 확인 문장을 제거한다", () => {
  const result = polishKoreaDailyPreviewWriterResult({
    introduction: "미국 지수는 올랐습니다.\n오늘 코스피 전망을 낙관이나 경계 한쪽으로만 정하기 어렵습니다.",
    sections: [
      {
        heading: "전일 코스피 복기",
        body: "코스피는 0.04% 내렸습니다.\n오늘 흐름을 볼 때 외국인 매매 방향을 따로 확인해야 하는 배경입니다.",
      },
      {
        heading: "미국 증시와 금리",
        body: "나스닥은 올랐습니다.\n오늘 한국 증시에는 기대와 부담이 동시에 들어와 있습니다.",
      },
      {
        heading: "환율과 외국인 흐름",
        body: "환율이 진정되면 부담이 줄 수 있습니다.\n장 시작 전에는 환율을 보고 장중에는 외국인 매매를 봅니다.",
      },
    ],
    conclusion: "코스피와 코스닥은 엇갈렸습니다.\n두 지수가 같은 강도로 움직인다고 정하기 어렵습니다.\n둘의 차이를 함께 봅니다.",
  });

  assert.equal(result.introduction, "미국 지수는 올랐습니다.");
  assert.deepEqual(result.sections, [
    { heading: "전일 코스피 복기", body: "코스피는 0.04% 내렸습니다." },
    { heading: "미국 증시와 금리", body: "나스닥은 올랐습니다." },
    { heading: "환율과 외국인 흐름", body: "환율이 진정되면 부담이 줄 수 있습니다." },
  ]);
  assert.equal(result.conclusion, "코스피와 코스닥은 엇갈렸습니다.\n두 지수가 같은 강도로 움직인다고 정하기 어렵습니다.");
});
