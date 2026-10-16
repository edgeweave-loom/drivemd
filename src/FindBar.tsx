import {
  closeSearchPanel,
  findNext,
  findPrevious,
  replaceAll,
  replaceNext,
  SearchQuery,
} from "@codemirror/search";
import type { Command } from "@codemirror/view";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { MAX_COUNTED, type Matches } from "./find.ts";
import { Icon } from "./Icon.tsx";
import { keepFocus } from "./keys.ts";
import { useLayout } from "./layout.ts";
import { moveInMenu } from "./menu.ts";

function counted({ total, current }: Matches): string {
  const all = total > MAX_COUNTED ? `${String(MAX_COUNTED)}+` : String(total);
  if (current !== undefined) return `${String(current)} of ${all}`;
  if (total === 0) return "No matches";
  return total === 1 ? "1 match" : `${all} matches`;
}

const OPTIONS = [
  { name: "Match case", option: "caseSensitive" },
  { name: "Whole word", option: "wholeWord" },
  { name: "Regular expression", option: "regexp" },
] as const;

/**
 * Find in note's bar, which drives the editor's search: a field, the
 * matches' count, the previous and next match, a menu of the query's
 * options and of Replace, which shows a second row, and a way out. On a
 * phone it takes the app bar's place, its way out a Back at its start.
 * Its buttons leave the focus, and a touch screen's keyboard, where they
 * are, so that nothing moves as iOS would pan the page back.
 */
export function FindBar({
  query,
  matches,
  field,
  onQuery,
  onCommand,
  onKey,
}: {
  query: SearchQuery;
  matches: Matches;
  field: RefObject<HTMLInputElement | null>;
  onQuery: (query: SearchQuery) => void;
  onCommand: (command: Command) => void;
  /** Runs the editor's key bindings for its search, Escape among them. */
  onKey: (event: KeyboardEvent) => boolean;
}) {
  const id = useId();
  const phone = useLayout() === "phone";
  const menu = useRef<HTMLDivElement>(null);
  const replaceField = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState(false);
  const change = (
    spec: Partial<
      Pick<
        SearchQuery,
        "search" | "caseSensitive" | "wholeWord" | "regexp" | "replace"
      >
    >,
  ) => {
    const { search, caseSensitive, wholeWord, regexp, literal, replace } =
      query;
    onQuery(
      new SearchQuery({
        search,
        caseSensitive,
        wholeWord,
        regexp,
        literal,
        replace,
        ...spec,
      }),
    );
  };
  const keys = (event: ReactKeyboardEvent, enter: () => void) => {
    if (event.key === "Enter") {
      event.preventDefault();
      enter();
    } else if (onKey(event.nativeEvent)) {
      event.preventDefault();
    }
  };
  const close = (
    <button
      type="button"
      onMouseDown={keepFocus}
      className="icon-button"
      aria-label="Close find"
      title="Close find"
      onClick={() => {
        onCommand(closeSearchPanel);
      }}
    >
      <Icon name={phone ? "arrow_back" : "close"} />
    </button>
  );
  return (
    <div role="search" aria-label="Find in note" className="find-bar">
      <div className="find-row">
        {phone && close}
        <label className="find-field">
          {!phone && <Icon name="search" />}
          <input
            ref={field}
            type="text"
            aria-label="Find"
            placeholder="Find in note"
            value={query.search}
            aria-invalid={query.search !== "" && !query.valid}
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => {
              change({ search: event.target.value });
            }}
            onKeyDown={(event) => {
              keys(event, () => {
                onCommand(event.shiftKey ? findPrevious : findNext);
              });
            }}
          />
        </label>
        {query.valid && <span className="find-count">{counted(matches)}</span>}
        <button
          type="button"
          onMouseDown={keepFocus}
          className="icon-button"
          aria-label="Previous match"
          title="Previous match"
          disabled={matches.total === 0}
          onClick={() => {
            onCommand(findPrevious);
          }}
        >
          <Icon name="keyboard_arrow_up" />
        </button>
        <button
          type="button"
          onMouseDown={keepFocus}
          className="icon-button"
          aria-label="Next match"
          title="Next match"
          disabled={matches.total === 0}
          onClick={() => {
            onCommand(findNext);
          }}
        >
          <Icon name="keyboard_arrow_down" />
        </button>
        <button
          type="button"
          onMouseDown={keepFocus}
          className="icon-button find-more"
          popoverTarget={id}
          aria-haspopup="menu"
          aria-label="Find options"
          title="Find options"
        >
          <Icon name="more_vert" />
        </button>
        <div
          ref={menu}
          id={id}
          popover="auto"
          role="menu"
          aria-label="Find options"
          className="menu find-menu"
          onKeyDown={moveInMenu}
        >
          {OPTIONS.map(({ name, option }) => (
            <button
              key={option}
              type="button"
              onMouseDown={keepFocus}
              role="menuitemcheckbox"
              aria-checked={query[option]}
              onClick={() => {
                menu.current?.hidePopover();
                change({ [option]: !query[option] });
                field.current?.focus();
              }}
            >
              <Icon name="check" />
              {name}
            </button>
          ))}
          <hr />
          <button
            type="button"
            onMouseDown={keepFocus}
            role="menuitemcheckbox"
            aria-checked={replacing}
            onClick={() => {
              menu.current?.hidePopover();
              flushSync(() => {
                setReplacing(!replacing);
              });
              (replacing ? field : replaceField).current?.focus();
            }}
          >
            <Icon name="check" />
            Replace
          </button>
        </div>
        {!phone && close}
      </div>
      {replacing && (
        <div className="find-row">
          <label className="find-field">
            <input
              ref={replaceField}
              type="text"
              aria-label="Replace with"
              placeholder="Replace with"
              value={query.replace}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => {
                change({ replace: event.target.value });
              }}
              onKeyDown={(event) => {
                keys(event, () => {
                  onCommand(replaceNext);
                });
              }}
            />
          </label>
          <button
            type="button"
            onMouseDown={keepFocus}
            className="text"
            disabled={matches.total === 0}
            onClick={() => {
              onCommand(replaceNext);
            }}
          >
            Replace
          </button>
          <button
            type="button"
            onMouseDown={keepFocus}
            className="text"
            disabled={matches.total === 0}
            onClick={() => {
              onCommand(replaceAll);
            }}
          >
            Replace all
          </button>
        </div>
      )}
    </div>
  );
}
