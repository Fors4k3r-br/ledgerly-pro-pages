#!/usr/bin/env python3
"""Gera o arquivo de dados setoriais do Ledgerly Pro a partir do XML de Classificação Setorial da B3.

Uso (na raiz do projeto):  python3 tools/gerar-setores.py [tools/acoesb3.xml] [src/js/portfolio/sectors-data.js]
Descarta as linhas de cabeçalho repetidas do documento original e guarda só código -> subsetor.
"""
import datetime, json, re, sys
import xml.etree.ElementTree as ET

src = sys.argv[1] if len(sys.argv) > 1 else 'tools/acoesb3.xml'
dst = sys.argv[2] if len(sys.argv) > 2 else 'src/js/portfolio/sectors-data.js'
norm = lambda s: re.sub(r'\s+', ' ', (s or '').strip())

setores, subs, empresas, ignoradas = [], [], {}, 0
for e in ET.parse(src).getroot():
    r = {c.tag: norm(c.text) for c in e}
    cod, setor, sub = r.get('Codigo', '').upper(), r.get('Setor', ''), r.get('Subsetor', '')
    if not re.fullmatch(r'[A-Z0-9]{4}', cod) or not setor or not sub or setor.upper() == 'SETOR ECONÔMICO':
        ignoradas += 1; continue
    if setor not in setores: setores.append(setor)
    par = [setores.index(setor), sub]
    if par not in subs: subs.append(par)
    if cod in empresas and empresas[cod] != subs.index(par):
        print(f'aviso: {cod} aparece com classificações diferentes; mantida a primeira'); continue
    empresas[cod] = subs.index(par)

dados = {'fonte': 'B3 - Classificação Setorial', 'gerado': datetime.date.today().isoformat(),
         'setores': setores, 'subsetores': subs, 'empresas': dict(sorted(empresas.items()))}
with open(dst, 'w', encoding='utf-8') as f:
    f.write('// Gerado por tools/gerar-setores.py a partir do XML da B3. Não edite à mão.\n')
    f.write('globalThis.LEDGERLY_SETORES = ' + json.dumps(dados, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(f'{len(empresas)} empresas, {len(setores)} setores, {len(subs)} subsetores; {ignoradas} linhas descartadas -> {dst}')
