import mysql from "mysql2/promise";
export class InMemoryPersistenceAdapter {
    guestProfiles = new Map();
    rooms = new Map();
    handSummaries = [];
    async upsertGuestProfile(profile) {
        this.guestProfiles.set(profile.id, profile);
    }
    async createRoom(room) {
        this.rooms.set(room.id, room);
    }
    async updateRoomStatus(roomId, status) {
        const room = this.rooms.get(roomId);
        if (room) {
            room.status = status;
        }
    }
    async saveHandSummary(summary) {
        this.handSummaries.push(summary);
    }
}
export class AuroraMySqlPersistenceAdapter {
    pool;
    constructor(pool = mysql.createPool({
        uri: process.env.AURORA_DATABASE_URL,
        waitForConnections: true,
        connectionLimit: 10
    })) {
        this.pool = pool;
    }
    async upsertGuestProfile(profile) {
        await this.pool.execute(`INSERT INTO guest_profiles (id, display_name, font_scale)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), font_scale = VALUES(font_scale)`, [profile.id, profile.displayName, profile.fontScale]);
    }
    async createRoom(room) {
        await this.pool.execute(`INSERT INTO rooms (id, host_profile_id, invite_code, status)
       VALUES (?, ?, ?, ?)`, [room.id, room.hostProfileId, room.inviteCode, room.status]);
    }
    async updateRoomStatus(roomId, status) {
        await this.pool.execute(`UPDATE rooms SET status = ? WHERE id = ?`, [status, roomId]);
    }
    async saveHandSummary(summary) {
        await this.pool.execute(`INSERT INTO hand_summaries (room_id, winner_profile_id, outcome, matched_pattern_id, summary_json)
       VALUES (?, ?, ?, ?, ?)`, [
            summary.roomId,
            summary.winnerProfileId ?? null,
            summary.outcome,
            summary.matchedPatternId ?? null,
            summary.summaryJson
        ]);
    }
}
export function createPersistenceAdapter() {
    if (process.env.AURORA_DATABASE_URL) {
        return new AuroraMySqlPersistenceAdapter();
    }
    return new InMemoryPersistenceAdapter();
}
