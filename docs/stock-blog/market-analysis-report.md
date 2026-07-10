# Market Analysis Report

`MarketAnalysisReport`는 실제 주식 API 연결 전에도 동일한 구조로 시장 브리핑을 만들기 위한 내부 표준 리포트다.

## 주요 필드

- contentType: 브리핑 종류
- title: 리포트 제목
- marketSummary: 시장 요약
- indexAndSectorFlow: 지수/섹터 흐름
- keyPoints: 주목 포인트
- investorChecklist: 투자자 체크리스트
- riskNotes: 리스크/주의사항
- sourceMode: mock, manual, api

## 현재 사용 방식

`buildMarketAnalysisReportFromMockContext(input)`으로 mock/manual 기반 보고서를 만든다. 실제 API 연결 전에는 외부 데이터를 호출하지 않는다.

## 향후 확장

- KRX/미국 지수 데이터
- 환율/금리/유가 데이터
- 경제 일정/실적 일정
- 뉴스 출처 및 링크 번들
