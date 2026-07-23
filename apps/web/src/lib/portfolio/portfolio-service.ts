import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  allocationBy,
  annualDividend,
  applyPortfolioWeights,
  calculateHolding,
  decimal,
  dedupeNews,
  evaluatePortfolioRisks,
  percent,
  type CalculatedHolding,
  type CalculationQuote,
} from "./portfolio-calculations";
import { portfolioConfig, PORTFOLIO_TEAM } from "./portfolio-config";
import { getPortfolioPriceProvider } from "./portfolio-price-provider";
import { ruleBasedPortfolioReportWriter } from "./portfolio-report-writer";
import type {
  DividendStatus,
  FreshnessStatus,
  PortfolioAccountDto,
  PortfolioCurrency,
  PortfolioDashboard,
  PortfolioHoldingDto,
  PortfolioMarket,
  PortfolioNewsDto,
  PortfolioPriceDto,
  PortfolioRiskDto,
} from "./portfolio-types";
import { searchNaverNewsReferences } from "@/lib/stock-blog/references/naver-search-reference-adapter";

const ZERO = new Prisma.Decimal(0);
const refreshWindows = new Map<string, number[]>();

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function accountDto(account: {
  id: string; name: string; baseCurrency: string; description: string | null; isActive: boolean; createdAt: Date; updatedAt: Date;
}): PortfolioAccountDto {
  return {
    ...account,
    baseCurrency: account.baseCurrency as PortfolioCurrency,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

function holdingDto(holding: {
  id: string; portfolioAccountId: string; market: string; symbol: string; name: string; assetType: string;
  quantity: Prisma.Decimal; averagePrice: Prisma.Decimal; currency: string; sector: string; note: string | null;
  dividendTrackingEnabled: boolean; isActive: boolean; createdAt: Date; updatedAt: Date;
}): PortfolioHoldingDto {
  return {
    ...holding,
    market: holding.market as PortfolioMarket,
    assetType: holding.assetType as PortfolioHoldingDto["assetType"],
    quantity: holding.quantity.toString(),
    averagePrice: holding.averagePrice.toString(),
    currency: holding.currency as PortfolioCurrency,
    createdAt: holding.createdAt.toISOString(),
    updatedAt: holding.updatedAt.toISOString(),
  };
}

function unavailablePrice(holding: PortfolioHoldingDto): PortfolioPriceDto {
  return {
    symbol: holding.symbol,
    market: holding.market,
    currentPrice: null,
    currency: holding.currency,
    change: null,
    changePercent: null,
    weeklyChangePercent: null,
    observedAt: null,
    collectedAt: null,
    sourceName: "시세 미확인",
    sourceUrl: null,
    freshnessStatus: "unavailable",
  };
}

function currentFreshness(stored: string, observedAt: Date): FreshnessStatus {
  if (stored === "unavailable") return "unavailable";
  const ageMinutes = Math.max(0, (Date.now() - observedAt.getTime()) / 60_000);
  const freshMinutes = portfolioConfig().priceCacheMinutes;
  if (ageMinutes <= freshMinutes) return stored === "stale" ? "stale" : "fresh";
  if (ageMinutes <= Math.max(freshMinutes * 4, 60)) return stored === "stale" ? "stale" : "delayed";
  return "stale";
}

function priceDto(snapshot: {
  market: string; symbol: string; price: Prisma.Decimal; currency: string; change: Prisma.Decimal | null;
  changePercent: Prisma.Decimal | null; weeklyChangePercent: Prisma.Decimal | null; observedAt: Date; collectedAt: Date;
  provider: string; sourceUrl: string | null; freshnessStatus: string;
}): PortfolioPriceDto {
  return {
    market: snapshot.market as PortfolioMarket,
    symbol: snapshot.symbol,
    currentPrice: snapshot.price.toString(),
    currency: snapshot.currency as PortfolioCurrency,
    change: snapshot.change?.toString() ?? null,
    changePercent: snapshot.changePercent?.toString() ?? null,
    weeklyChangePercent: snapshot.weeklyChangePercent?.toString() ?? null,
    observedAt: snapshot.observedAt.toISOString(),
    collectedAt: snapshot.collectedAt.toISOString(),
    sourceName: snapshot.provider,
    sourceUrl: snapshot.sourceUrl,
    freshnessStatus: currentFreshness(snapshot.freshnessStatus, snapshot.observedAt),
  };
}

function riskId(type: string, holdingId: string | null, index: number) {
  return `calculated:${type}:${holdingId ?? "portfolio"}:${index}`;
}

function allocationDto(values: CalculatedHolding[], keyOf: (value: CalculatedHolding) => string) {
  return allocationBy(values, keyOf).map((item) => ({
    key: item.key,
    label: item.key,
    value: item.value.toString(),
    weightPercent: item.weightPercent.toString(),
  }));
}

function reportBriefing(
  totalMarketValue: Prisma.Decimal,
  totalProfitLoss: Prisma.Decimal,
  risks: Array<{ severity: string; title: string }>,
  dividends: Array<{ exDividendDate: Date | null; paymentDate: Date | null }>,
  dataQuality: string,
) {
  if (totalMarketValue.isZero()) return "활성 보유 종목과 확인 가능한 시세를 등록하면 포트폴리오 브리핑을 생성합니다.";
  const direction = totalProfitLoss.isPositive() ? "원가보다 높은" : totalProfitLoss.isNegative() ? "원가보다 낮은" : "원가와 같은";
  const highRisks = risks.filter((risk) => risk.severity === "high").map((risk) => risk.title);
  const upcoming = dividends.filter((event) => {
    const date = event.exDividendDate ?? event.paymentDate;
    if (!date) return false;
    const days = (date.getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 14;
  }).length;
  return `현재 전체 평가금액은 총 원가보다 ${direction} 상태입니다. ${highRisks.length ? `우선 확인할 고위험 신호는 ${highRisks.slice(0, 2).join(", ")}입니다.` : "고위험 집중 신호는 감지되지 않았습니다."} 향후 14일 내 확인할 배당 일정은 ${upcoming}건입니다. 데이터 품질은 ${dataQuality === "verified" ? "검증 가능" : "잠정"} 상태이며 매수·매도 판단이 아닌 확인 자료입니다.`;
}

async function latestPrices(holdings: PortfolioHoldingDto[]) {
  const entries = await Promise.all(holdings.map(async (holding) => {
    const snapshot = await prisma.portfolioPriceSnapshot.findFirst({
      where: { market: holding.market, symbol: holding.symbol },
      orderBy: { collectedAt: "desc" },
    });
    return [`${holding.market}:${holding.symbol}`, snapshot ? priceDto(snapshot) : unavailablePrice(holding)] as const;
  }));
  return new Map(entries);
}

async function latestExchangeRate() {
  const snapshot = await prisma.portfolioPriceSnapshot.findFirst({
    where: { market: "FX", symbol: "USD/KRW" },
    orderBy: { collectedAt: "desc" },
  });
  return snapshot ? {
    value: snapshot.price,
    freshnessStatus: currentFreshness(snapshot.freshnessStatus, snapshot.observedAt),
    observedAt: snapshot.observedAt,
    sourceName: snapshot.provider,
  } : null;
}

function newsRiskCategory(title: string) {
  const rules: Array<[RegExp, string]> = [
    [/상장폐지|거래정지|증자|감자/i, "capital_or_listing"],
    [/소송|검찰|조사|회계|감사/i, "legal_or_accounting"],
    [/규제|제재|과징금/i, "regulation"],
    [/실적|영업이익|매출|적자/i, "earnings"],
    [/배당|배당금|배당락/i, "dividend"],
  ];
  return rules.find(([pattern]) => pattern.test(title))?.[1] ?? null;
}

function sourceNameFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function collectPortfolioNews(holdings: PortfolioHoldingDto[]) {
  if (!portfolioConfig().newsEnabled) return;
  for (const holding of holdings) {
    const queries = [`${holding.name} ${holding.symbol}`, `${holding.name} 실적 배당 공시 소송 증자 규제`];
    const found = [];
    for (const query of queries) found.push(...await searchNaverNewsReferences(query, 5));
    const normalized = dedupeNews(found.map((item) => {
      const url = item.originallink ?? item.link ?? "";
      const title = (item.title ?? holding.name).replace(/<[^>]+>/g, "").trim();
      const publishedAt = item.pubDate ? new Date(item.pubDate) : null;
      return {
        url,
        title,
        sourceName: sourceNameFromUrl(url),
        publishedAt,
        riskCategory: newsRiskCategory(title),
      };
    }).filter((item) => item.url && item.sourceName && item.publishedAt && !Number.isNaN(item.publishedAt.getTime()))).slice(0, 5);
    for (const item of normalized) {
      await prisma.portfolioNewsReference.upsert({
        where: { url: item.url },
        update: {
          market: holding.market,
          symbol: holding.symbol,
          title: item.title,
          sourceName: item.sourceName,
          publishedAt: item.publishedAt!,
          summary: `${holding.name} 관련 ${item.riskCategory ?? "시장"} 참고자료입니다. 원문과 공식 공시를 확인하세요.`,
          riskCategory: item.riskCategory,
          relevanceScore: "0.8",
          collectedAt: new Date(),
        },
        create: {
          market: holding.market,
          symbol: holding.symbol,
          title: item.title,
          sourceName: item.sourceName,
          url: item.url,
          publishedAt: item.publishedAt!,
          summary: `${holding.name} 관련 ${item.riskCategory ?? "시장"} 참고자료입니다. 원문과 공식 공시를 확인하세요.`,
          riskCategory: item.riskCategory,
          relevanceScore: "0.8",
        },
      });
    }
  }
}

export async function getPortfolioDashboard(accountId?: string | null): Promise<PortfolioDashboard> {
  const accountsRaw = await prisma.portfolioAccount.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  const account = accountId ? accountsRaw.find((candidate) => candidate.id === accountId) ?? null : accountsRaw[0] ?? null;
  const accounts = accountsRaw.map(accountDto);
  const baseCurrency = (account?.baseCurrency ?? "KRW") as PortfolioCurrency;
  if (!account) {
    return {
      enabled: true,
      generatedAt: new Date().toISOString(),
      dataAsOf: null,
      account: null,
      accounts,
      holdings: [],
      summary: {
        baseCurrency,
        totalMarketValue: "0",
        totalCostBasis: "0",
        totalProfitLoss: "0",
        totalReturnPercent: "0",
        expectedAnnualDividend: "0",
        todayChangeAmount: null,
        exchangeRate: null,
        exchangeRateAsOf: null,
        exchangeRateSource: null,
        dataQuality: "unavailable",
        missingItems: ["활성 포트폴리오 계좌"],
      },
      allocations: { holdings: [], sectors: [], markets: [], currencies: [] },
      dividends: [],
      news: [],
      risks: [],
      reports: [],
      briefing: "계좌 그룹을 만든 뒤 보유 종목을 등록하세요. 실제 보유 종목은 자동으로 생성하지 않습니다.",
      team: PORTFOLIO_TEAM.map((member) => ({ ...member })),
    };
  }
  const holdingsRaw = await prisma.portfolioHolding.findMany({
    where: { portfolioAccountId: account.id, isActive: true },
    orderBy: [{ market: "asc" }, { name: "asc" }],
    take: portfolioConfig().maxSymbols,
  });
  const holdings = holdingsRaw.map(holdingDto);
  const prices = await latestPrices(holdings);
  const exchangeRate = await latestExchangeRate();
  const quotes = new Map<string, CalculationQuote>();
  const calculated = applyPortfolioWeights(holdings.map((holding) => {
    const price = prices.get(`${holding.market}:${holding.symbol}`) ?? unavailablePrice(holding);
    quotes.set(`${holding.market}:${holding.symbol}`, {
      price: price.currentPrice,
      changePercent: price.changePercent,
      weeklyChangePercent: price.weeklyChangePercent,
      freshnessStatus: price.freshnessStatus,
    });
    return calculateHolding(holding, quotes.get(`${holding.market}:${holding.symbol}`)!, baseCurrency, exchangeRate?.value ?? null);
  }));
  const dividendRows = holdings.length ? await prisma.dividendEvent.findMany({
    where: { OR: holdings.map((holding) => ({ market: holding.market, symbol: holding.symbol })) },
    orderBy: [{ exDividendDate: "asc" }, { paymentDate: "asc" }],
    take: Math.max(holdings.length * 5, 20),
  }) : [];
  const holdingBySymbol = new Map(holdings.map((holding) => [`${holding.market}:${holding.symbol}`, holding]));
  const latestDividendBySymbol = new Map<string, typeof dividendRows[number]>();
  for (const event of dividendRows) {
    const key = `${event.market}:${event.symbol}`;
    if (!latestDividendBySymbol.has(key)) latestDividendBySymbol.set(key, event);
  }
  const dividendDtos = dividendRows.map((event) => {
    const holding = holdingBySymbol.get(`${event.market}:${event.symbol}`);
    const expected = holding ? annualDividend(holding.quantity, event.amountPerShare, event.status as DividendStatus) : null;
    return {
      id: event.id,
      market: event.market as PortfolioMarket,
      symbol: event.symbol,
      name: holding?.name ?? event.symbol,
      exDividendDate: iso(event.exDividendDate),
      paymentDate: iso(event.paymentDate),
      expectedAmount: expected?.toString() ?? null,
      currency: event.currency as PortfolioCurrency,
      status: event.status as DividendStatus,
      sourceName: event.sourceName,
      sourceUrl: event.sourceUrl,
    };
  });
  const newsRows = portfolioConfig().newsEnabled && holdings.length ? await prisma.portfolioNewsReference.findMany({
    where: { OR: holdings.map((holding) => ({ market: holding.market, symbol: holding.symbol })) },
    orderBy: { publishedAt: "desc" },
    take: Math.max(holdings.length * 5, 20),
  }) : [];
  const newsCounts = new Map<string, number>();
  const news = newsRows.filter((item) => {
    const key = `${item.market}:${item.symbol}`;
    const count = newsCounts.get(key) ?? 0;
    if (count >= 5) return false;
    newsCounts.set(key, count + 1);
    return true;
  }).map<PortfolioNewsDto>((item) => ({
    id: item.id,
    market: item.market as PortfolioMarket,
    symbol: item.symbol,
    title: item.title,
    sourceName: item.sourceName,
    url: item.url,
    publishedAt: item.publishedAt.toISOString(),
    summary: item.summary,
    riskCategory: item.riskCategory,
    relevanceScore: item.relevanceScore?.toString() ?? null,
  }));
  const dividendUnavailableSymbols = new Set(holdings.filter((holding) => holding.dividendTrackingEnabled && !latestDividendBySymbol.has(`${holding.market}:${holding.symbol}`)).map((holding) => holding.symbol));
  const newsMissingSymbols = new Set(portfolioConfig().newsEnabled ? holdings.filter((holding) => !newsCounts.has(`${holding.market}:${holding.symbol}`)).map((holding) => holding.symbol) : []);
  const calculatedRisks = evaluatePortfolioRisks(calculated, quotes, {
    exchangeRateFreshness: holdings.some((holding) => holding.currency !== baseCurrency) ? exchangeRate?.freshnessStatus ?? "unavailable" : undefined,
    dividendUnavailableSymbols,
    newsMissingSymbols,
  });
  const eventNewsRisks = news.filter((item) => item.riskCategory && ["capital_or_listing", "legal_or_accounting", "regulation"].includes(item.riskCategory)).map((item) => ({
    holdingId: holdingBySymbol.get(`${item.market}:${item.symbol}`)?.id ?? null,
    type: `event_${item.riskCategory}`,
    severity: "warning" as const,
    title: `${item.symbol} 주요 이벤트 뉴스`,
    message: `"${item.title}" 관련 원문과 공식 공시를 확인할 필요가 있습니다.`,
  }));
  const combinedRisks = [...calculatedRisks, ...eventNewsRisks];
  const totalMarketValue = calculated.reduce((sum, item) => item.baseMarketValue ? sum.add(item.baseMarketValue) : sum, ZERO);
  const totalCostBasis = calculated.reduce((sum, item) => item.baseCostBasis ? sum.add(item.baseCostBasis) : sum, ZERO);
  const totalProfitLoss = totalMarketValue.sub(totalCostBasis);
  const totalReturnPercent = percent(totalProfitLoss, totalCostBasis);
  const expectedAnnualDividend = holdings.reduce((sum, holding) => {
    const event = latestDividendBySymbol.get(`${holding.market}:${holding.symbol}`);
    if (!event) return sum;
    const amount = annualDividend(holding.quantity, event.amountPerShare, event.status as DividendStatus);
    if (!amount) return sum;
    if (event.currency === baseCurrency) return sum.add(amount);
    if (event.currency === "USD" && baseCurrency === "KRW" && exchangeRate) return sum.add(amount.mul(exchangeRate.value));
    return sum;
  }, ZERO);
  const todayChangeAmount = calculated.reduce<Prisma.Decimal | null>((sum, item) => {
    const price = prices.get(`${item.holding.market}:${item.holding.symbol}`);
    if (!price?.change || !item.baseMarketValue || !price.currentPrice) return sum;
    const nativeChange = decimal(price.change).mul(decimal(item.holding.quantity));
    const baseChange = item.holding.currency === baseCurrency ? nativeChange : exchangeRate ? nativeChange.mul(exchangeRate.value) : null;
    return baseChange ? (sum ?? ZERO).add(baseChange) : sum;
  }, null);
  const missingItems = Array.from(new Set(calculated.flatMap((item) => item.missingItems)));
  if (holdings.some((holding) => holding.currency !== baseCurrency) && !exchangeRate) missingItems.push("USD/KRW 환율");
  const dataAsOf = Array.from(prices.values()).map((price) => price.observedAt).filter((value): value is string => Boolean(value)).sort().at(0) ?? null;
  const provisional = calculated.some((item) => item.provisional) || (exchangeRate && exchangeRate.freshnessStatus !== "fresh");
  const dataQuality = !holdings.length || calculated.every((item) => !item.baseMarketValue) ? "unavailable" : provisional ? "provisional" : "verified";
  const risks: PortfolioRiskDto[] = combinedRisks.map((risk, index) => ({
    id: riskId(risk.type, risk.holdingId, index),
    holdingId: risk.holdingId,
    type: risk.type,
    severity: risk.severity,
    title: risk.title,
    message: risk.message,
    detectedAt: new Date().toISOString(),
  }));
  const reports = await prisma.portfolioReport.findMany({
    where: { portfolioAccountId: account.id },
    orderBy: { reportDate: "desc" },
    take: 12,
  });
  const briefing = reportBriefing(totalMarketValue, totalProfitLoss, risks, dividendRows, dataQuality);
  return {
    enabled: true,
    generatedAt: new Date().toISOString(),
    dataAsOf,
    account: accountDto(account),
    accounts,
    holdings: calculated.map((item) => {
      const holding = holdings.find((candidate) => candidate.id === item.holding.id)!;
      const price = prices.get(`${holding.market}:${holding.symbol}`) ?? unavailablePrice(holding);
      const event = latestDividendBySymbol.get(`${holding.market}:${holding.symbol}`);
      const dividend = event ? annualDividend(holding.quantity, event.amountPerShare, event.status as DividendStatus) : null;
      return {
        holding,
        price,
        nativeMarketValue: item.nativeMarketValue?.toString() ?? null,
        nativeCostBasis: item.nativeCostBasis.toString(),
        nativeProfitLoss: item.nativeProfitLoss?.toString() ?? null,
        baseMarketValue: item.baseMarketValue?.toString() ?? null,
        baseCostBasis: item.baseCostBasis?.toString() ?? null,
        baseProfitLoss: item.baseProfitLoss?.toString() ?? null,
        returnPercent: item.returnPercent?.toString() ?? null,
        weightPercent: item.weightPercent?.toString() ?? null,
        expectedAnnualDividend: dividend?.toString() ?? null,
        dividendStatus: (event?.status ?? "unavailable") as DividendStatus,
        provisional: item.provisional,
        missingItems: item.missingItems,
      };
    }),
    summary: {
      baseCurrency,
      totalMarketValue: totalMarketValue.toString(),
      totalCostBasis: totalCostBasis.toString(),
      totalProfitLoss: totalProfitLoss.toString(),
      totalReturnPercent: totalReturnPercent.toString(),
      expectedAnnualDividend: expectedAnnualDividend.toString(),
      todayChangeAmount: todayChangeAmount?.toString() ?? null,
      exchangeRate: exchangeRate?.value.toString() ?? null,
      exchangeRateAsOf: iso(exchangeRate?.observedAt),
      exchangeRateSource: exchangeRate?.sourceName ?? null,
      dataQuality,
      missingItems,
    },
    allocations: {
      holdings: calculated.filter((item) => item.baseMarketValue).map((item) => ({
        key: item.holding.id,
        label: item.holding.name,
        value: item.baseMarketValue!.toString(),
        weightPercent: item.weightPercent?.toString() ?? "0",
      })).sort((left, right) => decimal(right.value).comparedTo(left.value)),
      sectors: allocationDto(calculated, (item) => item.holding.sector),
      markets: allocationDto(calculated, (item) => item.holding.market),
      currencies: allocationDto(calculated, (item) => item.holding.currency),
    },
    dividends: dividendDtos,
    news,
    risks,
    reports: reports.map((report) => ({
      id: report.id,
      reportType: report.reportType as PortfolioDashboard["reports"][number]["reportType"],
      reportDate: report.reportDate.toISOString(),
      summary: report.summary,
      body: report.body,
      dataQuality: report.dataQuality,
      status: report.status,
    })),
    briefing,
    team: PORTFOLIO_TEAM.map((member) => ({ ...member })),
  };
}

export function assertRefreshRateLimit(key: string, now = Date.now()) {
  const windowStart = now - 60_000;
  const attempts = (refreshWindows.get(key) ?? []).filter((time) => time >= windowStart);
  if (attempts.length >= 3) throw new Error("REFRESH_RATE_LIMITED");
  attempts.push(now);
  refreshWindows.set(key, attempts);
}

async function recordPortfolioTask(accountId: string, summary: string, dataQuality: string) {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: "stock-monitor" }, select: { id: true } });
    if (!employee) return;
    const now = new Date();
    const taskId = `portfolio-refresh-${now.getTime()}`;
    await prisma.task.create({
      data: {
        id: taskId,
        title: "포트폴리오 평가 및 위험 신호 갱신",
        description: `포트폴리오 ${accountId}의 조회 전용 모니터링 작업`,
        department: "주식팀",
        assignedEmployeeId: employee.id,
        status: "완료",
        progress: 100,
        startedAt: now,
        completedAt: now,
        model: "rules",
        currentStep: "portfolio-qa-auditor 검증 완료",
        recentOutput: summary,
        nextAction: dataQuality === "verified" ? "다음 수동 갱신 대기" : "누락·오래된 데이터 확인",
      },
    });
    await prisma.agentRun.create({
      data: {
        taskId,
        employeeId: employee.id,
        mode: "portfolio-monitoring-rules",
        status: "completed",
        triggerSource: "manual-refresh",
        startedAt: now,
        completedAt: now,
        resultSummary: summary,
        metadata: { accountId, dataQuality, readOnly: true },
      },
    });
  } catch {
    // Portfolio valuation remains usable even when the optional office activity bridge is unavailable.
  }
}

export async function refreshPortfolio(accountId?: string | null) {
  const account = accountId
    ? await prisma.portfolioAccount.findFirst({ where: { id: accountId, isActive: true } })
    : await prisma.portfolioAccount.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
  if (!account) throw new Error("활성 포트폴리오 계좌가 없습니다.");
  const holdings = await prisma.portfolioHolding.findMany({
    where: { portfolioAccountId: account.id, isActive: true },
    orderBy: { createdAt: "asc" },
    take: portfolioConfig().maxSymbols,
  });
  if (!holdings.length) return getPortfolioDashboard(account.id);
  const provider = getPortfolioPriceProvider();
  const cutoff = new Date(Date.now() - portfolioConfig().priceCacheMinutes * 60_000);
  const requests = [];
  for (const holding of holdings) {
    const cached = await prisma.portfolioPriceSnapshot.findFirst({
      where: { market: holding.market, symbol: holding.symbol, collectedAt: { gte: cutoff } },
      orderBy: { collectedAt: "desc" },
    });
    if (!cached) requests.push({
      market: holding.market as PortfolioMarket,
      symbol: holding.symbol,
      assetType: holding.assetType,
      currency: holding.currency as PortfolioCurrency,
    });
  }
  const quotes = await provider.getPrices(requests);
  for (const quote of quotes) {
    if (!quote.currentPrice || !quote.observedAt) continue;
    await prisma.portfolioPriceSnapshot.create({
      data: {
        market: quote.market,
        symbol: quote.symbol,
        price: quote.currentPrice,
        currency: quote.currency,
        change: quote.change,
        changePercent: quote.changePercent,
        weeklyChangePercent: quote.weeklyChangePercent,
        marketDate: new Date(quote.observedAt),
        observedAt: new Date(quote.observedAt),
        collectedAt: quote.collectedAt ? new Date(quote.collectedAt) : new Date(),
        provider: quote.sourceName,
        sourceUrl: quote.sourceUrl,
        freshnessStatus: quote.freshnessStatus,
      },
    });
  }
  if (holdings.some((holding) => holding.currency !== account.baseCurrency)) {
    const cachedFx = await prisma.portfolioPriceSnapshot.findFirst({
      where: { market: "FX", symbol: "USD/KRW", collectedAt: { gte: cutoff } },
      orderBy: { collectedAt: "desc" },
    });
    if (!cachedFx) {
      const fx = await provider.getUsdKrw();
      if (fx?.currentPrice && fx.observedAt) await prisma.portfolioPriceSnapshot.create({
        data: {
          market: "FX",
          symbol: "USD/KRW",
          price: fx.currentPrice,
          currency: "KRW",
          change: fx.change,
          changePercent: fx.changePercent,
          weeklyChangePercent: fx.weeklyChangePercent,
          marketDate: new Date(fx.observedAt),
          observedAt: new Date(fx.observedAt),
          collectedAt: fx.collectedAt ? new Date(fx.collectedAt) : new Date(),
          provider: fx.sourceName,
          sourceUrl: fx.sourceUrl,
          freshnessStatus: fx.freshnessStatus,
        },
      });
    }
  }
  await collectPortfolioNews(holdings.map(holdingDto));
  const dashboard = await getPortfolioDashboard(account.id);
  await prisma.portfolioValuationSnapshot.create({
    data: {
      portfolioAccountId: account.id,
      baseCurrency: dashboard.summary.baseCurrency,
      totalMarketValue: dashboard.summary.totalMarketValue,
      totalCostBasis: dashboard.summary.totalCostBasis,
      totalProfitLoss: dashboard.summary.totalProfitLoss,
      totalReturnPercent: dashboard.summary.totalReturnPercent,
      exchangeRate: dashboard.summary.exchangeRate,
      dataQuality: dashboard.summary.dataQuality,
      missingItems: dashboard.summary.missingItems,
    },
  });
  await prisma.portfolioRiskSignal.deleteMany({ where: { portfolioAccountId: account.id, resolvedAt: null } });
  if (dashboard.risks.length) await prisma.portfolioRiskSignal.createMany({
    data: dashboard.risks.map((risk) => ({
      portfolioAccountId: account.id,
      holdingId: risk.holdingId,
      type: risk.type,
      severity: risk.severity,
      title: risk.title,
      message: risk.message,
    })),
  });
  const generatedReports = await ruleBasedPortfolioReportWriter.generate(dashboard);
  await prisma.portfolioReport.createMany({
    data: generatedReports.map((report) => ({
      portfolioAccountId: account.id,
      reportType: report.reportType,
      reportDate: new Date(),
      summary: report.summary,
      body: report.body,
      dataQuality: report.dataQuality,
      status: report.status,
    })),
  });
  await recordPortfolioTask(account.id, dashboard.briefing, dashboard.summary.dataQuality);
  return getPortfolioDashboard(account.id);
}
