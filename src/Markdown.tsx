import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Component,
  createContext,
  useContext,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { useDrive } from "./drive-context.ts";
import { inDrive } from "./drive-web.ts";
import { FOLDER, GOOGLE_TYPES, isMarkdown, type FileRef } from "./drive.ts";
import { Link } from "./Link.tsx";
import { remarkProperties } from "./properties.ts";
import { resolveQuery } from "./queries.ts";
import { relativePath } from "./resolve.ts";
import { hrefOf } from "./router.ts";

const REMARK = [remarkGfm, remarkFrontmatter, remarkProperties];
// Raw HTML is parsed, headings get ids, then GitHub's rules sanitize it all,
// prefixing ids so that none can stand for one of the app's own. Code is
// highlighted last, with classes the sanitizer would drop.
const REHYPE = [rehypeRaw, rehypeSlug, rehypeSanitize, rehypeHighlight];
const COMPONENTS: Components = { a: Anchor, img: Image };

/** The folder the note sits in, where its relative links start. */
const NoteFolder = createContext<FileRef | undefined>(undefined);

/** Whether an address leads to a web page outside the app. */
function onTheWeb(href: string): boolean {
  return /^https?:/i.test(href);
}

/**
 * A Markdown file rendered as GitHub renders it: with tables, task lists,
 * strikethrough, autolinks, footnotes, highlighted code, sanitized HTML and
 * front matter as a table of properties.
 */
export function Rendered({
  text,
  folder,
}: {
  text: string;
  /** The folder the note sits in, if known: relative links start there. */
  folder?: FileRef | undefined;
}) {
  return (
    <NoteFolder value={folder}>
      <Fallible text={text}>
        <div className="markdown">
          <Markdown
            remarkPlugins={REMARK}
            rehypePlugins={REHYPE}
            components={COMPONENTS}
          >
            {text}
          </Markdown>
        </div>
      </Fallible>
    </NoteFolder>
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
  if (path) return <DriveLink path={path}>{children}</DriveLink>;
  // A target for links within the page, which HTML may mark by name.
  return <a {...attributes} id={id ?? name} />;
}

/**
 * A relative link, which leads where its path does in Drive from the note's
 * folder: a Markdown file or a folder opens in the app, another file opens in
 * Google Drive, and a link to nothing is faded.
 */
function DriveLink({
  path,
  children,
}: {
  path: string[];
  children: ReactNode;
}) {
  const folder = useContext(NoteFolder);
  if (!folder) return <Unresolved>{children}</Unresolved>;
  return (
    <Resolved folder={folder} path={path}>
      {children}
    </Resolved>
  );
}

function Resolved({
  folder,
  path,
  children,
}: {
  folder: FileRef;
  path: string[];
  children: ReactNode;
}) {
  const { drive } = useDrive();
  const client = useQueryClient();
  const found = useQuery(resolveQuery(drive, client, folder, path));
  if (found.isPending) return <span>{children}</span>;
  if (!found.data) return <Unresolved>{children}</Unresolved>;
  const { ref, name, mimeType } = found.data;
  if (mimeType === FOLDER) {
    return <Link to={hrefOf({ name: "folder", folder: ref })}>{children}</Link>;
  }
  if (!mimeType.startsWith(GOOGLE_TYPES) && isMarkdown(name)) {
    return <Link to={hrefOf({ name: "file", file: ref })}>{children}</Link>;
  }
  return (
    <a href={inDrive(ref)} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function Unresolved({ children }: { children: ReactNode }) {
  return (
    <span className="unresolved" title="Not found in Google Drive">
      {children}
    </span>
  );
}

/**
 * An image. One on another site is not loaded, so that a note cannot make
 * the app call that site: it is a link to open in a new tab.
 */
function Image({ src, alt }: ComponentProps<"img">) {
  if (typeof src === "string" && onTheWeb(src)) {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="image-link">
        Image: {alt === undefined || alt === "" ? src : alt}
      </a>
    );
  }
  return <span>{alt}</span>;
}
