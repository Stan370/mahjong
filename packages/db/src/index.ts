import mysql from "mysql2/promise";

export interface GuestProfileRecord {
  id: string;
  displayName: string;
  fontScale: "S" | "M" | "L";
}

export interface RoomRecord {
  id: string;
  hostProfileId: string;
  inviteCode: string;
  status: "lobby" | "playing" | "finished";
}

export interface HandSummaryRecord {
  roomId: string;
  winnerProfileId?: string;
  outcome: "mahjong" | "invalid" | "wall-exhausted";
  matchedPatternId?: string;
  summaryJson: string;
}

export interface PersistenceAdapter {
  upsertGuestProfile(profile: GuestProfileRecord): Promise<void>;
  createRoom(room: RoomRecord): Promise<void>;
  updateRoomStatus(roomId: string, status: RoomRecord["status"]): Promise<void>;
  saveHandSummary(summary: HandSummaryRecord): Promise<void>;
}

export class InMemoryPersistenceAdapter implements PersistenceAdapter {
  guestProfiles = new Map<string, GuestProfileRecord>();
  rooms = new Map<string, RoomRecord>();
  handSummaries: HandSummaryRecord[] = [];

  async upsertGuestProfile(profile: GuestProfileRecord) {
    this.guestProfiles.set(profile.id, profile);
  }

  async createRoom(room: RoomRecord) {
    this.rooms.set(room.id, room);
  }

  async updateRoomStatus(roomId: string, status: RoomRecord["status"]) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.status = status;
    }
  }

  async saveHandSummary(summary: HandSummaryRecord) {
    this.handSummaries.push(summary);
  }
}

export class AuroraMySqlPersistenceAdapter implements PersistenceAdapter {
  constructor(
    private readonly pool = mysql.createPool({
      uri: process.env.AURORA_DATABASE_URL,
      waitForConnections: true,
      connectionLimit: 10
    })
  ) {}

  async upsertGuestProfile(profile: GuestProfileRecord) {
    await this.pool.execute(
      `INSERT INTO guest_profiles (id, display_name, font_scale)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), font_scale = VALUES(font_scale)`,
      [profile.id, profile.displayName, profile.fontScale]
    );
  }

  async createRoom(room: RoomRecord) {
    await this.pool.execute(
      `INSERT INTO rooms (id, host_profile_id, invite_code, status)
       VALUES (?, ?, ?, ?)`,
      [room.id, room.hostProfileId, room.inviteCode, room.status]
    );
  }

  async updateRoomStatus(roomId: string, status: RoomRecord["status"]) {
    await this.pool.execute(`UPDATE rooms SET status = ? WHERE id = ?`, [status, roomId]);
  }

  async saveHandSummary(summary: HandSummaryRecord) {
    await this.pool.execute(
      `INSERT INTO hand_summaries (room_id, winner_profile_id, outcome, matched_pattern_id, summary_json)
       VALUES (?, ?, ?, ?, ?)`,
      [
        summary.roomId,
        summary.winnerProfileId ?? null,
        summary.outcome,
        summary.matchedPatternId ?? null,
        summary.summaryJson
      ]
    );
  }
}

export function createPersistenceAdapter(): PersistenceAdapter {
  if (process.env.AURORA_DATABASE_URL) {
    return new AuroraMySqlPersistenceAdapter();
  }

  return new InMemoryPersistenceAdapter();
}
