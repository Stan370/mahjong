export type ClientIntentType =
  | "joinRoom"
  | "takeSeat"
  | "toggleReady"
  | "startGame"
  | "submitCharlestonPass"
  | "submitCharlestonVote"
  | "discardTile"
  | "submitClaim"
  | "passClaim"
  | "exchangeJoker"
  | "declareMahjong"
  | "requestSnapshot";

export interface ClientIntent<TType extends ClientIntentType = ClientIntentType> {
  type: TType;
  payload: Record<string, unknown>;
  playerId: string;
  roomId: string;
}

export type ServerEventType =
  | "snapshot"
  | "roomUpdated"
  | "gameStarted"
  | "charlestonUpdate"
  | "charlestonVoteRequest"
  | "tileDiscarded"
  | "claimWindowOpened"
  | "claimResolved"
  | "mahjongDeclared"
  | "error";

export interface ServerEvent<TType extends ServerEventType = ServerEventType> {
  type: TType;
  payload: Record<string, unknown>;
}
