import test from "node:test";
import assert from "node:assert/strict";
import { validateJobImageManifest, type NaverDraftJob } from "./naver-writer.js";

function jobFixture(): NaverDraftJob {
  const body = "1. Market review\nBody\n\n2. Korea outlook\nBody";
  const baseImage = {
    type: "chart" as const,
    title: "Chart",
    caption: "Caption",
    sourceLabel: "As of date | Source",
    licenseType: "generated-data-chart",
    usageAllowed: true,
    dataKeys: ["korea.kospi.changePct"],
    width: 1200,
    height: 675,
    fileFormat: "image/svg+xml",
    uploadFormat: "image/png",
    fileVerified: true,
  };
  const contentImages = [
    { ...baseImage, id: "thumbnail", role: "thumbnail" as const, type: "thumbnail" as const, placementAfterHeading: "__thumbnail__", imageUrl: "/generated/stock-blog/p/thumbnail.svg", dataKeys: [] },
    { ...baseImage, id: "chart-1", role: "body" as const, placementAfterHeading: "1. Market review", imageUrl: "/generated/stock-blog/p/chart-1.svg" },
    { ...baseImage, id: "chart-2", role: "body" as const, placementAfterHeading: "2. Korea outlook", imageUrl: "/generated/stock-blog/p/chart-2.svg" },
  ];
  return {
    id: "job", title: "Title", body, markdownBody: null, htmlBody: null, tags: [], category: null,
    thumbnailText: null, thumbnailPrompt: null, thumbnailImageUrl: contentImages[0].imageUrl,
    inlineImageUrls: contentImages.slice(1).map((image) => image.imageUrl), contentImages,
    imageQuality: { status: "passed" }, allowImageUpload: true, allowPublish: true, disclaimer: null,
  };
}

test("validated chart manifest preserves body image order and placements", () => {
  const result = validateJobImageManifest(jobFixture());
  assert.equal(result.ok, true);
  assert.deepEqual(result.bodyImages.map((image) => image.id), ["chart-1", "chart-2"]);
});

test("manifest blocks decorative-only or misplaced body images", () => {
  const job = jobFixture();
  job.body = "1. Market review\nBody";
  job.contentImages = [{
    id: "card", role: "body", type: "related-image", title: "Card", placementAfterHeading: "Missing heading",
    imageUrl: "/generated/stock-blog/p/card.svg", caption: "Caption", sourceLabel: "Source", licenseType: "generated",
    usageAllowed: true, dataKeys: [], width: 1200, height: 675, fileFormat: "image/svg+xml", uploadFormat: "image/png", fileVerified: true,
  }];
  job.inlineImageUrls = ["/generated/stock-blog/p/card.svg"];
  job.imageQuality = { status: "blocked" };
  const result = validateJobImageManifest(job);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("IMAGE_QUALITY_NOT_PASSED"));
  assert.ok(result.issues.includes("IMAGE_PLACEMENT_HEADING_MISSING"));
  assert.ok(result.issues.includes("IMAGE_VERIFIED_CHART_REQUIRED"));
});
