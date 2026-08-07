import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import process from 'node:process';

const root = path.resolve(process.cwd());
const srcDir = path.join(root, 'src');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function compileJavaScript(source, label) {
  try {
    new vm.Script(source, { filename: label });
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

function renderIncludes(filePath, stack = []) {
  const absolute = path.resolve(filePath);
  assert(!stack.includes(absolute), `Circular HTML include: ${relative(absolute)}`);

  const text = fs.readFileSync(absolute, 'utf8');
  return text.replace(
    /<\?!=\s*include\(['"]([^'"]+)['"]\);?\s*\?>/g,
    (_match, includeName) => {
      const includePath = path.join(srcDir, `${includeName}.html`);
      assert(
        fs.existsSync(includePath),
        `Missing HTML include ${includeName} referenced by ${relative(absolute)}`,
      );
      return renderIncludes(includePath, [...stack, absolute]);
    },
  );
}

function extractScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(
    (match) => match[1],
  );
}

function validateServerFiles(files) {
  const serverFiles = files.filter((file) => file.endsWith('.gs')).sort();
  const source = serverFiles
    .map((file) => `\n// ---- ${relative(file)} ----\n${fs.readFileSync(file, 'utf8')}`)
    .join('\n');

  compileJavaScript(source, 'AppsScriptServerBundle.gs');

  const names = new Map();
  for (const file of serverFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/^function\s+([A-Za-z0-9_]+)\s*\(/gm)) {
      const name = match[1];
      const prior = names.get(name);
      assert(!prior, `Duplicate server function ${name}: ${prior} and ${relative(file)}`);
      names.set(name, relative(file));
    }
  }

  return { fileCount: serverFiles.length, functionCount: names.size };
}

function validateHtml(files) {
  const indexPath = path.join(srcDir, 'ui', 'Index.html');
  assert(fs.existsSync(indexPath), 'src/ui/Index.html is missing.');
  const rendered = renderIncludes(indexPath);
  const scripts = extractScripts(rendered);
  assert(scripts.length >= 3, 'Expected main, executive, and slot-sharing scripts.');
  scripts.forEach((script, index) => {
    compileJavaScript(script, `RenderedClientScript-${index + 1}.js`);
  });

  const htmlFiles = files.filter((file) => file.endsWith('.html'));
  htmlFiles.forEach((file) => {
    const text = fs.readFileSync(file, 'utf8');
    const openStyle = (text.match(/<style>/g) || []).length;
    const closeStyle = (text.match(/<\/style>/g) || []).length;
    assert(openStyle === closeStyle, `Unbalanced style tags in ${relative(file)}`);
  });

  return { fileCount: htmlFiles.length, scriptCount: scripts.length };
}


function validateWebAppInclude() {
  const webAppPath = path.join(srcDir, 'web', 'WebApp.gs');
  const source = fs.readFileSync(webAppPath, 'utf8');

  assert(
    /function\s+include\s*\([^)]*\)\s*\{[\s\S]*?createTemplateFromFile\([\s\S]*?getRawContent\(\)/m.test(source),
    'WebApp include() must use createTemplateFromFile(...).getRawContent() so split HTML/script partials are composed before final validation.',
  );
}

function validateManifest() {
  const manifestPath = path.join(srcDir, 'appsscript.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(manifest.runtimeVersion === 'V8', 'appsscript.json must use V8.');
  assert(manifest.timeZone === 'Asia/Manila', 'appsscript.json must use Asia/Manila.');
}

function reportLargeFiles(files) {
  const warnings = files
    .map((file) => ({ file, lines: fs.readFileSync(file, 'utf8').split(/\r?\n/).length }))
    .filter((item) => item.lines > 550)
    .sort((a, b) => b.lines - a.lines);

  warnings.forEach((item) => {
    console.warn(`Warning: ${relative(item.file)} has ${item.lines} lines.`);
  });
}

const files = walk(srcDir);
validateManifest();
validateWebAppInclude();
const server = validateServerFiles(files);
const html = validateHtml(files);
reportLargeFiles(files);

console.log(
  `Validation passed: ${server.fileCount} server files, ${server.functionCount} server functions, ` +
    `${html.fileCount} HTML partials, ${html.scriptCount} rendered client scripts.`,
);
