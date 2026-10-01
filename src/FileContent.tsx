import { useQuery } from "@tanstack/react-query";
import { useDrive } from "./drive-context.ts";
import { TooLargeError, type FileMetadata } from "./drive.ts";
import { Loaded } from "./Loaded.tsx";
import { contentQuery, MAX_CONTENT } from "./queries.ts";
import { decode, type FileText } from "./text.ts";

const MEGABYTES = new Intl.NumberFormat("en", {
  style: "unit",
  unit: "megabyte",
  maximumFractionDigits: 1,
});

/** A Markdown file's content, once Drive has sent it. */
export function FileContent({ file }: { file: FileMetadata }) {
  if (!file.capabilities.canDownload) {
    return (
      <p>
        The file's owner does not let you download it, so DriveMD cannot show
        it. <InDrive file={file} />
      </p>
    );
  }
  if (file.size !== undefined && file.size > MAX_CONTENT) {
    return <TooLarge file={file} size={MEGABYTES.format(file.size / 1e6)} />;
  }
  return <Content file={file} />;
}

function Content({ file }: { file: FileMetadata }) {
  const { drive } = useDrive();
  const content = useQuery({ ...contentQuery(drive, file), select: decode });
  // The file grew since Drive gave its size.
  if (content.error instanceof TooLargeError) {
    return (
      <TooLarge
        file={file}
        size={`over ${MEGABYTES.format(MAX_CONTENT / 1e6)}`}
      />
    );
  }
  return (
    <Loaded query={content}>
      {(text) => {
        const reason = readOnly(file, text);
        return (
          <>
            {reason && <p className="badge read-only">{reason}</p>}
            <pre className="source">{text.text}</pre>
          </>
        );
      }}
    </Loaded>
  );
}

function TooLarge({ file, size }: { file: FileMetadata; size: string }) {
  return (
    <p>
      This file holds {size}, and DriveMD opens files up to{" "}
      {MEGABYTES.format(MAX_CONTENT / 1e6)}. <InDrive file={file} />
    </p>
  );
}

/** Why the user cannot edit the file, if they cannot. */
function readOnly(file: FileMetadata, text: FileText): string | undefined {
  if (file.locked) {
    return file.lockReason ? `Locked: ${file.lockReason}` : "Locked";
  }
  const { canModifyContent, canComment } = file.capabilities;
  if (!canModifyContent) return canComment ? "Comment only" : "View only";
  switch (text.readOnly) {
    case "not-utf8":
      return "Not UTF-8 text: DriveMD only shows it";
    case "mixed-line-breaks":
      return "Mixed line breaks: DriveMD only shows it";
    case undefined:
      return undefined;
  }
}

/** A link to the file in Google Drive, which opens what DriveMD cannot. */
function InDrive({ file }: { file: FileMetadata }) {
  const url = new URL(
    `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`,
  );
  if (file.resourceKey) url.searchParams.set("resourcekey", file.resourceKey);
  return (
    <a href={url.href} target="_blank" rel="noreferrer">
      Open it in Google Drive
    </a>
  );
}
