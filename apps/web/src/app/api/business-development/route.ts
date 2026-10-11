import { requireAdminApiSession } from "@/lib/auth/admin-auth";
import { ControlPlaneError, kind, label, uuid } from "@/lib/business-development/policy";
import { getBusinessDirector } from "@/lib/business-development/runtime";
import { readControlRequest,RequestError } from "@/lib/business-development/request";

export const runtime = "nodejs";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function errorResponse(error: unknown) {
  if (error instanceof ControlPlaneError) return response({ error: error.code }, error.code === "ISOLATED_DATABASE_REQUIRED" ? 503 : 409);
  if (error instanceof Error && error.message === "CONTROL_PLANE_DISABLED") return response({ error: "CONTROL_PLANE_DISABLED" },503);
  // Driver errors may contain SQL/connection information. Do not return or log them.
  return response({ error: "CONTROL_PLANE_UNAVAILABLE" },503);
}

export async function GET(request: Request) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;
  try { return response(await getBusinessDirector().status()); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const auth = await requireAdminApiSession(request);
  if (!auth.ok) return auth.response;
  let body: Record<string,unknown>;
  try { body = await readControlRequest(request,process.env.BG_V2_CONTROL_ORIGIN); }
  catch (error) {
    if (error instanceof RequestError) return response({error:error.message},error.status);
    return response({error:"INVALID_JSON"},400);
  }
  try {
    const director = getBusinessDirector();
    if (body.action === "start") return response({ project: await director.startProject(label(body.requestKey),label(body.title)) },201);
    if (body.action === "pause" || body.action === "resume") {
      await director.setProjectPaused(uuid(body.projectId),body.action === "pause");
      return response({ ok: true });
    }
    if (body.action === "enqueue") {
      const dependencies = body.dependencies === undefined ? [] : body.dependencies;
      if (!Array.isArray(dependencies) || dependencies.length > 20) return response({ error: "INVALID_DEPENDENCY" },400);
      const task = await director.enqueue(uuid(body.projectId),kind(body.kind),label(body.dedupKey),dependencies.map(uuid));
      // Return IDs/status only; execution capabilities stay inside the worker boundary.
      return response({ task: { id: task.id, kind: task.kind, status: task.status } },201);
    }
    if (body.action === "retry_interrupted") {
      await director.retryInterrupted(uuid(body.taskId));
      return response({ ok: true });
    }
    // No approval, payment, paid API, deployment or arbitrary command execution endpoint.
    return response({ error: "UNSUPPORTED_ACTION" },400);
  } catch (error) { return errorResponse(error); }
}
