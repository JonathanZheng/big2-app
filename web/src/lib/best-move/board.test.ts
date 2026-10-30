import { describe, expect, it } from "vitest";
import { parseCards } from "@/lib/engine/cards";
import { encodeState } from "@/lib/model/encoding";
import {
  EMPTY_BOARD, autoCounts, boardToGame, checkBoard, cycleOwner, isOpening, myHand, setOwner, toggleLastCard,
  type Board,
} from "./board";

function boardWith(mine: string, played: Partial<Record<"west" | "north" | "east", string>> = {}, out = ""): Board {
  let board = EMPTY_BOARD;
  for (const card of parseCards(mine)) board = setOwner(board, card, "mine");
  for (const [seat, text] of Object.entries(played)) {
    for (const card of parseCards(text!)) board = setOwner(board, card, seat as "west");
  }
  for (const card of parseCards(out)) board = setOwner(board, card, "out");
  return board;
}

describe("card ownership", () => {
  it("cycles through every state and back", () => {
    let owner = cycleOwner("unseen");
    const seen = [owner];
    for (let i = 0; i < 5; i++) {
      owner = cycleOwner(owner);
      seen.push(owner);
    }
    expect(seen).toEqual(["mine", "west", "north", "east", "out", "unseen"]);
  });

  it("drops a card from the trick when its owner changes", () => {
    let board = boardWith("3d 4c", { west: "5d 6d" });
    board = { ...board, lastPlayer: 1, lastCards: parseCards("5d 6d") };
    board = setOwner(board, parseCards("5d")[0], "north");
    expect(board.lastCards).toEqual(parseCards("6d"));
    expect(board.owners[parseCards("5d")[0]]).toBe("north");
  });

  it("toggles cards in and out of the trick", () => {
    let board = boardWith("3d", { west: "5d 6d" });
    board = { ...board, lastPlayer: 1 };
    board = toggleLastCard(board, parseCards("5d")[0]);
    board = toggleLastCard(board, parseCards("6d")[0]);
    expect(board.lastCards).toEqual(parseCards("5d 6d"));
    board = toggleLastCard(board, parseCards("5d")[0]);
    expect(board.lastCards).toEqual(parseCards("6d"));
  });
});

describe("counts and the opening", () => {
  it("fills opponent counts from the cards marked as played", () => {
    const board = boardWith("3d 4c", { west: "5d 6d 7d", north: "8d 9d", east: "10d" });
    expect(autoCounts(board)).toEqual([10, 11, 12]);
  });

  it("knows the 3♦ is still to be played in my hand or unseen, but not once played or out", () => {
    expect(isOpening(boardWith("3d 4c"))).toBe(true);
    expect(isOpening(boardWith("4c 5c"))).toBe(true);
    expect(isOpening(boardWith("4c", { west: "3d" }))).toBe(false);
    expect(isOpening(boardWith("4c", {}, "3d"))).toBe(false);
  });
});

describe("boardToGame", () => {
  it("builds a state with our hand, opponent counts, the trick and the known played cards", () => {
    let board = boardWith("4c 6c", { west: "5d 5c" }, "3d 7d");
    board = { ...board, lastPlayer: 1, lastCards: parseCards("5d 5c"), passes: 1 };
    const game = boardToGame(board);
    expect(game.hands.map((h) => h.length)).toEqual([2, 11, 13, 13]);
    expect(game.hands[0]).toEqual(parseCards("4c 6c"));
    expect(game.current).toBe(0);
    expect(game.firstMove).toBe(false);
    expect(game.lastPlay).toEqual({ player: 1, cards: parseCards("5d 5c") });
    expect(game.passes).toBe(1);
    expect(game.playedBy?.[1]).toEqual(parseCards("5d 5c"));
    expect(game.dead).toEqual(parseCards("3d 7d"));
    expect(autoCounts(board)).toEqual([11, 13, 13]);
  });

  it("marks our hand, each seat's played cards and dead cards in the encoding", () => {
    let board = boardWith("4c 6c", { west: "5d 5c" }, "3d 7d");
    board = { ...board, lastPlayer: 1, lastCards: parseCards("5d 5c") };
    const game = boardToGame(board);
    const encoded = encodeState(game, 0);
    const ones = (from: number, to: number) =>
      Array.from(encoded.slice(from, to)).reduce((sum, value) => sum + value, 0);

    expect(ones(0, 52)).toBe(2); // my hand
    expect(ones(52, 104)).toBe(46); // every card not in my hand, played or dead
    expect(ones(104, 156)).toBe(2); // played by West
    expect(encoded[104 + parseCards("5d")[0]]).toBe(1);
    expect(encoded[52 + parseCards("7d")[0]]).toBe(0); // out of the game
  });
});

describe("checkBoard", () => {
  it("accepts a legal trick", () => {
    let board = boardWith("4c 6c", { west: "3d 5d 5c" }, "7d");
    board = { ...board, lastPlayer: 1, lastCards: parseCards("5d 5c") };
    expect(checkBoard(board).errors).toEqual([]);
  });

  it("rejects a trick that is not a legal move", () => {
    let board = boardWith("4c 6c", { west: "3d 5d 6c" }, "7d");
    board = { ...board, lastPlayer: 1, lastCards: parseCards("5d 6c") };
    expect(checkBoard(board).errors.join(" ")).toContain("not a legal Big 2 move");
  });

  it("rejects an opening lead without the 3♦", () => {
    const board = boardWith("4c 5c");
    expect(checkBoard(board).errors.join(" ")).toContain("3♦ is still unseen");
  });

  it("accepts an opening lead with the 3♦", () => {
    expect(checkBoard(boardWith("3d 4c")).errors).toEqual([]);
  });

  it("rejects a table move whose cards are not marked for that player", () => {
    let board = boardWith("4c 6c", { west: "3d 5d" }, "7d");
    board = { ...board, lastPlayer: 1, lastCards: parseCards("5d 5c") };
    expect(checkBoard(board).errors.join(" ")).toContain("must be cards marked as played by West");
  });

  it("warns when the counts do not match the unseen cards", () => {
    const board: Board = { ...boardWith("3d 4c", { west: "5d" }), counts: [13, 13, 13] };
    expect(checkBoard(board).warnings).toHaveLength(1);
  });

  it("does not warn when typed counts account for every unseen card", () => {
    const base = boardWith("3d 4c 5c 6c 7c 8c 9c 10c Jc Qc Kc Ac 2c", { west: "5d" });
    expect(myHand(base)).toHaveLength(13);
    const board: Board = { ...base, counts: [13, 13, 12] };
    expect(checkBoard(board).warnings).toEqual([]);
  });
});
