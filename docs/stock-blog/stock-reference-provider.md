# Stock Reference Provider

For the production Naver Search adapter, MarketSnapshot contract, strict Hermes preflight, and generated image policy, see `docs/stock-blog/real-reference-provider.md`.

BG Company 주식 블로그는 Hermes 실제 실행 전에 참고자료 묶음(`ReferenceBundle`)을 준비한다.
1차 운영 기준은 외부 크롤링/API 호출이 아니라 `manual` provider다. 운영자가 검증한 링크와 요약을 JSON으로 넣고, Hermes는 그 자료만 근거로 글을 작성한다.

## Provider

- `STOCK_REFERENCE_PROVIDER=mock`: 개발 기본값. Hermes 운영 결과로 인정하지 않는다.
- `STOCK_REFERENCE_PROVIDER=manual`: 운영자가 제공한 수동 참고자료 JSON을 사용한다.
- `STOCK_REFERENCE_PROVIDER=web` 또는 `naver-search`: 기존 Naver Search adapter 경로. 실제 API enable/key가 없으면 `real-disabled`로 처리된다.

## Manual JSON

`STOCK_REFERENCE_MANUAL_PATH=config/stock-references/manual-references.json` 또는 `STOCK_REFERENCE_MANUAL_JSON`으로 제공한다.

```json
{
  "bundles": [
    {
      "contentType": "KOREA_MARKET_CLOSE_US_PREVIEW",
      "marketDate": "2026-07-11",
      "references": [
        {
          "sourceType": "market_data",
          "reliability": "official",
          "title": "KOSPI/KOSDAQ 마감 데이터",
          "publisher": "KRX",
          "publishedAt": "2026-07-11",
          "url": "https://example.com/market-close",
          "summary": "지수 방향, 수급, 거래대금 등 핵심 마감 데이터 요약",
          "keywords": ["KOSPI", "KOSDAQ", "수급"]
        }
      ]
    }
  ]
}
```

## Hermes 운영 통과 기준

Hermes mode에서는 다음 조건을 통과해야 자동 승인/네이버 임시저장 단계로 갈 수 있다.

- 실제 참고자료 3개 이상
- 중복되지 않는 URL 3개 이상
- 서로 다른 발행처 2곳 이상
- 시장 데이터 또는 공식/신뢰 참고자료 1개 이상
- `mock` / `real-disabled` provider는 운영 결과로 인정하지 않음

## 금지

- 기사 문장/전문 복사 금지
- URL 없는 수치 단정 금지
- 매수·매도 추천 표현 금지
- Naver/Playwright 자동 게시 금지
