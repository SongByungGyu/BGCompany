const NAVER_BLOG_HOSTS = new Set(["blog.naver.com", "m.blog.naver.com"]);
const NAVER_POST_VIEW_PATHS = new Set(["/postview.naver", "/postview.nhn"]);

export type ParsedNaverPublishedUrl = {
  blogId: string;
  postId: string;
};

function cleanBlogId(value: string | null | undefined) {
  const candidate = value?.trim() ?? "";
  return candidate && /^[a-z0-9_-]{2,64}$/i.test(candidate) ? candidate : null;
}

export function parseNaverPublishedUrl(value?: string): ParsedNaverPublishedUrl | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !NAVER_BLOG_HOSTS.has(url.hostname.toLowerCase())) return null;

    const queryPostId = url.searchParams.get("logNo")?.trim() ?? "";
    if (queryPostId) {
      const blogId = cleanBlogId(url.searchParams.get("blogId"));
      if (!NAVER_POST_VIEW_PATHS.has(url.pathname.toLowerCase()) || !blogId || !/^\d+$/.test(queryPostId)) return null;
      return { blogId, postId: queryPostId };
    }

    const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
    const blogId = segments.length === 2 ? cleanBlogId(segments[0]) : null;
    if (!blogId || !/^\d+$/.test(segments[1] ?? "")) return null;
    return { blogId, postId: segments[1] };
  } catch {
    return null;
  }
}

export function isAllowedNaverPublishedResult(input: {
  url?: string;
  reportedPostId?: string;
  expectedBlogId?: string;
}) {
  const parsed = parseNaverPublishedUrl(input.url);
  const reportedPostId = input.reportedPostId ?? "";
  if (!parsed || !/^\d+$/.test(reportedPostId) || parsed.postId !== reportedPostId) return false;
  const expectedBlogId = cleanBlogId(input.expectedBlogId);
  return !expectedBlogId || parsed.blogId.toLowerCase() === expectedBlogId.toLowerCase();
}
