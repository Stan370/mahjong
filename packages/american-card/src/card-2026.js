export const americanMahjongCard2026 = {
    id: "nmjl-like-2026-mvp",
    title: "American Mahjong MVP Card 2026",
    patterns: [
        {
            id: "flowers-dragons-2026-a",
            name: "Flowers + Dragons",
            section: "Flowers",
            allowsJokers: true,
            notes: "A compact MVP hand to validate flower-heavy play with a joker-friendly kong.",
            groups: [
                { kind: "kong", tile: "flower-1" },
                { kind: "kong", tile: "flower-2" },
                { kind: "pong", tile: "dragon-red" },
                { kind: "pong", tile: "dragon-green" }
            ]
        },
        {
            id: "winds-dragons-2026-b",
            name: "Winds and Dragons",
            section: "Winds",
            allowsJokers: true,
            groups: [
                { kind: "pong", tile: "wind-east" },
                { kind: "pong", tile: "wind-south" },
                { kind: "pong", tile: "wind-west" },
                { kind: "pong", tile: "wind-north" },
                { kind: "pair", tile: "dragon-white", maxJokers: 0 }
            ]
        },
        {
            id: "consecutive-run-2026-c",
            name: "Consecutive Run",
            section: "Consecutive Run",
            allowsJokers: true,
            groups: [
                { kind: "pair", tile: "flower-1", maxJokers: 0 },
                { kind: "pong", tile: "bam-2" },
                { kind: "pong", tile: "bam-3" },
                { kind: "pong", tile: "bam-4" },
                { kind: "kong", tile: "bam-5" }
            ]
        }
    ]
};
