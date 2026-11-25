# Changelog

## [1.0.2] - 2026-11-25

### Added
- Play yourself: pick "You" for White, Black or both. Click or drag the pieces, with move dots and a promotion picker. Works on phones too.
- New engines: Berserk and Obsidian (built for the browser by Chesswatch) and Lozza 11.
- Step mode now thinks ahead: the engine searches while it waits, and Next move plays its best move right away.
- Custom think time per move, in minutes and seconds.
- Smart time control: the engine moves as soon as it's sure (best move stable, score settled), up to a maximum you set.
- Strength levels for engines without their own setting (Berserk, Obsidian, Lozza).

### Changed
- When you play one side, the board turns so your pieces are at the bottom.
- No automatic next game while someone plays by hand.

## [1.0.1] - 2026-11-25

### Added
- Pick the Stockfish version for each side: Stockfish 19, 19 Lite, 18 Lite, 17.1 Lite, 16, 11, 10, 8 and 6. Let old engines play new ones.
- Strength slider per side: Elo 1320 to max for neural-network engines, skill 0 to 20 for classic ones.
- Move sounds, on by default: wooden move, capture, castle, check, promotion and game start/end sounds, made for Chesswatch.
- Best-move arrow on the board while an engine is thinking.
- Captured pieces and material count next to each player.
- Swap sides button, first-move and last-move buttons.

### Changed
- New design: cleaner player bars, a live analysis card and tabs for moves, match setup and score.
- Games start from the starting position by default. Turn it off in Match setup to start from a random opening.
- Settings use switches and a time-control picker instead of dropdowns.

## [1.0.0] - 2026-11-24

First public release.

### Added
- Stockfish 19 plays against Stockfish 19, live in the browser.
- Strength per side: full strength or Elo 1320 to 3000.
- Time controls: fixed time per move (0.1 s to 10 s) or a real chess clock (Bullet 1+0, Blitz 3+2, Rapid 10+5).
- Step mode: Stockfish only moves when you click "Next move" or press Enter.
- Opening book with 36 openings, so the games are different every time.
- Live engine panel: eval bar, depth, nodes, speed, principal variation and an eval history graph.
- Move list you can browse, PGN export, score across games, automatic next game, optional move sounds.
- Light and dark theme, works on phones.
- Desktop apps for Windows, macOS and Linux, and an unsigned iOS app.
