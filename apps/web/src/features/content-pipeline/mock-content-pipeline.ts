import type { ContentPipelineRun } from "./content-pipeline-types";

export const mockContentPipelines: ContentPipelineRun[] = [
  {
    id: "mock-content-pipeline-1",
    title: "BG Company 구축기 1편",
    topic: "AI 개인회사 구축 과정 정리",
    channel: "blog",
    status: "draft_requested",
    currentStep: "파이프라인 실행 전",
    taskIds: [],
    outputTitle: "콘텐츠 파이프라인 대기",
    outputSummary: "새 콘텐츠 파이프라인을 실행하면 업무 보드, 승인함, 타임라인에 결과가 생성됩니다.",
    runnerMode: "mock",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];
