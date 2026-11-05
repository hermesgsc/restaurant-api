import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { marked } from 'marked';

const raiz = path.resolve(import.meta.dirname, '..');
const pasta = path.join(raiz, 'docs', 'relatorio');
const args = process.argv.slice(2);
const ru = args.includes('--ru') ? args[args.indexOf('--ru') + 1] : 'RU';
if (!/^[A-Za-z0-9_-]+$/.test(ru ?? '')) {
  console.error('Uso: npm run relatorio:pdf -- --ru <RU> (so letras, numeros, _ e -)');
  process.exit(1);
}

function acharNavegador() {
  const candidatos = [
    process.env.EDGE_BIN,
    process.env.CHROME_BIN,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidatos.find((c) => c && fs.existsSync(c));
}

function montarFiguras(md) {
  let n = 0;
  return md.replace(/!\[([^\]]*)\]\(([^)]+)\)(?:\{\.([a-z-]+)\})?/g, (_t, legenda, arquivo, classe) => {
    const bytes = fs.readFileSync(path.resolve(pasta, arquivo));
    n += 1;
    return `<figure class="${classe ?? 'largura'}"><img src="data:image/png;base64,${bytes.toString('base64')}" alt="${legenda}">`
      + `<figcaption>Figura ${n} – ${legenda}</figcaption></figure>`;
  });
}

function montarHtml() {
  let md = fs.readFileSync(path.join(pasta, 'relatorio.md'), 'utf8');
  md = montarFiguras(md);
  md = md.replace(/^(#{2,3}) (.+?) \{\.sem-numero\}$/gm, '$1 $2 <span class="marca-sem-numero"></span>');
  const corpo = marked.parse(md, { gfm: true })
    .replace(/<h2>(.*?) <span class="marca-sem-numero"><\/span><\/h2>/g, '<h2 class="sem-numero">$1</h2>');
  const css = fs.readFileSync(path.join(pasta, 'relatorio.css'), 'utf8');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Projeto Back-End</title><style>${css}</style></head><body>${corpo}</body></html>`;
}

const navegador = acharNavegador();
if (!navegador) {
  console.error('Edge ou Chrome nao encontrado. Defina EDGE_BIN ou CHROME_BIN com o caminho do executavel.');
  process.exit(1);
}

const temporaria = fs.mkdtempSync(path.join(os.tmpdir(), 'rede-relatorio-'));
const html = path.join(temporaria, 'relatorio.html');
const destino = path.join(pasta, `${ru}_Projeto_Back_End.pdf`);
fs.writeFileSync(html, montarHtml());
fs.rmSync(destino, { force: true });

const r = spawnSync(navegador, [
  '--headless', '--disable-gpu', '--no-pdf-header-footer', '--no-first-run',
  `--user-data-dir=${path.join(temporaria, 'perfil')}`,
  `--print-to-pdf=${destino}`,
  pathToFileURL(html).href,
], { stdio: 'inherit', timeout: 120000 });
fs.rmSync(temporaria, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });

if (!fs.existsSync(destino) || fs.statSync(destino).size === 0) {
  console.error(`Falha ao gerar o PDF (codigo de saida ${r.status}${r.error ? `, ${r.error.message}` : ''}). Rode de novo.`);
  process.exit(1);
}
console.log(`PDF gerado: ${path.relative(raiz, destino)} (${Math.round(fs.statSync(destino).size / 1024)} kB)`);
