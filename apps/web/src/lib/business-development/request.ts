export class RequestError extends Error {
  status: number;
  constructor(code: string,status: number) { super(code); this.status=status; }
}
export async function readControlRequest(request: Request,configuredOrigin?: string): Promise<Record<string,unknown>> {
  const url = new URL(request.url);
  // Next may use an internal hostname in request.url. Host remains the browser's target.
  const expectedOrigin = configuredOrigin || `${url.protocol}//${request.headers.get("host") || url.host}`;
  if (request.headers.get("origin") !== expectedOrigin) throw new RequestError("ORIGIN_REQUIRED",403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new RequestError("JSON_REQUIRED",415);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("INVALID_JSON",400);
  let raw = ""; let bytes = 0;
  const decoder = new TextDecoder("utf-8",{fatal:true});
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) { await reader.cancel(); throw new RequestError("REQUEST_TOO_LARGE",413); }
      raw += decoder.decode(value,{stream:true});
    }
    raw += decoder.decode();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError("INVALID_JSON",400);
  } finally { reader.releaseLock(); }
}
