import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Children,
  Component,
  createContext,
  useCallback,
  useContext,
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
import { remarkProperties } from "./properties.ts";
import {
  imageQuery,
  MAX_IMAGE,
  metadataQuery,
  resolveQuery,
} from "./queries.ts";
import { onTheWeb, relativePath } from "./resolve.ts";
import { toggleTask } from "./tasks.ts";
import { hrefOf } from "./router.ts";
import type { VaultSettings } from "./vault-settings.ts";

type Plugins = NonNullable<Options["remarkPlugins"]>;

const REMARK: Plugins = [remarkGfm, remarkFrontmatter, remarkProperties];

/** The sanitizer's rules for a note: GitHub's, and the ones given. */
function rehype(schema?: Schema): Plugins {
  // Raw HTML is parsed, headings get ids, then the rules sanitize it all,
  // prefixing ids so that none can stand for one of the app's own. Code is
  // highlighted last, with classes the sanitizer would drop.
  return [rehypeRaw, rehypeSlug, [rehypeSanitize, schema], rehypeHighlight];
}

const attributes = defaultSchema.attributes ?? {};

// GitHub's rules, and what Obsidian's syntax renders to, which they drop.
const VAULT_SCHEMA: Schema = {
  ...defaultSchema,
  attributes: {
    ...attributes,
    details: [
      ["className", "callout"],
      ["dataCallout", ...CALLOUT_TYPES],
    ],
    div: [
      ...(attributes.div ?? []),
      ["className", "callout", "callout-title", "callout-content"],
      ["dataCallout", ...CALLOUT_TYPES],
    ],
    summary: [...(attributes.summary ?? []), ["className", "callout-title"]],
  },
};

const GITHUB = { remark: REMARK, rehype: rehype() };
const OBSIDIAN = {
  remark: [...REMARK, remarkCallouts],
  rehype: rehype(VAULT_SCHEMA),
};
// Obsidian shows a single line break as one, where Markdown joins the lines.
const OBSIDIAN_BREAKS = {
  ...OBSIDIAN,
  remark: [...OBSIDIAN.remark, remarkBreaks],
};

/** How a note renders: as Obsidian renders it in a vault, else as GitHub. */
function pluginsFor(vault: VaultSettings | undefined) {
  if (!vault) return GITHUB;
  return vault.strictLineBreaks ? OBSIDIAN : OBSIDIAN_BREAKS;
}
const COMPONENTS: Components = {
  a: Anchor,
  img: Image,
  li: ListItem,
  input: Checkbox,
};

/** The folder the note sits in, where its relative links start. */
const NoteFolder = createContext<FileRef | undefined>(undefined);

/** The note's text, and what changes it when a task's checkbox is tapped. */
const Tasks = createContext<
  { text: string; edit: (text: string) => void } | undefined
>(undefined);

/** Where the list item around a checkbox starts in the note's text. */
const TaskAt = createContext<number | undefined>(undefined);

/**
 * A Markdown file rendered as GitHub renders it: with tables, task lists,
 * strikethrough, autolinks, footnotes, highlighted code, sanitized HTML and
 * front matter as a table of properties. A note in an Obsidian vault breaks
 * its lines as Obsidian does.
 */
export function Rendered({
  text,
  folder,
  vault,
  onEdit,
}: {
  text: string;
  /** The folder the note sits in, if known: relative links start there. */
  folder?: FileRef | undefined;
  /** The settings of the Obsidian vault the note sits in, if it does. */
  vault?: VaultSettings | undefined;
  /** Takes the text with a task checked or unchecked, if the user may edit. */
  onEdit?: ((text: string) => void) | undefined;
}) {
  const plugins = pluginsFor(vault);
  return (
    <NoteFolder value={folder}>
      <Tasks value={onEdit && { text, edit: onEdit }}>
        <Fallible text={text}>
          <div className="markdown">
            <Markdown
              remarkPlugins={plugins.remark}
              rehypePlugins={plugins.rehype}
              components={COMPONENTS}
            >
              {text}
            </Markdown>
          </div>
        </Fallible>
      </Tasks>
    </NoteFolder>
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
  children,
}: ComponentProps<"a"> & {
  /** The older way HTML marks a target, which React does not type. */
  name?: string;
}) {
  const attributes = {
    id,
    title,
    className,
    "aria-label": label,
    "aria-describedby": describedBy,
    children,
  };
  if (href.startsWith("#")) {
    const scroll = (event: MouseEvent) => {
      // The address stays the page's own, with the path taken in history.
      event.preventDefault();
      // Ids keep the encoding links have, and get the prefix the sanitizer
      // gives them all, as on GitHub.
      document
        .getElementById(`user-content-${href.slice(1)}`)
        ?.scrollIntoView();
    };
    return <a {...attributes} href={href} onClick={scroll} />;
  }
  if (onTheWeb(href)) {
    return <a {...attributes} href={href} target="_blank" rel="noreferrer" />;
  }
  if (href.startsWith("mailto:")) return <a {...attributes} href={href} />;
  const path = relativePath(href);
  // A link without text cannot be tapped, so it asks Drive nothing.
  if (path && Children.count(children) > 0) {
    return <DriveLink {...attributes} path={path} />;
  }
  // A target for links within the page, which HTML may mark by name.
  return <a {...attributes} id={id ?? name} />;
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
 * folder: a Markdown file or a folder opens in the app, another file opens in
 * Google Drive, and a link to nothing is faded.
 */
function DriveLink({
  path,
  ...attributes
}: LinkAttributes & { path: string[] }) {
  const folder = useContext(NoteFolder);
  if (!folder) return <Unresolved {...attributes} />;
  return <Resolved {...attributes} folder={folder} path={path} />;
}

function Resolved({
  folder,
  path,
  ...attributes
}: LinkAttributes & { folder: FileRef; path: string[] }) {
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
  const { ref, name, mimeType } = found.data;
  if (mimeType === FOLDER) {
    return (
      <Link {...attributes} to={hrefOf({ name: "folder", folder: ref })} />
    );
  }
  if (!mimeType.startsWith(GOOGLE_TYPES) && isMarkdown(name)) {
    return <Link {...attributes} to={hrefOf({ name: "file", file: ref })} />;
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
 * is read from Drive.
 */
function Image({ src, alt = "" }: ComponentProps<"img">) {
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

function DriveImage({ path, alt }: { path: string[]; alt: string }) {
  const folder = useContext(NoteFolder);
  if (!folder) return <Unresolved>{alt}</Unresolved>;
  return <ImageInDrive folder={folder} path={path} alt={alt} />;
}

/**
 * An image where its path leads in Drive, read with the user's token once it
 * comes near the screen. One that is not an image, that the user may not
 * download, or that holds over 10 MB is a link to Google Drive.
 */
function ImageInDrive({
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
  const [seen, near] = useSeen();
  const found = useQuery({
    ...resolveQuery(drive, client, folder, path),
    enabled: seen,
  });
  // A path found already, by a link to it say, waits for the screen too.
  const details = useQuery(
    metadataQuery(drive, seen ? found.data?.ref : undefined),
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
  if (file && (!shown || bytes.error instanceof TooLargeError)) {
    return <ImageLink href={inDrive(file)} label={alt || file.name} />;
  }
  if (found.isError || details.isError || bytes.isError) {
    return <span title="Google Drive could not send this image">{alt}</span>;
  }
  if (!file || !bytes.data) return <span>{alt}</span>;
  return <BlobImage bytes={bytes.data} file={file} alt={alt} />;
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
}: {
  bytes: Uint8Array<ArrayBuffer>;
  file: FileMetadata;
  alt: string;
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
      ref={show}
      onError={() => {
        setBroken(true);
      }}
    />
  );
}
