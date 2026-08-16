from pathlib import Path

path = Path('scripts/agent-clean-physical-api.py')
source = path.read_text()

for line in [
    "replace_all('src/physical-die-visuals.ts', 'lastPhysicalFallbackReplay', 'lastAdditionalPhysicalReplay')\n",
    "replace_all('src/physical-die-visuals.ts', 'capturePhysicalFallbackReplay', 'captureAdditionalPhysicalReplay')\n",
    "replace_all('src/physical-die-visuals.ts', 'restorePhysicalFallbackReplay', 'restoreAdditionalPhysicalReplay')\n",
    "replace_all('src/physical-die-visuals.ts', 'physical fallback', 'additional physical')\n",
    "replace_all('src/main.ts', '(dice.length === 0 && activeFallbackSpecs.length === 0)', '(activePhysicalSpecs.length === 0 && activeFallbackSpecs.length === 0)')\n",
]:
    source = source.replace(line, '')

old = 'r"  roll\\(\\n    request\\?:\\n      \\| \\{.*?\\n      \\| number\\[],\\n  \\): Promise<RendererCompletion>;"'
new = 'r"  roll\\(\\n    request\\?:.*?\\n  \\): Promise<RendererCompletion>;"'
if source.count(old) != 1:
    raise SystemExit(f'bridge-contract regex: expected one match, found {source.count(old)}')
source = source.replace(old, new, 1)

start_marker = "replace_once(\n    'src/main.ts',\n    \"\"\"  fallbackVisuals.forEach((visual) => visual.settle());\"\"\""
end_marker = "    'settle additional physical dice on reveal',\n)\n"
start = source.find(start_marker)
end = source.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('reveal-settlement codemod block not found')
end += len(end_marker)
targeted = "\n".join([
    "replace_once(",
    "    'src/main.ts',",
    "    \"\"\"  fallbackVisuals.forEach((visual) => visual.settle());",
    "  // Keep the completed plan while the table remains visible.\"\"\",",
    "    \"\"\"  additionalPhysicalVisuals.forEach((visual) => visual.settle());",
    "  fallbackVisuals.forEach((visual) => visual.settle());",
    "  // Keep the completed plan while the table remains visible.\"\"\",",
    "    'settle additional physical dice on reveal',",
    ")",
    "",
])
source = source[:start] + targeted + source[end:]

start_marker = "replace_once(\n    'src/main.ts',\n    \"\"\"            physicalCount: activeOutcomes.length,\"\"\""
end_marker = "    'result summary physical count',\n)\n"
start = source.find(start_marker)
end = source.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('physical-count codemod block not found')
end += len(end_marker)
targeted = "\n".join([
    "replace_all(",
    "    'src/main.ts',",
    "    '            physicalCount: activeOutcomes.length,',",
    "    '            physicalCount: activePhysicalSpecs.length,',",
    ")",
    "",
])
source = source[:start] + targeted + source[end:]

path.write_text(source)
