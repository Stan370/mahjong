import { validateAmericanMahjongHand } from "@mahjong/american-card";
const SEAT_ORDER = ["east", "south", "west", "north"];
const SUITS = ["bam", "crak", "dot"];
function makeTile(code) {
    if (code.startsWith("bam-")) {
        return { code, suit: "bam", value: Number(code.split("-")[1]) };
    }
    if (code.startsWith("crak-")) {
        return { code, suit: "crak", value: Number(code.split("-")[1]) };
    }
    if (code.startsWith("dot-")) {
        return { code, suit: "dot", value: Number(code.split("-")[1]) };
    }
    if (code.startsWith("flower-")) {
        return { code, suit: "flower", value: Number(code.split("-")[1]) };
    }
    if (code.startsWith("joker-")) {
        return { code, suit: "joker", value: Number(code.split("-")[1]) };
    }
    if (code.startsWith("wind-")) {
        return { code, suit: "wind", value: code.replace("wind-", "") };
    }
    return { code, suit: "dragon", value: code.replace("dragon-", "") };
}
function buildDeck() {
    const tiles = [];
    for (const suit of SUITS) {
        for (let value = 1; value <= 9; value += 1) {
            for (let copy = 0; copy < 4; copy += 1) {
                tiles.push(makeTile(`${suit}-${value}`));
            }
        }
    }
    for (const wind of ["east", "south", "west", "north"]) {
        for (let copy = 0; copy < 4; copy += 1) {
            tiles.push(makeTile(`wind-${wind}`));
        }
    }
    for (const dragon of ["red", "green", "white"]) {
        for (let copy = 0; copy < 4; copy += 1) {
            tiles.push(makeTile(`dragon-${dragon}`));
        }
    }
    for (let value = 1; value <= 8; value += 1) {
        tiles.push(makeTile(`flower-${value}`));
    }
    for (let value = 1; value <= 8; value += 1) {
        tiles.push(makeTile(`joker-${value}`));
    }
    return shuffle(tiles);
}
function shuffle(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
}
export function createRoomState(roomId, host) {
    return {
        id: roomId,
        hostId: host.id,
        players: {
            [host.id]: host
        },
        seats: {
            east: { wind: "east", ready: false },
            south: { wind: "south", ready: false },
            west: { wind: "west", ready: false },
            north: { wind: "north", ready: false }
        }
    };
}
export function upsertPlayer(room, player) {
    room.players[player.id] = player;
    return room;
}
export function takeSeat(room, playerId, wind) {
    const existingSeat = SEAT_ORDER.find((seatWind) => room.seats[seatWind].playerId === playerId);
    if (existingSeat) {
        room.seats[existingSeat].playerId = undefined;
        room.seats[existingSeat].ready = false;
    }
    room.seats[wind].playerId = playerId;
    room.seats[wind].ready = false;
    return room;
}
export function toggleReady(room, playerId) {
    const seatWind = SEAT_ORDER.find((wind) => room.seats[wind].playerId === playerId);
    if (!seatWind) {
        return room;
    }
    room.seats[seatWind].ready = !room.seats[seatWind].ready;
    return room;
}
export function canStart(room) {
    return SEAT_ORDER.every((wind) => room.seats[wind].playerId && room.seats[wind].ready);
}
export function startGame(room) {
    if (!canStart(room)) {
        throw new Error("All four seats must be occupied and ready before the hand can start.");
    }
    const deck = buildDeck();
    const players = {
        east: { concealedTiles: [], exposedTiles: [] },
        south: { concealedTiles: [], exposedTiles: [] },
        west: { concealedTiles: [], exposedTiles: [] },
        north: { concealedTiles: [], exposedTiles: [] }
    };
    for (const wind of SEAT_ORDER) {
        players[wind].concealedTiles = deck.splice(0, 13);
    }
    players.east.concealedTiles.push(deck.shift());
    room.game = {
        deck,
        currentTurn: "east",
        discards: [],
        players,
        phase: "playing"
    };
    room.startedAt = new Date().toISOString();
    return room;
}
export function discardTile(room, playerId, tileCode) {
    if (!room.game || room.game.phase !== "playing") {
        throw new Error("A hand is not active.");
    }
    const seatWind = SEAT_ORDER.find((wind) => room.seats[wind].playerId === playerId);
    if (!seatWind || seatWind !== room.game.currentTurn) {
        throw new Error("It is not this player's turn.");
    }
    const hand = room.game.players[seatWind].concealedTiles;
    const tileIndex = hand.findIndex((tile) => tile.code === tileCode);
    if (tileIndex === -1) {
        throw new Error("Tile is not present in the concealed hand.");
    }
    const [tile] = hand.splice(tileIndex, 1);
    room.game.discards.push(tile);
    const currentIndex = SEAT_ORDER.indexOf(seatWind);
    const nextWind = SEAT_ORDER[(currentIndex + 1) % SEAT_ORDER.length];
    const drawnTile = room.game.deck.shift();
    if (drawnTile) {
        room.game.players[nextWind].concealedTiles.push(drawnTile);
    }
    else {
        room.game.phase = "finished";
        room.game.result = {
            winnerId: "wall-exhausted",
            status: "invalid"
        };
    }
    room.game.currentTurn = nextWind;
    return room;
}
export function declareMahjong(room, playerId) {
    if (!room.game) {
        throw new Error("A hand is not active.");
    }
    const seatWind = SEAT_ORDER.find((wind) => room.seats[wind].playerId === playerId);
    if (!seatWind) {
        throw new Error("Player must be seated to declare Mahjong.");
    }
    const concealedTiles = room.game.players[seatWind].concealedTiles;
    const result = validateAmericanMahjongHand(concealedTiles);
    room.game.phase = "finished";
    room.game.result = {
        winnerId: playerId,
        patternId: result.bestMatch?.patternId,
        status: result.matched ? "mahjong" : "invalid"
    };
    return room;
}
export function createSnapshot(room, viewerId) {
    const seats = Object.fromEntries(SEAT_ORDER.map((wind) => {
        const seat = room.seats[wind];
        const player = seat.playerId ? room.players[seat.playerId] : undefined;
        return [
            wind,
            {
                ...seat,
                playerName: player?.name,
                fontScale: player?.fontScale
            }
        ];
    }));
    const viewerWind = SEAT_ORDER.find((wind) => room.seats[wind].playerId === viewerId);
    return {
        roomId: room.id,
        hostId: room.hostId,
        seats,
        game: room.game
            ? {
                currentTurn: room.game.currentTurn,
                discards: room.game.discards,
                phase: room.game.phase,
                wallCount: room.game.deck.length,
                myTiles: viewerWind ? room.game.players[viewerWind].concealedTiles : [],
                exposedTiles: {
                    east: room.game.players.east.exposedTiles,
                    south: room.game.players.south.exposedTiles,
                    west: room.game.players.west.exposedTiles,
                    north: room.game.players.north.exposedTiles
                },
                result: room.game.result
            }
            : undefined
    };
}
