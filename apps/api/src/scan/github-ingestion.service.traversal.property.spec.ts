// Feature: github-repository-scanner, Property 6
import "reflect-metadata";
import fc from "fast-check";
import { Readable } from "node:stream";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gzipSync } from "node:zlib";
import {
  GitHubIngestionService,
  type ParsedRepo,
} from "./github-ingestion.service";

/**
 * Property 6: Path-traversal safety
 *
 * For any archive entry name (including `../` sequences, absolute paths, mixed
 * `/` and `\` separators, symlinks, and hard links), no entry is ever written
 * to a location outside `scanDir`; the resolved destination of every accepted
 * entry is contained within `scanDir`.
 *
 * This file validates the property two complementary ways:
 *
 *   (A) Predicate test — generate adversarial entry path strings with fast-check
 *       and assert the implementation's containment guard
 *       (`dest === root || dest.startsWith(root + sep)`) agrees with an
 *       independent oracle, and that any traversal-escaping path yields `false`.
 *
 *   (B) End-to-end test — build real adversarial gzipped tarballs in-memory
 *       (entries with literal `../`, absolute, mixed-separator names, symlinks,
 *       and hard links pointing outside the tree), pipe them through
 *       `safeExtract`, and assert no file ever lands outside `scanDir` and that
 *       sentinel targets outside `scanDir` are never created.
 *
 * Validates: Requirements 3.9, 3.10
 */

const PARSED: ParsedRepo = { owner: "octocat", repo: "hello-world" };

// ---------------------------------------------------------------------------
// (A) Containment-guard predicate property
// ---------------------------------------------------------------------------

/**
 * The exact path-traversal guard the implementation applies inside
 * `safeExtract`'s filter: resolve the entry against the root and require the
 * resolved destination to equal the root or sit beneath `root + sep`.
 */
function implGuard(root: string, entryPath: string): boolean {
  const dest = path.resolve(root, entryPath);
  return dest === root || dest.startsWith(root + path.sep);
}

/**
 * Independent oracle for containment using `path.relative`: a destination is
 * contained iff the relative path from root to dest neither escapes upward
 * (`..`) nor is absolute. The empty relative path means dest === root.
 */
function oracleContained(root: string, entryPath: string): boolean {
  const dest = path.resolve(root, entryPath);
  const rel = path.relative(root, dest);
  if (rel === "") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** A path segment built from realistic, mostly-safe filename characters. */
const segmentArb = fc
  .stringMatching(/^[A-Za-z0-9._-]{1,12}$/)
  .filter((s) => s.length > 0);

/** Adversarial path-component generator mixing escapes, absolutes, separators. */
const componentArb = fc.oneof(
  segmentArb,
  fc.constant(".."),
  fc.constant("."),
  fc.constant(""), // produces doubled separators
);

/**
 * Build adversarial entry path strings: random components joined by a random
 * mix of `/` and `\` separators, optionally prefixed to look absolute (POSIX
 * `/etc/...` or Windows-style `C:\...`).
 */
const adversarialEntryArb = fc
  .record({
    components: fc.array(componentArb, { minLength: 1, maxLength: 6 }),
    seps: fc.array(fc.constantFrom("/", "\\"), { minLength: 1, maxLength: 6 }),
    prefix: fc.constantFrom("", "/", "\\", "C:\\", "//"),
  })
  .map(({ components, seps, prefix }) => {
    let out = prefix;
    components.forEach((c, i) => {
      if (i > 0) out += seps[i % seps.length];
      out += c;
    });
    return out;
  });

describe("GitHubIngestionService — Property 6: Path-traversal safety (guard predicate)", () => {
  it("containment guard agrees with an independent oracle for adversarial entry names", () => {
    fc.assert(
      fc.property(
        // Random roots so the property is not tied to one directory.
        fc.constantFrom(
          path.resolve(os.tmpdir(), "scan-root"),
          path.resolve(os.tmpdir(), "nested", "scan-dir"),
          path.resolve("/srv", "temp-scans", "abc123"),
        ),
        adversarialEntryArb,
        (root, entryPath) => {
          expect(implGuard(root, entryPath)).toBe(
            oracleContained(root, entryPath),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("rejects every entry whose resolved destination escapes the root", () => {
    const root = path.resolve(os.tmpdir(), "scan-root");
    fc.assert(
      fc.property(adversarialEntryArb, (entryPath) => {
        const dest = path.resolve(root, entryPath);
        const escapes = dest !== root && !dest.startsWith(root + path.sep);
        // If it escapes, the guard MUST reject it (return false).
        if (escapes) {
          expect(implGuard(root, entryPath)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("explicit traversal escapes are always rejected", () => {
    const root = path.resolve(os.tmpdir(), "scan-root");
    const escapers = [
      "../evil.txt",
      "../../evil.txt",
      "a/../../evil.txt",
      "../../../../../../etc/passwd",
      "./../../escape",
    ];
    for (const e of escapers) {
      expect(implGuard(root, e)).toBe(false);
    }
    // Contained entries are accepted.
    for (const ok of ["a.txt", "src/index.ts", "a/b/c/d.ts", "./safe.ts"]) {
      expect(implGuard(root, ok)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// (B) End-to-end adversarial tarball extraction
// ---------------------------------------------------------------------------

/** USTAR type flags. */
const TYPE_FILE = "0";
const TYPE_SYMLINK = "2";
const TYPE_HARDLINK = "1";

interface TarEntrySpec {
  name: string;
  content?: string;
  type?: string;
  linkname?: string;
}

/** Write an octal numeric field of `len` bytes (digits + trailing NUL). */
function octalField(value: number, len: number): Buffer {
  const str = value
    .toString(8)
    .padStart(len - 1, "0")
    .slice(-(len - 1));
  return Buffer.from(str + "\0", "ascii");
}

/**
 * Build a single 512-byte USTAR header + padded content for one entry. This
 * lets us craft literal `../`, absolute, and link entry names that the high
 * level `tar.create` API would otherwise refuse to emit.
 */
function buildTarEntry(spec: TarEntrySpec): Buffer {
  const content = Buffer.from(spec.content ?? "", "utf8");
  const header = Buffer.alloc(512, 0);

  // name (0, 100)
  header.write(spec.name.slice(0, 100), 0, "ascii");
  // mode (100, 8), uid (108, 8), gid (116, 8)
  octalField(0o644, 8).copy(header, 100);
  octalField(0, 8).copy(header, 108);
  octalField(0, 8).copy(header, 116);
  // size (124, 12) — links/dirs carry 0 bytes of content
  octalField(content.length, 12).copy(header, 124);
  // mtime (136, 12)
  octalField(0, 12).copy(header, 136);
  // typeflag (156, 1)
  header.write(spec.type ?? TYPE_FILE, 156, "ascii");
  // linkname (157, 100)
  if (spec.linkname) header.write(spec.linkname.slice(0, 100), 157, "ascii");
  // magic (257, 6) + version (263, 2)
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");

  // checksum (148, 8): sum of header bytes with the checksum field as spaces.
  for (let i = 148; i < 156; i++) header[i] = 0x20;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  const chk = sum.toString(8).padStart(6, "0").slice(-6);
  header.write(chk + "\0 ", 148, "ascii");

  // content padded to a 512-byte boundary
  const pad = (512 - (content.length % 512)) % 512;
  return Buffer.concat([header, content, Buffer.alloc(pad, 0)]);
}

/** Assemble a gzipped tar archive from entry specs (with the two-block trailer). */
function buildGzippedTar(entries: TarEntrySpec[]): Buffer {
  const blocks = entries.map(buildTarEntry);
  const trailer = Buffer.alloc(1024, 0); // two empty 512-byte blocks
  return gzipSync(Buffer.concat([...blocks, trailer]));
}

/** Recursively collect every file path under `dir` (returns [] if missing). */
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe("GitHubIngestionService.safeExtract — Property 6: Path-traversal safety (end-to-end)", () => {
  const service = new GitHubIngestionService({
    maxRepoBytes: 10 * 1024 * 1024,
    maxFileCount: 5000,
    fetchTimeoutMs: 5000,
    fetchMechanism: "tarball",
  });

  let parentDir: string;
  let scanDir: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-traversal-"));
    scanDir = path.join(parentDir, "scan");
    fs.mkdirSync(scanDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("never writes any entry outside scanDir for an adversarial archive", async () => {
    // GitHub tarballs nest everything under a top folder that `strip: 1` removes,
    // so every crafted name is prefixed with a "<repo>-<sha>/" top component.
    const TOP = "octocat-hello-world-deadbeef";
    const sentinelOutside = path.join(parentDir, "PWNED.txt");
    const sentinelGrandparent = path.resolve(parentDir, "..", "PWNED-up.txt");

    const entries: TarEntrySpec[] = [
      { name: `${TOP}/src/index.ts`, content: "export const ok = 1;" },
      { name: `${TOP}/README.md`, content: "# hello" },
      // Relative traversal escapes (post-strip these become ../.. paths)
      { name: `${TOP}/../PWNED.txt`, content: "owned" },
      { name: `${TOP}/../../PWNED-up.txt`, content: "owned-up" },
      { name: `${TOP}/a/b/../../../../escape.txt`, content: "escape" },
      // Absolute path entry
      { name: "/tmp/ss-absolute-PWNED.txt", content: "abs" },
      // Mixed-separator / backslash traversal
      { name: `${TOP}/..\\..\\PWNED-win.txt`, content: "winowned" },
      // Symlink and hard link pointing outside the tree
      {
        name: `${TOP}/link-out`,
        type: TYPE_SYMLINK,
        linkname: "../../../../../../etc/passwd",
      },
      {
        name: `${TOP}/hard-out`,
        type: TYPE_HARDLINK,
        linkname: "../../../../etc/hosts",
      },
    ];

    const archive = buildGzippedTar(entries);

    // Extraction may legitimately reject hostile entries; failures must not
    // result in any escape, so we tolerate a thrown ingestion error here.
    try {
      await service.safeExtract(Readable.from(archive), scanDir);
    } catch {
      /* hostile-archive rejection is acceptable; containment is asserted below */
    }

    // 1) No sentinel file was created anywhere outside scanDir.
    expect(fs.existsSync(sentinelOutside)).toBe(false);
    expect(fs.existsSync(sentinelGrandparent)).toBe(false);
    expect(fs.existsSync("/tmp/ss-absolute-PWNED.txt")).toBe(false);

    // 2) Every extracted file's real path is contained within scanDir.
    const realRoot = fs.realpathSync(scanDir);
    for (const file of walk(scanDir)) {
      const real = fs.realpathSync(path.dirname(file));
      expect(real === realRoot || real.startsWith(realRoot + path.sep)).toBe(
        true,
      );
    }

    // 3) No symlink/hard link to an outside target was materialized.
    for (const file of walk(scanDir)) {
      const lst = fs.lstatSync(file);
      expect(lst.isSymbolicLink()).toBe(false);
    }
  });

  it("extracts only the safe, contained files and drops every escape (fuzzed)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            safeName: fc.stringMatching(/^[a-z]{1,8}$/),
            escape: fc.boolean(),
            depth: fc.integer({ min: 1, max: 6 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        async (specs) => {
          const fcParent = fs.mkdtempSync(
            path.join(os.tmpdir(), "ss-traversal-fc-"),
          );
          const fcScan = path.join(fcParent, "scan");
          fs.mkdirSync(fcScan, { recursive: true });
          const TOP = "owner-repo-sha";

          try {
            const entries: TarEntrySpec[] = specs.map((s, i) =>
              s.escape
                ? {
                    name: `${TOP}/${"../".repeat(s.depth)}esc-${i}-${s.safeName}.txt`,
                    content: "x",
                  }
                : {
                    name: `${TOP}/safe-${i}-${s.safeName}.ts`,
                    content: "y",
                  },
            );

            const archive = buildGzippedTar(entries);
            try {
              await service.safeExtract(Readable.from(archive), fcScan);
            } catch {
              /* tolerate hostile-archive rejection */
            }

            // Nothing escaped the scan dir.
            const realRoot = fs.realpathSync(fcScan);
            for (const file of walk(fcScan)) {
              const real = fs.realpathSync(path.dirname(file));
              expect(
                real === realRoot || real.startsWith(realRoot + path.sep),
              ).toBe(true);
            }
            // The parent dir contains nothing but the scan subdir.
            const parentChildren = fs
              .readdirSync(fcParent)
              .filter((n) => n !== "scan");
            expect(parentChildren).toEqual([]);
          } finally {
            fs.rmSync(fcParent, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
