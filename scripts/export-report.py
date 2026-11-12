"""Export the current evidence documents to a self-contained Word progress report."""
from pathlib import Path
from datetime import datetime,timezone,timedelta
from xml.sax.saxutils import escape
from zipfile import ZipFile,ZIP_DEFLATED
root=Path(__file__).resolve().parent.parent
sources=['docs/build-report.md','docs/progress.md','docs/work-log.md','docs/testing/results.md','docs/planning/backlog.md','docs/finance/progress.md','docs/finance/repository-assessment.md','docs/finance/decisions.md','docs/finance/testing/results.md','docs/finance/planning/milestones.md','docs/finance/planning/days/F04.md']
paras=[]
for name in sources:
 text=(root/name).read_text()
 for line in text.splitlines():
  if not line.strip():continue
  style='Normal'
  if line.startswith('# '):style='Title';line=line[2:]
  elif line.startswith('## '):style='Heading1';line=line[3:]
  elif line.startswith('### '):style='Heading2';line=line[4:]
  elif line.startswith('| ---'):continue
  elif line.startswith('|'):line=' · '.join(x.strip() for x in line.strip('|').split('|'))
  line=line.replace('**','').replace('`','')
  paras.append(f'<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr><w:r><w:t xml:space="preserve">{escape(line)}</w:t></w:r></w:p>')
 paras.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
xml=f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{ns}"><w:body>'+''.join(paras)+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr></w:body></w:document>'
styles=f'''<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="{ns}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="245C49"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style></w:styles>'''
types='''<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'''
rels='''<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'''
docrels='''<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'''
target=root/'docs/Encova_Progress_Report.docx'
with ZipFile(target,'w',ZIP_DEFLATED) as z:
 for path,content in {'[Content_Types].xml':types,'_rels/.rels':rels,'word/document.xml':xml,'word/styles.xml':styles,'word/_rels/document.xml.rels':docrels}.items():z.writestr(path,content)
print(f'Exported {target.name} from {len(sources)} current evidence documents.')
