# Automatic MarketSnapshot

BG Company의 운영 `MarketSnapshot`은 사용자가 시장 수치를 입력하는 방식이 아니라 조회 전용 외부 API 조합으로 생성한다.

## Provider 구성

- Primary: 한국투자증권 Open API(KIS)
  - KOSPI/KOSDAQ 지수(오전 전망은 당일 장 시작 전 0% 행을 제외하고 직전 실제 거래일 확정값 사용)
  - 시장별 투자자 매매동향
  - 국내 업종 강세/약세 흐름
  - S&P 500, NASDAQ, Dow Jones
  - USD/KRW
- Macro: FRED
  - DGS2(미국 2년물 국채금리)
  - DGS10(미국 10년물 국채금리)
  - 향후 14일 경제지표 발표 일정
- Reference: Naver 뉴스/경쟁 블로그 검색

KIS 구현은 공식 `koreainvestment/open-trading-api` 샘플에 있는 조회 endpoint와 TR ID만 allowlist한다. 주문, 정정/취소, 잔고, 계좌, 포지션 API는 코드에 포함하지 않는다.

## 환경변수

```env
STOCK_MARKET_DATA_PROVIDER=kis-fred
STOCK_MARKET_DATA_ALLOW_MANUAL_FALLBACK=false
STOCK_MARKET_DATA_ALLOW_MANUAL_IN_HERMES=false

KIS_BASE_URL=https://openapi.koreainvestment.com:9443
KIS_APP_KEY=
KIS_APP_SECRET=
KIS_TIMEOUT_MS=10000
KIS_MAX_RETRIES=2
KIS_RETRY_BASE_DELAY_MS=500
KIS_MARKET_MAX_AGE_MINUTES=4320
KIS_SP500_CODE=SPX
KIS_NASDAQ_CODE=COMP
KIS_DOW_CODE=.DJI
KIS_USD_KRW_CODE=FX@KRW

FRED_API_KEY=
FRED_TIMEOUT_MS=10000
FRED_MAX_AGE_MINUTES=7200
FRED_US_2Y_SERIES_ID=DGS2
FRED_US_10Y_SERIES_ID=DGS10
```

자격증명은 운영 `.env`에만 저장하고 로그, UI, Git에 출력하지 않는다. KIS 계좌번호는 필요하지 않으며 설정하지 않는다.

KIS 조회에서 `429`, `500`, `502`, `503`, `504`가 발생하면 읽기 전용 요청만 최대 2회 지수 백오프로 재시도한다. 인증 실패, allowlist 위반, 잘못된 요청은 재시도하지 않는다. 모든 재시도가 실패하면 `needs_data`/`error`로 안전 중단하며 mock 또는 Manual 데이터로 대체하지 않는다.

## 표준 DTO와 freshness

각 지표는 다음 메타데이터를 포함한다.

- `provider`
- `sourceName`
- `url`
- `asOf`: 데이터 기준 시각
- `collectedAt`: BG Company 수집 시각
- `freshness`: `fresh | stale | expired | unknown`
- `ageMinutes`
- `maxAgeMinutes`

Snapshot은 모든 필수 지표가 존재하고 모든 source가 `fresh`일 때만 다음 상태가 된다.

```text
status=ready
dataQuality=verified
freshness.status=fresh
```

누락, 자격증명 오류, provider 장애, 오래된 자료가 있으면 `needs_credentials`, `needs_data`, `error` 중 하나로 반환한다. mock으로 대체하지 않는다.

## Hermes 품질 차단

운영 Hermes 실행 전 Quality Gate는 다음을 모두 요구한다.

- 실제 뉴스/URL/발행처 기준 충족
- 경쟁 블로그 기준 충족
- `MarketSnapshot.status=ready`
- `MarketSnapshot.dataQuality=verified`
- `MarketSnapshot.freshness.status=fresh`
- stale/expired source 0개
- 필수 시장 지표 누락 0개

하나라도 실패하면 Hermes 실행을 차단한다.

## Manual fallback

Manual Snapshot은 장애 대응용 비상 경로로만 유지한다.

- 기본 자동 fallback: 꺼짐
- 운영 Hermes 사용: 기본 차단
- 비상 사용 시에만 두 환경변수를 명시적으로 검토한다.

```env
STOCK_MARKET_DATA_ALLOW_MANUAL_FALLBACK=true
STOCK_MARKET_DATA_ALLOW_MANUAL_IN_HERMES=true
```

비상 모드에서도 source URL, 기준 시각, freshness가 없는 수동 데이터는 품질 검사를 통과하지 않는다.

## 운영 안전 원칙

- 주문/매매/잔고/계좌 API 금지
- mock fallback 금지
- provider 응답 전문 및 인증 header 로그 금지
- 실제 Hermes는 모든 Reference와 MarketSnapshot이 PASS한 뒤 사용자 승인으로 1회만 실행
- scheduler, auto approve, auto draft는 별도 승인 전까지 비활성 유지
