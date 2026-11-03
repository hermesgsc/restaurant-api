import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// gera os png de docs/diagramas a partir dos .puml. precisa de java e do
// plantuml.jar; por padrao procura em .tools/ (fora do git) e aceita
// JAVA_BIN e PLANTUML_JAR pra apontar pra outro lugar
const raiz = path.resolve(import.meta.dirname, '..');
const pasta = path.join(raiz, 'docs', 'diagramas');
const javaLocal = path.join(raiz, '.tools', 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
const java = process.env.JAVA_BIN || (fs.existsSync(javaLocal) ? javaLocal : 'java');
const jar = process.env.PLANTUML_JAR || path.join(raiz, '.tools', 'plantuml.jar');

if (!fs.existsSync(jar)) {
  console.error(`plantuml.jar nao encontrado em ${jar}. Baixe em https://plantuml.com/download ou defina PLANTUML_JAR.`);
  process.exit(1);
}

const fontes = fs.readdirSync(pasta).filter((f) => f.endsWith('.puml')).map((f) => path.join(pasta, f));
const r = spawnSync(java, ['-Djava.awt.headless=true', '-jar', jar, '-tpng', '-charset', 'UTF-8', ...fontes], { stdio: 'inherit' });
if (r.error) {
  console.error(`Nao foi possivel executar o java (${java}): ${r.error.message}`);
  process.exit(1);
}
if (r.status !== 0) process.exit(r.status);
console.log(`${fontes.length} diagrama(s) renderizado(s) em docs/diagramas.`);
