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
for n in range(1,49):
 p=root/f'docs/finance/planning/days/F{n:02}.md'
 assert p.is_file(),f'Missing {p}'
 text=p.read_text()
 for heading in ['Goal','Task checklist','Completed work','Files changed','Checks and results','Learning check','Blockers','Remaining work','Next action','Advancement approval']:
  assert f'## {heading}' in text,f'{p}: missing {heading}'
for name in ['README.md','specification.md','decisions.md','progress.md','repository-assessment.md','risks.md','api/openapi.yaml','testing/results.md','architecture/system.mmd']:
 assert (root/'docs/finance'/name).is_file(),f'Missing finance document {name}'
print('PASS: 60 ERP and 48 separate finance milestone records, required status documents, and local documentation links.')

# Concrete finance API and documentation must agree in both directions.
import json
api=json.loads((root/'docs/finance/api/openapi.yaml').read_text())
verbs={'GET','POST','PATCH','DELETE','PUT','HEAD','OPTIONS'}
actual={}
for route in (root/'src/app/api/v1/finance').rglob('route.ts'):
 path='/'+str(route.parent.relative_to(root/'src/app')).replace('[id]','{id}')
 exports=set(re.findall(r'export\s+(?:async\s+)?function\s+(GET|POST|PATCH|DELETE|PUT|HEAD|OPTIONS)\b|export\s+const\s+(GET|POST|PATCH|DELETE|PUT|HEAD|OPTIONS)\b',route.read_text()))
 actual[path]={next(x for x in pair if x).lower() for pair in exports}
 for block in re.findall(r'export\s*\{([^}]+)\}',route.read_text()):
  for item in block.split(','):
   exported=item.strip().split(' as ')[-1].strip()
   if exported in verbs:actual[path].add(exported.lower())
assert set(actual)==set(api['paths']), 'Concrete finance paths must match OpenAPI exactly'
for path,methods in actual.items():
 assert methods==set(api['paths'][path]),f'Finance verb mismatch: {path}'
def api_refs(obj):
 if isinstance(obj,dict):
  for key,value in obj.items():
   if key=='$ref' and value.startswith('#/'):
    target=api
    for part in value[2:].split('/'):target=target[part]
   else:api_refs(value)
 elif isinstance(obj,list):
  for item in obj:api_refs(item)
api_refs(api)
print(f'PASS: {len(actual)} concrete finance API paths, all exported verbs and local OpenAPI references match.')
