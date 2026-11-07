from pathlib import Path
import re
root=Path(__file__).resolve().parent.parent
for n in range(1,61):
 p=root/f'docs/planning/days/day-{n:03}.md'
 assert p.is_file(),f'Missing {p}'
 text=p.read_text()
 for heading in ['Goal','Task checklist','Completed work','Files changed','Checks and results','Learning check','Blockers','Remaining work','Next action','Advancement approval']:
  assert f'## {heading}' in text,f'{p}: missing {heading}'
for name in ['docs/progress.md','docs/work-log.md','docs/product/analysis.md','docs/testing/results.md','docs/operations/setup.md']:
 assert (root/name).is_file(),f'Missing {name}'
for file in (root/'docs').rglob('*.md'):
 for target in re.findall(r'\]\(([^)]+)\)',file.read_text()):
  if '://' not in target and not target.startswith('#'):
   assert (file.parent/target.split('#')[0]).exists(),f'{file}: broken local link {target}'
print('PASS: 60 milestone records, required status documents, and local documentation links.')
