/** One endpoint for every online room action. The body says which action. */
import {
  createRoom, heartbeat, joinRoom, makeMove, nextRoomGame, setDisplayName, startRoom, takeOverSeat, turnTimedOut,
} from "@/lib/online/actions";
import { HttpError, requireUser } from "@/lib/online/server";

const GAMES = [1, 3, 5, 10];
const TIMERS = [null, 30, 60, 90];
const DIFFICULTIES = ["easy", "medium", "hard"];

function bad(message: string): never {
  throw new HttpError(400, message);
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json().catch(() => bad("The request was not valid."))) as Record<string, unknown>;
    const roomId = typeof body.roomId === "string" ? body.roomId : "";
    switch (body.action) {
      case "name":
        await setDisplayName(user, String(body.name ?? ""));
        return Response.json({ ok: true });
      case "create": {
        if (!DIFFICULTIES.includes(body.difficulty as string)) bad("Pick a difficulty.");
        if (!GAMES.includes(body.games as number)) bad("Pick a length.");
        if (!TIMERS.includes(body.turnSeconds as number | null)) bad("Pick a turn timer.");
        return Response.json(await createRoom(user, {
          difficulty: body.difficulty as "easy" | "medium" | "hard",
          games: body.games as 1 | 3 | 5 | 10,
          hints: body.hints === true,
          turnSeconds: body.turnSeconds as number | null,
        }));
      }
      case "join":
        return Response.json(await joinRoom(user, String(body.code ?? "")));
      case "start":
        await startRoom(user, roomId);
        return Response.json({ ok: true });
      case "next":
        await nextRoomGame(user, roomId);
        return Response.json({ ok: true });
      case "move": {
        const cards = body.cards;
        if (!Array.isArray(cards) || cards.some((c) => !Number.isInteger(c) || c < 0 || c > 51)) bad("Those are not cards.");
        await makeMove(user, roomId, cards as number[]);
        return Response.json({ ok: true });
      }
      case "heartbeat":
        await heartbeat(user, roomId);
        return Response.json({ ok: true });
      case "takeover":
        await takeOverSeat(user, roomId, Number(body.seat));
        return Response.json({ ok: true });
      case "timeout":
        await turnTimedOut(user, roomId);
        return Response.json({ ok: true });
      default:
        bad("Unknown action.");
    }
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Online action failed", error);
    return Response.json({ error: "Something went wrong on the server." }, { status: 500 });
  }
}
