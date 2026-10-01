import {
  Component,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

const REMARK = [remarkGfm];
const REHYPE = [rehypeHighlight];
const COMPONENTS: Components = { a: Anchor, img: Image };

/** Whether an address leads to a web page outside the app. */
function onTheWeb(href: string): boolean {
  return /^https?:/i.test(href);
}

/**
 * A Markdown file rendered as GitHub renders it: with tables, task lists,
 * strikethrough, autolinks, footnotes and highlighted code.
 */
export function Rendered({ text }: { text: string }) {
  return (
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
 * link at all. Only the attributes Markdown and footnotes give a link pass.
 */
function Anchor({
  href = "",
  id,
  title,
  className,
  "aria-label": label,
  "aria-describedby": describedBy,
  children,
}: ComponentProps<"a">) {
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
      // Ids keep the encoding links have, as GitHub's do.
      document.getElementById(href.slice(1))?.scrollIntoView();
    };
    return <a {...attributes} href={href} onClick={scroll} />;
  }
  if (onTheWeb(href)) {
    return <a {...attributes} href={href} target="_blank" rel="noreferrer" />;
  }
  if (href.startsWith("mailto:")) return <a {...attributes} href={href} />;
  return <span>{children}</span>;
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
