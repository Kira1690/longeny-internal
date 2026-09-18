"""Builds the hierarchical test's reports from HTML: digital PDFs (print), screenshots,
phone-style photos, scanned PDFs, a TIFF, a dark photo and a DICOM stand-in."""
import json, os, subprocess, glob
from PIL import Image, ImageFilter, ImageEnhance

OUT = os.path.dirname(os.path.abspath(__file__)) + '/out'
os.makedirs(OUT, exist_ok=True)
CHROME = glob.glob(os.path.expanduser('~/.cache/ms-playwright/chromium_headless_shell-1223/*/chrome-headless-shell'))[0]

PANELS = {
 'lipid': ('Lipid Profile', [('Total cholesterol','{a}','mg/dL','< 200'),('LDL cholesterol','{b}','mg/dL','< 100'),('HDL cholesterol','{c}','mg/dL','> 40'),('Triglycerides','{d}','mg/dL','< 150')]),
 'thyroid': ('Thyroid Function', [('TSH','{a}','uIU/mL','0.4 - 4.0'),('Free T4','{b}','ng/dL','0.8 - 1.8'),('Free T3','{c}','pg/mL','2.3 - 4.2')]),
 'diabetes': ('Diabetes Panel', [('HbA1c','{a}','%','4.0 - 5.6'),('Fasting glucose','{b}','mg/dL','70 - 99'),('Fasting insulin','{c}','uIU/mL','2 - 20')]),
 'cbc': ('Complete Blood Count', [('Haemoglobin','{a}','g/dL','13.0 - 17.0'),('WBC count','{b}','10^3/uL','4.0 - 11.0'),('Platelets','{c}','10^3/uL','150 - 410'),('RBC count','{d}','10^6/uL','4.5 - 5.5')]),
 'liver': ('Liver Function', [('ALT (SGPT)','{a}','U/L','7 - 56'),('AST (SGOT)','{b}','U/L','10 - 40'),('Bilirubin total','{c}','mg/dL','0.1 - 1.2'),('Albumin','{d}','g/dL','3.5 - 5.0')]),
 'rx': ('Prescription', [('Metformin','500 mg','twice daily','30 days'),('Vitamin D3','60000 IU','weekly','8 weeks')]),
}

def page_html(r, panel, part=None):
    title, rows = PANELS[panel]
    trs = ''.join(f"<tr><td>{n}</td><td><b>{v.format(**r['vals'])}</b></td><td>{u}</td><td>{ref}</td></tr>" for n,v,u,ref in rows)
    head = ['Test','Result','Unit','Reference'] if panel!='rx' else ['Medicine','Dose','Frequency','Duration']
    return f"""<section class=page><div class=lab>{r['lab']}</div><div class=addr>NABL accredited laboratory · Pune · Tel 020 5555 0100</div>
<table class=meta><tr><td>Patient: <b>{r['patient']}</b></td><td>Sample ID: <b>{r['sid']}</b></td></tr>
<tr><td>Age/Sex: {r['age']}</td><td>Collected: {r['date']}</td></tr></table>
<h2>{title}{' (continued)' if part==2 else ''}</h2><table class=res><tr>{''.join(f'<th>{h}</th>' for h in head)}</tr>{trs}</table>
<p class=sig>Verified by Dr. R. Kulkarni, MD Pathology</p></section>"""

CSS = """<style>body{font-family:'DejaVu Sans',Arial;margin:0;color:#111}.page{width:760px;padding:40px;page-break-after:always;background:#fff}
.lab{font-size:28px;font-weight:bold}.addr{font-size:13px;margin-bottom:16px}.meta{width:100%;font-size:16px;margin-bottom:10px}
h2{font-size:21px;border-bottom:2px solid #111}.res{width:100%;border-collapse:collapse;font-size:17px}.res td,.res th{border:1px solid #333;padding:7px;text-align:left}
.sig{margin-top:30px;font-size:14px}</style>"""

def html(r, pages):
    return f"<html><head><meta charset=utf-8>{CSS}</head><body>{''.join(pages)}</body></html>"

def render(name, doc_html, pdf=False, png=False, height=900):
    path = f"{OUT}/{name}.html"; open(path,'w').write(doc_html)
    if pdf:
        subprocess.run([CHROME,'--no-sandbox','--disable-gpu',f'--print-to-pdf={OUT}/{name}.pdf','--no-pdf-header-footer',f'file://{path}'],check=True,capture_output=True)
    if png:
        subprocess.run([CHROME,'--no-sandbox','--disable-gpu','--hide-scrollbars',f'--screenshot={OUT}/{name}.png','--window-size=840,'+str(height),f'file://{path}'],check=True,capture_output=True)

def photo(src, dst):  # phone-style: tilted, softer, warmer, JPEG
    im = Image.open(src).convert('RGB').rotate(3.5, expand=True, fillcolor=(205,195,180))
    im = ImageEnhance.Brightness(im).enhance(0.93).filter(ImageFilter.GaussianBlur(0.7))
    im.save(dst, quality=78)

def scanned_pdf(pngs, dst):  # image-only PDF, like a scanner makes
    ims = [Image.open(p).convert('L').convert('RGB') for p in pngs]
    ims[0].save(dst, save_all=True, append_images=ims[1:], resolution=120)

REPORTS = json.load(open(os.path.dirname(os.path.abspath(__file__))+'/reports.json'))
for r in REPORTS:
    n = r['key']; fmt = r['format']; panel = r['panel']
    if fmt == 'digital':
        pages = [page_html(r,panel)] + ([page_html(r,r['panel2'],2)] if r.get('panel2') else [])
        render(n, html(r,pages), pdf=True)
    elif fmt in ('screenshot','photo','tiff','scanned','mixed'):
        render(n, html(r,[page_html(r,panel)]), png=True)
        if fmt=='photo': photo(f'{OUT}/{n}.png', f'{OUT}/{n}.jpg')
        if fmt=='tiff': Image.open(f'{OUT}/{n}.png').convert('RGB').save(f'{OUT}/{n}.tiff')
        if fmt=='scanned':
            extra=[]
            if r.get('panel2'):
                render(n+'_p2', html(r,[page_html(r,r['panel2'],2)]), png=True); extra=[f'{OUT}/{n}_p2.png']
            scanned_pdf([f'{OUT}/{n}.png']+extra, f'{OUT}/{n}.pdf')
        if fmt=='mixed':
            render(n+'_d', html(r,[page_html(r,r['panel2'])]), pdf=True)  # digital page 1 (text), screenshot page 2 (scan)
    elif fmt=='dark':
        Image.new('RGB',(900,700),(35,32,30)).filter(ImageFilter.GaussianBlur(10)).save(f'{OUT}/{n}.jpg',quality=55)
    elif fmt=='dicom':
        open(f'{OUT}/{n}.dcm','wb').write(b'\0'*128+b'DICM'+os.urandom(2048))
print('generated', len(REPORTS))
