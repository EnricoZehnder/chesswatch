#!/usr/bin/env bash
# Rebuilds the browser (WebAssembly) versions of Berserk and Obsidian.
#
# Needs: git, curl and the Emscripten SDK (https://emscripten.org), activated
# with `source emsdk_env.sh`. Output goes to web/engines/berserk and web/engines/obsidian.
#
# What the patches change, for both engines:
#  - one search thread instead of a thread pool (browsers only allow threads with
#    special server headers, which GitHub Pages can't send)
#  - UCI input arrives asynchronously from the web worker instead of stdin
#  - the search yields every 40 ms so "stop" works during "go infinite"
#  - the neural network is embedded with #embed instead of .incbin
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="${WORK:-$(mktemp -d)}"

BERSERK_COMMIT=1d2354d3250e5ed6fe832d0c6f60eb0b684d3e49
BERSERK_NET=berserk-6fd12bbd95c8.nn
OBSIDIAN_COMMIT=720614a61ed6201037516d555f0bd2f7e5aeae3c
OBSIDIAN_NET=net89perm.bin

COMMON=(-O3 -msimd128 -DNDEBUG -lm
  -sASYNCIFY -sASYNCIFY_STACK_SIZE=131072 -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=134217728 -sSTACK_SIZE=8388608 -sENVIRONMENT=worker -sEXIT_RUNTIME=0
  '-sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE=$stringToNewUTF8' --pre-js "$HERE/uci-pre.js")

cd "$WORK"

# ---- Berserk (C)
git clone -q https://github.com/jhonnold/berserk
git -C berserk checkout -q "$BERSERK_COMMIT"
git -C berserk apply "$HERE/berserk-browser.patch"
curl -fsSL -o "berserk/src/$BERSERK_NET" \
  "https://github.com/jhonnold/berserk-networks/releases/download/networks/$BERSERK_NET"
(
  cd berserk/src
  emcc -msse4.1 -std=gnu2x -Wno-c23-extensions -DVERSION=\"20261114\" \
    -DEVALFILE=\"$BERSERK_NET\" -DEVALFILE_PATH=\"$PWD/$BERSERK_NET\" \
    attacks.c bench.c berserk.c board.c datagen.c eval.c history.c move.c movegen.c movepick.c \
    options.c perft.c random.c search.c see.c tb.c thread.c transposition.c tune.c uci.c util.c \
    zobrist.c nn/accumulator.c nn/evaluate.c nn/threats.c pyrrhic/tbprobe.c \
    "${COMMON[@]}" -o "$ROOT/web/engines/berserk/berserk.js"
)

# ---- Obsidian (C++)
git clone -q https://github.com/gab8192/Obsidian
git -C Obsidian checkout -q "$OBSIDIAN_COMMIT"
git -C Obsidian apply "$HERE/obsidian-browser.patch"
curl -fsSL -o "Obsidian/$OBSIDIAN_NET" \
  "https://github.com/gab8192/Obsidian-nets/releases/download/nets/$OBSIDIAN_NET"
(
  cd Obsidian
  emcc -O3 -msimd128 -msse4.2 -DNDEBUG -c src/fathom/src/tbprobe.c -o tbprobe.o
  em++ -msse4.2 -std=c++17 -Wno-c23-extensions -fno-exceptions \
    -DEvalFile=\"$OBSIDIAN_NET\" -DEVALFILE_PATH=\"$PWD/$OBSIDIAN_NET\" \
    src/*.cpp tbprobe.o "${COMMON[@]}" -o "$ROOT/web/engines/obsidian/obsidian.js"
)

echo "Built into $ROOT/web/engines/{berserk,obsidian}"
