/** Account history for the signed-in player. The body says which action. */
import { loadHistory, mergeIntoAccount, resetHistory } from "@/lib/account/server";
import { parseBundle } from "@/lib/account/validate";
import { HttpError, requireUser } from "@/lib/online/server";

function bad(message: string): never {
  throw new HttpError(400, message);
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json().catch(() => bad("The request was not valid."))) as Record<string, unknown>;
    switch (body.action) {
      case "load":
        return Response.json({ history: await loadHistory(user.id) });
      case "merge": {
        const bundle = parseBundle(body.bundle) ?? bad("The history was not valid.");
        return Response.json({ history: await mergeIntoAccount(user.id, bundle) });
      }
      case "reset":
        return Response.json({ history: await resetHistory(user.id) });
      default:
        bad("Unknown action.");
    }
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    console.error("History action failed", error);
    return Response.json({ error: "Something went wrong on the server." }, { status: 500 });
  }
}
