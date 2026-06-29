CREATE TABLE IF NOT EXISTS guest_profiles (
  id VARCHAR(64) PRIMARY KEY,
  display_name VARCHAR(120) NOT NULL,
  font_scale ENUM('S', 'M', 'L') NOT NULL DEFAULT 'M',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rooms (
  id VARCHAR(32) PRIMARY KEY,
  host_profile_id VARCHAR(64) NOT NULL,
  invite_code VARCHAR(12) NOT NULL UNIQUE,
  status ENUM('lobby', 'playing', 'finished') NOT NULL DEFAULT 'lobby',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_rooms_host_profile
    FOREIGN KEY (host_profile_id) REFERENCES guest_profiles(id)
);

CREATE TABLE IF NOT EXISTS room_players (
  room_id VARCHAR(32) NOT NULL,
  profile_id VARCHAR(64) NOT NULL,
  seat_wind ENUM('east', 'south', 'west', 'north') NULL,
  ready BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, profile_id),
  CONSTRAINT fk_room_players_room
    FOREIGN KEY (room_id) REFERENCES rooms(id),
  CONSTRAINT fk_room_players_profile
    FOREIGN KEY (profile_id) REFERENCES guest_profiles(id)
);

CREATE TABLE IF NOT EXISTS hand_summaries (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  room_id VARCHAR(32) NOT NULL,
  winner_profile_id VARCHAR(64) NULL,
  outcome ENUM('mahjong', 'invalid', 'wall-exhausted') NOT NULL,
  matched_pattern_id VARCHAR(64) NULL,
  summary_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hand_summaries_room
    FOREIGN KEY (room_id) REFERENCES rooms(id)
);
