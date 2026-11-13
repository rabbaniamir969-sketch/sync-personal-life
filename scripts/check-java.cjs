const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const platform = process.platform;
const javaHome = process.env.JAVA_HOME || process.env.JDK_HOME;
const candidates = [];

if (javaHome) {
  candidates.push(javaHome);
}

if (platform === 'win32') {
  candidates.push(
    'C:\\Program Files\\Microsoft\\jdk-17',
    'C:\\Program Files\\Microsoft\\jdk-21',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-17',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-21',
    'C:\\Program Files\\Zulu\\zulu-17',
    'C:\\Program Files\\Zulu\\zulu-21',
    'C:\\Program Files\\Java\\jdk-17',
    'C:\\Program Files\\Java\\jdk-21',
    'C:\\Program Files\\Android\\Android Studio\\jbr'
  );
} else {
  candidates.push('/usr/lib/jvm', '/usr/local/opt/openjdk@17', '/usr/local/opt/openjdk@21');
}

function resolveJavaExecutable(basePath) {
  if (!basePath) return null;
  const candidate = platform === 'win32'
    ? path.join(basePath, 'bin', 'java.exe')
    : path.join(basePath, 'bin', 'java');
  return fs.existsSync(candidate) ? candidate : null;
}

function findJavaExecutable() {
  for (const candidate of candidates) {
    const javaExecutable = resolveJavaExecutable(candidate);
    if (javaExecutable) return javaExecutable;

    const directJava = resolveJavaExecutable(path.join(candidate, 'default'));
    if (directJava) return directJava;
  }

  const envJava = process.env.PATH ? process.env.PATH.split(path.delimiter) : [];
  for (const folder of envJava) {
    const javaExecutable = resolveJavaExecutable(folder);
    if (javaExecutable) return javaExecutable;
    const pathExecutable = path.join(folder, platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(pathExecutable)) return pathExecutable;
  }

  return null;
}

const javaExecutable = findJavaExecutable();

if (!javaExecutable) {
  console.error('JAVA_HOME is not set or no JDK 21+ was found. Install JDK 21 or use Android Studio bundled JDK, then set JAVA_HOME before building the Android app.');
  process.exit(1);
}

const result = spawnSync(javaExecutable, ['-version'], { encoding: 'utf8' });
if (result.error || result.status !== 0) {
  console.error('The configured Java runtime is invalid or unusable for Android builds.');
  if (result.error) console.error(result.error.message);
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

const versionOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
const versionLine = versionOutput.split(/\r?\n/).find(Boolean) || '';
const versionMatch = versionOutput.match(/version "(?:1\.)?(\d+)/);
const majorVersion = versionMatch ? Number(versionMatch[1]) : NaN;

if (!Number.isInteger(majorVersion) || majorVersion < 21 || majorVersion > 24) {
  console.error(`This Gradle setup requires JDK 21–24 (JDK 21 recommended). Detected: ${versionLine || 'unknown Java version'}`);
  process.exit(1);
}

console.log(`Using Java: ${javaExecutable}`);
console.log(versionLine.trim());
