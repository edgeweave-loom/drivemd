import {
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryOptions,
} from "@tanstack/react-query";
import {
  Children,
  Component,
  createContext,
  useCallback,
  memo,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import Markdown, {
  type Components,
  type ExtraProps,
  type Options,
} from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, {
  defaultSchema,
  type Options as Schema,
} from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkBreaks from "remark-breaks";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { CALLOUT_TYPES, remarkCallouts } from "./callouts.ts";
import { useDrive } from "./drive-context.ts";
import { inDrive } from "./drive-web.ts";
import {
  FOLDER,
  GOOGLE_TYPES,
  isMarkdown,
  TooLargeError,
  type FileMetadata,
  type FileRef,
} from "./drive.ts";
import { Link } from "./Link.tsx";
import {
  remarkBlockIds,
  remarkComments,
  remarkHighlights,
  remarkInlineFootnotes,
  remarkTags,
  remarkWikiLinks,
} from "./obsidian.ts";
import { remarkProperties } from "./properties.ts";
import {
  imageQuery,
  MAX_CONTENT,
  MAX_IMAGE,
  metadataQuery,
  noteQuery,
  resolveQuery,
  vaultLinkQuery,
} from "./queries.ts";
import { hashOf, onTheWeb, relativePath, type Found } from "./resolve.ts";
import { toggleTask } from "./tasks.ts";
import { hrefOf } from "./router.ts";
import { linkPartHash, partHash, showPart, targetOf } from "./parts.ts";
import { partOf } from "./sections.ts";
import { decode } from "./text.ts";
import type { VaultLink } from "./vault-links.ts";
import type { Vault } from "./vault-settings.ts";
import { remarkEscapes } from "./written.ts";

type Plugins = NonNullable<Options["remarkPlugins"]>;

const REMARK: Plugins = [remarkGfm, remarkFrontmatter, remarkProperties];

// A footnote's way back to its reference is an arrow shown as text: iOS draws
// the arrow alone as an emoji.
const REMARK_REHYPE = { footnoteBackContent: "\u21A9\uFE0E" };

/** The rehype plugins for a note, sanitizing with the given rules, else GitHub's. */
function rehype(schema?: Schema): Plugins {
  // Raw HTML is parsed, headings get ids, then the rules sanitize it all,
  // prefixing ids so that none can stand for one of the app's own. Code is
  // highlighted last, with classes the sanitizer would drop.
  return [rehypeRaw, rehypeSlug, [rehypeSanitize, schema], rehypeHighlight];
}

// GitHub's rules, and what Obsidian's syntax renders to, which they drop.
const VAULT_SCHEMA: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), "dataWikilink"],
    img: [...(defaultSchema.attributes?.img ?? []), "dataEmbed"],
    details: [
      ["className", "callout"],
      ["dataCallout", ...CALLOUT_TYPES],
    ],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", "callout", "callout-title", "callout-content", "embed"],
      ["dataCallout", ...CALLOUT_TYPES],
      "dataEmbed",
    ],
    span: [["className", "tag"]],
    summary: [
      ...(defaultSchema.attributes?.summary ?? []),
      ["className", "callout-title"],
    ],
  },
};

const GITHUB = { remark: REMARK, rehype: rehype() };
const OBSIDIAN = {
  // Escapes are noted first, then comments go, since what they hide is no
  // other syntax.
  remark: [
    ...REMARK,
    remarkEscapes,
    remarkComments,
    remarkCallouts,
    remarkInlineFootnotes,
    remarkHighlights,
    remarkBlockIds,
    remarkWikiLinks,
    remarkTags,
  ],
  rehype: rehype(VAULT_SCHEMA),
};
// Obsidian shows a single line break as one, where Markdown joins the lines.
const OBSIDIAN_BREAKS = {
  ...OBSIDIAN,
  remark: [...OBSIDIAN.remark, remarkBreaks],
};

// A note an embed shows keeps no ids, which those of the note around it
// already stand for.
const EMBED_SCHEMA: Schema = {
  ...VAULT_SCHEMA,
  attributes: {
    ...VAULT_SCHEMA.attributes,
    "*": (VAULT_SCHEMA.attributes?.["*"] ?? []).filter(
      (attribute) => attribute !== "id" && attribute !== "name",
    ),
  },
};
const EMBEDDED = { ...OBSIDIAN, rehype: rehype(EMBED_SCHEMA) };
const EMBEDDED_BREAKS = { ...OBSIDIAN_BREAKS, rehype: rehype(EMBED_SCHEMA) };

/**
 * How a note renders: as Obsidian renders it in a vault, without ids when an
 * embed shows it, else as GitHub.
 */
function pluginsFor(vault: Vault | undefined, embedded: boolean) {
  if (!vault) return GITHUB;
  const breaks = !vault.settings.strictLineBreaks;
  if (embedded) return breaks ? EMBEDDED_BREAKS : EMBEDDED;
  return breaks ? OBSIDIAN_BREAKS : OBSIDIAN;
}
const COMPONENTS: Components = {
  a: Anchor,
  div: Division,
  img: Image,
  li: ListItem,
  input: Checkbox,
};

// Embeds of notes in embeds of notes show this deep at most.
const MAX_EMBEDS = 3;

/** The folder the note sits in, where its relative links start. */
const NoteFolder = createContext<FileRef | undefined>(undefined);

/** The vault the note sits in, where its links lead as Obsidian's do. */
const NoteVault = createContext<Vault | undefined>(undefined);

/** The notes shown, the outermost first, down to the one an embed shows. */
const Shown = createContext<string[]>([]);

/** The note an embed shows, whose page its links to its own parts open. */
const EmbeddedPage = createContext<FileRef | undefined>(undefined);

/** The note's text, and what changes it when a task's checkbox is tapped. */
const Tasks = createContext<
  { text: string; edit: (text: string) => void } | undefined
>(undefined);

/** Where the list item around a checkbox starts in the note's text. */
const TaskAt = createContext<number | undefined>(undefined);

/**
 * A Markdown file rendered as GitHub renders it: with tables, task lists,
 * strikethrough, autolinks, footnotes, highlighted code, sanitized HTML and
 * front matter as a table of properties. A note in an Obsidian vault renders
 * the syntax Obsidian adds as Obsidian does.
 */
export function Rendered({
  text,
  folder,
  vault,
  note,
  onEdit,
}: {
  text: string;
  /** The folder the note sits in, if known: relative links start there. */
  folder?: FileRef | undefined;
  /** The Obsidian vault the note sits in, if it does. */
  vault?: Vault | undefined;
  /** The note, which its embeds of notes never show again. */
  note?: FileRef | undefined;
  /** Takes the text with a task checked or unchecked, if the user may edit. */
  onEdit?: ((text: string) => void) | undefined;
}) {
  const outer = useContext(Shown);
  // An embed's note shows within another: none of its ids may stand for
  // one of that note's.
  const embedded = outer.length > 0;
  const plugins = pluginsFor(vault, embedded);
  const noteId = note?.id;
  const shown = useMemo(
    () => (noteId === undefined ? outer : [...outer, noteId]),
    [outer, noteId],
  );
  // The same folder and vault, as the page renders again, so that embeds
  // need not render again with it.
  const folderId = folder?.id;
  const folderKey = folder?.resourceKey;
  const inFolder = useMemo(
    () =>
      folderId === undefined
        ? undefined
        : { id: folderId, resourceKey: folderKey },
    [folderId, folderKey],
  );
  const rootId = vault?.root.id;
  const rootKey = vault?.root.resourceKey;
  const strict = vault?.settings.strictLineBreaks;
  const inVault = useMemo(
    () =>
      rootId === undefined || strict === undefined
        ? undefined
        : {
            root: { id: rootId, resourceKey: rootKey },
            settings: { strictLineBreaks: strict },
          },
    [rootId, rootKey, strict],
  );
  return (
    <Shown value={shown}>
      <EmbeddedPage value={embedded ? note : undefined}>
        <NoteVault value={inVault}>
          <NoteFolder value={inFolder}>
            <Tasks value={onEdit && { text, edit: onEdit }}>
              <Fallible text={text}>
                <div className={vault ? "markdown obsidian" : "markdown"}>
                  <Markdown
                    remarkPlugins={plugins.remark}
                    remarkRehypeOptions={REMARK_REHYPE}
                    rehypePlugins={plugins.rehype}
                    components={COMPONENTS}
                  >
                    {text}
                  </Markdown>
                </div>
              </Fallible>
            </Tasks>
          </NoteFolder>
        </NoteVault>
      </EmbeddedPage>
    </Shown>
  );
}

/** A list item, which tells a task's checkbox where its text starts. */
function ListItem({ node, ...props }: ComponentProps<"li"> & ExtraProps) {
  return (
    <TaskAt value={node?.position?.start.offset}>
      <li {...props} />
    </TaskAt>
  );
}

/**
 * A task's checkbox, which a tap checks or unchecks in the note's text when
 * the user may edit it. One that no Markdown task marker stands for, as in
 * a task list written in HTML, stays as it is.
 */
function Checkbox({
  node,
  checked = false,
}: ComponentProps<"input"> & ExtraProps) {
  const tasks = useContext(Tasks);
  const offset = useContext(TaskAt);
  // A task's own checkbox comes from its marker, so it has no place of its
  // own in the text, where one written in HTML does.
  const toggled =
    tasks && offset !== undefined && !node?.position
      ? toggleTask(tasks.text, offset)
      : undefined;
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={toggled === undefined}
      onChange={() => {
        if (toggled !== undefined) tasks?.edit(toggled);
      }}
    />
  );
}

/**
 * Shows the text as written when rendering it fails, as notes nested deeper
 * than the renderer's stack make it, rather than the app failing as a whole.
 * A new text is rendered again.
 */
class Fallible extends Component<
  { text: string; children: ReactNode },
  { text: string; failed: boolean }
> {
  override state = { text: this.props.text, failed: false };

  static getDerivedStateFromProps(
    { text }: { text: string },
    state: { text: string },
  ) {
    return text === state.text ? null : { text, failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <>
        <p role="alert" className="failure">
          DriveMD could not render this note, so it shows as written.
        </p>
        <pre className="source">{this.props.text}</pre>
      </>
    );
  }
}

/**
 * A link: web pages open in a new tab, and links within the page scroll to
 * their target. An address the renderer emptied, such as a script, is no
 * link at all, and neither is an anchor that marks a target for those links.
 * Only the attributes Markdown, HTML anchors and footnotes give a link pass.
 */
function Anchor({
  href = "",
  id,
  name,
  title,
  className,
  "aria-label": label,
  "aria-describedby": describedBy,
  "data-wikilink": wikiLink,
  children,
}: ComponentProps<"a"> & {
  /** The older way HTML marks a target, which React does not type. */
  name?: string;
  /** What an Obsidian link leads to, as written: `Note#Heading`. */
  "data-wikilink"?: string;
}) {
  const vault = useContext(NoteVault);
  const attributes = {
    id,
    title,
    className,
    "aria-label": label,
    "aria-describedby": describedBy,
    children,
  };
  // A link without text cannot be tapped, so it asks Drive nothing.
  const tappable = Children.count(children) > 0;
  if (vault && wikiLink && tappable) {
    const { path, parts } = targetOf(wikiLink);
    // Of headings under one another, the last names the part.
    const hash = partHash(parts.at(-1) ?? "");
    if (path === "") return <PartLink {...attributes} href={hash} />;
    return <VaultLink {...attributes} path={path.split("/")} hash={hash} />;
  }
  if (href.startsWith("#")) return <PartLink {...attributes} href={href} />;
  if (onTheWeb(href)) {
    return <a {...attributes} href={href} target="_blank" rel="noreferrer" />;
  }
  if (href.startsWith("mailto:")) return <a {...attributes} href={href} />;
  const path = relativePath(href);
  if (path && tappable) {
    return vault ? (
      <VaultLink
        {...attributes}
        path={path}
        hash={linkPartHash(hashOf(href))}
      />
    ) : (
      <DriveLink {...attributes} path={path} hash={hashOf(href)} />
    );
  }
  // A target for links within the page, which HTML may mark by name.
  return <a {...attributes} id={id ?? name} />;
}

/**
 * A link to a part of the note, which scrolls to it, or opens the page of the
 * note an embed shows at that part.
 */
function PartLink({ href, ...attributes }: LinkAttributes & { href: string }) {
  const page = useContext(EmbeddedPage);
  if (page) {
    return (
      <Link {...attributes} to={hrefOf({ name: "file", file: page }) + href} />
    );
  }
  const scroll = (event: MouseEvent) => {
    // The address stays the page's own, with the path taken in history.
    event.preventDefault();
    showPart(href.slice(1));
  };
  return <a {...attributes} href={href} onClick={scroll} />;
}

/**
 * Whether the element came near the screen, and the ref that watches it.
 * Links and images wait for it before they ask Drive anything, so that a
 * note with thousands of them asks only for those the user scrolls to.
 */
function useSeen(): [
  boolean,
  (element: Element | null) => (() => void) | undefined,
] {
  const [seen, setSeen] = useState(false);
  const near = useCallback((element: Element | null) => {
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some(({ isIntersecting }) => isIntersecting)) return;
        observer.disconnect();
        setSeen(true);
      },
      { rootMargin: "50%" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [seen, near];
}

/** The attributes a link keeps, whatever it leads to. */
type LinkAttributes = Pick<
  ComponentProps<"a">,
  "id" | "title" | "className" | "aria-label" | "aria-describedby"
> & { children: ReactNode };

/**
 * A relative link, which leads where its path does in Drive from the note's
 * folder: a Markdown file opens in the app, at the part its `#` names, and so
 * does a folder; another file opens in Google Drive, and a link to nothing is
 * faded.
 */
function DriveLink({
  path,
  hash,
  ...attributes
}: LinkAttributes & { path: string[]; hash: string }) {
  const folder = useContext(NoteFolder);
  if (!folder) return <Unresolved {...attributes} />;
  return <Resolved {...attributes} folder={folder} path={path} hash={hash} />;
}

function Resolved({
  folder,
  path,
  hash,
  ...attributes
}: LinkAttributes & { folder: FileRef; path: string[]; hash: string }) {
  const { drive } = useDrive();
  const client = useQueryClient();
  const [seen, near] = useSeen();
  const found = useQuery({
    ...resolveQuery(drive, client, folder, path),
    enabled: seen,
  });
  if (!seen) return <span {...attributes} ref={near} />;
  if (found.isError) {
    return (
      <span
        {...attributes}
        title="Google Drive could not say where this link leads"
      />
    );
  }
  if (found.isPending) return <span {...attributes} />;
  if (!found.data) return <Unresolved {...attributes} />;
  return <LinkTo {...attributes} found={found.data} hash={hash} />;
}

/**
 * A link to what a link in a note of a vault leads to, as Obsidian finds it.
 * When Drive left some drives out of the search, the link is not called
 * broken: it may lead to a note in one of them.
 */
function VaultLink({
  path,
  hash,
  ...attributes
}: LinkAttributes & { path: string[]; hash: string }) {
  const vault = useContext(NoteVault);
  const folder = useContext(NoteFolder);
  if (!vault || !folder) return <Unresolved {...attributes} />;
  return (
    <InVault
      {...attributes}
      from={{ vault: vault.root, folder }}
      path={path}
      hash={hash}
    />
  );
}

function InVault({
  from,
  path,
  hash,
  ...attributes
}: LinkAttributes & {
  from: { vault: FileRef; folder: FileRef };
  path: string[];
  hash: string;
}) {
  const { drive } = useDrive();
  const client = useQueryClient();
  const [seen, near] = useSeen();
  const link = useQuery({
    ...vaultLinkQuery(drive, client, from, path),
    enabled: seen,
  });
  if (!seen) return <span {...attributes} ref={near} />;
  if (link.isError) {
    return (
      <span
        {...attributes}
        title="Google Drive could not say where this link leads"
      />
    );
  }
  if (link.isPending) return <span {...attributes} />;
  const { found, incomplete } = link.data;
  if (found) return <LinkTo {...attributes} found={found} hash={hash} />;
  if (!incomplete) return <Unresolved {...attributes} />;
  return (
    <span
      {...attributes}
      title="Google Drive did not search every drive, so this link may lead to a note it left out"
    />
  );
}

/**
 * A link to what a link in a note found in Drive: a folder or a Markdown file
 * opens in the app, the file at the part `hash` names, and another file opens
 * in Google Drive.
 */
function LinkTo({
  found: { ref, name, mimeType },
  hash,
  ...attributes
}: LinkAttributes & { found: Found; hash: string }) {
  if (mimeType === FOLDER) {
    return (
      <Link {...attributes} to={hrefOf({ name: "folder", folder: ref })} />
    );
  }
  if (!mimeType.startsWith(GOOGLE_TYPES) && isMarkdown(name)) {
    return (
      <Link {...attributes} to={hrefOf({ name: "file", file: ref }) + hash} />
    );
  }
  return (
    <a {...attributes} href={inDrive(ref)} target="_blank" rel="noreferrer" />
  );
}

function Unresolved(attributes: LinkAttributes) {
  return (
    <span
      {...attributes}
      className="unresolved"
      title="Not found in Google Drive"
    />
  );
}

/**
 * An image. One on another site is not loaded, so that a note cannot make
 * the app call that site: it is a link to open in a new tab. A relative one
 * is read from Drive, and so is an Obsidian embed.
 */
function Image({
  src,
  alt = "",
  width,
  height,
  "data-embed": embed,
}: ComponentProps<"img"> & {
  /** What an Obsidian embed shows, as written: `image.png`, `Note#Heading`. */
  "data-embed"?: string;
}) {
  const vault = useContext(NoteVault);
  if (vault && embed !== undefined) {
    // A size in pixels, as an embed gives it, whatever HTML says.
    const pixels = (value: string | number | undefined) => {
      const written = value?.toString();
      return written !== undefined && /^\d+$/.test(written)
        ? written
        : undefined;
    };
    return (
      <Embed
        target={embed}
        alt={alt}
        size={{ width: pixels(width), height: pixels(height) }}
      />
    );
  }
  if (typeof src !== "string") return <span>{alt}</span>;
  if (onTheWeb(src)) return <ImageLink href={src} label={alt || src} />;
  const path = relativePath(src);
  if (!path) return <span>{alt}</span>;
  return <DriveImage path={path} alt={alt} />;
}

function ImageLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="image-link">
      Image: {label}
    </a>
  );
}

/** An image's size, as an embed gives it. */
interface Size {
  width: string | undefined;
  height: string | undefined;
}

/**
 * An image where its path leads in Drive, from the note's folder, or as
 * Obsidian finds it in a vault.
 */
function DriveImage({ path, alt }: { path: string[]; alt: string }) {
  const folder = useContext(NoteFolder);
  const vault = useContext(NoteVault);
  if (!folder) return <Unresolved>{alt}</Unresolved>;
  if (!vault) return <RelativeImage folder={folder} path={path} alt={alt} />;
  return (
    <VaultImage
      from={{ vault: vault.root, folder }}
      path={path}
      alt={alt}
      size={undefined}
      other={undefined}
    />
  );
}

function RelativeImage({
  folder,
  path,
  alt,
}: {
  folder: FileRef;
  path: string[];
  alt: string;
}) {
  const { drive } = useDrive();
  const client = useQueryClient();
  return (
    <ImageInDrive
      lookup={resolveQuery(drive, client, folder, path)}
      alt={alt}
    />
  );
}

/** An image as Obsidian finds it in a vault, or what `other` shows instead. */
function VaultImage({
  from,
  path,
  alt,
  size,
  other,
}: {
  from: { vault: FileRef; folder: FileRef };
  path: string[];
  alt: string;
  size: Size | undefined;
  other: ((found: Found) => ReactNode) | undefined;
}) {
  const { drive } = useDrive();
  const client = useQueryClient();
  return (
    <ImageInDrive
      lookup={{ ...vaultLinkQuery(drive, client, from, path), select: foundIn }}
      alt={alt}
      size={size}
      other={other}
    />
  );
}

/**
 * What an Obsidian embed shows: an image, sized as the embed says, or a link
 * to anything else it finds, a note or a PDF say, at the part it names.
 */
function Embed({
  target,
  alt,
  size,
}: {
  target: string;
  alt: string;
  size: Size;
}) {
  const folder = useContext(NoteFolder);
  const vault = useContext(NoteVault);
  if (!folder || !vault) return <Unresolved>{alt}</Unresolved>;
  const { path, parts } = targetOf(target);
  const hash = partHash(parts.at(-1) ?? "");
  return (
    <VaultImage
      from={{ vault: vault.root, folder }}
      path={path.split("/")}
      alt={alt}
      size={size}
      other={(found) => (
        <LinkTo found={found} hash={hash}>
          {alt}
        </LinkTo>
      )}
    />
  );
}

/**
 * What a link in a vault found: null for nothing, or "incomplete" when Drive
 * left some drives out of the search.
 */
function foundIn({ found, incomplete }: VaultLink) {
  return found ?? (incomplete ? ("incomplete" as const) : null);
}

/**
 * An image where a lookup finds it in Drive, read with the user's token once
 * it comes near the screen. One that is not an image, that the user may not
 * download, or that holds over 10 MB is a link to Google Drive; `other`
 * shows what is not an image at all, if given.
 */
function ImageInDrive<Answer, Key extends QueryKey>({
  lookup,
  alt,
  size,
  other,
}: {
  lookup: UseQueryOptions<Answer, Error, Found | null | "incomplete", Key>;
  alt: string;
  size?: Size | undefined;
  other?: ((found: Found) => ReactNode) | undefined;
}) {
  const { drive } = useDrive();
  const [seen, near] = useSeen();
  const found = useQuery({ ...lookup, enabled: seen });
  const image =
    found.data && found.data !== "incomplete" ? found.data : undefined;
  const elsewhere = image && other && !IMAGES.has(image.mimeType);
  // A path found already, by a link to it say, waits for the screen too.
  const details = useQuery(
    metadataQuery(drive, seen && !elsewhere ? image?.ref : undefined),
  );
  const file = details.data;
  const shown = file !== undefined && showsHere(file);
  const bytes = useQuery(imageQuery(drive, shown ? file : undefined));
  // An image waiting for the screen takes room, so that only the few the
  // screen holds come near it together.
  if (!seen) {
    return (
      <span className="image-pending" ref={near}>
        {alt}
      </span>
    );
  }
  if (found.data === null) return <Unresolved>{alt}</Unresolved>;
  if (found.data === "incomplete") {
    return (
      <span title="Google Drive did not search every drive, so this may be a file it left out">
        {alt}
      </span>
    );
  }
  if (elsewhere) return other(image);
  if (file && (!shown || bytes.error instanceof TooLargeError)) {
    return <ImageLink href={inDrive(file)} label={alt || file.name} />;
  }
  if (found.isError || details.isError || bytes.isError) {
    return <span title="Google Drive could not send this image">{alt}</span>;
  }
  if (!file || !bytes.data) return <span>{alt}</span>;
  return <BlobImage bytes={bytes.data} file={file} alt={alt} size={size} />;
}

// The images every browser shows. SVG is left out: it can hold script, which
// an image does not run, but a tab opened on it might.
const IMAGES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Whether the viewer shows the file as an image, rather than a link. */
function showsHere(file: FileMetadata): boolean {
  return (
    IMAGES.has(file.mimeType) &&
    file.capabilities.canDownload &&
    (file.size === undefined || file.size <= MAX_IMAGE)
  );
}

/**
 * An image of the bytes, through an object URL that lives as long as the
 * image shows; a link to Google Drive when the browser cannot decode them.
 */
function BlobImage({
  bytes,
  file,
  alt,
  size,
}: {
  bytes: Uint8Array<ArrayBuffer>;
  file: FileMetadata;
  alt: string;
  size: Size | undefined;
}) {
  const [broken, setBroken] = useState(false);
  const { mimeType: type } = file;
  const show = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image) return;
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      image.src = url;
      return () => {
        URL.revokeObjectURL(url);
      };
    },
    [bytes, type],
  );
  if (broken)
    return <ImageLink href={inDrive(file)} label={alt || file.name} />;
  return (
    <img
      alt={alt}
      width={size?.width}
      height={size?.height}
      ref={show}
      onError={() => {
        setBroken(true);
      }}
    />
  );
}

/** A block of the note: an embed of a note shows that note. */
function Division({ node, ...attributes }: ComponentProps<"div"> & ExtraProps) {
  const vault = useContext(NoteVault);
  // What an Obsidian embed shows, as written: `Note#Heading`.
  const embed = node?.properties.dataEmbed;
  if (typeof embed !== "string" || !vault) return <div {...attributes} />;
  return <NoteEmbed target={embed} id={attributes.id} />;
}

/**
 * A note an embed shows, or the part of it the embed names, read as it comes
 * near the screen. Its own embeds show this deep at most, and a note never
 * shows within itself: past that, and for a note DriveMD cannot show, the
 * embed is a link. It renders again only when what it shows changes, not as
 * the note around it does.
 */
const NoteEmbed = memo(function NoteEmbed({
  target,
  id,
}: {
  target: string;
  /** The block ID that names the embed, if any. */
  id: string | undefined;
}) {
  const vault = useContext(NoteVault);
  const folder = useContext(NoteFolder);
  const { path, parts } = targetOf(target);
  const name = path.split("/").at(-1) ?? path;
  if (!vault || !folder) return <p>{name}</p>;
  return (
    <EmbeddedNote
      from={{ vault: vault.root, folder }}
      vault={vault}
      path={path.split("/")}
      parts={parts}
      name={name}
      id={id}
    />
  );
});

function EmbeddedNote({
  from,
  vault,
  path,
  parts,
  name,
  id,
}: {
  from: { vault: FileRef; folder: FileRef };
  vault: Vault;
  path: string[];
  parts: string[];
  name: string;
  id: string | undefined;
}) {
  const { drive } = useDrive();
  const client = useQueryClient();
  const shown = useContext(Shown);
  const [seen, near] = useSeen();
  const part = parts.at(-1) ?? "";
  const link = useQuery({
    ...vaultLinkQuery(drive, client, from, path),
    enabled: seen,
  });
  const found = link.data?.found;
  const note =
    found &&
    !found.mimeType.startsWith(GOOGLE_TYPES) &&
    isMarkdown(found.name) &&
    !shown.includes(found.ref.id) &&
    shown.length <= MAX_EMBEDS
      ? found
      : undefined;
  const details = useQuery(metadataQuery(drive, note?.ref));
  const file = details.data;
  const readable =
    file !== undefined &&
    file.capabilities.canDownload &&
    (file.size === undefined || file.size <= MAX_CONTENT);
  const bytes = useQuery(noteQuery(drive, readable ? file : undefined));
  const text = useMemo(
    () => (bytes.data ? decode(bytes.data) : undefined),
    [bytes.data],
  );
  const content = useMemo(
    () => (text ? partOf(text.text, part) : undefined),
    [text, part],
  );
  const parent = file?.parents[0];
  const inFolder = useMemo(
    () => (parent === undefined ? undefined : { id: parent }),
    [parent],
  );
  if (!seen) {
    return (
      <div className="embed" id={id} ref={near}>
        {name}
      </div>
    );
  }
  if (link.isError) {
    return (
      <p title="Google Drive could not say what this embed shows">{name}</p>
    );
  }
  if (link.isPending) return <p className="hint">{name}</p>;
  if (!found) {
    return (
      <p>
        {link.data.incomplete ? (
          <span title="Google Drive did not search every drive, so this embed may show a note it left out">
            {name}
          </span>
        ) : (
          <Unresolved>{name}</Unresolved>
        )}
      </p>
    );
  }
  const title = (
    <LinkTo found={found} hash={partHash(part)}>
      {[name, ...parts].join(" > ")}
    </LinkTo>
  );
  if (!note || (file && !readable) || text?.readOnly === "not-utf8") {
    return <p>{title}</p>;
  }
  if (details.isError || bytes.isError) {
    return <p title="Google Drive could not send this note">{title}</p>;
  }
  if (!file || !text) return <p className="hint">{title}</p>;
  return (
    <div className="embed" id={id}>
      <p className="embed-title">{title}</p>
      {content === undefined ? (
        <p className="hint">This part is not in the note.</p>
      ) : (
        <Rendered text={content} folder={inFolder} vault={vault} note={file} />
      )}
    </div>
  );
}
