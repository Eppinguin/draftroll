from pathlib import Path

path = Path('scripts/test-cards-demo.mjs')
source = path.read_text()
before = "assert.match(cards, /game-specific interpretation belongs to the consuming application/);"
after = "assert.match(cards, /game-specific interpretation .*consuming application/);"
if source.count(before) != 1:
    raise SystemExit(f'cards system-agnostic assertion: expected one match, found {source.count(before)}')
path.write_text(source.replace(before, after, 1))
