export type StockBlogImageRole = "thumbnail" | "body";
export type StockBlogImageType = "thumbnail" | "chart" | "related-image";
export type StockBlogImageLicenseType = "generated" | "generated-data-chart" | "external-commercial";

export type StockBlogImageDataPoint = {
  key: string;
  label: string;
  value: number;
  unit: string;
  asOf: string;
};

export type StockBlogContentImage = {
  id: string;
  role: StockBlogImageRole;
  type: StockBlogImageType;
  title: string;
  placementAfterHeading: string;
  imageUrl: string;
  caption: string;
  sourceLabel: string;
  sourceName: string;
  sourceUrl?: string;
  relevanceTags?: string[];
  licenseType: StockBlogImageLicenseType;
  collectedAt: string;
  usageAllowed: boolean;
  dataKeys: string[];
  dataPoints: StockBlogImageDataPoint[];
  width: number;
  height: number;
  fileFormat: "image/svg+xml" | "image/png" | "image/jpeg";
  uploadFormat: "image/png" | "image/jpeg";
  fileVerified: boolean;
};

export type StockBlogImageQualityIssueCode =
  | "image_data_mismatch"
  | "image_not_relevant"
  | "image_license_unknown"
  | "image_file_missing"
  | "image_upload_failed"
  | "image_quality_failed";

export type StockBlogImageQualityAudit = {
  status: "passed" | "blocked";
  checkedAt: string;
  bodyImageCount: number;
  chartImageCount: number;
  relatedImageCount: number;
  generatedImageCount: number;
  externalImageCount: number;
  checks: string[];
  issues: Array<{ code: StockBlogImageQualityIssueCode; message: string }>;
};
