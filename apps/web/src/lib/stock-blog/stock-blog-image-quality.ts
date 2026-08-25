import type { MarketSnapshot } from "@/lib/stock-blog/references/reference-types";
import { isAllowedFredDegradedSnapshot } from "@/lib/stock-blog/references/fred-degraded-policy";
import { isAllowedKisSectorDegradedSnapshot } from "@/lib/stock-blog/references/kis-sector-degraded-policy";
import { isAllowedKisOverseasDegradedSnapshot } from "@/lib/stock-blog/references/kis-overseas-degraded-policy";
import type { StockBlogContentImage, StockBlogImageQualityAudit, StockBlogImageQualityIssueCode } from "@/lib/stock-blog/stock-blog-image-types";
import { hasMeaningfulInvestorFlowValues } from "@/lib/stock-blog/investor-flow-policy";

function resolveSnapshotValue(snapshot: MarketSnapshot, key: string): unknown {
  return key.split(".").reduce<unknown>((value, segment) => {
    if (Array.isArray(value)) return value[Number(segment)];
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[segment];
  }, snapshot);
}

function closeEnough(left: number, right: number) {
  return Math.abs(left - right) <= Math.max(0.0001, Math.abs(right) * 0.000001);
}

export function evaluateStockBlogImageQuality(images: StockBlogContentImage[], snapshot?: MarketSnapshot): StockBlogImageQualityAudit {
  const checkedAt = new Date().toISOString();
  const issues: Array<{ code: StockBlogImageQualityIssueCode; message: string }> = [];
  const bodyImages = images.filter((image) => image.role === "body");
  const charts = bodyImages.filter((image) => image.type === "chart");
  const relatedImages = bodyImages.filter((image) => image.type === "related-image");
  const generatedImages = images.filter((image) => image.licenseType === "generated" || image.licenseType === "generated-data-chart");
  const externalImages = images.filter((image) => image.licenseType === "external-commercial");

  if (bodyImages.length < 2 || bodyImages.length > 3) {
    issues.push({ code: "image_quality_failed", message: "본문 이미지는 핵심 차트·이미지 2~3장이어야 합니다." });
  }
  if (new Set(images.map((image) => image.imageUrl)).size !== images.length) {
    issues.push({ code: "image_quality_failed", message: "중복 이미지 URL이 있습니다." });
  }
  if (bodyImages.some((image) => !image.placementAfterHeading.trim() || !image.caption.trim() || !image.sourceLabel.trim())) {
    issues.push({ code: "image_not_relevant", message: "본문 이미지의 연결 섹션·설명·출처가 누락됐습니다." });
  }
  if (images.some((image) => !image.usageAllowed || !image.licenseType)) {
    issues.push({ code: "image_license_unknown", message: "사용 허가 또는 라이선스가 확인되지 않은 이미지가 있습니다." });
  }
  if (images.some((image) => !image.fileVerified || image.width < 1080 || image.height < 675)) {
    issues.push({ code: "image_file_missing", message: "이미지 파일 또는 모바일 가독성 규격을 확인하지 못했습니다." });
  }
  if (bodyImages.length > 0 && charts.length === 0 && relatedImages.length === bodyImages.length) {
    issues.push({ code: "image_quality_failed", message: "검증 수치가 있는데 본문 이미지가 모두 장식용 이미지입니다." });
  }

  if (charts.length > 0) {
    if (
      !snapshot
      || snapshot.status !== "ready"
      || (
        snapshot.dataQuality !== "verified"
        && !isAllowedFredDegradedSnapshot(snapshot)
        && !isAllowedKisSectorDegradedSnapshot(snapshot)
        && !isAllowedKisOverseasDegradedSnapshot(snapshot)
      )
      || snapshot.freshness?.status !== "fresh"
      || snapshot.fallbackUsed !== false
    ) {
      issues.push({ code: "image_data_mismatch", message: "차트에 사용할 검증된 최신 MarketSnapshot이 없습니다." });
    } else {
      for (const chart of charts) {
        if (chart.dataKeys.length === 0 || chart.dataPoints.length !== chart.dataKeys.length) {
          issues.push({ code: "image_data_mismatch", message: `${chart.title}: 차트 데이터 키가 완전하지 않습니다.` });
          continue;
        }
        if (
          chart.id === "kospi-investor-flow"
          && !hasMeaningfulInvestorFlowValues(chart.dataPoints.map((point) => point.value))
        ) {
          issues.push({ code: "image_quality_failed", message: `${chart.title}: 전부 0인 수급값은 유효한 비교 차트로 사용하지 않습니다.` });
        }
        if (chart.id === "major-index-change") {
          const domesticPoints = chart.dataPoints.filter((point) => point.label === "KOSPI" || point.label === "KOSDAQ");
          const currentMarketDate = snapshot.marketDate.replace(/-/g, "");
          const usesCurrentMarketDate = domesticPoints.some((point) => point.asOf.replace(/\D/g, "").slice(0, 8) === currentMarketDate);
          if (domesticPoints.length === 2 && domesticPoints.every((point) => point.value === 0) && usesCurrentMarketDate) {
            issues.push({ code: "image_quality_failed", message: `${chart.title}: 장 시작 전 당일 0% 지수값은 직전 거래일 확정값으로 교체해야 합니다.` });
          }
        }
        for (const point of chart.dataPoints) {
          const actual = resolveSnapshotValue(snapshot, point.key);
          if (typeof actual !== "number" || !closeEnough(actual, point.value)) {
            issues.push({ code: "image_data_mismatch", message: `${chart.title}: ${point.key} 값이 MarketSnapshot과 일치하지 않습니다.` });
          }
          if (!point.unit.trim() || !point.asOf.trim()) {
            issues.push({ code: "image_quality_failed", message: `${chart.title}: 단위 또는 기준일이 누락됐습니다.` });
          }
        }
      }
    }
  }

  return {
    status: issues.length === 0 ? "passed" : "blocked",
    checkedAt,
    bodyImageCount: bodyImages.length,
    chartImageCount: charts.length,
    relatedImageCount: relatedImages.length,
    generatedImageCount: generatedImages.length,
    externalImageCount: externalImages.length,
    checks: [
      "section_relevance",
      "market_snapshot_match",
      "title_axis_unit_asof",
      "license_and_usage",
      "mobile_dimensions",
      "duplicate_images",
      "file_access",
      "naver_upload_format",
    ],
    issues,
  };
}
