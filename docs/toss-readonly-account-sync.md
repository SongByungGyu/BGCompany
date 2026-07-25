# 토스증권 공식 Open API 읽기 전용 계좌 연동

## 허용 범위

- `POST /oauth2/token`: client credentials 토큰 발급
- `GET /api/v1/accounts`: 종합매매 계좌 식별
- `GET /api/v1/holdings`: 보유 주식 조회

주문, 정정, 취소, 이체 API는 호출 허용 목록에 없으며 UI와 서버 서비스에도 구현하지 않는다.
토스증권에서 반환된 전체 계좌번호는 메모리에서 계좌 선택과 해시 생성에만 사용하고 로그, 브라우저,
데이터베이스에 저장하지 않는다.

## 운영 설정

```env
PORTFOLIO_MONITORING_ENABLED=true
PORTFOLIO_ACCOUNT_SYNC_ENABLED=true
PORTFOLIO_ACCOUNT_SYNC_PROVIDER=toss
TOSSINVEST_CLIENT_ID=
TOSSINVEST_CLIENT_SECRET=
TOSSINVEST_ACCOUNT_SEQ=
TOSSINVEST_ACCOUNT_LABEL=토스증권 실계좌
```

토스증권 WTS Open API 설정의 허용 IP에 운영 서버의 고정 공인 IP를 등록해야 한다.
종합매매 계좌가 하나면 `TOSSINVEST_ACCOUNT_SEQ`는 비워도 된다. 여러 개면 공식 계좌 목록에서
확인한 `accountSeq`만 지정한다.

## 미래에셋 계좌

개인 계좌 잔고를 조회할 수 있는 미래에셋의 공식 공개 API는 현재 프로젝트에서 검증하지 못했다.
따라서 로그인 자동화나 화면 스크래핑은 사용하지 않는다. 미래에셋 앱 또는 HTS에서 직접 내려받은
잔고 자료를 대시보드의 CSV 가져오기로 반영한다.

현재 CSV 표준 열은 다음과 같다.

```csv
market,symbol,name,assetType,quantity,averagePrice,currency,sector,note,dividendTrackingEnabled
KR,005930,삼성전자,stock,10,70000,KRW,반도체,미래에셋 잔고,true
```

증권사 원본 CSV의 열 구성이 다르면 계좌번호와 주민등록정보를 제거한 샘플 헤더만 확인한 뒤
별도 변환기를 추가한다.
