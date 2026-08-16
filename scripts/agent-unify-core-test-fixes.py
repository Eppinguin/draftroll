from pathlib import Path


def replace_once(path: str, before: str, after: str, label: str) -> None:
    target = Path(path)
    source = target.read_text()
    count = source.count(before)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    target.write_text(source.replace(before, after, 1))


replace_once(
    'scripts/test-common-dice-helpers.mjs',
    "  assert.equal(encounterTable.renderAs, 'spinner');",
    "  assert.equal(encounterTable.renderAs, 'token');",
    'table-draw non-physical render hint',
)

print('Remaining core test expectations migrated.')
