import { sha1, SHA1_LENGTH } from "../sha1.ts";
import type { EpubContainer } from "./container.ts";
import { EpubResourceError } from "./errors.ts";
import { CONTAINER_ROOT, resolveHref } from "./resource-path.ts";
import { parseXml } from "./xml.ts";

/**
 * Obfuscated fonts — the book scrambles the first few bytes of a font file so it
 * cannot be used as a standalone font. **This is not encryption**: the algorithm is
 * public and the key is written in the book itself (it is the book's own unique
 * identifier); the point is embedding licences, not secrecy.
 *
 * Which items are obfuscated, and with which scheme, is declared in
 * `META-INF/encryption.xml`.
 *
 * ## The support boundary: only the IDPF scheme
 *
 * | Algorithm | URI | frond |
 * | --- | --- | --- |
 * | IDPF (defined by the EPUB spec itself) | `http://www.idpf.org/2008/embedding` | decodes it |
 * | Adobe | `http://ns.adobe.com/pdf/enc#RC` | **explicit error** |
 * | Anything else (real encryption, e.g. DRM) | — | **explicit error** |
 *
 * The two schemes differ in both key derivation and length (IDPF: SHA-1 over the
 * whitespace-stripped identifier gives 20 bytes, masking the first 1040; Adobe: read
 * the UUID inside the identifier as hex into 16 bytes, masking the first 1024), so
 * using one to decode the other **always** yields broken bytes rather than something
 * approximately right.
 *
 * **The state of the evidence has to be stated plainly: this project has obtained no
 * evidence about obfuscated fonts at all.** Not one of the 33 sample books has a
 * `META-INF/encryption.xml`, and none embeds fonts either — so "which scheme is more
 * common" is neither confirmed nor refuted here. This boundary is drawn from the
 * spec, not from measured numbers. That is the same discipline ADR-0010 applies to
 * `primary-writing-mode`: with no evidence, say there is none rather than pretend
 * otherwise.
 *
 * **What it would take to overturn this**: a book using the Adobe scheme. At that
 * point what needs adding is the key derivation and the length, plus a new synthetic
 * fixture (ADR-0007: one ailment per file) — not the removal of the error here.
 */

/** Where OCF declares obfuscation and encryption. */
const ENCRYPTION_PATH = "META-INF/encryption.xml";

/** The IDPF font obfuscation algorithm. */
const IDPF_ALGORITHM = "http://www.idpf.org/2008/embedding";

/** IDPF masks only this many bytes at the head of the file, leaving the rest verbatim — 52 × 20, an exact multiple of the key. */
const IDPF_OBFUSCATED_LENGTH = 1040;

export interface FontObfuscation {
  /**
   * Restores this item if it was obfuscated, and returns it verbatim otherwise.
   *
   * Shaped as "ask once" rather than "ask whether, then decode yourself", because
   * the latter makes every place that takes bytes remember to ask — and the symptom
   * of forgetting is a page full of tofu, not an exception.
   */
  restore(path: string, bytes: Uint8Array): Uint8Array;
}

/**
 * Reads `META-INF/encryption.xml` to learn which of this book's items were
 * obfuscated.
 *
 * Not having the file is the norm (all 33 sample books lack it), in which case every
 * item is returned verbatim.
 */
export function readFontObfuscation(
  container: EpubContainer,
  identifier: string | undefined,
): FontObfuscation {
  const declarations = container.has(ENCRYPTION_PATH)
    ? readDeclarations(container.text(ENCRYPTION_PATH))
    : new Map<string, string>();

  return {
    restore(path, bytes) {
      const algorithm = declarations.get(path);
      if (algorithm === undefined) return bytes;
      if (algorithm !== IDPF_ALGORITHM) {
        throw new EpubResourceError(
          "unsupported-obfuscation",
          `${path} is obfuscated or encrypted with ${algorithm}; frond only decodes the IDPF scheme (${IDPF_ALGORITHM})`,
        );
      }
      if (identifier === undefined) {
        throw new EpubResourceError(
          "missing-obfuscation-key",
          `${path} is IDPF-obfuscated, but this book has no unique identifier, so the key cannot be derived`,
        );
      }
      return unmask(bytes, idpfKey(identifier));
    },
  };
}

/** Archive path → the declared algorithm URI. */
function readDeclarations(source: string): ReadonlyMap<string, string> {
  const document = parseXml(source, {
    reason: "malformed-container",
    label: ENCRYPTION_PATH,
  });

  const declarations = new Map<string, string>();
  for (const data of document.child("encryption")?.children("EncryptedData") ?? []) {
    const algorithm = data.child("EncryptionMethod")?.attribute("Algorithm");
    const uri = data.child("CipherData")?.child("CipherReference")?.attribute("URI");
    if (algorithm === undefined || uri === undefined) continue;

    // The URI is a URL relative to the package root and may likewise be encoded
    // (font filenames often carry spaces), so it goes through the same resolution as
    // the manifest and the TOC.
    const resolved = resolveHref(uri, CONTAINER_ROOT);
    if (resolved.kind !== "in-container") continue;
    declarations.set(resolved.path, algorithm);
  }
  return declarations;
}

/**
 * The IDPF key: SHA-1 over the UTF-8 bytes of the unique identifier with **all
 * whitespace removed**.
 *
 * The stripping is mandated by the spec (U+0020, U+0009, U+000D, U+000A) — books
 * commonly wrap the identifier across lines in the XML, and without stripping the
 * same book would derive different keys under different formatting.
 */
function idpfKey(identifier: string): Uint8Array {
  // The four code points the spec names are listed one by one rather than written as
  // `\s`: `\s` also covers whitespace such as U+00A0, and stripping one character too
  // many gives an entirely different key.
  const stripped = identifier.replaceAll(/[\u0020\u0009\u000d\u000a]/g, "");
  return sha1(new TextEncoder().encode(stripped));
}

/**
 * Masks the first 1040 bytes of the file with the key, cycled. XOR is its own
 * inverse, so obfuscating and restoring are the same operation — but **only over the
 * first 1040 bytes**; masking past that would destroy the rest of the font.
 */
function unmask(bytes: Uint8Array, key: Uint8Array): Uint8Array {
  const restored = Uint8Array.from(bytes);
  const end = Math.min(restored.length, IDPF_OBFUSCATED_LENGTH);
  for (let index = 0; index < end; index += 1) {
    restored[index] = restored[index]! ^ key[index % SHA1_LENGTH]!;
  }
  return restored;
}
