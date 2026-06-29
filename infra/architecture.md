# Mahjong Family Table Architecture

## Runtime split
- `apps/web`: Next.js frontend deployed to Vercel
- `apps/realtime`: Node.js WebSocket + REST room service
- `packages/game-engine`: server-authoritative room and hand state
- `packages/american-card`: fixed American Mahjong card definitions plus joker-aware validation
- `packages/db`: Aurora MySQL persistence adapter with an in-memory fallback for local development

## AWS services
- `Aurora MySQL`: durable room records, guest preferences, finished hand summaries
- `ElastiCache Redis`: active room snapshots, reconnect state, pub/sub fanout when horizontally scaling realtime nodes
- `CloudWatch`: logs and room/game error alerts

## MVP rules boundary
- Supports private-room American Mahjong only
- Uses one fixed card snapshot for validation
- Includes joker-aware meld validation
- Defers Charleston and automated scoring

## Reconnect model
1. Client joins a room over HTTP and receives a stable guest id.
2. Client opens a WebSocket and requests a server snapshot.
3. Realtime service loads the live room from Redis or memory.
4. Server emits a viewer-specific snapshot containing concealed tiles only for the requesting player.
