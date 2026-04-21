"""
Generate professional PDFs for Pine Point Tree Service deliverables.
FITFO Systems branding — clean dark header, one logo, strong text hierarchy.
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether, Image, Flowable
)
import os
import re

# --- Paths ---
DOCS_DIR = os.path.dirname(os.path.abspath(__file__))

# --- Colors (aligned with FITFO website Workshop aesthetic) ---
HEADER_BG = HexColor('#0D1B2A')
BODY_BLACK = HexColor('#1A1A2E')
BODY_DARK = HexColor('#2D3142')
MEDIUM_GRAY = HexColor('#6B7280')
LIGHT_GRAY = HexColor('#9CA3AF')
COOL_GRAY = HexColor('#B0B8C4')
WHITE = HexColor('#FFFFFF')
GREEN = HexColor('#2D5A27')
FITFO_ACCENT = HexColor('#c85a28')  # rust/copper from FITFO website
FITFO_TEXT = HexColor('#999994')    # muted gray for logo text
BLUE_ACCENT = HexColor('#00B4D8')
ORANGE_WARN = HexColor('#F97316')
TABLE_HEADER_BG = HexColor('#0D1B2A')
TABLE_ALT_ROW = HexColor('#F5F7FA')
TABLE_BORDER = HexColor('#D1D5DB')
RULE_COLOR = HexColor('#E5E7EB')

PAGE_W, PAGE_H = letter
MARGIN = 0.75 * inch
CONTENT_W = PAGE_W - 2 * MARGIN
HEADER_HEIGHT = 130


class CleanHeader(Flowable):
    """Clean dark header — solid background, one logo, strong text."""

    def __init__(self, title, subtitle, date, confidential=False):
        Flowable.__init__(self)
        self.title = title
        self.subtitle = subtitle
        self.date = date
        self.confidential = confidential
        self.width = CONTENT_W
        self.height = HEADER_HEIGHT

    def draw(self):
        c = self.canv

        # Solid dark background with very subtle bottom-edge gradient
        c.setFillColor(HEADER_BG)
        c.rect(0, 0, self.width, self.height, fill=True, stroke=False)

        # Slightly lighter strip at very bottom (2px) for subtle depth
        c.setStrokeColor(HexColor('#142236'))
        c.setLineWidth(2)
        c.line(0, 1, self.width, 1)

        # FITFO text logo — right side, matching website Workshop style
        # Renders: FIT[F]O Systems  with [F] in accent color
        logo_right = self.width - 24
        logo_y = self.height / 2 + 6

        # FITFO text mark — dark header version (white text, accent bracket)
        # Matches website: FIT[F]O bold dark, [F] in rust, Systems lighter
        c.setFont('Helvetica-Bold', 18)
        fit_w = c.stringWidth('FIT', 'Helvetica-Bold', 18)
        bracket_w = c.stringWidth('[F]', 'Helvetica-Bold', 18)
        o_w = c.stringWidth('O', 'Helvetica-Bold', 18)
        sys_w = c.stringWidth('Systems', 'Helvetica', 12)

        total_w = fit_w + bracket_w + o_w + 8 + sys_w
        lx = logo_right - total_w

        # "FIT" — white on dark header
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 18)
        c.drawString(lx, logo_y, 'FIT')
        lx += fit_w

        # "[F]" — rust accent
        c.setFillColor(FITFO_ACCENT)
        c.setFont('Helvetica-Bold', 18)
        c.drawString(lx, logo_y, '[F]')
        lx += bracket_w

        # "O" — white
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 18)
        c.drawString(lx, logo_y, 'O')
        lx += o_w + 8

        # "Systems" — lighter weight, slightly smaller
        c.setFillColor(COOL_GRAY)
        c.setFont('Helvetica', 12)
        c.drawString(lx, logo_y + 1, 'Systems')

        # Text — left side
        tx = 24
        top = self.height - 30

        # Title (dominant)
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 22)
        c.drawString(tx, top - 16, self.title)

        # Accent line in FITFO rust color
        c.setStrokeColor(FITFO_ACCENT)
        c.setLineWidth(2)
        c.line(tx, top - 26, tx + 50, top - 26)

        # Subtitle
        c.setFillColor(COOL_GRAY)
        c.setFont('Helvetica', 10)
        c.drawString(tx, top - 40, self.subtitle)

        # Date
        c.drawString(tx, top - 54, self.date)

        # Confidential label
        if self.confidential:
            c.setFillColor(ORANGE_WARN)
            c.setFont('Helvetica-Bold', 8)
            c.drawString(tx, top - 72, 'INTERNAL DOCUMENT -- NOT FOR CLIENT DISTRIBUTION')


def get_styles():
    styles = {}
    styles['h1'] = ParagraphStyle('H1', fontName='Helvetica-Bold', fontSize=15, leading=21,
        textColor=BODY_BLACK, spaceBefore=24, spaceAfter=10)
    styles['h2'] = ParagraphStyle('H2', fontName='Helvetica-Bold', fontSize=12, leading=17,
        textColor=BODY_DARK, spaceBefore=16, spaceAfter=8)
    styles['h3'] = ParagraphStyle('H3', fontName='Helvetica-Bold', fontSize=10.5, leading=15,
        textColor=BODY_DARK, spaceBefore=12, spaceAfter=6)
    styles['body'] = ParagraphStyle('Body', fontName='Helvetica', fontSize=10, leading=15,
        textColor=BODY_DARK, spaceAfter=8)
    styles['body_bold'] = ParagraphStyle('BodyBold', fontName='Helvetica-Bold', fontSize=10, leading=15,
        textColor=BODY_BLACK, spaceAfter=8)
    styles['bullet'] = ParagraphStyle('Bullet', fontName='Helvetica', fontSize=10, leading=15,
        textColor=BODY_DARK, leftIndent=20, spaceAfter=4, bulletIndent=8)
    styles['checkbox'] = ParagraphStyle('Checkbox', fontName='Helvetica', fontSize=10, leading=15,
        textColor=BODY_DARK, leftIndent=20, spaceAfter=6)
    styles['table_header'] = ParagraphStyle('TH', fontName='Helvetica-Bold', fontSize=9, leading=12, textColor=WHITE)
    styles['table_cell'] = ParagraphStyle('TC', fontName='Helvetica', fontSize=9, leading=13, textColor=BODY_DARK)
    styles['table_cell_bold'] = ParagraphStyle('TCB', fontName='Helvetica-Bold', fontSize=9, leading=13, textColor=BODY_BLACK)
    return styles


def divider():
    return HRFlowable(width="100%", thickness=0.75, color=RULE_COLOR, spaceBefore=14, spaceAfter=14)


def parse_markdown_to_elements(md_text, styles, include_service_images=False):
    """Parse markdown with KeepTogether grouping to prevent orphaned headers."""
    raw_elements = _parse_raw(md_text, styles, include_service_images)
    return _group_with_keep_together(raw_elements)


def _parse_raw(md_text, styles, include_service_images=False):
    """First pass: convert markdown to flat list of flowables."""
    elements = []
    lines = md_text.split('\n')
    i = 0
    in_table = False
    table_rows = []

    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if i < 5 and (line.startswith('# ') or line.startswith('## ') or line.startswith('### ')):
            i += 1
            continue
        if line == '---':
            elements.append(divider())
            i += 1
            continue
        if '|' in line and line.startswith('|'):
            if not in_table:
                in_table = True
                table_rows = []
            if re.match(r'^\|[\s\-:|]+\|$', line):
                i += 1
                continue
            cells = [c.strip() for c in line.split('|')[1:-1]]
            table_rows.append(cells)
            next_line = lines[i + 1].strip() if i + 1 < len(lines) else ''
            if not (next_line.startswith('|') and '|' in next_line):
                in_table = False
                elements.extend(render_table(table_rows, styles))
                table_rows = []
            i += 1
            continue
        if line.startswith('## '):
            elements.append(('H1', Paragraph(clean_md(line[3:]), styles['h1'])))
            i += 1
            continue
        if line.startswith('### '):
            text = clean_md(line[4:])
            elements.append(('H2', Paragraph(text, styles['h2'])))

            # Insert service images after specific h3 headings (client doc only)
            if include_service_images:
                elements.extend(_service_image_for_heading(line[4:].strip(), styles))

            i += 1
            continue
        if re.match(r'^\d+\.\s', line):
            text = re.sub(r'^\d+\.\s', '', line)
            elements.append(Paragraph(f'<bullet>&bull;</bullet>{clean_md(text)}', styles['bullet']))
            i += 1
            continue
        if line.startswith('- [ ] '):
            elements.append(Paragraph(f'<bullet>&#9744;</bullet>{clean_md(line[6:])}', styles['checkbox']))
            i += 1
            continue
        if line.startswith('- '):
            elements.append(Paragraph(f'<bullet>&bull;</bullet>{clean_md(line[2:])}', styles['bullet']))
            i += 1
            continue
        if line.startswith('**') and line.endswith('**') and line.count('**') == 2:
            elements.append(Paragraph(clean_md(line), styles['body_bold']))
            i += 1
            continue
        elements.append(Paragraph(clean_md(line), styles['body']))
        i += 1
    return elements


# Service section images — use compressed versions for PDF
PDF_IMAGES_DIR = os.path.join(DOCS_DIR, 'pdf-images')
SERVICE_IMAGES = {
    'Services': 'equipment1.jpg',
    'Opening': 'profile.jpg',
    'Our Work': 'transformation1d.jpg',
}

def _service_image_for_heading(heading, styles):
    """Return a small inline image if this heading matches a service section."""
    for key, filename in SERVICE_IMAGES.items():
        if key.lower() in heading.lower():
            img_path = os.path.join(PDF_IMAGES_DIR, filename)
            if os.path.exists(img_path):
                img = Image(img_path, width=2.8*inch, height=1.4*inch)
                img.hAlign = 'LEFT'
                return [Spacer(1, 4), img, Spacer(1, 6)]
    return []


def _group_with_keep_together(raw_elements):
    """Second pass: wrap each heading + its following content in KeepTogether
    so headers never appear orphaned at the bottom of a page."""
    grouped = []
    i = 0

    while i < len(raw_elements):
        elem = raw_elements[i]

        # Check if this is a tagged heading tuple
        is_heading = isinstance(elem, tuple) and elem[0] in ('H1', 'H2')

        if is_heading:
            # Collect heading + next few content items to keep together
            group = [elem[1]]  # the Paragraph
            j = i + 1
            # Grab up to 4 following non-heading items to keep with the heading
            count = 0
            while j < len(raw_elements) and count < 4:
                next_elem = raw_elements[j]
                if isinstance(next_elem, tuple) and next_elem[0] in ('H1', 'H2'):
                    break  # next heading, stop grouping
                if isinstance(next_elem, HRFlowable):
                    break  # divider, stop grouping
                actual = next_elem[1] if isinstance(next_elem, tuple) else next_elem
                group.append(actual)
                j += 1
                count += 1

            grouped.append(KeepTogether(group))
            i = j
        else:
            # Regular element, just add it
            actual = elem[1] if isinstance(elem, tuple) else elem
            grouped.append(actual)
            i += 1

    return grouped


def render_table(rows, styles):
    if not rows:
        return []
    elements = []
    num_cols = len(rows[0])
    col_width = CONTENT_W / num_cols
    table_data = []
    for ri, row in enumerate(rows):
        styled_row = []
        for cell in row:
            if ri == 0:
                styled_row.append(Paragraph(clean_md(cell), styles['table_header']))
            elif cell.startswith('**'):
                styled_row.append(Paragraph(clean_md(cell), styles['table_cell_bold']))
            else:
                styled_row.append(Paragraph(clean_md(cell), styles['table_cell']))
        table_data.append(styled_row)
    t = Table(table_data, colWidths=[col_width] * num_cols)
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEADER_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, TABLE_BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]
    for ri in range(1, len(table_data)):
        if ri % 2 == 0:
            style_cmds.append(('BACKGROUND', (0, ri), (-1, ri), TABLE_ALT_ROW))
    t.setStyle(TableStyle(style_cmds))
    elements.append(Spacer(1, 4))
    elements.append(t)
    elements.append(Spacer(1, 8))
    return elements


def clean_md(text):
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', r'<i>\1</i>', text)
    text = re.sub(r'`(.+?)`', r'<font face="Courier" size="9">\1</font>', text)
    text = re.sub(r'\[(.+?)\]\((.+?)\)', r'\1', text)
    text = text.replace('--', ' -- ')
    return text


def add_footer(canvas, doc, footer_text):
    canvas.saveState()
    canvas.setStrokeColor(RULE_COLOR)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, 50, PAGE_W - MARGIN, 50)
    canvas.setFont('Helvetica', 7)
    canvas.setFillColor(LIGHT_GRAY)
    canvas.drawString(MARGIN, 38, footer_text)
    canvas.drawRightString(PAGE_W - MARGIN, 38, f"Page {doc.page}")
    canvas.restoreState()


def build_pdf(md_path, output_path, title, subtitle, date, footer_text,
              confidential=False, include_service_images=False):
    styles = get_styles()
    with open(md_path, 'r') as f:
        md_text = f.read()
    doc = SimpleDocTemplate(output_path, pagesize=letter,
        topMargin=0.6*inch, bottomMargin=0.8*inch, leftMargin=MARGIN, rightMargin=MARGIN)
    elements = []
    elements.append(CleanHeader(title, subtitle, date, confidential))
    elements.append(Spacer(1, 24))
    elements.extend(parse_markdown_to_elements(md_text, styles, include_service_images))
    def on_page(canvas, doc):
        add_footer(canvas, doc, footer_text)
    doc.build(elements, onFirstPage=on_page, onLaterPages=on_page)
    print(f"  Created: {output_path} ({os.path.getsize(output_path):,} bytes)")


if __name__ == '__main__':
    print("Generating professional PDFs...\n")
    build_pdf(
        md_path=os.path.join(DOCS_DIR, 'A-internal-comprehensive-review.md'),
        output_path=os.path.join(DOCS_DIR, 'A-internal-comprehensive-review.pdf'),
        title='Pine Point Tree Service',
        subtitle='Internal Project Review  |  FITFO Systems',
        date='Version 0.5 Assessment  |  March 2026',
        footer_text='FITFO Systems  |  fitfosystems.com  |  Internal Document',
        confidential=True,
    )
    build_pdf(
        md_path=os.path.join(DOCS_DIR, 'B-client-facing-full.md'),
        output_path=os.path.join(DOCS_DIR, 'B-client-facing-full.pdf'),
        title='Pine Point Tree Service',
        subtitle='Website Project Overview  |  Prepared by FITFO Systems',
        date='March 2026',
        footer_text='FITFO Systems  |  fitfosystems.com  |  pinepointtrees.com',
        include_service_images=True,
    )
    build_pdf(
        md_path=os.path.join(DOCS_DIR, 'C-client-facing-stripped.md'),
        output_path=os.path.join(DOCS_DIR, 'C-client-facing-stripped.pdf'),
        title='Pine Point Tree Service',
        subtitle='Website Summary  |  FITFO Systems',
        date='March 2026',
        footer_text='FITFO Systems  |  fitfosystems.com  |  pinepointtrees.com',
    )
    print("\nDone. All PDFs saved to /docs/")
