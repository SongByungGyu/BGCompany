import type {
  DividendStatus,
  PortfolioAssetType,
  PortfolioCurrency,
  PortfolioMarket,
} from "./portfolio-types";

export type PortfolioDividendProfile = {
  dividendType: "quarterly" | "monthly" | "weekly" | "irregular" | "none";
  amountPerShare: string | null;
  currency: PortfolioCurrency;
  exDividendDate: string | null;
  recordDate: string | null;
  paymentDate: string | null;
  status: DividendStatus;
  sourceName: string;
  sourceUrl: string;
  dataQuality: "official_confirmed" | "official_recent_annualized" | "official_unavailable";
};

export type PortfolioHoldingProfile = {
  market: PortfolioMarket;
  symbol: string;
  name: string;
  assetType: PortfolioAssetType;
  sector: string;
  analysis: string;
  dividend: PortfolioDividendProfile;
};

const profiles: PortfolioHoldingProfile[] = [
  {
    market: "US", symbol: "ARKX", name: "ARK Space & Defense Innovation ETF", assetType: "ETF",
    sector: "우주·방산 테마 ETF",
    analysis: "우주·방산 혁신기업에 투자하는 액티브 테마 ETF. 테마 집중도와 중소형 성장주 변동성을 함께 확인해야 합니다.",
    dividend: {
      dividendType: "irregular", amountPerShare: null, currency: "USD", exDividendDate: null,
      recordDate: null, paymentDate: null, status: "unavailable", sourceName: "ARK Invest 공식 펀드 페이지",
      sourceUrl: "https://www.ark-funds.com/funds/arkx", dataQuality: "official_unavailable",
    },
  },
  {
    market: "US", symbol: "GOOGL", name: "Alphabet Class A", assetType: "stock",
    sector: "커뮤니케이션 서비스·인터넷",
    analysis: "검색·광고, YouTube, Google Cloud가 핵심. AI 인프라 투자 확대에 따른 성장과 자본지출·규제 위험을 함께 봐야 합니다.",
    dividend: {
      dividendType: "quarterly", amountPerShare: "0.22", currency: "USD", exDividendDate: "2026-06-08",
      recordDate: "2026-06-08", paymentDate: "2026-06-15", status: "confirmed", sourceName: "Alphabet 2026 Q1 공식 실적자료",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/1652044/000165204426000043/googexhibit991q12026.htm",
      dataQuality: "official_confirmed",
    },
  },
  {
    market: "US", symbol: "INTC", name: "Intel", assetType: "stock",
    sector: "정보기술·반도체",
    analysis: "CPU·파운드리 전환이 핵심. 대규모 설비투자, 공정 실행력과 현금흐름 회복 여부가 주요 위험이며 배당은 중단 상태입니다.",
    dividend: {
      dividendType: "none", amountPerShare: null, currency: "USD", exDividendDate: null,
      recordDate: null, paymentDate: null, status: "unavailable", sourceName: "Intel 2024 Form 10-K",
      sourceUrl: "https://www.intc.com/filings-reports/all-sec-filings/content/0000050863-25-000009/intc-20241228.htm",
      dataQuality: "official_unavailable",
    },
  },
  {
    market: "US", symbol: "KORU", name: "Direxion Daily MSCI South Korea Bull 3X ETF", assetType: "ETF",
    sector: "한국 주식 3배 레버리지 ETF",
    analysis: "MSCI Korea 지수의 하루 수익률 3배를 목표로 하는 단기 상품. 일일 재설정과 변동성 복리 효과로 장기 수익률이 3배와 크게 달라질 수 있습니다.",
    dividend: {
      dividendType: "quarterly", amountPerShare: "0.11402", currency: "USD", exDividendDate: "2026-03-24",
      recordDate: "2026-03-24", paymentDate: "2026-03-31", status: "estimated", sourceName: "Direxion KORU 공식 페이지",
      sourceUrl: "https://www.direxion.com/product/daily-msci-south-korea-bull-3x-etf",
      dataQuality: "official_recent_annualized",
    },
  },
  {
    market: "US", symbol: "MSFT", name: "Microsoft", assetType: "stock",
    sector: "정보기술·소프트웨어",
    analysis: "Azure·Microsoft 365·AI 플랫폼이 핵심. 클라우드 성장과 AI 투자 회수 속도, 높은 기대 밸류에이션을 함께 확인해야 합니다.",
    dividend: {
      dividendType: "quarterly", amountPerShare: "0.91", currency: "USD", exDividendDate: "2026-08-20",
      recordDate: "2026-08-20", paymentDate: "2026-09-10", status: "confirmed", sourceName: "Microsoft 공식 배당 발표",
      sourceUrl: "https://news.microsoft.com/source/2026/06/10/microsoft-announces-quarterly-dividend-29/",
      dataQuality: "official_confirmed",
    },
  },
  {
    market: "US", symbol: "QLD", name: "ProShares Ultra QQQ", assetType: "ETF",
    sector: "나스닥100 2배 레버리지 ETF",
    analysis: "Nasdaq-100의 하루 수익률 2배를 목표로 하는 상품. 기술주 집중, 일일 재설정과 변동성 손실 위험을 지속 확인해야 합니다.",
    dividend: {
      dividendType: "quarterly", amountPerShare: null, currency: "USD", exDividendDate: null,
      recordDate: null, paymentDate: null, status: "unavailable", sourceName: "ProShares QLD 공식 페이지",
      sourceUrl: "https://www.proshares.com/our-etfs/leveraged-and-inverse/qld", dataQuality: "official_unavailable",
    },
  },
  {
    market: "US", symbol: "QQQI", name: "NEOS Nasdaq-100 High Income ETF", assetType: "ETF",
    sector: "나스닥100 옵션 인컴 ETF",
    analysis: "Nasdaq-100 주식과 콜옵션 전략으로 월 분배를 추구합니다. 분배금에 옵션수익·자본환급이 포함될 수 있고 상승 참여가 제한될 수 있습니다.",
    dividend: {
      dividendType: "monthly", amountPerShare: "0.6346", currency: "USD", exDividendDate: "2026-07-22",
      recordDate: "2026-07-22", paymentDate: "2026-07-24", status: "estimated", sourceName: "NEOS QQQI 공식 분배내역",
      sourceUrl: "https://neosfunds.com/qqqi/", dataQuality: "official_recent_annualized",
    },
  },
  {
    market: "US", symbol: "RAM", name: "T-REX 2X Long DRAM Daily Target ETF", assetType: "ETF",
    sector: "메모리 반도체 2배 레버리지 ETF",
    analysis: "DRAM ETF의 하루 수익률 2배를 스왑으로 추종하는 신생 단기 상품. 일일 재설정, 짧은 운용 이력과 전액 손실 가능성을 특별 관리해야 합니다.",
    dividend: {
      dividendType: "none", amountPerShare: null, currency: "USD", exDividendDate: null,
      recordDate: null, paymentDate: null, status: "unavailable", sourceName: "REX Shares RAM 공식 페이지",
      sourceUrl: "https://www.rexshares.com/ram/", dataQuality: "official_unavailable",
    },
  },
  {
    market: "US", symbol: "SLDP", name: "Solid Power", assetType: "stock",
    sector: "산업재·전고체 배터리",
    analysis: "전고체 배터리 소재·셀 기술 개발 단계 기업. 상용화 일정, 기술 검증, 현금소진과 추가 자금조달 위험이 핵심이며 정기 배당은 확인되지 않습니다.",
    dividend: {
      dividendType: "none", amountPerShare: null, currency: "USD", exDividendDate: null,
      recordDate: null, paymentDate: null, status: "unavailable", sourceName: "Solid Power 2025 Form 10-K",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/1844862/000110465926019435/sldp-20251231x10k.htm",
      dataQuality: "official_unavailable",
    },
  },
  {
    market: "US", symbol: "SOXL", name: "Direxion Daily Semiconductor Bull 3X ETF", assetType: "ETF",
    sector: "반도체 3배 레버리지 ETF",
    analysis: "미국 반도체 지수의 하루 수익률 3배를 목표로 합니다. 반도체 업황 집중과 일일 재설정·변동성 복리 손실 위험이 매우 큽니다.",
    dividend: {
      dividendType: "irregular", amountPerShare: null, currency: "USD", exDividendDate: null,
      recordDate: null, paymentDate: null, status: "unavailable", sourceName: "Direxion SOXL 공식 페이지",
      sourceUrl: "https://www.direxion.com/product/daily-semiconductor-bull-bear-3x-etfs",
      dataQuality: "official_unavailable",
    },
  },
  {
    market: "US", symbol: "SSO", name: "ProShares Ultra S&P500", assetType: "ETF",
    sector: "S&P500 2배 레버리지 ETF",
    analysis: "S&P 500의 하루 수익률 2배를 목표로 합니다. 광범위 지수지만 일일 재설정과 변동성 복리로 장기 추적 오차가 커질 수 있습니다.",
    dividend: {
      dividendType: "quarterly", amountPerShare: null, currency: "USD", exDividendDate: null,
      recordDate: null, paymentDate: null, status: "unavailable", sourceName: "ProShares SSO 공식 페이지",
      sourceUrl: "https://www.proshares.com/our-etfs/leveraged-and-inverse/sso", dataQuality: "official_unavailable",
    },
  },
  {
    market: "US", symbol: "ULTY", name: "YieldMax Ultra Option Income Strategy ETF", assetType: "ETF",
    sector: "멀티종목 옵션 인컴 ETF",
    analysis: "고변동성 종목의 옵션전략으로 주간 분배를 추구합니다. 분배금 변동, 자본환급 가능성, 상승 제한과 기초자산 하락 위험을 함께 봐야 합니다.",
    dividend: {
      dividendType: "weekly", amountPerShare: "0.3176", currency: "USD", exDividendDate: "2026-07-22",
      recordDate: "2026-07-22", paymentDate: "2026-07-23", status: "estimated", sourceName: "YieldMax ULTY 공식 분배내역",
      sourceUrl: "https://yieldmaxetfs.com/our-etfs/ulty/", dataQuality: "official_recent_annualized",
    },
  },
];

const profileByKey = new Map(profiles.map((profile) => [`${profile.market}:${profile.symbol}`, profile]));

export function getPortfolioHoldingProfile(market: PortfolioMarket, symbol: string) {
  return profileByKey.get(`${market}:${symbol.toUpperCase()}`) ?? null;
}

export function getPortfolioHoldingProfiles() {
  return profiles;
}

export function dividendFrequencyMultiplier(dividendType: string) {
  if (dividendType === "weekly") return 52;
  if (dividendType === "monthly") return 12;
  if (dividendType === "quarterly") return 4;
  return 1;
}
