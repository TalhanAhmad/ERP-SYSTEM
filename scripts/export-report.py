"""Export current full and focused evidence reports, with local PNG evidence."""
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED
import re
import struct
root = Path(__file__).resolve().parent.parent
ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
main_sources = ['docs/build-report.md','docs/progress.md','docs/work-log.md','docs/testing/results.md','docs/planning/backlog.md','docs/finance/progress.md','docs/finance/repository-assessment.md','docs/finance/decisions.md','docs/finance/testing/results.md','docs/finance/planning/milestones.md','docs/finance/planning/days/F04.md','docs/finance/planning/days/F05.md']
main_sources += [f'docs/finance/planning/days/F{n:02}.md' for n in range(6,11)]
main_sources += ['docs/finance/accounting/ledger-core.md','docs/finance/testing/F06-F10-results.md','docs/finance/delivery-F06-F10.md']
focused_sources = ['docs/finance/delivery-F06-F10.md'] + [f'docs/finance/planning/days/F{n:02}.md' for n in range(6,11)] + ['docs/finance/accounting/ledger-core.md','docs/finance/testing/F06-F10-results.md']

def report_xml(sources):
    paragraphs, images = [], []
    for name in sources:
        source = root / name
        for line in source.read_text().splitlines():
            if not line.strip():
                continue
            picture = re.fullmatch(r'!\[([^]]*)\]\(([^)]+\.png)\)', line)
            if picture:
                path = (source.parent / picture[2]).resolve()
                assert path.is_relative_to(root), 'Report images must be local workspace files'
                blob = path.read_bytes()
                assert blob[:8] == b'\x89PNG\r\n\x1a\n', 'Expected a PNG screenshot'
                width, height = struct.unpack('>II', blob[16:24])
                scale = min(5.8 * 914400 / width, 8 * 914400 / height)
                cx, cy = round(width * scale), round(height * scale)
                number = len(images) + 1
                images.append(blob)
                alt = escape(picture[1], {'"':'&quot;'})
                paragraphs.append(f'<w:p><w:r><w:drawing><wp:inline><wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{number}" name="Evidence {number}" descr="{alt}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="{number}" name="Evidence {number}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage{number}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>')
                continue
            style = 'Normal'
            if line.startswith('# '): style, line = 'Title', line[2:]
            elif line.startswith('## '): style, line = 'Heading1', line[3:]
            elif line.startswith('### '): style, line = 'Heading2', line[4:]
            elif line.startswith('| ---'): continue
            elif line.startswith('|'): line = ' · '.join(x.strip() for x in line.strip('|').split('|'))
            line = line.replace('**','').replace('`','')
            paragraphs.append(f'<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr><w:r><w:t xml:space="preserve">{escape(line)}</w:t></w:r></w:p>')
        paragraphs.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    xml = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' + ''.join(paragraphs) + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr></w:body></w:document>'
    return xml, images

styles=f'''<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="{ns}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="245C49"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style></w:styles>'''
types='''<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'''
rels='''<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'''
docrels='''<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'''

for target_name, sources in [('docs/Encova_Progress_Report.docx',main_sources),('docs/finance/Encova_F06-F10_Report.docx',focused_sources)]:
    xml, images = report_xml(sources)
    image_rels = ''.join(f'<Relationship Id="rIdImage{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image{i}.png"/>' for i in range(1,len(images)+1))
    relationships = docrels.replace('</Relationships>',image_rels+'</Relationships>')
    content_types = types.replace('</Types>','<Default Extension="png" ContentType="image/png"/></Types>')
    target = root / target_name
    with ZipFile(target,'w',ZIP_DEFLATED) as archive:
        for path, content in {'[Content_Types].xml':content_types,'_rels/.rels':rels,'word/document.xml':xml,'word/styles.xml':styles,'word/_rels/document.xml.rels':relationships}.items():
            archive.writestr(path,content)
        for i, blob in enumerate(images,1):
            archive.writestr(f'word/media/image{i}.png',blob)
    print(f'Exported {target.name} from {len(sources)} current evidence documents, including {len(images)} synthetic screenshots.')
