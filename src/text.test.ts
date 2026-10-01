// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decode, encode, sameBytes } from "./text.ts";

const utf8 = (text: string) => new TextEncoder().encode(text);
const BOM = [0xef, 0xbb, 0xbf];

function bytes(...values: number[]) {
  return new Uint8Array(values);
}

describe("decode", () => {
  it("reads UTF-8 text, keeping its line breaks", () => {
    expect(decode(utf8("# Plan\n\n- café\n"))).toEqual({
      text: "# Plan\n\n- café\n",
      bom: false,
      lineBreak: "\n",
      readOnly: undefined,
    });
  });

  it.each([
    ["\r\n", "a\r\nb\r\n"],
    ["\r", "a\rb\r"],
    ["\n", "a\nb"],
  ])("finds the file's line break, %j", (lineBreak, text) => {
    expect(decode(utf8(text))).toMatchObject({
      text,
      lineBreak,
      readOnly: undefined,
    });
  });

  it("gives a file without line breaks the usual one", () => {
    expect(decode(utf8("one line"))).toMatchObject({
      lineBreak: "\n",
      readOnly: undefined,
    });
  });

  it("sets the byte order mark apart, so the text starts with the file's own", () => {
    expect(decode(bytes(...BOM, ...utf8("---\ntitle: Plan\n---\n")))).toEqual({
      text: "---\ntitle: Plan\n---\n",
      bom: true,
      lineBreak: "\n",
      readOnly: undefined,
    });
  });

  it("keeps a second byte order mark, which is part of the text", () => {
    expect(decode(bytes(...BOM, ...BOM, 0x61))).toMatchObject({
      text: "﻿a",
      bom: true,
    });
  });

  it.each([
    ["\r\n then \n", "a\r\nb\nc"],
    ["\n then \r\n", "a\nb\r\nc"],
    ["\n then \r", "a\nb\rc"],
    ["\r\n then \r", "a\r\nb\rc"],
  ])("leaves read-only a file whose line breaks mix, %s", (_, text) => {
    expect(decode(utf8(text))).toMatchObject({
      text,
      readOnly: "mixed-line-breaks",
    });
  });

  it.each([
    ["a Latin-1 byte", bytes(0x63, 0x61, 0x66, 0xe9)],
    ["a cut-off sequence", bytes(0x61, 0xe2, 0x82)],
    ["an overlong encoding", bytes(0xc0, 0xaf)],
    ["an encoded surrogate", bytes(0xed, 0xa0, 0x80)],
    ["UTF-16", bytes(0xff, 0xfe, 0x61, 0x00)],
  ])("shows, read-only, a file that is not UTF-8: %s", (_, content) => {
    const decoded = decode(content);

    expect(decoded.readOnly).toBe("not-utf8");
    expect(decoded.text).toContain("�");
  });

  it("decodes an empty file", () => {
    expect(decode(bytes())).toEqual({
      text: "",
      bom: false,
      lineBreak: "\n",
      readOnly: undefined,
    });
  });
});

describe("encode", () => {
  it.each([
    ["LF", utf8("# Plan\n\n- [ ] café 🎉\n")],
    ["CRLF", utf8("# Plan\r\n\r\n- [ ] tea\r\n")],
    ["CR", utf8("a\rb")],
    ["no final line break", utf8("a\nb")],
    ["a byte order mark", bytes(...BOM, ...utf8("a\r\nb\r\n"))],
    ["a byte order mark only", bytes(...BOM)],
    ["two byte order marks", bytes(...BOM, ...BOM, 0x61)],
    ["a noncharacter", utf8("a￾b")],
    ["an empty file", bytes()],
  ])("gives back the bytes it decoded, with %s", (_, content) => {
    const { text, bom } = decode(content);

    expect(encode(text, { bom })).toEqual(content);
  });

  it("puts the byte order mark back first", () => {
    expect(encode("a\nb", { bom: true })).toEqual(
      bytes(...BOM, 0x61, 0x0a, 0x62),
    );
  });
});

describe("sameBytes", () => {
  it("tells whether two contents hold the same bytes", () => {
    expect(sameBytes(bytes(1, 2, 3), bytes(1, 2, 3))).toBe(true);
    expect(sameBytes(bytes(), bytes())).toBe(true);
    expect(sameBytes(bytes(1, 2, 3), bytes(1, 2, 4))).toBe(false);
    expect(sameBytes(bytes(1, 2, 3), bytes(1, 2))).toBe(false);
  });
});
