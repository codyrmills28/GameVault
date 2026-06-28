/**
 * Java runtime provisioning for Java-based game servers (e.g. Minecraft).
 * Pure helpers here are deps-injectable and unit-tested; the impure download/
 * extract path lives in `ensureJava` (Task 2).
 */

/** Adoptium Temurin "latest GA JRE" binary endpoint for a Windows x64 major version.
 *  This URL 302-redirects to the actual .zip asset. */
export function adoptiumUrl(major: number): string {
  return `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jre/hotspot/normal/eclipse`;
}

/** Parse a JVM `UnsupportedClassVersionError` and return the Java *major* version the jar needs.
 *  The error reports a class-file version (e.g. "class file version 69.0"); the required Java
 *  major is that number minus 44 (52->8, 61->17, 65->21, 69->25). Returns null when no such
 *  marker is present (i.e. the failure was not a Java-version mismatch). */
export function parseRequiredJavaMajor(text: string): number | null {
  if (!text) return null;
  const m = text.match(/class file version (\d+)(?:\.\d+)?/i);
  if (!m) return null;
  const classFileVersion = parseInt(m[1], 10);
  const major = classFileVersion - 44;
  return major > 0 ? major : null;
}

/** Given the top-level entries of an extracted Temurin archive and an existence check (both
 *  relative to the extract root), return the sub-directory that contains "bin/java.exe" so the
 *  caller can flatten it. Temurin zips contain a single top dir like "jdk-21.0.5+11-jre/".
 *  Returns "" when bin/java.exe is already at the root, or null when not found. */
export function findArchiveJavaRoot(
  entries: string[],
  exists: (relPath: string) => boolean
): string | null {
  if (exists("bin/java.exe")) return "";
  const topDirs = new Set<string>();
  for (const e of entries) {
    const seg = e.replace(/\\/g, "/").split("/")[0];
    if (seg) topDirs.add(seg);
  }
  for (const dir of topDirs) {
    if (exists(`${dir}/bin/java.exe`)) return dir;
  }
  return null;
}
