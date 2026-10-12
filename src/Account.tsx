import { useId, useRef, type RefObject } from "react";
import { STANDALONE } from "./layout.ts";
import { SignOut } from "./SignOut.tsx";

/**
 * The signed-in account, as its initial, since Google gives DriveMD no
 * photo, and a menu: its address, the about page, which offers the source
 * that the AGPL asks for, and Sign out.
 */
export function Account({
  email,
  onSignOut,
}: {
  email: string;
  onSignOut: () => void;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="account"
        popoverTarget={id}
        aria-label={`Account, ${email}`}
      >
        {/* A character, not half of one. */}
        {Array.from(email)[0]?.toUpperCase()}
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="Account"
        className="menu account-menu"
      >
        <AccountItems
          email={email}
          onSignOut={onSignOut}
          button={button}
          menu={menu}
        />
      </div>
    </>
  );
}

/**
 * The account's part of a menu: its address, the about page and Sign out,
 * after which the focus goes back to the button that opened the menu.
 */
export function AccountItems({
  email,
  onSignOut,
  button,
  menu,
}: {
  email: string;
  onSignOut: () => void;
  button: RefObject<HTMLButtonElement | null>;
  menu: RefObject<HTMLDivElement | null>;
}) {
  // The Home Screen app has no Back button: the page opens in its window, so
  // that its Close button, or a swipe, returns to the app where it was left.
  const standalone = window.matchMedia(STANDALONE).matches;
  return (
    <>
      <p>{email}</p>
      <a
        href="/about.html"
        target={standalone ? undefined : "_blank"}
        rel={standalone ? undefined : "noopener"}
        onClick={() => {
          menu.current?.hidePopover();
        }}
      >
        About DriveMD
      </a>
      <SignOut
        account={email}
        onSignOut={onSignOut}
        onStay={() => {
          // The menu closed as the dialog opened.
          button.current?.focus();
        }}
      />
    </>
  );
}
