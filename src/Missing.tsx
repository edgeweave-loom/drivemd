/** Says that a part of the app could not load, with a way to reload it. */
export function Missing({ part }: { part: string }) {
  return (
    <p role="alert" className="failure">
      DriveMD could not load its {part}. Check your connection, then reload it.{" "}
      <button
        type="button"
        onClick={() => {
          window.location.reload();
        }}
      >
        Reload
      </button>
    </p>
  );
}
