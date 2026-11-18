"""Build the UX audit report (one HTML page plus images) from the audit run.

usage: python build-report.py <audit_dir>
Reads pages.jsonl, flows.jsonl and findings.json from <audit_dir> and writes
<audit_dir>/report/index.html with JPEG copies of the screenshots it shows.
"""
import html
import json
import os
import shutil
import sys

from PIL import Image

AUDIT = sys.argv[1]
SHOTS = os.path.join(AUDIT, 'shots')
OUT = os.path.join(AUDIT, 'report')
IMG = os.path.join(OUT, 'img')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(IMG)

def jsonl(name):
    path = os.path.join(AUDIT, name)
    return [json.loads(line) for line in open(path, encoding='utf-8')] if os.path.exists(path) else []

pages, flows = jsonl('pages.jsonl'), jsonl('flows.jsonl')
# A task whose recording script itself failed (a selector problem, not an app finding) is left out.
flows = [f for f in flows if f['completed'] or 'locator.' not in (f.get('error') or '')]
findings = json.load(open(os.path.join(AUDIT, 'findings.json'), encoding='utf-8'))
used = {}

def img(name, width=1366):
    """Copy one screenshot as a JPEG into the report and return its relative path."""
    if not name or not os.path.exists(os.path.join(SHOTS, name)):
        return None
    if name not in used:
        out = name.replace('.png', '.jpg')
        im = Image.open(os.path.join(SHOTS, name)).convert('RGB')
        if im.width > width:
            im = im.resize((width, int(im.height * width / im.width)))
        if im.height > 4000:
            im = im.crop((0, 0, im.width, 4000))
        im.save(os.path.join(IMG, out), quality=70, optimize=True)
        used[name] = 'img/' + out
    return used[name]

esc = html.escape
ROLE_LABEL = {'cashier': 'Cashier', 'manager': 'Manager', 'admin': 'Admin (owner)', 'superadmin': 'Super admin',
              'superadmin-preview': 'Super admin previewing Store A', 'lottery-admin': 'Lottery store admin',
              'lottery-cashier': 'Lottery store cashier', 'signed-out': 'Signed out'}
SEV = {'P1': 'Fix first', 'P2': 'Fix next', 'P3': 'Polish'}

def flags(c):
    out = []
    contrast = sum(a['nodes'] for a in c.get('axe', []) if a['id'] == 'color-contrast')
    other = [a for a in c.get('axe', []) if a['id'] not in ('color-contrast', 'axe-failed')]
    if contrast: out.append(('warn', f'{contrast} low-contrast'))
    for a in other: out.append(('warn', f"{a['nodes']} {a['id']}"))
    if c.get('pageOverflow') or c.get('mainOverflow'): out.append(('bad', 'scrolls sideways'))
    if c.get('h1Count') not in (None, 1): out.append(('info', f"{c.get('h1Count')} page titles"))
    return out

# --- findings ---
finding_html = []
for sev in ('P1', 'P2', 'P3'):
    group = [f for f in findings if f['severity'] == sev]
    if not group: continue
    finding_html.append(f'<h3 class="sev-head sev-{sev}">{SEV[sev]} <span>{len(group)}</span></h3>')
    for f in group:
        shots = ''.join(f'<button class="thumb" data-full="{p}" aria-label="Enlarge {esc(n)}"><img loading="lazy" src="{p}" alt="{esc(n)}"></button>'
                        for n in f.get('evidence', []) if (p := img(n)))
        roles = ''.join(f'<span class="chip">{esc(r)}</span>' for r in f.get('roles', []))
        finding_html.append(f'''<article class="finding sev-{sev}" id="{esc(f['id'])}">
  <header><span class="area">{esc(f['area'])}</span><h4>{esc(f['title'])}</h4>{roles}</header>
  <p>{esc(f['what'])}</p>
  <p class="fix"><strong>Change:</strong> {esc(f['fix'])}</p>
  {f'<p class="where">{esc(f["where"])}</p>' if f.get('where') else ''}
  {f'<div class="thumbs">{shots}</div>' if shots else ''}
</article>''')

# --- flows ---
flow_rows, flow_strips = [], []
for f in flows:
    label = f['flow'].replace('-', ' ')
    actions = f['clicks'] + f['keys'] + f['entries'] + f['scans']
    flow_rows.append(f'''<tr><td><a href="#flow-{esc(f['flow'])}">{esc(label)}</a></td><td>{esc(ROLE_LABEL.get(f['role'], f['role']))}</td>
<td class="num">{f['clicks']}</td><td class="num">{f['keys']}</td><td class="num">{f['entries']}</td><td class="num">{f['scans']}</td>
<td class="num"><strong>{actions}</strong></td><td class="num">{len([d for d in f['dialogs'] if not d.startswith('browser')])}</td>
<td>{'<span class="ok">Finished</span>' if f['completed'] else '<span class="bad">Stopped</span>'}{(' · ' + esc(f['note'])) if f.get('note') else ''}</td></tr>''')
    steps = ''.join(f'''<figure><button class="thumb" data-full="{p}" aria-label="Enlarge step {s['n']}"><img loading="lazy" src="{p}" alt=""></button>
<figcaption><b>{s['n']}</b> {esc(s['action'])}{('<br><small>' + esc(', '.join(s['dialogs'])) + '</small>') if s['dialogs'] else ''}</figcaption></figure>'''
                    for s in f['steps'] if (p := img(s['file'])))
    browser = [d for d in f['dialogs'] if d.startswith('browser')]
    flow_strips.append(f'''<section class="flow" id="flow-{esc(f['flow'])}"><h4>{esc(label)} <small>{esc(ROLE_LABEL.get(f['role'], f['role']))} · {actions} actions</small></h4>
{('<p class="bad">Browser pop-ups: ' + esc('; '.join(browser)) + '</p>') if browser else ''}
{('<p class="bad">' + esc(f['error']) + '</p>') if f.get('error') else ''}<div class="strip">{steps}</div></section>''')

# --- role tours ---
tour_tabs, tour_panels = [], []
# Manager screens match admin's except the four admin-only pages; the method notes say so.
for role in [r for r in ROLE_LABEL if r != 'manager']:
    entries = [p for p in pages if p['role'] == role]
    if not entries: continue
    cards = []
    for e in entries:
        files = e.get('files') or []
        main = next((f for f in files if '1366-light.png' in f and '__full' not in f), files[0] if files else None)
        # Whole-page captures for the main roles; the others repeat admin's pages.
        full = next((f for f in files if '__full' in f), None) if role in ('admin', 'cashier', 'superadmin') else None
        p = img(main)
        if not p: continue
        pf = img(full, 1366) if full else p
        chips = ''.join(f'<span class="flag {k}">{esc(t)}</span>' for k, t in flags(e.get('checks') or {}))
        if e.get('denied'): chips += '<span class="flag info">Access denied page</span>'
        if e.get('problems'): chips += f'<span class="flag bad">{len(e["problems"])} errors</span>'
        title = (e.get('checks') or {}).get('title') or ''
        cards.append(f'''<figure class="page"><button class="thumb" data-full="{pf}" aria-label="Enlarge {esc(e['path'])}"><img loading="lazy" src="{p}" alt=""></button>
<figcaption><b>{esc(title)}</b><code>{esc(e['path'])}</code><div>{chips}</div></figcaption></figure>''')
    tour_tabs.append(f'<button role="tab" data-tab="{role}">{esc(ROLE_LABEL[role])} <span>{len(cards)}</span></button>')
    tour_panels.append(f'<div class="tour" role="tabpanel" data-panel="{role}"><div class="grid">{"".join(cards)}</div></div>')

# --- totals ---
checked = [p for p in pages if p.get('checks')]
contrast = sum(a['nodes'] for p in checked for a in p['checks']['axe'] if a['id'] == 'color-contrast')
unlabeled = sum(a['nodes'] for p in checked for a in p['checks']['axe'] if a['id'] == 'label')
shots_total = len([n for n in os.listdir(SHOTS) if n.endswith('.png')])
counts = {s: len([f for f in findings if f['severity'] == s]) for s in ('P1', 'P2', 'P3')}

page = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'report-template.html'), encoding='utf-8').read()
page = (page.replace('{{PAGES}}', str(len(checked))).replace('{{SHOTS}}', str(shots_total)).replace('{{FLOWS}}', str(len(flows)))
        .replace('{{P1}}', str(counts['P1'])).replace('{{P2}}', str(counts['P2'])).replace('{{P3}}', str(counts['P3']))
        .replace('{{CONTRAST}}', f'{contrast:,}').replace('{{UNLABELED}}', str(unlabeled))
        .replace('{{FLOW_ROWS}}', '\n'.join(flow_rows)).replace('{{FLOW_STRIPS}}', '\n'.join(flow_strips))
        .replace('{{FINDINGS}}', '\n'.join(finding_html)).replace('{{TOUR_TABS}}', ''.join(tour_tabs)).replace('{{TOUR_PANELS}}', ''.join(tour_panels)))
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(page)
size = sum(os.path.getsize(os.path.join(IMG, n)) for n in os.listdir(IMG))
print(f'report: {len(used)} images, {size / 1e6:.1f} MB')
